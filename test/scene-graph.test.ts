import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  Project,
  buildSceneGraph,
  children,
  filterScene,
  findBySource,
  walk,
  worldMatrix,
  worldPosition,
} from "../src/index.ts";
import { at, expectError, expectVec, sequentialIds } from "./helpers.ts";

function rig() {
  const project = Project.create({ name: "Весна", ids: sequentialIds() });
  const venueId = project.addVenue({ name: "Главный зал" });
  const stageId = project.addGeometry(venueId, {
    name: "Сцена",
    shape: { kind: "box", width: 12, depth: 8, height: 1 },
    transform: at(0, 4, 0),
  });
  const portalId = project.addSoundPortal(venueId, {
    name: "Портал L",
    type: "K1",
    transform: at(-9, 2, 1),
  });
  const june = project.addPlot(venueId, { date: "2026-06-01" });
  const july = project.addPlot(venueId, { date: "2026-07-01" });
  const front = project.addLayer(june, { name: "Фронт", discipline: "light" });
  const back = project.addLayer(june, { name: "Тыл", discipline: "light" });
  const pa = project.addLayer(june, { name: "Зал", discipline: "sound" });
  const screen = project.addLayer(june, { name: "Экран", discipline: "video" });
  const prompts = project.addLayer(june, { name: "Суфлёр", discipline: "video" });
  const julyFront = project.addLayer(july, { name: "Фронт", discipline: "light" });

  const bar = project.addFixture(june, {
    name: "Ферма",
    type: "Truss",
    discipline: "light",
    kind: "light-fixture",
    layerId: front,
    transform: at(10, 0, 0, { z: 90 }),
    address: { universe: 1, address: 1 },
  });
  const spot = project.addFixture(june, {
    name: "Пятно",
    type: "Sharpy",
    discipline: "light",
    kind: "light-fixture",
    layerId: front,
    parentId: bar,
    transform: at(1, 0, 0),
    address: { universe: 1, address: 10 },
  });
  const wash = project.addFixture(june, {
    name: "Залив",
    type: "Aura",
    discipline: "light",
    kind: "light-fixture",
    layerId: back,
    transform: at(-2, 3, 6),
    address: { universe: 1, address: 40 },
  });
  const speaker = project.addFixture(june, {
    name: "Колонка",
    type: "X12",
    discipline: "sound",
    kind: "active-speaker",
    layerId: pa,
    transform: at(4, 1, 2),
  });
  const led = project.addFixture(june, {
    name: "Экран",
    type: "P3",
    discipline: "video",
    kind: "led-screen",
    layerId: screen,
    transform: at(0, 8, 4),
  });
  project.addFixture(june, {
    name: "Пол",
    type: "LCD",
    discipline: "video",
    kind: "floor-prompter",
    layerId: prompts,
    transform: at(1, 1, 0),
  });
  project.addFixture(june, {
    name: "ТВ",
    type: "TV-55",
    discipline: "video",
    kind: "tv-on-stand",
    layerId: prompts,
    transform: at(3, 1, 1.2),
  });
  const julySpot = project.addFixture(july, {
    name: "Июльское пятно",
    type: "Sharpy",
    discipline: "light",
    kind: "light-fixture",
    layerId: julyFront,
    transform: at(5, 5, 5),
    address: { universe: 1, address: 1 },
  });

  return {
    project,
    venueId,
    stageId,
    portalId,
    june,
    july,
    front,
    back,
    pa,
    screen,
    prompts,
    bar,
    spot,
    wash,
    speaker,
    led,
    julySpot,
  };
}

describe("один граф на дату", () => {
  test("зал общий для дат, плот — нет", () => {
    const hall = rig();
    const juneGraph = hall.project.sceneGraph(hall.venueId, hall.june);
    const julyGraph = hall.project.sceneGraph(hall.venueId, hall.july);

    assert.equal(juneGraph.date, "2026-06-01");
    assert.equal(julyGraph.date, "2026-07-01");
    assert.equal(findBySource(juneGraph, hall.portalId)?.permanence, "venue");
    assert.equal(findBySource(julyGraph, hall.portalId)?.kind, "sound-portal");
    assert.equal(findBySource(juneGraph, hall.spot)?.discipline, "light");
    assert.equal(findBySource(julyGraph, hall.spot), null);
    assert.equal(findBySource(juneGraph, hall.julySpot), null);
    assert.equal(findBySource(julyGraph, hall.julySpot)?.catalogType, "Sharpy");

    const before = worldPosition(juneGraph, findBySource(juneGraph, hall.portalId)!.id);
    hall.project.setSoundPortalTransform(hall.venueId, hall.portalId, at(1, 1, 1));
    expectVec(worldPosition(juneGraph, findBySource(juneGraph, hall.portalId)!.id), before.x, before.y, before.z);
    const rebuiltJune = hall.project.sceneGraph(hall.venueId, hall.june);
    const rebuiltJuly = hall.project.sceneGraph(hall.venueId, hall.july);
    expectVec(worldPosition(rebuiltJune, findBySource(rebuiltJune, hall.portalId)!.id), 1, 1, 1);
    expectVec(worldPosition(rebuiltJuly, findBySource(rebuiltJuly, hall.portalId)!.id), 1, 1, 1);

    const other = hall.project.addVenue({ name: "Малый" });
    const otherPlot = hall.project.addPlot(other, { date: "2026-06-01" });
    expectError(() => hall.project.sceneGraph(other, hall.june), "plot-venue-mismatch");
    expectError(() => buildSceneGraph(hall.project.toSnapshot(), other, hall.june), "plot-venue-mismatch");
    assert.equal(hall.project.sceneGraph(other, otherPlot).date, "2026-06-01");
  });

  test("прибор без родителя стоит в координатах зала, ребёнок — относительно родителя", () => {
    const hall = rig();
    const graph = hall.project.sceneGraph(hall.venueId, hall.june);
    const spot = findBySource(graph, hall.spot);
    const bar = findBySource(graph, hall.bar);
    const wash = findBySource(graph, hall.wash);
    assert.ok(spot && bar && wash);
    expectVec(worldPosition(graph, wash.id), -2, 3, 6);
    expectVec(worldPosition(graph, bar.id), 10, 0, 0);
    expectVec(worldPosition(graph, spot.id), 10, 1, 0);
    assert.deepEqual(hall.project.fixture(hall.june, hall.spot).transform.position, { x: 1, y: 0, z: 0 });

    hall.project.setFixtureParent(hall.june, hall.spot, null);
    assert.deepEqual(hall.project.fixture(hall.june, hall.spot).transform.position, { x: 1, y: 0, z: 0 });
    const detached = hall.project.sceneGraph(hall.venueId, hall.june);
    expectVec(worldPosition(detached, findBySource(detached, hall.spot)!.id), 1, 0, 0);
    expectVec(worldPosition(graph, spot.id), 10, 1, 0);
  });

  test("обход идёт от зала к приборам, узлы заморожены", () => {
    const hall = rig();
    const graph = hall.project.sceneGraph(hall.venueId, hall.june);
    const names = walk(graph).map((node) => node.name);
    assert.deepEqual(names.slice(0, 5), ["Главный зал · 2026-06-01", "Главный зал", "Сцена", "Портал L", "2026-06-01"]);
    assert.deepEqual(children(graph, graph.rootId).map((node) => node.kind), ["venue", "plot"]);
    const spot = findBySource(graph, hall.spot)!;
    assert.equal(spot.address?.address, 10);
    assert.equal(findBySource(graph, hall.speaker)?.address, null);
    assert.equal(findBySource(graph, hall.stageId)?.shape?.kind, "box");
    assert.equal(Object.isFrozen(spot), true);
    assert.throws(() => {
      (spot as { name: string }).name = "Другое";
    });
    const again = hall.project.sceneGraph(hall.venueId, hall.june);
    assert.deepEqual(Object.keys(graph.nodes), Object.keys(again.nodes));
    assert.notEqual(graph.nodes[graph.rootId], again.nodes[again.rootId]);
    assert.equal(worldMatrix(graph, graph.rootId)[12], 0);
  });
});

describe("фильтр слоя внутри дисциплины", () => {
  test("один граф содержит все дисциплины, фильтр только читает его", () => {
    const hall = rig();
    const graph = hall.project.sceneGraph(hall.venueId, hall.june);
    const kinds = new Set(walk(graph).map((node) => node.kind));
    for (const kind of [
      "geometry",
      "sound-portal",
      "light-fixture",
      "active-speaker",
      "led-screen",
      "floor-prompter",
      "tv-on-stand",
    ] as const) {
      assert.equal(kinds.has(kind), true, kind);
    }

    const front = filterScene(graph, { discipline: "light", layerIds: [hall.front] });
    assert.deepEqual(front.map((node) => node.sourceId), [hall.stageId, hall.bar, hall.spot]);
    assert.equal(front[0], findBySource(graph, hall.stageId));
    assert.equal(walk(graph).length, 12);

    const sound = filterScene(graph, { discipline: "sound", layerIds: [hall.pa] });
    assert.deepEqual(
      sound.map((node) => node.kind),
      ["geometry", "sound-portal", "active-speaker"],
    );

    const soundOff = filterScene(graph, { discipline: "sound", layerIds: [] });
    assert.deepEqual(
      soundOff.map((node) => node.kind),
      ["geometry", "sound-portal"],
    );

    const video = filterScene(graph, { discipline: "video", layerIds: [hall.prompts] });
    assert.deepEqual(
      video.map((node) => node.kind),
      ["geometry", "floor-prompter", "tv-on-stand"],
    );
    assert.equal(video.some((node) => node.kind === "sound-portal"), false);

    const allLight = filterScene(graph, { discipline: "light" });
    assert.equal(allLight.filter((node) => node.kind === "light-fixture").length, 3);
    assert.equal(allLight.some((node) => node.kind === "sound-portal"), false);

    expectError(() => filterScene(graph, { layerIds: [hall.front] }), "invalid-query");
    const foreignLayer = filterScene(graph, { discipline: "light", layerIds: [hall.pa] });
    assert.deepEqual(foreignLayer.map((node) => node.kind), ["geometry"]);
  });

  test("пустой плот всё равно показывает постоянное зала", () => {
    const project = Project.create({ name: "Пусто", ids: sequentialIds() });
    const venueId = project.addVenue({ name: "Зал" });
    project.addGeometry(venueId, {
      name: "Сцена",
      shape: { kind: "box", width: 4, depth: 4, height: 1 },
      transform: at(0, 0, 0),
    });
    const portalId = project.addSoundPortal(venueId, {
      name: "Портал",
      type: "K2",
      transform: at(0, 0, 0),
    });
    const plotId = project.addPlot(venueId, { date: "2026-01-01" });
    const graph = project.sceneGraph(venueId, plotId);
    assert.deepEqual(filterScene(graph, {}).map((node) => node.sourceId), [
      project.listGeometry(venueId)[0]?.id,
      portalId,
    ]);
    expectError(() => project.sceneGraph(venueId, "нет"), "unknown-plot");
  });
});
