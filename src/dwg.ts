import {
  Arc,
  Circle,
  DwgReader,
  Insert,
  Line,
  LwPolyline,
  Polyline,
  Spline,
  type CadDocument,
  type Entity,
} from "@node-projects/acad-ts";
import { SceneError } from "./errors.ts";
import type { UnderlayStroke, Vec3, VenueUnderlay } from "./types.ts";

/**
 * DWG читается как линии подложки зала.
 * Приборы, текст и блоки не становятся объектами плота.
 * Оси чертежа совпадают с залом: X — ширина, Y — глубина, Z — высота.
 */

const SENTINEL =
  /^(?:AC10\d\d|AC2\.10|AC1\.50|AC1\.40|AC1\.2|MC0\.0)/;

export function parseDwgUnderlay(bytes: Uint8Array, fileName: string): VenueUnderlay {
  if (bytes.byteLength === 0) {
    throw new SceneError("invalid-dwg", "Файл пустой");
  }
  if (!isDwg(bytes)) {
    throw new SceneError("invalid-dwg", "Это не файл DWG");
  }
  const document = readDocument(bytes);
  const strokes = strokesOf(document);
  if (strokes.length === 0) {
    throw new SceneError("invalid-dwg", "В DWG нет линий для подложки");
  }
  return { fileName: baseName(fileName), strokes };
}

function isDwg(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 6) return false;
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 6));
  return SENTINEL.test(head);
}

function readDocument(bytes: Uint8Array): CadDocument {
  try {
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return DwgReader.readFromStream(copy as ArrayBuffer);
  } catch {
    throw new SceneError("invalid-dwg", "Не удалось прочитать DWG");
  }
}

function strokesOf(document: CadDocument): UnderlayStroke[] {
  const model = document.modelSpace;
  if (!model) return [];
  const strokes: UnderlayStroke[] = [];
  collect(model.entities, strokes, 0);
  return strokes;
}

function collect(entities: Iterable<Entity>, strokes: UnderlayStroke[], depth: number): void {
  if (depth > 8) return;
  for (const entity of entities) {
    if (entity instanceof Insert) {
      try {
        collect(entity.explode(), strokes, depth + 1);
      } catch {
        // Вставка без развёртки не становится прибором.
      }
      continue;
    }
    const stroke = strokeOf(entity);
    if (stroke) strokes.push(stroke);
  }
}

function strokeOf(entity: Entity): UnderlayStroke | null {
  if (entity instanceof Line) {
    return finish([pointOf(entity.startPoint), pointOf(entity.endPoint)], false);
  }
  if (entity instanceof Arc) {
    return finish(entity.polygonalVertexes(16).map(pointOf), false);
  }
  if (entity instanceof Circle) {
    return finish(entity.polygonalVertexes(24).map(pointOf), true);
  }
  if (entity instanceof LwPolyline) {
    return finish(entity.getPoints(16).map(pointOf), entity.isClosed);
  }
  if (entity instanceof Polyline) {
    return finish(entity.getPoints(16).map(pointOf), entity.isClosed);
  }
  if (entity instanceof Spline) {
    const source = entity.fitPoints.length >= 2 ? entity.fitPoints : entity.controlPoints;
    return finish(source.map(pointOf), entity.isClosed);
  }
  return null;
}

function pointOf(point: { x: number; y: number; z?: number }): Vec3 | null {
  const z = point.z ?? 0;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(z)) return null;
  return { x: point.x, y: point.y, z };
}

function finish(points: readonly (Vec3 | null)[], closed: boolean): UnderlayStroke | null {
  const clean: Vec3[] = [];
  for (const point of points) {
    if (!point) return null;
    const previous = clean[clean.length - 1];
    if (previous && same(previous, point)) continue;
    clean.push(point);
  }
  if (closed && clean.length >= 2) {
    const first = clean[0];
    const last = clean[clean.length - 1];
    if (first && last && !same(first, last)) clean.push({ ...first });
  }
  if (clean.length < 2) return null;
  return { points: clean };
}

function same(left: Vec3, right: Vec3): boolean {
  return (
    Math.abs(left.x - right.x) < 1e-6 &&
    Math.abs(left.y - right.y) < 1e-6 &&
    Math.abs(left.z - right.z) < 1e-6
  );
}

function baseName(fileName: string): string {
  const trimmed = fileName.trim();
  const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const name = (slash >= 0 ? trimmed.slice(slash + 1) : trimmed).trim();
  if (name === "") throw new SceneError("invalid-dwg", "У файла DWG нет имени");
  return name;
}
