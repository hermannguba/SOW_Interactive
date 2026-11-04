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

export function nextAddress(fixtures: readonly Fixture[]): DmxAddress {
  const used = new Set<string>();
  for (const fixture of fixtures) {
    if (fixture.address) used.add(`${fixture.address.universe}:${fixture.address.address}`);
  }
  for (let universe = 1; universe <= 64; universe += 1) {
    for (let address = 1; address <= 512; address += 1) {
      if (!used.has(`${universe}:${address}`)) return { universe, address };
    }
  }
  throw new SceneError("invalid-address", "Свободный адрес DMX не найден");
}

export function frameOf(marks: readonly OrthographicMark[], padding = 2): ViewFrame {
  const points = pointsOf(marks);
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

function pointsOf(marks: readonly OrthographicMark[]): ViewPoint[] {
  const points: ViewPoint[] = [];
  for (const mark of marks) {
    if (mark.shape.kind === "point") points.push(mark.shape.at);
    else points.push(...mark.shape.points);
  }
  return points;
}
