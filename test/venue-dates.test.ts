import assert from "node:assert/strict";
import { test } from "node:test";
import { projectOrthographic, type Project } from "../src/index.ts";
import { createDemo } from "../web/demo.ts";
import { expectClose } from "./helpers.ts";

test("у залов разные геометрия и порталы, у дат разные плоты", () => {
  const { project } = createDemo();
  const [main, small] = project.listVenues();
  assert.ok(main && small);
  assert.equal(main.name, "Главный зал");
  assert.equal(small.name, "Малый зал");

  assert.deepEqual(
    project.listPlots(main.id).map((plot) => plot.date),
    ["2026-06-01", "2026-06-15"],
  );
  assert.deepEqual(
    project.listPlots(small.id).map((plot) => plot.date),
    ["2026-07-01", "2026-07-20"],
  );

  assert.deepEqual(
    project.listGeometry(main.id).map((entry) => entry.name),
    ["Сцена", "Задник"],
  );
  assert.deepEqual(
    project.listGeometry(small.id).map((entry) => entry.name),
    ["Камерная сцена"],
  );
  const mainStage = project.listGeometry(main.id)[0];
  const smallStage = project.listGeometry(small.id)[0];
  assert.equal(mainStage?.shape.kind, "box");
  assert.equal(smallStage?.shape.kind, "box");
  if (mainStage?.shape.kind === "box" && smallStage?.shape.kind === "box") {
    assert.equal(mainStage.shape.width, 16);
    assert.equal(smallStage.shape.width, 8);
  }

  assert.deepEqual(
    project.listSoundPortals(main.id).map((portal) => portal.name),
    ["Портал L", "Портал R"],
  );
  assert.deepEqual(
    project.listSoundPortals(small.id).map((portal) => portal.type),
    ["X8"],
  );
});

test("смена даты не затирает плот, порталы остаются у зала", () => {
  const { project } = createDemo();
  const main = project.listVenues()[0];
  const small = project.listVenues()[1];
  assert.ok(main && small);
  const [opening, encore] = project.listPlots(main.id);
  const [chamber] = project.listPlots(small.id);
  assert.ok(opening && encore && chamber);

  const front = project.listFixtures(opening.id)[0];
  const backlight = project.listFixtures(encore.id)[0];
  assert.ok(front && backlight);
  assert.equal(front.type, "Sharpy");
  assert.equal(backlight.type, "Aura");
  assert.deepEqual(front.address, { universe: 1, address: 11 });
  assert.deepEqual(backlight.address, { universe: 1, address: 11 });

  const layer = project.listLayers(encore.id, "light").find((entry) => entry.name === "Основной");
  assert.ok(layer);
  const added = project.addFixture(encore.id, {
    name: "Заливка",
    type: "Aura",
    discipline: "light",
    kind: "light-fixture",
    layerId: layer.id,
    transform: {
      position: { x: 1, y: 1, z: 6 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    address: { universe: 1, address: 22 },
  });

  assert.deepEqual(
    project.listFixtures(opening.id).map((fixture) => fixture.id),
    [front.id],
  );
  assert.equal(project.fixture(opening.id, front.id).type, "Sharpy");
  assert.equal(project.listFixtures(encore.id).some((fixture) => fixture.id === added), true);
  assert.equal(project.listFixtures(chamber.id).some((fixture) => fixture.id === front.id), false);

  const portals = project.listSoundPortals(main.id).map((portal) => portal.id).sort();
  assert.deepEqual(portalIds(project, main.id, opening.id), portals);
  assert.deepEqual(portalIds(project, main.id, encore.id), portals);
  for (const plotId of [opening.id, encore.id]) {
    for (const portalId of portals) {
      assert.equal(
        project.listFixtures(plotId).some((fixture) => fixture.id === portalId),
        false,
      );
    }
  }

  const openingPortals = portalPoints(project, main.id, opening.id);
  const encorePortals = portalPoints(project, main.id, encore.id);
  assert.equal(openingPortals.length, 2);
  assert.deepEqual(encorePortals, openingPortals);
  expectClose(openingPortals[0]?.x ?? 0, -9);
  expectClose(openingPortals[0]?.y ?? 0, 2);
  expectClose(openingPortals[1]?.x ?? 0, 9);

  const chamberPortals = portalIds(project, small.id, chamber.id);
  assert.equal(chamberPortals.length, 1);
  assert.equal(chamberPortals.some((id) => portals.includes(id)), false);
  assert.notDeepEqual(
    geometryIds(project, main.id, opening.id),
    geometryIds(project, small.id, chamber.id),
  );
  assert.deepEqual(
    geometryIds(project, main.id, opening.id),
    geometryIds(project, main.id, encore.id),
  );
});

function portalIds(project: Project, venueId: string, plotId: string): string[] {
  return Object.values(project.sceneGraph(venueId, plotId).nodes)
    .filter((node) => node.kind === "sound-portal" && node.permanence === "venue")
    .flatMap((node) => (node.sourceId ? [node.sourceId] : []))
    .sort();
}

function geometryIds(project: Project, venueId: string, plotId: string): string[] {
  return Object.values(project.sceneGraph(venueId, plotId).nodes)
    .filter((node) => node.kind === "geometry" && node.permanence === "venue")
    .flatMap((node) => (node.sourceId ? [node.sourceId] : []))
    .sort();
}

function portalPoints(project: Project, venueId: string, plotId: string): { x: number; y: number }[] {
  return projectOrthographic(project.sceneGraph(venueId, plotId), "top", { discipline: "sound" })
    .marks.filter((mark) => mark.nodeKind === "sound-portal" && mark.shape.kind === "point")
    .flatMap((mark) => (mark.shape.kind === "point" ? [mark.shape.at] : []))
    .sort((left, right) => left.x - right.x);
}
