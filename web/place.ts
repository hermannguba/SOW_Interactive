import { SceneError, type DmxAddress, type Fixture, type FixtureKind, type OrthographicMark, type OrthographicView, type Transform, type ViewPoint } from "../src/index.ts";

/** Недостающая ось при постановке: сверху задаётся высота, сбоку — глубина. */
export const PLACEMENT_DEFAULTS: Record<FixtureKind, { readonly y: number; readonly z: number }> = {
  "light-fixture": { y: 0, z: 6 },
  "active-speaker": { y: 1, z: 2 },
  "led-screen": { y: 6, z: 4 },
  "floor-prompter": { y: 1, z: 0 },
  "tv-on-stand": { y: 2, z: 1.4 },
};

export const HIT_RADIUS = 0.75;

export interface ViewFrame {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
}

export interface SvgBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function worldFromView(
  view: OrthographicView,
  point: ViewPoint,
  kind: FixtureKind,
): Transform {
  const defaults = PLACEMENT_DEFAULTS[kind];
  const position =
    view === "top"
      ? { x: point.x, y: point.y, z: defaults.z }
      : { x: point.x, y: defaults.y, z: point.y };
  return { position, rotation: { x: 0, y: 0, z: 0 } };
}

export interface AddressPlan {
  /** Сколько слотов занимает уже стоящий прибор. null — только стартовый адрес. */
  readonly footprintOf?: (fixture: Fixture) => number | null;
  /** Сколько слотов нужно новому адресу. null — один стартовый. */
  readonly needed?: number | null;
}

/** Первая свободная пара, в которую помещается весь футпринт и которая не пересекает чужой диапазон. */
export function nextAddress(fixtures: readonly Fixture[], plan: AddressPlan = {}): DmxAddress {
  const needed = lengthOf(plan.needed);
  const footprintOf = plan.footprintOf ?? (() => 1);
  for (let universe = 1; universe <= 64; universe += 1) {
    for (let address = 1; address <= 512; address += 1) {
      const candidate = { universe, address };
      if (addressConflict(fixtures, candidate, needed, footprintOf) === null) return candidate;
    }
  }
  throw new SceneError("invalid-address", "Свободный адрес DMX не найден");
}

/**
 * Пустая строка — адрес можно занять.
 * Неразвёрнутый режим передаётся как needed null и проверяется только в стартовом слоте.
 */
export function addressConflict(
  fixtures: readonly Fixture[],
  address: DmxAddress,
  needed: number | null,
  footprintOf: (fixture: Fixture) => number | null,
  ignoreId?: string,
): string | null {
  const length = lengthOf(needed);
  if (!Number.isInteger(address.universe) || address.universe < 1) {
    return "Юниверс должен быть целым числом от 1";
  }
  if (!Number.isInteger(address.address) || address.address < 1 || address.address > 512) {
    return "Адрес должен быть целым числом от 1 до 512";
  }
  if (address.address + length - 1 > 512) {
    return `Режим занимает ${length} адресов и не помещается в юниверс с адреса ${address.address}`;
  }
  const from = address.address;
  const to = from + length - 1;
  for (const fixture of fixtures) {
    if (fixture.id === ignoreId || !fixture.address) continue;
    if (fixture.address.universe !== address.universe) continue;
    const otherLength = lengthOf(footprintOf(fixture));
    const otherFrom = fixture.address.address;
    const otherTo = Math.min(512, otherFrom + otherLength - 1);
    if (from <= otherTo && otherFrom <= to) {
      return length === 1 && otherLength === 1
        ? `Адрес ${address.universe}.${address.address} уже занят`
        : `Адреса ${address.universe}.${from}–${address.universe}.${to} пересекают прибор «${fixture.name}»`;
    }
  }
  return null;
}

function lengthOf(footprint: number | null | undefined): number {
  if (footprint == null) return 1;
  if (!Number.isInteger(footprint) || footprint < 1) return 1;
  return footprint;
}

export function frameOf(
  marks: readonly OrthographicMark[],
  padding = 2,
  extra: readonly ViewPoint[] = [],
): ViewFrame {
  const points = [...pointsOf(marks), ...extra];
  if (points.length === 0) {
    return { minX: -10, minY: -10, width: 20, height: 20 };
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const spanX = Math.max(maxX - minX, 4);
  const spanY = Math.max(maxY - minY, 4);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return {
    minX: centerX - spanX / 2 - padding,
    minY: centerY - spanY / 2 - padding,
    width: spanX + padding * 2,
    height: spanY + padding * 2,
  };
}

/** Лист смотрит математической осью Y вверх, SVG — вниз. */
export function viewBoxOf(frame: ViewFrame): SvgBox {
  return {
    x: frame.minX,
    y: -(frame.minY + frame.height),
    width: frame.width,
    height: frame.height,
  };
}

export function viewPointFromSvg(svgX: number, svgY: number): ViewPoint {
  return { x: svgX, y: -svgY };
}

export function hitMark(
  marks: readonly OrthographicMark[],
  point: ViewPoint,
  radius = HIT_RADIUS,
): OrthographicMark | null {
  let body: OrthographicMark | null = null;
  let bodyArea = Number.POSITIVE_INFINITY;
  for (const mark of marks) {
    if (mark.nodeKind !== "light-fixture" || mark.shape.kind !== "polygon") continue;
    if (!contains(mark.shape.points, point)) continue;
    const area = Math.abs(polygonArea(mark.shape.points));
    if (area < bodyArea) {
      body = mark;
      bodyArea = area;
    }
  }
  if (body) return body;
  let best: OrthographicMark | null = null;
  let bestDistance = radius;
  for (const mark of marks) {
    if (mark.shape.kind !== "point") continue;
    const distance = Math.hypot(mark.shape.at.x - point.x, mark.shape.at.y - point.y);
    if (distance <= bestDistance) {
      best = mark;
      bestDistance = distance;
    }
  }
  return best;
}

function contains(points: readonly ViewPoint[], point: ViewPoint): boolean {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const current = points[index];
    const prior = points[previous];
    if (!current || !prior) continue;
    const crosses = current.y > point.y !== prior.y > point.y;
    if (!crosses) continue;
    const x = ((prior.x - current.x) * (point.y - current.y)) / (prior.y - current.y) + current.x;
    if (point.x < x) inside = !inside;
  }
  return inside;
}

function polygonArea(points: readonly ViewPoint[]): number {
  let area = 0;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const current = points[index];
    const prior = points[previous];
    if (!current || !prior) continue;
    area += prior.x * current.y - current.x * prior.y;
  }
  return area / 2;
}

function pointsOf(marks: readonly OrthographicMark[]): ViewPoint[] {
  const points: ViewPoint[] = [];
  for (const mark of marks) {
    if (mark.shape.kind === "point") points.push(mark.shape.at);
    else points.push(...mark.shape.points);
  }
  return points;
}
