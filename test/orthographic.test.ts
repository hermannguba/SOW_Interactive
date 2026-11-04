import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  Project,
  findBySource,
  projectOrthographic,
  type OrthographicMark,
  type OrthographicProjection,
  type ViewPoint,
} from "../src/index.ts";
import { at, expectClose, expectError, sequentialIds } from "./helpers.ts";

function expectPoint(actual: ViewPoint, x: number, y: number): void {
  expectClose(actual.x, x);
  expectClose(actual.y, y);
}

function expectCorners(
  points: readonly ViewPoint[],
  expected: readonly (readonly [number, number])[],
): void {
  assert.equal(points.length, expected.length);
  for (const [x, y] of expected) {
    const found = points.some(
      (point) => Math.abs(point.x - x) < 1e-9 && Math.abs(point.y - y) < 1e-9,
    );
    assert.equal(found, true, `нет точки ${x}, ${y}`);
  }
}

function mark(view: OrthographicProjection, name: string): OrthographicMark {
  const found = view.marks.find((item) => item.name === name);
  assert.ok(found, name);
  return found;
}

function pointShape(item: OrthographicMark): { at: ViewPoint; heading: ViewPoint } {
  assert.equal(item.shape.kind, "point");
  if (item.shape.kind !== "point") throw new Error(item.name);
  return item.shape;
}

function hall() {
  const project = Project.create({ name: "Весна", ids: sequentialIds() });
  const venueId = project.addVenue({ name: "Зал" });
  const stageId = project.addGeometry(venueId, {
    name: "Сцена",
    shape: { kind: "box", width: 4, depth: 2, height: 6 },
    transform: at(10, 4, 5),
  });
  const wallId = project.addGeometry(venueId, {
    name: "Стойка",
    shape: {
      kind: "polyline",
      points: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 4 },
      ],
    },
    transform: at(3, 1, 0),
  });
  const boomId = project.addGeometry(venueId, {
    name: "Ферма зала",
    shape: {
      kind: "polyline",
      points: [
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
    },
    transform: at(3, 0, 1),
  });
  const turnedId = project.addGeometry(venueId, {
    name: "Поворот",
    shape: { kind: "box", width: 4, depth: 2, height: 2 },
    transform: at(0, 0, 0, { z: 90 }),
  });
  const portalId = project.addSoundPortal(venueId, {
    name: "Портал L",
    type: "K1",
    transform: at(-9, 2, 1, { z: 90 }),
  });
  const plotId = project.addPlot(venueId, { date: "2026-06-01" });
  const front = project.addLayer(plotId, { name: "Фронт", discipline: "light" });
  const back = project.addLayer(plotId, { name: "Тыл", discipline: "light" });
  const pa = project.addLayer(plotId, { name: "Звук", discipline: "sound" });
  const screen = project.addLayer(plotId, { name: "Экран", discipline: "video" });
  const bar = project.addFixture(plotId, {
    name: "Ферма",
    type: "Truss",
    discipline: "light",
    kind: "light-fixture",
    layerId: front,
    transform: at(10, 0, 0, { z: 90 }),
    address: { universe: 1, address: 1 },
  });
  const spot = project.addFixture(plotId, {
    name: "Пятно",
    type: "Sharpy",
    discipline: "light",
    kind: "light-fixture",
    layerId: front,
    parentId: bar,
    transform: at(1, 0, 0),
    address: { universe: 1, address: 10 },
  });
  const wash = project.addFixture(plotId, {
    name: "Залив",
    type: "Aura",
    discipline: "light",
    kind: "light-fixture",
    layerId: back,
    transform: at(-2, 3, 6),
    address: { universe: 1, address: 40 },
  });
  const speaker = project.addFixture(plotId, {
    name: "Колонка",
    type: "X12",
    discipline: "sound",
    kind: "active-speaker",
    layerId: pa,
    transform: at(4, 1, 2, { z: 90 }),
  });
  const led = project.addFixture(plotId, {
    name: "Экран",
    type: "P3",
    discipline: "video",
    kind: "led-screen",
    layerId: screen,
    transform: at(0, 8, 4),
  });
  return {
    project,
    venueId,
    plotId,
    stageId,
    wallId,
    boomId,
    turnedId,
    portalId,
    front,
    back,
    pa,
    screen,
    bar,
    spot,
    wash,
    speaker,
    led,
  };
}

describe("проекция сверху и сбоку", () => {
  test("сверху оставляет ширину и глубину, сбоку — ширину и высоту", () => {
    const rig = hall();
    const graph = rig.project.sceneGraph(rig.venueId, rig.plotId);
    const top = projectOrthographic(graph, "top");
    const side = projectOrthographic(graph, "side");

    assert.deepEqual(top.axes, { horizontal: "x", vertical: "y", dropped: "z" });
    assert.deepEqual(side.axes, { horizontal: "x", vertical: "z", dropped: "y" });

    const topWash = pointShape(mark(top, "Залив"));
    const sideWash = pointShape(mark(side, "Залив"));
    expectPoint(topWash.at, -2, 3);
    expectPoint(topWash.heading, 1, 0);
    expectPoint(sideWash.at, -2, 6);
    expectPoint(sideWash.heading, 1, 0);

    const topSpeaker = pointShape(mark(top, "Колонка"));
    const sideSpeaker = pointShape(mark(side, "Колонка"));
    expectPoint(topSpeaker.at, 4, 1);
    expectPoint(topSpeaker.heading, 0, 1);
    expectPoint(sideSpeaker.at, 4, 2);
    expectPoint(sideSpeaker.heading, 0, 0);

    const topPortal = pointShape(mark(top, "Портал L"));
    expectPoint(topPortal.at, -9, 2);
    expectPoint(topPortal.heading, 0, 1);
    assert.equal(mark(top, "Портал L").permanence, "venue");
    assert.equal(mark(top, "Портал L").nodeKind, "sound-portal");
  });

  test("прибор на родителе проецируется в координатах зала", () => {
    const rig = hall();
    const graph = rig.project.sceneGraph(rig.venueId, rig.plotId);
    const top = projectOrthographic(graph, "top");
    const side = projectOrthographic(graph, "side");
    const topSpot = pointShape(mark(top, "Пятно"));
    const sideSpot = pointShape(mark(side, "Пятно"));
    expectPoint(topSpot.at, 10, 1);
    expectPoint(topSpot.heading, 0, 1);
    expectPoint(sideSpot.at, 10, 0);
    expectPoint(sideSpot.heading, 0, 0);
    assert.equal(mark(top, "Пятно").layerId, rig.front);
    assert.equal(mark(top, "Пятно").discipline, "light");
  });

  test("геометрия зала становится контуром, ломаная вдоль высоты схлопывается сверху", () => {
    const rig = hall();
    const graph = rig.project.sceneGraph(rig.venueId, rig.plotId);
    const top = projectOrthographic(graph, "top");
    const side = projectOrthographic(graph, "side");

    const topStage = mark(top, "Сцена").shape;
    const sideStage = mark(side, "Сцена").shape;
    assert.equal(topStage.kind, "polygon");
    assert.equal(sideStage.kind, "polygon");
    if (topStage.kind === "polygon") {
      expectCorners(topStage.points, [
        [8, 3],
        [12, 3],
        [12, 5],
        [8, 5],
      ]);
    }
    if (sideStage.kind === "polygon") {
      expectCorners(sideStage.points, [
        [8, 2],
        [12, 2],
        [12, 8],
        [8, 8],
      ]);
    }

    const turned = mark(top, "Поворот").shape;
    assert.equal(turned.kind, "polygon");
    if (turned.kind === "polygon") {
      expectCorners(turned.points, [
        [-1, 2],
        [1, 2],
        [1, -2],
        [-1, -2],
      ]);
    }

    const topWall = mark(top, "Стойка").shape;
    const sideWall = mark(side, "Стойка").shape;
    assert.equal(topWall.kind, "polyline");
    assert.equal(sideWall.kind, "polyline");
    if (topWall.kind === "polyline") expectCorners(topWall.points, [[3, 1]]);
    if (sideWall.kind === "polyline") {
      expectCorners(sideWall.points, [
        [3, 0],
        [3, 4],
      ]);
    }

    const topBoom = mark(top, "Ферма зала").shape;
    const sideBoom = mark(side, "Ферма зала").shape;
    assert.equal(topBoom.kind, "polyline");
    assert.equal(sideBoom.kind, "polyline");
    if (topBoom.kind === "polyline") {
      expectCorners(topBoom.points, [
        [3, 0],
        [5, 0],
      ]);
    }
    if (sideBoom.kind === "polyline") {
      expectCorners(sideBoom.points, [
        [3, 1],
        [5, 1],
      ]);
    }
  });
});

describe("фильтр проекции", () => {
  test("слой внутри дисциплины оставляет геометрию и прячет чужие приборы", () => {
    const rig = hall();
    const graph = rig.project.sceneGraph(rig.venueId, rig.plotId);
    const query = { discipline: "light" as const, layerIds: [rig.front] };
    const top = projectOrthographic(graph, "top", query);
    const side = projectOrthographic(graph, "side", query);
    const names = ["Сцена", "Стойка", "Ферма зала", "Поворот", "Ферма", "Пятно"];
    assert.deepEqual(
      top.marks.map((item) => item.name),
      names,
    );
    assert.deepEqual(
      side.marks.map((item) => item.sourceId),
      top.marks.map((item) => item.sourceId),
    );
    assert.equal(top.marks.some((item) => item.nodeKind === "sound-portal"), false);
    assert.equal(top.marks.some((item) => item.name === "Залив"), false);
    assert.equal(top.marks.some((item) => item.name === "Колонка"), false);
    assert.equal(top.marks.some((item) => item.name === "Экран"), false);

    const sound = projectOrthographic(graph, "top", { discipline: "sound", layerIds: [] });
    assert.deepEqual(
      sound.marks.map((item) => item.name),
      ["Сцена", "Стойка", "Ферма зала", "Поворот", "Портал L"],
    );

    const video = projectOrthographic(graph, "side", { discipline: "video", layerIds: [rig.screen] });
    assert.equal(video.marks.at(-1)?.name, "Экран");
    assert.equal(video.marks.some((item) => item.nodeKind === "sound-portal"), false);
  });

  test("проекция не меняет граф", () => {
    const rig = hall();
    const graph = rig.project.sceneGraph(rig.venueId, rig.plotId);
    const spot = findBySource(graph, rig.spot);
    assert.ok(spot);
    const before = spot.transform.position.x;
    const view = projectOrthographic(graph, "top", { discipline: "light", layerIds: [rig.front] });
    assert.equal(findBySource(graph, rig.spot), spot);
    assert.equal(spot.transform.position.x, before);
    assert.equal(Object.isFrozen(view.marks[0]), true);
    assert.throws(() => {
      (view.marks[0] as { name: string }).name = "Другое";
    });
    expectError(() => projectOrthographic(graph, "top", { layerIds: [rig.front] }), "invalid-query");
    expectError(() => projectOrthographic(graph, "front" as "top"), "invalid-query");
  });

  test("пустой плот проецирует постоянное зала", () => {
    const project = Project.create({ name: "Пусто", ids: sequentialIds() });
    const venueId = project.addVenue({ name: "Зал" });
    project.addGeometry(venueId, {
      name: "Сцена",
      shape: { kind: "box", width: 2, depth: 2, height: 1 },
      transform: at(0, 0, 0),
    });
    project.addSoundPortal(venueId, {
      name: "Портал",
      type: "K2",
      transform: at(1, 0, 2),
    });
    const plotId = project.addPlot(venueId, { date: "2026-01-01" });
    const view = projectOrthographic(project.sceneGraph(venueId, plotId), "side");
    assert.deepEqual(
      view.marks.map((item) => item.nodeKind),
      ["geometry", "sound-portal"],
    );
    const portal = pointShape(mark(view, "Портал"));
    expectPoint(portal.at, 1, 2);
  });
});
