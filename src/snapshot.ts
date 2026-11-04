import { SceneError } from "./errors.ts";
import type {
  DmxAddress,
  Discipline,
  Fixture,
  FixtureKind,
  Geometry,
  Layer,
  PlotSnapshot,
  ProjectSnapshot,
  SoundPortal,
  UnderlayStroke,
  VenueSnapshot,
  VenueUnderlay,
} from "./types.ts";
import { isDiscipline, isRecord } from "./values.ts";

function fail(message: string): never {
  throw new SceneError("invalid-snapshot", message);
}

function readString(source: Record<string, unknown>, key: string, label: string): string {
  const value = source[key];
  if (typeof value !== "string") fail(`${label}: поле «${key}» должно быть строкой`);
  return value;
}

function readArray(source: Record<string, unknown>, key: string, label: string): readonly unknown[] {
  const value = source[key];
  if (!Array.isArray(value)) fail(`${label}: поле «${key}» должно быть списком`);
  return value;
}

function readNullableString(
  source: Record<string, unknown>,
  key: string,
  label: string,
): string | null {
  const value = source[key];
  if (value === null) return null;
  if (typeof value !== "string") fail(`${label}: поле «${key}» должно быть строкой или null`);
  return value;
}

function readDiscipline(value: unknown, label: string): Discipline {
  if (!isDiscipline(value)) fail(`${label}: неизвестная дисциплина`);
  return value;
}

/**
 * Проверяет форму снимка. Диапазоны, связи и уникальность проверяет проект при загрузке.
 */
export function parseSnapshot(input: unknown): ProjectSnapshot {
  if (!isRecord(input)) fail("Снимок проекта должен быть объектом");
  if (input.version !== 1) fail("Ожидалась версия снимка 1");

  const venues = readArray(input, "venues", "Проект").map((venue, index) =>
    parseVenue(venue, `Зал ${index + 1}`),
  );

  return {
    version: 1,
    id: readString(input, "id", "Проект"),
    name: readString(input, "name", "Проект"),
    venues,
  };
}

function parseVenue(input: unknown, label: string): VenueSnapshot {
  if (!isRecord(input)) fail(`${label} должен быть объектом`);
  return {
    id: readString(input, "id", label),
    name: readString(input, "name", label),
    geometry: readArray(input, "geometry", label).map((item, index) =>
      parseGeometry(item, `${label}, геометрия ${index + 1}`),
    ),
    portals: readArray(input, "portals", label).map((item, index) =>
      parsePortal(item, `${label}, портал ${index + 1}`),
    ),
    underlay: parseUnderlay(input.underlay, `${label}, подложка`),
    plots: readArray(input, "plots", label).map((item, index) =>
      parsePlot(item, `${label}, плот ${index + 1}`),
    ),
  };
}

function parseGeometry(input: unknown, label: string): Geometry {
  if (!isRecord(input)) fail(`${label} должна быть объектом`);
  return {
    id: readString(input, "id", label),
    name: readString(input, "name", label),
    shape: parseShape(input.shape, label),
    transform: parseTransform(input.transform, label),
  };
}

function parseShape(input: unknown, label: string): Geometry["shape"] {
  if (!isRecord(input)) fail(`${label}: форма должна быть объектом`);
  if (input.kind === "box") {
    return {
      kind: "box",
      width: readFinite(input.width, `${label}: ширина`),
      depth: readFinite(input.depth, `${label}: глубина`),
      height: readFinite(input.height, `${label}: высота`),
    };
  }
  if (input.kind === "polyline") {
    if (!Array.isArray(input.points)) fail(`${label}: точки ломаной должны быть списком`);
    return {
      kind: "polyline",
      points: input.points.map((point, index) => parseVec3(point, `${label}: точка ${index + 1}`)),
    };
  }
  fail(`${label}: неизвестная форма`);
}

function parsePortal(input: unknown, label: string): SoundPortal {
  if (!isRecord(input)) fail(`${label} должен быть объектом`);
  return {
    id: readString(input, "id", label),
    name: readString(input, "name", label),
    type: readString(input, "type", label),
    transform: parseTransform(input.transform, label),
  };
}

function parseUnderlay(input: unknown, label: string): VenueUnderlay | null {
  if (input === undefined || input === null) return null;
  if (!isRecord(input)) fail(`${label} должна быть объектом`);
  const strokes = readArray(input, "strokes", label);
  if (strokes.length === 0) fail(`${label}: нет линий`);
  return {
    fileName: readString(input, "fileName", label),
    strokes: strokes.map((stroke, index) => parseStroke(stroke, `${label}, линия ${index + 1}`)),
  };
}

function parseStroke(input: unknown, label: string): UnderlayStroke {
  if (!isRecord(input)) fail(`${label} должна быть объектом`);
  if (!Array.isArray(input.points) || input.points.length < 2) {
    fail(`${label}: нужны хотя бы две точки`);
  }
  return {
    points: input.points.map((point, index) => parseVec3(point, `${label}, точка ${index + 1}`)),
  };
}

function parsePlot(input: unknown, label: string): PlotSnapshot {
  if (!isRecord(input)) fail(`${label} должен быть объектом`);
  return {
    id: readString(input, "id", label),
    date: readString(input, "date", label),
    layers: readArray(input, "layers", label).map((item, index) =>
      parseLayer(item, `${label}, слой ${index + 1}`),
    ),
    fixtures: readArray(input, "fixtures", label).map((item, index) =>
      parseFixture(item, `${label}, прибор ${index + 1}`),
    ),
  };
}

function parseLayer(input: unknown, label: string): Layer {
  if (!isRecord(input)) fail(`${label} должен быть объектом`);
  return {
    id: readString(input, "id", label),
    name: readString(input, "name", label),
    discipline: readDiscipline(input.discipline, label),
  };
}

function parseFixture(input: unknown, label: string): Fixture {
  if (!isRecord(input)) fail(`${label} должен быть объектом`);
  const discipline = readDiscipline(input.discipline, label);
  const kind = readString(input, "kind", label);
  return {
    id: readString(input, "id", label),
    name: readString(input, "name", label),
    type: readString(input, "type", label),
    discipline,
    kind: kind as FixtureKind,
    layerId: readString(input, "layerId", label),
    parentId: readNullableString(input, "parentId", label),
    transform: parseTransform(input.transform, label),
    address: parseAddress(input.address, label),
  };
}

function parseAddress(input: unknown, label: string): DmxAddress | null {
  if (input === null) return null;
  if (!isRecord(input)) fail(`${label}: адрес должен быть объектом или null`);
  return {
    universe: readFinite(input.universe, `${label}: юниверс`),
    address: readFinite(input.address, `${label}: адрес`),
  };
}

function parseTransform(input: unknown, label: string): Geometry["transform"] {
  if (!isRecord(input)) fail(`${label}: трансформ должен быть объектом`);
  return {
    position: parseVec3(input.position, `${label}: позиция`),
    rotation: parseVec3(input.rotation, `${label}: поворот`),
  };
}

function parseVec3(input: unknown, label: string): { x: number; y: number; z: number } {
  if (!isRecord(input)) fail(`${label} должна быть объектом`);
  return {
    x: readFinite(input.x, label),
    y: readFinite(input.y, label),
    z: readFinite(input.z, label),
  };
}

function readFinite(value: unknown, label: string): number {
  if (typeof value !== "number") fail(`${label} должна быть числом`);
  return value;
}
