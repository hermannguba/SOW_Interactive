import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACadVersion,
  CadDocument,
  Circle,
  DwgWriter,
  Line,
  LwPolyline,
  LwPolylineVertex,
  TextEntity,
  XY,
  XYZ,
} from "@node-projects/acad-ts";
import {
  Project,
  SceneError,
  parseDwgUnderlay,
  projectOrthographic,
  type Project as ProjectType,
  type SceneNode,
} from "../src/index.ts";
import { createDemo } from "../web/demo.ts";
import { expectClose } from "./helpers.ts";

test("разбор DWG даёт линии подложки и не создаёт приборы", () => {
  const bytes = drawing((doc) => {
    doc.modelSpace?.entities.add(new Line(new XYZ(0, 0, 0), new XYZ(4, 2, 3)));
    const poly = new LwPolyline([
      new LwPolylineVertex(new XY(-6, 1)),
      new LwPolylineVertex(new XY(6, 1)),
      new LwPolylineVertex(new XY(6, 8)),
      new LwPolylineVertex(new XY(-6, 8)),
    ]);
    poly.isClosed = true;
    doc.modelSpace?.entities.add(poly);
    doc.modelSpace?.entities.add(new Circle(new XYZ(5, 5, 1), 1));
    const text = new TextEntity();
    text.value = "Sharpy";
    text.insertPoint = new XYZ(1, 1, 1);
    doc.modelSpace?.entities.add(text);
  });

  const underlay = parseDwgUnderlay(bytes, "C:\\залы\\план.dwg");
  assert.equal(underlay.fileName, "план.dwg");
  assert.equal(JSON.stringify(underlay).includes("Sharpy"), false);

  const line = underlay.strokes.find((stroke) => stroke.points.length === 2);
  assert.ok(line);
  expectClose(line.points[0]?.x ?? 99, 0);
  expectClose(line.points[0]?.z ?? 99, 0);
  expectClose(line.points[1]?.x ?? 99, 4);
  expectClose(line.points[1]?.y ?? 99, 2);
  expectClose(line.points[1]?.z ?? 99, 3);

  const frame = underlay.strokes.find((stroke) =>
    stroke.points.some((point) => point.x === -6 && point.y === 8),
  );
  assert.ok(frame);
  assert.equal(frame.points[0]?.x, frame.points[frame.points.length - 1]?.x);
  assert.equal(frame.points[0]?.y, frame.points[frame.points.length - 1]?.y);

  const circle = underlay.strokes.find((stroke) => stroke.points.length > 8);
  assert.ok(circle);
  const onRadius = circle.points.some(
    (point) => Math.abs(Math.hypot(point.x - 5, point.y - 5) - 1) < 1e-6 && point.z === 1,
  );
  assert.equal(onRadius, true);

  const newer = drawing((doc) => {
    doc.modelSpace?.entities.add(new Line(new XYZ(1, 0, 0), new XYZ(2, 0, 0)));
  }, ACadVersion.AC1032);
  const modern = parseDwgUnderlay(newer, "newer.dwg");
  assert.equal(modern.strokes.length, 1);
  expectClose(modern.strokes[0]?.points[1]?.x ?? 0, 2);
});

test("пустой файл и не-DWG отвергаются, зал остаётся целым", () => {
  expectDwg(new Uint8Array(), "empty.dwg", "Файл пустой");
  expectDwg(new TextEncoder().encode("это текст"), "note.txt", "Это не файл DWG");
  expectDwg(
    new TextEncoder().encode("0\nSECTION\n2\nHEADER\n"),
    "plan.dxf",
    "Это не файл DWG",
  );
  const junk = new Uint8Array(64);
  junk.set(new TextEncoder().encode("AC1015"));
  assert.throws(
    () => parseDwgUnderlay(junk, "broken.dwg"),
    (error: unknown) => {
      assert.ok(error instanceof SceneError);
      assert.equal(error.code, "invalid-dwg");
      assert.equal(
        error.message === "Не удалось прочитать DWG" || error.message === "В DWG нет линий для подложки",
        true,
      );
      return true;
    },
  );
  expectDwg(drawing(() => {}), "blank.dwg", "В DWG нет линий для подложки");

  const { project, venueId, plotId } = createDemo();
  const before = fixtureIds(project, plotId);
  const underlay = parseDwgUnderlay(
    drawing((doc) => {
      doc.modelSpace?.entities.add(new Line(new XYZ(0, 1, 0), new XYZ(2, 1, 4)));
    }),
    "hall.dwg",
  );
  project.setUnderlay(venueId, underlay);
  assert.throws(
    () => parseDwgUnderlay(new TextEncoder().encode("нет"), "nope.txt"),
    (error: unknown) => error instanceof SceneError && error.message === "Это не файл DWG",
  );
  assert.equal(project.underlay(venueId)?.fileName, "hall.dwg");
  assert.deepEqual(fixtureIds(project, plotId), before);
  assert.equal(project.listFixtures(plotId).length, before.length);
});

test("подложка принадлежит залу и видна на всех его датах", () => {
  const { project, venueId } = createDemo();
  const [main, small] = project.listVenues();
  assert.ok(main && small);
  const [opening, encore] = project.listPlots(main.id);
  const [chamber] = project.listPlots(small.id);
  assert.ok(opening && encore && chamber);
  const fixturesBefore = project.listFixtures(opening.id).length + project.listFixtures(encore.id).length;

  const underlay = parseDwgUnderlay(
    drawing((doc) => {
      doc.modelSpace?.entities.add(new Line(new XYZ(-6, 1, 0), new XYZ(6, 1, 4)));
    }),
    "halls/main.dwg",
  );
  project.setUnderlay(main.id, underlay);
  const stored = project.underlay(main.id);
  assert.ok(stored);
  const first = stored.strokes[0]?.points[0] as { x: number } | undefined;
  assert.ok(first);
  first.x = 50;
  assert.notEqual(project.underlay(main.id)?.strokes[0]?.points[0]?.x, 50);

  const openingTop = underlayPoints(project, main.id, opening.id, "top");
  const encoreTop = underlayPoints(project, main.id, encore.id, "top");
  const openingSide = underlayPoints(project, main.id, opening.id, "side");
  const encoreSide = underlayPoints(project, main.id, encore.id, "side");
  assert.deepEqual(encoreTop, openingTop);
  assert.deepEqual(encoreSide, openingSide);
  expectClose(openingTop[0]?.x ?? 0, -6);
  expectClose(openingTop[0]?.y ?? 0, 1);
  expectClose(openingTop[1]?.x ?? 0, 6);
  expectClose(openingSide[1]?.y ?? 0, 4);

  for (const plotId of [opening.id, encore.id]) {
    const nodes: readonly SceneNode[] = Object.values(project.sceneGraph(main.id, plotId).nodes);
    assert.equal(nodes.some((node) => node.kind === "underlay" && node.permanence === "venue"), true);
    assert.equal(nodes.some((node) => node.kind === "underlay" && node.permanence === "plot"), false);
  }
  assert.equal(
    Object.values(project.sceneGraph(small.id, chamber.id).nodes).some((node) => node.kind === "underlay"),
    false,
  );
  assert.equal(project.underlay(small.id), null);
  assert.equal(
    project.listFixtures(opening.id).length + project.listFixtures(encore.id).length,
    fixturesBefore,
  );

  const light = projectOrthographic(project.sceneGraph(main.id, opening.id), "top", { discipline: "light" });
  const sound = projectOrthographic(project.sceneGraph(main.id, encore.id), "side", { discipline: "sound" });
  assert.equal(light.marks.some((mark) => mark.nodeKind === "underlay"), true);
  assert.equal(sound.marks.some((mark) => mark.nodeKind === "underlay"), true);

  const snapshot = project.toSnapshot();
  assert.equal(snapshot.venues.find((venue) => venue.id === main.id)?.underlay?.fileName, "main.dwg");
  assert.equal(snapshot.venues.find((venue) => venue.id === small.id)?.underlay, null);
  assert.equal(JSON.stringify(snapshot.venues[0]?.plots).includes("main.dwg"), false);
  const loaded = Project.fromSnapshot(snapshot);
  assert.deepEqual(loaded.underlay(main.id), project.underlay(main.id));

  const legacy = project.toSnapshot();
  const firstVenue = legacy.venues[0];
  assert.ok(firstVenue);
  const without = {
    ...legacy,
    venues: legacy.venues.map((venue) =>
      venue.id === firstVenue.id ? { ...venue, underlay: undefined } : venue,
    ),
  };
  assert.equal(Project.fromSnapshot(without).underlay(main.id), null);
});

function drawing(build: (document: CadDocument) => void, version = ACadVersion.AC1015): Uint8Array {
  const document = new CadDocument();
  const header = document.header;
  if (!header) throw new Error("нет заголовка DWG");
  header.version = version;
  build(document);
  return DwgWriter.writeToBuffer(document);
}

function expectDwg(bytes: Uint8Array, fileName: string, message: string): void {
  assert.throws(
    () => parseDwgUnderlay(bytes, fileName),
    (error: unknown) => {
      assert.ok(error instanceof SceneError);
      assert.equal(error.code, "invalid-dwg");
      assert.equal(error.message, message);
      return true;
    },
  );
}

function fixtureIds(project: ProjectType, plotId: string): string[] {
  return project.listFixtures(plotId).map((fixture) => fixture.id);
}

function underlayPoints(
  project: ProjectType,
  venueId: string,
  plotId: string,
  view: "top" | "side",
): { x: number; y: number }[] {
  return projectOrthographic(project.sceneGraph(venueId, plotId), view)
    .marks.filter((mark) => mark.nodeKind === "underlay" && mark.shape.kind === "polyline")
    .flatMap((mark) => (mark.shape.kind === "polyline" ? mark.shape.points : []));
}
