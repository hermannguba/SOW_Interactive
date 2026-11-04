import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  DEFAULT_CAMERA,
  Project,
  filterScene,
  projectOrthographic,
  projectPerspective,
  type OrthographicMark,
  type ViewPoint,
} from "../src/index.ts";
import { at, expectError, sequentialIds } from "./helpers.ts";

function pointOf(mark: OrthographicMark): ViewPoint {
  assert.equal(mark.shape.kind, "point");
  if (mark.shape.kind !== "point") throw new Error(mark.name);
  return mark.shape.at;
}

function idsOf(marks: readonly OrthographicMark[]): string[] {
  return marks.map((mark) => mark.nodeId);
}

function rig() {
  const project = Project.create({ name: "Весна", ids: sequentialIds() });
  const venueId = project.addVenue({ name: "Зал" });
  const stageId = project.addGeometry(venueId, {
    name: "Сцена",
    shape: { kind: "box", width: 4, depth: 2, height: 1 },
    transform: at(0, 4, 0.5),
  });
  project.setUnderlay(venueId, {
    fileName: "зал.dwg",
    strokes: [
      {
        points: [
          { x: -2, y: 0, z: 0 },
          { x: 2, y: 0, z: 0 },
        ],
      },
    ],
  });
  const portalId = project.addSoundPortal(venueId, {
    name: "Портал L",
    type: "K1",
    transform: at(-9, 2, 4),
  });
  const plotId = project.addPlot(venueId, { date: "2026-06-01" });
  const front = project.addLayer(plotId, { name: "Фронт", discipline: "light" });
  const back = project.addLayer(plotId, { name: "Тыл", discipline: "light" });
  const low = project.addFixture(plotId, {
    name: "Низ",
    type: "Sharpy",
    discipline: "light",
    kind: "light-fixture",
    layerId: front,
    transform: at(1, 2, 1),
    address: { universe: 1, address: 1 },
  });
  const high = project.addFixture(plotId, {
    name: "Верх",
    type: "Aura",
    discipline: "light",
    kind: "light-fixture",
    layerId: front,
    transform: at(1, 2, 9),
    address: { universe: 1, address: 2 },
  });
  const wash = project.addFixture(plotId, {
    name: "Залив",
    type: "Aura",
    discipline: "light",
    kind: "light-fixture",
    layerId: back,
    transform: at(-2, 3, 6),
    address: { universe: 1, address: 3 },
  });
  const encore = project.addPlot(venueId, { date: "2026-06-15" });
  const otherVenue = project.addVenue({ name: "Малый" });
  const otherStage = project.addGeometry(otherVenue, {
    name: "Камерная",
    shape: { kind: "box", width: 2, depth: 2, height: 1 },
    transform: at(0, 0, 0),
  });
  const otherPlot = project.addPlot(otherVenue, { date: "2026-07-01" });
  return {
    project,
    venueId,
    plotId,
    stageId,
    portalId,
    front,
    back,
    low,
    high,
    wash,
    encore,
    otherVenue,
    otherStage,
    otherPlot,
  };
}

describe("вид 3D", () => {
  test("читает тот же граф и тот же фильтр, что виды сверху и сбоку", () => {
    const hall = rig();
    const graph = hall.project.sceneGraph(hall.venueId, hall.plotId);
    const query = { discipline: "light" as const, layerIds: [hall.front] };
    const beforeGraph = JSON.stringify(graph);
    const beforeDocument = JSON.stringify(hall.project.toSnapshot());
    const seen = filterScene(graph, query).map((node) => node.id);
    const view = projectPerspective(graph, DEFAULT_CAMERA, query);
    assert.equal(view.view, "3d");
    assert.deepEqual(idsOf(view.marks), seen);
    assert.deepEqual(idsOf(projectOrthographic(graph, "top", query).marks), seen);
    assert.deepEqual(idsOf(projectOrthographic(graph, "side", query).marks), seen);
    assert.equal(JSON.stringify(graph), beforeGraph);
    assert.equal(JSON.stringify(hall.project.toSnapshot()), beforeDocument);
    assert.equal(hall.project.toSnapshot().version, 1);
    assert.equal(view.marks.some((mark) => mark.name === "Залив"), false);
    assert.equal(view.marks.some((mark) => mark.nodeKind === "sound-portal"), false);
    assert.equal(view.marks.some((mark) => mark.nodeKind === "underlay"), true);
    assert.equal(view.marks.some((mark) => mark.sourceId === hall.stageId), true);
    const low = view.marks.find((mark) => mark.sourceId === hall.low);
    const high = view.marks.find((mark) => mark.sourceId === hall.high);
    assert.ok(low && high);
    const lowAt = pointOf(low);
    const highAt = pointOf(high);
    assert.notEqual(lowAt.y, highAt.y);
    assert.ok(highAt.y > lowAt.y);
    assert.equal(Object.isFrozen(view.marks), true);
    expectError(() => projectPerspective(graph, DEFAULT_CAMERA, { layerIds: [hall.front] }), "invalid-query");
    expectError(
      () => projectPerspective(graph, { ...DEFAULT_CAMERA, distance: 0 }),
      "invalid-query",
    );
  });

  test("подложка и порталы подчиняются тому же фильтру, дата и зал не смешиваются", () => {
    const hall = rig();
    const light = projectPerspective(hall.project.sceneGraph(hall.venueId, hall.plotId), DEFAULT_CAMERA, {
      discipline: "light",
    });
    const sound = projectPerspective(hall.project.sceneGraph(hall.venueId, hall.plotId), DEFAULT_CAMERA, {
      discipline: "sound",
    });
    const underlay = light.marks.find((mark) => mark.nodeKind === "underlay");
    assert.equal(underlay?.shape.kind, "polyline");
    if (underlay?.shape.kind === "polyline") assert.equal(underlay.shape.points.length, 2);
    assert.equal(light.marks.some((mark) => mark.nodeKind === "sound-portal"), false);
    assert.equal(sound.marks.some((mark) => mark.sourceId === hall.portalId), true);
    assert.equal(sound.marks.some((mark) => mark.sourceId === hall.low), false);
    assert.deepEqual(
      idsOf(sound.marks),
      filterScene(hall.project.sceneGraph(hall.venueId, hall.plotId), { discipline: "sound" }).map(
        (node) => node.id,
      ),
    );

    const encore = projectPerspective(hall.project.sceneGraph(hall.venueId, hall.encore), DEFAULT_CAMERA, {
      discipline: "light",
    });
    assert.equal(encore.marks.some((mark) => mark.sourceId === hall.low), false);
    assert.equal(encore.marks.some((mark) => mark.sourceId === hall.stageId), true);
    assert.equal(encore.marks.some((mark) => mark.nodeKind === "underlay"), true);

    const other = projectPerspective(
      hall.project.sceneGraph(hall.otherVenue, hall.otherPlot),
      DEFAULT_CAMERA,
      { discipline: "light" },
    );
    assert.deepEqual(
      other.marks.map((mark) => mark.sourceId),
      [hall.otherStage],
    );
    const portal = sound.marks.find((mark) => mark.sourceId === hall.portalId);
    assert.ok(portal);
    assert.equal(portal.nodeKind, "sound-portal");
    assert.equal(pointOf(portal).x !== 0 || pointOf(portal).y !== 0, true);
  });
});
