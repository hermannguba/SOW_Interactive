import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Project, type PlotSnapshot, type ProjectSnapshot } from "../src/index.ts";
import { at, expectError, sequentialIds } from "./helpers.ts";

function withPlot(snapshot: ProjectSnapshot, plot: PlotSnapshot): ProjectSnapshot {
  const venue = snapshot.venues[0];
  assert.ok(venue);
  return {
    ...snapshot,
    venues: [{ ...venue, plots: [...venue.plots, plot] }, ...snapshot.venues.slice(1)],
  };
}

function show() {
  const project = Project.create({ name: "  Весна  ", ids: sequentialIds() });
  const venueId = project.addVenue({ name: " Главный зал " });
  const stageId = project.addGeometry(venueId, {
    name: "Сцена",
    shape: { kind: "box", width: 16, depth: 10, height: 1.2 },
    transform: at(0, 0, 0),
  });
  const wallId = project.addGeometry(venueId, {
    name: "Портал стена",
    shape: {
      kind: "polyline",
      points: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 8 },
      ],
    },
    transform: at(-8, 0, 0),
  });
  const portalId = project.addSoundPortal(venueId, {
    name: "Портал L",
    type: "K1",
    transform: at(-9, 2, 0),
  });
  const plotId = project.addPlot(venueId, { date: "2026-06-01" });
  const frontId = project.addLayer(plotId, { name: "Фронт", discipline: "light" });
  const backId = project.addLayer(plotId, { name: "Тыл", discipline: "light" });
  const paId = project.addLayer(plotId, { name: "Порталы", discipline: "sound" });
  const screenId = project.addLayer(plotId, { name: "Экран", discipline: "video" });
  const promptId = project.addLayer(plotId, { name: "Суфлёр", discipline: "video" });
  return {
    project,
    venueId,
    stageId,
    wallId,
    portalId,
    plotId,
    frontId,
    backId,
    paId,
    screenId,
    promptId,
  };
}

describe("проект, зал, дата и плот", () => {
  test("имя обрезается, зал хранит постоянное, на дату один плот", () => {
    const { project, venueId, plotId } = show();
    assert.equal(project.name, "Весна");
    assert.deepEqual(
      project.listVenues().map((venue) => venue.name),
      ["Главный зал"],
    );
    assert.equal(project.listGeometry(venueId).map((item) => item.name).join(","), "Сцена,Портал стена");
    assert.equal(project.listSoundPortals(venueId)[0]?.type, "K1");
    assert.equal(project.listPlots(venueId)[0]?.id, plotId);
    assert.equal(project.plotByDate(venueId, "2026-06-01")?.id, plotId);
    assert.equal(project.plotByDate(venueId, "2026-06-02"), null);

    expectError(() => project.addPlot(venueId, { date: "2026-06-01" }), "duplicate-date");
    assert.equal(project.listPlots(venueId).length, 1);
  });

  test("дата проверяется как календарная", () => {
    const { project, venueId, plotId } = show();
    for (const date of ["2026-02-31", "2026-02-29", "01.06.2026", "2026-6-1", ""]) {
      expectError(() => project.addPlot(venueId, { date }), "invalid-date");
    }
    const leap = project.addPlot(venueId, { date: "2024-02-29" });
    project.setPlotDate(leap, "2024-02-29");
    project.setPlotDate(plotId, "2026-07-01");
    assert.equal(project.plotByDate(venueId, "2026-06-01"), null);
    const reused = project.addPlot(venueId, { date: "2026-06-01" });
    assert.notEqual(reused, plotId);
    expectError(() => project.setPlotDate(leap, "2026-07-01"), "duplicate-date");
  });

  test("два зала могут иметь одну и ту же дату", () => {
    const { project, venueId } = show();
    const other = project.addVenue({ name: "Малый" });
    const plotId = project.addPlot(other, { date: "2026-06-01" });
    assert.equal(project.plotByDate(other, "2026-06-01")?.id, plotId);
    assert.equal(project.plotByDate(venueId, "2026-06-01")?.venueId, venueId);
    expectError(() => project.listGeometry(other + "-нет"), "unknown-venue");
  });

  test("пустое имя, пустая форма и чужие идентификаторы отвергаются", () => {
    const { project, venueId, plotId, stageId, portalId } = show();
    expectError(() => project.rename("   "), "empty-name");
    expectError(() => project.addVenue({ name: "" }), "empty-name");
    expectError(
      () =>
        project.addGeometry(venueId, {
          name: "Нуль",
          shape: { kind: "box", width: 0, depth: 1, height: 1 },
          transform: at(0, 0, 0),
        }),
      "invalid-shape",
    );
    expectError(
      () =>
        project.addGeometry(venueId, {
          name: "Линия",
          shape: { kind: "polyline", points: [{ x: 0, y: 0, z: 0 }] },
          transform: at(0, 0, 0),
        }),
      "invalid-shape",
    );
    expectError(
      () => project.addGeometry(venueId, { name: "Дыра", shape: { kind: "box", width: 1, depth: 1, height: 1 }, transform: at(Number.NaN, 0, 0) }),
      "invalid-transform",
    );
    expectError(() => project.removeGeometry(venueId, portalId), "unknown-geometry");
    expectError(() => project.removeSoundPortal(venueId, stageId), "unknown-portal");
    expectError(() => project.renameLayer(plotId, stageId, "Нет"), "unknown-layer");
    project.rename("Лето");
    project.renameGeometry(venueId, stageId, "Планшет");
    project.setGeometryShape(venueId, stageId, { kind: "box", width: 12, depth: 8, height: 1 });
    assert.equal(project.name, "Лето");
    const stage = project.listGeometry(venueId)[0];
    assert.equal(stage?.name, "Планшет");
    assert.equal(stage?.shape.kind, "box");
    if (stage?.shape.kind === "box") assert.equal(stage.shape.width, 12);
  });
});

describe("приборы и слои", () => {
  test("свет требует свободные юниверс и адрес, звук и видео — нет", () => {
    const hall = show();
    const { project, plotId, frontId, backId } = hall;
    const spot = project.addFixture(plotId, {
      name: "Пятно",
      type: "Sharpy",
      discipline: "light",
      kind: "light-fixture",
      layerId: frontId,
      transform: at(1, 2, 6),
      address: { universe: 1, address: 1 },
    });
    project.addFixture(plotId, {
      name: "Залив",
      type: "Aura",
      discipline: "light",
      kind: "light-fixture",
      layerId: backId,
      transform: at(2, 0, 6),
      address: { universe: 1, address: 512 },
    });
    project.addFixture(plotId, {
      name: "Второй юниверс",
      type: "Aura",
      discipline: "light",
      kind: "light-fixture",
      layerId: frontId,
      transform: at(3, 0, 6),
      address: { universe: 2, address: 1 },
    });

    expectError(
      () =>
        project.addFixture(plotId, {
          name: "Дубль",
          type: "Aura",
          discipline: "light",
          kind: "light-fixture",
          layerId: frontId,
          transform: at(0, 0, 0),
          address: { universe: 1, address: 1 },
        }),
      "duplicate-address",
    );
    assert.equal(project.listFixtures(plotId, { discipline: "light" }).length, 3);

    for (const address of [
      { universe: 0, address: 1 },
      { universe: 1.5, address: 1 },
      { universe: 1, address: 0 },
      { universe: 1, address: 513 },
      { universe: 1, address: 1.5 },
    ]) {
      expectError(() => project.setLightAddress(plotId, spot, address), "invalid-address");
    }
    assert.deepEqual(project.fixture(plotId, spot).address, { universe: 1, address: 1 });
    project.setLightAddress(plotId, spot, { universe: 1, address: 1 });
    project.setLightAddress(plotId, spot, { universe: 3, address: 10 });
    assert.deepEqual(project.fixture(plotId, spot).address, { universe: 3, address: 10 });

    project.removeFixture(plotId, spot);
    const reused = project.addFixture(plotId, {
      name: "Снова пятно",
      type: "Sharpy",
      discipline: "light",
      kind: "light-fixture",
      layerId: frontId,
      transform: at(0, 0, 0),
      address: { universe: 3, address: 10 },
    });
    assert.equal(project.fixture(plotId, reused).type, "Sharpy");
  });

  test("слой принадлежит дисциплине, звук и видео различают виды приборов", () => {
    const { project, plotId, frontId, paId, screenId, promptId, portalId } = show();
    expectError(
      () =>
        project.addFixture(plotId, {
          name: "Не туда",
          type: "Sharpy",
          discipline: "light",
          kind: "light-fixture",
          layerId: paId,
          transform: at(0, 0, 0),
          address: { universe: 1, address: 1 },
        }),
      "layer-discipline",
    );

    const speaker = project.addFixture(plotId, {
      name: "Колонка",
      type: "X12",
      discipline: "sound",
      kind: "active-speaker",
      layerId: paId,
      transform: at(4, 1, 2),
    });
    const led = project.addFixture(plotId, {
      name: "Экран",
      type: "P3",
      discipline: "video",
      kind: "led-screen",
      layerId: screenId,
      transform: at(0, 8, 4),
    });
    const prompter = project.addFixture(plotId, {
      name: "Пол",
      type: "LCD",
      discipline: "video",
      kind: "floor-prompter",
      layerId: promptId,
      transform: at(1, 1, 0),
    });
    const tv = project.addFixture(plotId, {
      name: "Стойка",
      type: "TV-55",
      discipline: "video",
      kind: "tv-on-stand",
      layerId: promptId,
      transform: at(2, 1, 1.4),
    });

    expectError(
      () =>
        project.addFixture(plotId, {
          name: "Чужой вид",
          type: "P3",
          discipline: "sound",
          kind: "led-screen",
          layerId: paId,
          transform: at(0, 0, 0),
        } as never),
      "kind-discipline",
    );
    expectError(
      () =>
        project.addFixture(plotId, {
          name: "С адресом",
          type: "X12",
          discipline: "sound",
          kind: "active-speaker",
          layerId: paId,
          transform: at(0, 0, 0),
          address: { universe: 1, address: 1 },
        } as never),
      "address-forbidden",
    );
    expectError(() => project.setLightAddress(plotId, speaker, { universe: 1, address: 1 }), "address-forbidden");
    expectError(() => project.setFixtureLayer(plotId, led, frontId), "layer-discipline");
    assert.equal(project.fixture(plotId, led).layerId, screenId);

    project.renameLayer(plotId, screenId, "Задник");
    project.setFixtureType(plotId, led, "P2.6");
    project.renameFixture(plotId, tv, "ТВ режиссёра");
    assert.equal(project.listLayers(plotId, "video").map((layer) => layer.name).join(","), "Задник,Суфлёр");
    assert.equal(project.fixture(plotId, led).type, "P2.6");
    assert.deepEqual(
      project.listFixtures(plotId, { layerId: promptId }).map((item) => item.kind),
      ["floor-prompter", "tv-on-stand"],
    );
    expectError(
      () => project.listFixtures(plotId, { discipline: "light", layerId: paId }),
      "layer-discipline",
    );
    expectError(() => project.removeLayer(plotId, promptId), "layer-in-use");
    assert.equal(project.listLayers(plotId).some((layer) => layer.id === promptId), true);
    project.removeFixture(plotId, prompter);
    project.removeFixture(plotId, tv);
    project.removeLayer(plotId, promptId);
    assert.equal(project.listLayers(plotId).some((layer) => layer.id === promptId), false);

    assert.equal(project.listSoundPortals(project.listVenues()[0]!.id).some((portal) => portal.id === portalId), true);
    assert.equal(project.listFixtures(plotId).some((item) => item.id === portalId), false);
    assert.equal(project.fixture(plotId, speaker).address, null);
  });

  test("родитель внутри плота, удаление родителя с детьми запрещено", () => {
    const { project, venueId, plotId, frontId } = show();
    const otherPlot = project.addPlot(venueId, { date: "2026-08-01" });
    const otherLayer = project.addLayer(otherPlot, { name: "Фронт", discipline: "light" });
    const bar = project.addFixture(plotId, {
      name: "Ферма",
      type: "Truss",
      discipline: "light",
      kind: "light-fixture",
      layerId: frontId,
      transform: at(0, 0, 7),
      address: { universe: 1, address: 1 },
    });
    const head = project.addFixture(plotId, {
      name: "Голова",
      type: "Sharpy",
      discipline: "light",
      kind: "light-fixture",
      layerId: frontId,
      parentId: bar,
      transform: at(1, 0, 0),
      address: { universe: 1, address: 20 },
    });
    const stranger = project.addFixture(otherPlot, {
      name: "Чужой",
      type: "Sharpy",
      discipline: "light",
      kind: "light-fixture",
      layerId: otherLayer,
      transform: at(0, 0, 0),
      address: { universe: 1, address: 1 },
    });

    expectError(() => project.setFixtureParent(plotId, bar, bar), "parent-cycle");
    expectError(() => project.setFixtureParent(plotId, bar, head), "parent-cycle");
    expectError(() => project.setFixtureParent(plotId, head, stranger), "unknown-parent");
    expectError(() => project.removeFixture(plotId, bar), "fixture-has-children");
    assert.equal(project.fixture(plotId, head).parentId, bar);
    project.removeFixture(plotId, head);
    project.removeFixture(plotId, bar);
    assert.equal(project.listFixtures(plotId).length, 0);
  });

  test("правка входа не меняет уже сохранённый трансформ", () => {
    const { project, venueId, portalId } = show();
    const transform = {
      position: { x: 1, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    };
    project.setSoundPortalTransform(venueId, portalId, transform);
    transform.position.x = 50;
    assert.equal(project.listSoundPortals(venueId)[0]?.transform.position.x, 1);
  });
});

describe("снимок", () => {
  test("снимок кругом возвращает тот же документ и не связан с ним ссылкой", () => {
    const { project, plotId, frontId } = show();
    project.addFixture(plotId, {
      name: "Пятно",
      type: "Sharpy",
      discipline: "light",
      kind: "light-fixture",
      layerId: frontId,
      transform: at(1, 0, 5),
      address: { universe: 1, address: 100 },
    });
    const snapshot = project.toSnapshot();
    const loose = snapshot as { name: string };
    loose.name = "Чужое";
    const fixture = snapshot.venues[0]?.plots[0]?.fixtures[0] as { name: string } | undefined;
    assert.ok(fixture);
    fixture.name = "Чужой прибор";
    assert.equal(project.name, "Весна");
    assert.equal(project.listFixtures(plotId)[0]?.name, "Пятно");

    const loaded = Project.fromSnapshot(JSON.parse(JSON.stringify(project.toSnapshot())) as ProjectSnapshot);
    assert.deepEqual(loaded.toSnapshot(), project.toSnapshot());
    const extra = loaded.addLayer(plotId, { name: "Ещё", discipline: "light" });
    assert.equal(loaded.listLayers(plotId).some((layer) => layer.id === extra), true);
    assert.equal(project.listLayers(plotId).some((layer) => layer.id === extra), false);
  });

  test("сломанный снимок не загружается", () => {
    const snapshot = show().project.toSnapshot();
    expectError(() => Project.fromSnapshot({ ...snapshot, version: 2 }), "invalid-snapshot");
    expectError(() => Project.fromSnapshot({ ...snapshot, venues: {} }), "invalid-snapshot");

    const noAddress = withPlot(structuredClone(snapshot), {
      id: "plot-x",
      date: "2026-09-01",
      layers: [{ id: "layer-x", name: "Фронт", discipline: "light" }],
      fixtures: [
        {
          id: "fixture-x",
          name: "Без адреса",
          type: "Sharpy",
          discipline: "light",
          kind: "light-fixture",
          layerId: "layer-x",
          parentId: null,
          transform: at(0, 0, 0),
          address: null,
          catalogId: null,
          mode: null,
          extent: null,
        },
      ],
    });
    expectError(() => Project.fromSnapshot(noAddress), "address-required");

    const withAddress = withPlot(structuredClone(snapshot), {
      id: "plot-y",
      date: "2026-09-02",
      layers: [{ id: "layer-y", name: "Звук", discipline: "sound" }],
      fixtures: [
        {
          id: "fixture-y",
          name: "Колонка",
          type: "X12",
          discipline: "sound",
          kind: "active-speaker",
          layerId: "layer-y",
          parentId: null,
          transform: at(0, 0, 0),
          address: { universe: 1, address: 1 },
          catalogId: null,
          mode: null,
          extent: null,
        },
      ],
    });
    expectError(() => Project.fromSnapshot(withAddress), "address-forbidden");

    const cycle = withPlot(structuredClone(snapshot), {
      id: "plot-z",
      date: "2026-09-03",
      layers: [{ id: "layer-z", name: "Фронт", discipline: "light" }],
      fixtures: [
        {
          id: "fixture-a",
          name: "A",
          type: "Sharpy",
          discipline: "light",
          kind: "light-fixture",
          layerId: "layer-z",
          parentId: "fixture-b",
          transform: at(0, 0, 0),
          address: { universe: 1, address: 1 },
          catalogId: null,
          mode: null,
          extent: null,
        },
        {
          id: "fixture-b",
          name: "B",
          type: "Sharpy",
          discipline: "light",
          kind: "light-fixture",
          layerId: "layer-z",
          parentId: "fixture-a",
          transform: at(1, 0, 0),
          address: { universe: 1, address: 2 },
          catalogId: null,
          mode: null,
          extent: null,
        },
      ],
    });
    expectError(() => Project.fromSnapshot(cycle), "parent-cycle");

    const venue = snapshot.venues[0];
    const geometry = venue?.geometry[0];
    assert.ok(venue && geometry);
    const duplicated: ProjectSnapshot = {
      ...snapshot,
      venues: [{ ...venue, geometry: [...venue.geometry, structuredClone(geometry)] }],
    };
    expectError(() => Project.fromSnapshot(duplicated), "duplicate-id");
  });

  test("повтор идентификатора из генератора отвергается", () => {
    let n = 0;
    const project = Project.create({
      name: "Тур",
      ids: () => {
        n += 1;
        return n < 3 ? "same" : `id-${n}`;
      },
    });
    expectError(() => project.addVenue({ name: "Зал" }), "duplicate-id");
    assert.equal(project.listVenues().length, 0);
  });
});
