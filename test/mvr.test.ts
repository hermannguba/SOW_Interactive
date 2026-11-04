import assert from "node:assert/strict";
import { test } from "node:test";
import { zipSync } from "fflate";
import {
  SceneError,
  importMvrLights,
  localMatrix,
  parseMvrLights,
  projectOrthographic,
  type Transform,
} from "../src/index.ts";
import { createDemo } from "../web/demo.ts";
import { expectClose } from "./helpers.ts";

test("разбор MVR берёт тип, позицию, поворот и адрес только у света", () => {
  const beam = { position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0 } };
  const wash = { position: { x: -2, y: 4, z: 6 }, rotation: { x: 10, y: -15, z: 40 } };
  const lights = parseMvrLights(
    mvr(`
      <GeneralSceneDescription verMajor="1" verMinor="5">
        <Scene>
          <Layers>
            <Layer name="Свет">
              <ChildList>
                <GroupObject name="Ферма">
                  <Matrix>${mvrMatrix({ position: { x: 5, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } })}</Matrix>
                  <ChildList>
                    <Fixture name="Луч 1" gdtfSpec="Robe@Megapointe.gdtf" gdtfMode="Mode 1">
                      <Matrix>${mvrMatrix(beam)}</Matrix>
                      <Addresses>
                        <Address break="1">10</Address>
                        <Address break="0">25</Address>
                      </Addresses>
                    </Fixture>
                  </ChildList>
                </GroupObject>
                <Fixture name="Залив" gdtfSpec="Robe@Spiider">
                  <Matrix>${mvrMatrix(wash)}</Matrix>
                  <Addresses><Address break="0">513</Address></Addresses>
                </Fixture>
                <VideoScreen name="Экран">
                  <Matrix>${mvrMatrix({ position: { x: 0, y: 1, z: 4 }, rotation: { x: 0, y: 0, z: 0 } })}</Matrix>
                </VideoScreen>
                <Projector name="Проектор"/>
              </ChildList>
            </Layer>
          </Layers>
        </Scene>
      </GeneralSceneDescription>
    `),
  );

  assert.equal(lights.length, 2);
  const spot = lights[0];
  const fill = lights[1];
  assert.ok(spot && fill);
  assert.equal(spot.name, "Луч 1");
  assert.equal(spot.type, "Megapointe");
  assert.deepEqual(spot.address, { universe: 1, address: 25 });
  expectClose(spot.transform.position.x, 6);
  expectClose(spot.transform.position.y, 2);
  expectClose(spot.transform.position.z, 3);
  expectClose(spot.transform.rotation.x, 0);
  expectClose(spot.transform.rotation.y, 0);
  expectClose(spot.transform.rotation.z, 0);

  assert.equal(fill.name, "Залив");
  assert.equal(fill.type, "Spiider");
  assert.deepEqual(fill.address, { universe: 2, address: 1 });
  expectClose(fill.transform.position.x, wash.position.x);
  expectClose(fill.transform.position.y, wash.position.y);
  expectClose(fill.transform.position.z, wash.position.z);
  expectClose(fill.transform.rotation.x, wash.rotation.x);
  expectClose(fill.transform.rotation.y, wash.rotation.y);
  expectClose(fill.transform.rotation.z, wash.rotation.z);
  assert.equal(JSON.stringify(lights).includes("Экран"), false);
  assert.equal(JSON.stringify(lights).includes("Проектор"), false);
});

test("пустой файл и не-MVR не меняют плот", () => {
  expectMvr(new Uint8Array(), "Файл пустой");
  expectMvr(new TextEncoder().encode("это не архив"), "Это не файл MVR");
  expectMvr(zip({ "readme.txt": "нет описания" }), "Это не файл MVR");
  const junk = new Uint8Array(32);
  junk[0] = 0x50;
  junk[1] = 0x4b;
  junk[2] = 0x03;
  junk[3] = 0x04;
  expectMvr(junk, "Не удалось прочитать MVR");
  expectMvr(
    mvr(`<GeneralSceneDescription><Scene><VideoScreen name="Экран"/></Scene></GeneralSceneDescription>`),
    "В MVR нет световых приборов",
  );

  const { project, venueId, plotId } = createDemo();
  const before = ids(project, plotId);
  const geometry = project.listGeometry(venueId).map((entry) => entry.id);
  assert.throws(
    () =>
      importMvrLights(
        project,
        plotId,
        mvr(`
          <GeneralSceneDescription><Scene>
            <Fixture name="Без адреса" gdtfSpec="Robe@Spot">
              <Matrix>${mvrMatrix(identityAt(0, 0, 0))}</Matrix>
            </Fixture>
          </Scene></GeneralSceneDescription>
        `),
      ),
    (error: unknown) => error instanceof SceneError && error.message === "У прибора «Без адреса» нет адреса DMX",
  );
  assert.deepEqual(ids(project, plotId), before);
  assert.deepEqual(
    project.listGeometry(venueId).map((entry) => entry.id),
    geometry,
  );
  assert.equal(project.underlay(venueId), null);
});

test("приборы MVR попадают только в плот выбранной даты", () => {
  const demo = createDemo();
  const { project } = demo;
  const [main, small] = project.listVenues();
  assert.ok(main && small);
  const [opening, encore] = project.listPlots(main.id);
  const [chamber, later] = project.listPlots(small.id);
  assert.ok(opening && encore && chamber && later);
  const geometry = project.listGeometry(main.id).map((entry) => entry.name);
  const portals = project.listSoundPortals(main.id).map((portal) => portal.id);
  const encoreBefore = ids(project, encore.id);
  const chamberBefore = ids(project, chamber.id);
  const soundBefore = project.listFixtures(chamber.id, { discipline: "sound" }).length;

  const bytes = mvr(`
    <GeneralSceneDescription><Scene>
      <Fixture name="Луч" gdtfSpec="Robe@Megapointe">
        <Matrix>${mvrMatrix({ position: { x: -3, y: 2, z: 7 }, rotation: { x: 0, y: 20, z: 0 } })}</Matrix>
        <Addresses><Address break="0">101</Address></Addresses>
      </Fixture>
      <VideoScreen name="Экран"/>
    </Scene></GeneralSceneDescription>
  `);
  const added = importMvrLights(project, opening.id, bytes);
  assert.equal(added.length, 1);

  const fixtures = project.listFixtures(opening.id);
  const imported = fixtures.find((fixture) => fixture.id === added[0]);
  assert.ok(imported);
  assert.equal(imported.discipline, "light");
  assert.equal(imported.kind, "light-fixture");
  assert.equal(imported.type, "Megapointe");
  assert.deepEqual(imported.address, { universe: 1, address: 101 });
  expectClose(imported.transform.position.x, -3);
  expectClose(imported.transform.position.y, 2);
  expectClose(imported.transform.position.z, 7);
  expectClose(imported.transform.rotation.y, 20);
  assert.equal(fixtures.some((fixture) => fixture.type === "Sharpy"), true);
  assert.equal(fixtures.some((fixture) => fixture.discipline !== "light"), false);

  assert.deepEqual(ids(project, encore.id), encoreBefore);
  assert.deepEqual(ids(project, chamber.id), chamberBefore);
  assert.equal(project.listFixtures(later.id).length, 0);
  assert.equal(project.listFixtures(chamber.id, { discipline: "sound" }).length, soundBefore);
  assert.equal(
    project.listFixtures(opening.id).some((fixture) => fixture.discipline === "video"),
    false,
  );
  assert.deepEqual(
    project.listGeometry(main.id).map((entry) => entry.name),
    geometry,
  );
  assert.deepEqual(
    project.listSoundPortals(main.id).map((portal) => portal.id),
    portals,
  );
  assert.equal(project.underlay(main.id), null);

  const top = projectOrthographic(project.sceneGraph(main.id, opening.id), "top", { discipline: "light" });
  const side = projectOrthographic(project.sceneGraph(main.id, opening.id), "side", { discipline: "light" });
  const mark = top.marks.find((item) => item.name === "Луч");
  const sideMark = side.marks.find((item) => item.name === "Луч");
  assert.equal(mark?.shape.kind, "point");
  assert.equal(sideMark?.shape.kind, "point");
  if (mark?.shape.kind === "point" && sideMark?.shape.kind === "point") {
    expectClose(mark.shape.at.x, -3);
    expectClose(mark.shape.at.y, 2);
    expectClose(sideMark.shape.at.y, 7);
  }
  assert.equal(
    projectOrthographic(project.sceneGraph(main.id, encore.id), "top", { discipline: "light" }).marks.some(
      (item) => item.name === "Луч",
    ),
    false,
  );

  assert.throws(
    () => importMvrLights(project, opening.id, bytes),
    (error: unknown) => error instanceof SceneError && error.message === "Адрес 1.101 уже занят",
  );
  assert.equal(project.listFixtures(opening.id).length, fixtures.length);
});

function mvr(xml: string): Uint8Array {
  return zip({ "GeneralSceneDescription.xml": xml });
}

function zip(files: Record<string, string>): Uint8Array {
  const encoded: Record<string, Uint8Array> = {};
  for (const [name, text] of Object.entries(files)) encoded[name] = new TextEncoder().encode(text);
  return zipSync(encoded);
}

function mvrMatrix(transform: Transform): string {
  const matrix = localMatrix(transform);
  const row = (a: number, b: number, c: number, d: number) => `{${a},${b},${c},${d}}`;
  return (
    row(matrix[0], matrix[4], matrix[8], 0) +
    row(matrix[1], matrix[5], matrix[9], 0) +
    row(matrix[2], matrix[6], matrix[10], 0) +
    row(matrix[12], matrix[13], matrix[14], 1)
  );
}

function identityAt(x: number, y: number, z: number): Transform {
  return { position: { x, y, z }, rotation: { x: 0, y: 0, z: 0 } };
}

function expectMvr(bytes: Uint8Array, message: string): void {
  assert.throws(
    () => parseMvrLights(bytes),
    (error: unknown) => {
      assert.ok(error instanceof SceneError);
      assert.equal(error.code, "invalid-mvr");
      assert.equal(error.message, message);
      return true;
    },
  );
}

function ids(project: ReturnType<typeof createDemo>["project"], plotId: string): string[] {
  return project.listFixtures(plotId).map((fixture) => fixture.id);
}
