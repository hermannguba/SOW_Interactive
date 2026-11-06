import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { zipSync } from "fflate";
import { SceneError, parseGdtf, projectOrthographic } from "../src/index.ts";
import { addGdtf, gdtfFixture, gdtfLibrary, installGdtf } from "../web/catalog.ts";
import { createDemo } from "../web/demo.ts";
import { libraryFor } from "../web/library.ts";
import { addressConflict, hitMark, nextAddress } from "../web/place.ts";
import { expectClose } from "./helpers.ts";

const SPEC = "LIGHT_SKY@AQUAPEARL-PRO@V1.4.gdtf";

test("AquaPearl читается в карточку: режимы, футпринт и габарит", () => {
  const fixture = parseGdtf(readFileSync(new URL("../web/fixtures/" + SPEC, import.meta.url)), SPEC);
  assert.equal(fixture.manufacturer, "LIGHT SKY");
  assert.equal(fixture.name, "AQUAPEARL-PRO");
  assert.equal(fixture.shortName, "AP PRO");
  assert.equal(fixture.fixtureTypeId, "F39B8A73-CECA-4E57-A361-2492534F7C02");
  assert.equal(fixture.spec, SPEC);
  assert.equal(fixture.revision, "2025-11-10T10:51:04");
  assert.deepEqual(
    fixture.modes.map((mode) => [mode.name, mode.expanded, mode.footprint, mode.channels.length]),
    [
      ["98CH", false, null, 31],
      ["26CH", true, 26, 23],
      ["35CH", true, 35, 28],
      ["22CH", true, 22, 19],
      ["16CH", true, 16, 13],
    ],
  );
  const standard = fixture.modes.find((mode) => mode.name === "26CH");
  assert.ok(standard);
  assert.deepEqual(standard.channels[0], {
    dmxBreak: 1,
    slots: [1, 2],
    attribute: "Pan",
    pretty: "P",
    original: "",
    geometry: "Yoke",
  });
  const pixels = fixture.modes.find((mode) => mode.name === "98CH");
  assert.ok(pixels);
  assert.equal(pixels.channels.some((channel) => channel.attribute === "Pan"), true);
  assert.equal(pixels.channels.some((channel) => channel.slots.length === 0), false);
  const extent = fixture.extent;
  assert.ok(extent);
  expectNear(extent.min.x, -0.177108);
  expectNear(extent.max.x, 0.177108);
  expectNear(extent.min.y, -0.1967545);
  expectNear(extent.max.y, 0.1967545);
  expectNear(extent.min.z, -0.441887);
  expectNear(extent.max.z, 0.0719385);
});

test("режим с ссылкой на пиксели остаётся в списке без футпринта", () => {
  const fixture = parseGdtf(
    gdtf(`
      <GDTF DataVersion="1.2">
        <FixtureType Name="Pixel" Manufacturer="Test" FixtureTypeID="ID" ShortName="PX">
          <Models>
            <Model Name="Body" Length="0.4" Width="0.2" Height="0.2"/>
          </Models>
          <Geometries>
            <Geometry Name="Base" Model="Body">
              <GeometryReference Geometry="Pixel" Name="P1"><Break DMXBreak="1" DMXOffset="1"/></GeometryReference>
            </Geometry>
            <Beam Name="Pixel"/>
          </Geometries>
          <DMXModes>
            <DMXMode Name="Pixels" Geometry="Base">
              <DMXChannels>
                <DMXChannel DMXBreak="1" Offset="1" Geometry="Base">
                  <LogicalChannel Attribute="Dimmer"><ChannelFunction Attribute="Dimmer"/></LogicalChannel>
                </DMXChannel>
                <DMXChannel DMXBreak="1" Offset="2" Geometry="Pixel">
                  <LogicalChannel Attribute="Color.Color.ColorAdd_R"><ChannelFunction Attribute="ColorAdd_R" OriginalAttribute="Red"/></LogicalChannel>
                </DMXChannel>
              </DMXChannels>
            </DMXMode>
            <DMXMode Name="Dim" Geometry="Base">
              <DMXChannels>
                <DMXChannel Offset="1,2" Geometry="Base">
                  <LogicalChannel Attribute="Dimmer"><ChannelFunction Attribute="Dimmer"/></LogicalChannel>
                </DMXChannel>
              </DMXChannels>
            </DMXMode>
          </DMXModes>
        </FixtureType>
      </GDTF>
    `),
    "Test@Pixel.gdtf",
  );
  const pixels = fixture.modes[0];
  const dim = fixture.modes[1];
  assert.ok(pixels && dim);
  assert.equal(pixels.expanded, false);
  assert.equal(pixels.footprint, null);
  assert.equal(pixels.channels[1]?.pretty, "ColorAdd_R");
  assert.equal(pixels.channels[1]?.original, "Red");
  assert.equal(dim.expanded, true);
  assert.equal(dim.footprint, 2);
  assert.equal(dim.channels[0]?.dmxBreak, 1);
  const extent = fixture.extent;
  assert.ok(extent);
  expectNear(extent.min.x, -0.2);
  expectNear(extent.max.x, 0.2);
  expectNear(extent.min.z, -0.1);
  expectNear(extent.max.z, 0.1);
});

test("пустой и чужой файл не становятся прибором", () => {
  assert.throws(
    () => parseGdtf(new Uint8Array(), "A@B.gdtf"),
    (error: unknown) => error instanceof SceneError && error.code === "invalid-gdtf",
  );
  assert.throws(
    () => parseGdtf(new TextEncoder().encode("не архив"), "A@B.gdtf"),
    (error: unknown) => error instanceof SceneError && error.code === "invalid-gdtf",
  );
});

test("прибор из библиотеки рисуется габаритом и занимает футпринт режима", () => {
  const parsed = parseGdtf(readFileSync(new URL("../web/fixtures/" + SPEC, import.meta.url)), SPEC);
  installGdtf([parsed]);
  const item = libraryFor("light").find((entry) => entry.discipline === "light" && entry.mode === "16CH");
  assert.ok(item && item.discipline === "light");
  assert.equal(item.footprint, 16);
  assert.equal(item.shortName, "AP PRO");

  const demo = createDemo();
  const layerId = demo.project.listLayers(demo.plotId, "light")[0]?.id;
  assert.ok(layerId);
  const extent = parsed.extent;
  assert.ok(extent);
  const id = demo.project.addFixture(demo.plotId, {
    name: item.shortName,
    type: item.type,
    discipline: "light",
    kind: "light-fixture",
    layerId,
    transform: { position: { x: 1, y: 2, z: 6 }, rotation: { x: 0, y: 0, z: 0 } },
    address: { universe: 1, address: 1 },
    catalogId: item.catalogId,
    mode: item.mode,
    extent,
  });
  const stored = demo.project.fixture(demo.plotId, id);
  assert.equal(stored.catalogId, parsed.fixtureTypeId);
  assert.equal(stored.mode, "16CH");
  demo.project.setFixtureMode(demo.plotId, id, "26CH");
  assert.equal(demo.project.fixture(demo.plotId, id).mode, "26CH");

  const top = projectOrthographic(demo.project.sceneGraph(demo.venueId, demo.plotId), "top", {
    discipline: "light",
  });
  const side = projectOrthographic(demo.project.sceneGraph(demo.venueId, demo.plotId), "side", {
    discipline: "light",
  });
  const topBody = top.marks.find((mark) => mark.sourceId === id);
  const sideBody = side.marks.find((mark) => mark.sourceId === id);
  assert.equal(topBody?.shape.kind, "polygon");
  assert.equal(sideBody?.shape.kind, "polygon");
  if (topBody?.shape.kind === "polygon") {
    expectNear(span(topBody.shape.points, "x").min, 1 + extent.min.x);
    expectNear(span(topBody.shape.points, "x").max, 1 + extent.max.x);
    expectNear(span(topBody.shape.points, "y").min, 2 + extent.min.y);
    expectNear(span(topBody.shape.points, "y").max, 2 + extent.max.y);
  }
  if (sideBody?.shape.kind === "polygon") {
    expectNear(span(sideBody.shape.points, "y").min, 6 + extent.min.z);
    expectNear(span(sideBody.shape.points, "y").max, 6 + extent.max.z);
  }
  assert.equal(hitMark(top.marks, { x: 1, y: 2 })?.sourceId, id);

  const lights = () => demo.project.listFixtures(demo.plotId, { discipline: "light" });
  const length = (fixture: { catalogId: string | null }): number | null => (fixture.catalogId ? 16 : 1);
  assert.equal(addressConflict(lights(), { universe: 1, address: 17 }, 16, length), null);
  assert.equal(
    addressConflict(lights(), { universe: 1, address: 10 }, 16, length)?.includes("пересекают"),
    true,
  );
  assert.equal(
    addressConflict(lights(), { universe: 1, address: 500 }, 16, length)?.includes("не помещается"),
    true,
  );
  assert.deepEqual(nextAddress(lights(), { footprintOf: length, needed: 16 }), {
    universe: 1,
    address: 17,
  });
  installGdtf([]);
});

test("повторный GDTF с тем же типом заменяет запись библиотеки", () => {
  installGdtf([]);
  const first = parseGdtf(
    gdtf(`
      <GDTF DataVersion="1.2">
        <FixtureType Name="Old" Manufacturer="Test" FixtureTypeID="SAME" ShortName="OLD">
          <DMXModes><DMXMode Name="1CH" Geometry="Base"><DMXChannels>
            <DMXChannel DMXBreak="1" Offset="1" Geometry="Base">
              <LogicalChannel Attribute="Dimmer"><ChannelFunction Attribute="Dimmer"/></LogicalChannel>
            </DMXChannel>
          </DMXChannels></DMXMode></DMXModes>
        </FixtureType>
      </GDTF>`),
    "old.gdtf",
  );
  addGdtf(first);
  addGdtf({ ...first, name: "New", spec: "new.gdtf" });
  assert.equal(gdtfLibrary().length, 1);
  assert.equal(gdtfFixture("SAME")?.name, "New");
  assert.equal(gdtfFixture("SAME")?.spec, "new.gdtf");
  installGdtf([]);
});

function expectNear(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} ~= ${expected}`);
}

function span(points: readonly { x: number; y: number }[], axis: "x" | "y"): { min: number; max: number } {
  const values = points.map((point) => point[axis]);
  return { min: Math.min(...values), max: Math.max(...values) };
}

function gdtf(xml: string): Uint8Array {
  return zipSync({ "description.xml": new TextEncoder().encode(xml) });
}
