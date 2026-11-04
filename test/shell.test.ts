import assert from "node:assert/strict";
import { test } from "node:test";
import { projectOrthographic } from "../src/index.ts";
import { createDemo } from "../web/demo.ts";
import { libraryFor } from "../web/library.ts";
import {
  frameOf,
  hitMark,
  nextAddress,
  viewBoxOf,
  viewPointFromSvg,
  worldFromView,
} from "../web/place.ts";
import { expectClose } from "./helpers.ts";

test("библиотека совпадает с дисциплиной", () => {
  assert.deepEqual(
    libraryFor("light").map((item) => item.kind),
    ["light-fixture", "light-fixture"],
  );
  assert.deepEqual(libraryFor("sound").map((item) => item.kind), ["active-speaker"]);
  assert.deepEqual(libraryFor("video").map((item) => item.kind), [
    "led-screen",
    "floor-prompter",
    "tv-on-stand",
  ]);
});

test("демо-зал хранит портал, геометрия видна в свете, портал только в звуке", () => {
  const demo = createDemo();
  assert.equal(demo.project.name, "Демо");
  assert.equal(demo.project.listVenues()[0]?.name, "Главный зал");
  assert.equal(demo.project.listPlots(demo.venueId)[0]?.date, "2026-06-01");
  assert.equal(demo.project.listFixtures(demo.plotId).length, 0);
  assert.equal(demo.project.listSoundPortals(demo.venueId).length, 1);
  const portal = demo.project.listSoundPortals(demo.venueId)[0];
  assert.ok(portal);
  assert.notEqual(portal.transform.position.y, portal.transform.position.z);

  const graph = demo.project.sceneGraph(demo.venueId, demo.plotId);
  const light = projectOrthographic(graph, "top", { discipline: "light" });
  assert.equal(light.marks.some((mark) => mark.nodeKind === "geometry"), true);
  assert.equal(light.marks.some((mark) => mark.nodeKind === "sound-portal"), false);

  const top = projectOrthographic(graph, "top", { discipline: "sound" });
  const side = projectOrthographic(graph, "side", { discipline: "sound" });
  const topPortal = top.marks.find((mark) => mark.nodeKind === "sound-portal");
  const sidePortal = side.marks.find((mark) => mark.nodeKind === "sound-portal");
  assert.equal(topPortal?.shape.kind, "point");
  assert.equal(sidePortal?.shape.kind, "point");
  if (topPortal?.shape.kind === "point" && sidePortal?.shape.kind === "point") {
    expectClose(topPortal.shape.at.x, portal.transform.position.x);
    expectClose(topPortal.shape.at.y, portal.transform.position.y);
    expectClose(sidePortal.shape.at.x, portal.transform.position.x);
    expectClose(sidePortal.shape.at.y, portal.transform.position.z);
  }
});

test("постановка сверху берёт высоту по умолчанию, сбоку — глубину", () => {
  const top = worldFromView("top", { x: 3, y: 4 }, "light-fixture");
  assert.deepEqual(top.position, { x: 3, y: 4, z: 6 });
  const side = worldFromView("side", { x: 3, y: 4 }, "light-fixture");
  assert.deepEqual(side.position, { x: 3, y: 0, z: 4 });
  const screen = worldFromView("top", { x: 1, y: 2 }, "led-screen");
  assert.equal(screen.position.z, 4);
});

test("кадр и лист переворачивают высоту вверх", () => {
  const frame = frameOf([], 2);
  assert.equal(frame.width, 20);
  const box = viewBoxOf({ minX: -2, minY: -2, width: 14, height: 12 });
  assert.equal(box.y, -10);
  assert.deepEqual(viewPointFromSvg(0, -8), { x: 0, y: 8 });
});

test("попадание выбирает ближайшую точку и пропускает контур", () => {
  const stage = {
    nodeId: "g",
    sourceId: "stage",
    name: "Сцена",
    nodeKind: "geometry" as const,
    discipline: null,
    layerId: null,
    permanence: "venue" as const,
    shape: { kind: "polygon" as const, points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }] },
  };
  const near = pointMark("a", 1, 1);
  const far = pointMark("b", 5, 5);
  assert.equal(hitMark([stage, near, far], { x: 1.2, y: 1.1 }, 0.75)?.sourceId, "a");
  assert.equal(hitMark([stage, near, far], { x: 3, y: 3 }, 0.75), null);
  assert.equal(hitMark([near, far], { x: 2, y: 2 }, 3)?.sourceId, "a");
  assert.equal(hitMark([near, far], { x: 3, y: 3 }, 3)?.sourceId, "b");
});

test("следующий адрес занимает первую свободную пару", () => {
  const demo = createDemo();
  const layerId = demo.project.listLayers(demo.plotId, "light")[0]?.id;
  assert.ok(layerId);
  const transform = { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } };
  demo.project.addFixture(demo.plotId, {
    name: "A",
    type: "Sharpy",
    discipline: "light",
    kind: "light-fixture",
    layerId,
    transform,
    address: { universe: 1, address: 1 },
  });
  demo.project.addFixture(demo.plotId, {
    name: "B",
    type: "Sharpy",
    discipline: "light",
    kind: "light-fixture",
    layerId,
    transform,
    address: { universe: 1, address: 3 },
  });
  assert.deepEqual(nextAddress(demo.project.listFixtures(demo.plotId, { discipline: "light" })), {
    universe: 1,
    address: 2,
  });
});

function pointMark(sourceId: string, x: number, y: number) {
  return {
    nodeId: sourceId,
    sourceId,
    name: sourceId,
    nodeKind: "light-fixture" as const,
    discipline: "light" as const,
    layerId: "layer",
    permanence: "plot" as const,
    shape: {
      kind: "point" as const,
      at: { x, y },
      heading: { x: 1, y: 0 },
    },
  };
}
