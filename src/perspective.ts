import { SceneError } from "./errors.ts";
import { filterScene, worldMatrix } from "./scene-graph.ts";
import { transformPoint, translationOf } from "./transform.ts";
import type { Extent, Mat4, SceneGraph, SceneNode, SceneQuery, Vec3 } from "./types.ts";
import type { OrthographicMark, ViewPoint, ViewShape } from "./orthographic.ts";

/**
 * 3D — та же проекция графа, что вид сверху и сбоку, с тем же фильтром.
 * Камера только крутит картинку. Лучей и нового формата данных нет.
 * Лист: X вправо, Y вверх. Высота зала видна вместе с шириной и глубиной.
 * На плане метровая сетка и оси от нуля. Прибор с габаритом — корпус, не точка.
 */

const EPSILON = 1e-9;
const DEG = Math.PI / 180;

export interface PerspectiveTarget {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface PerspectiveCamera {
  readonly yaw: number;
  readonly pitch: number;
  readonly distance: number;
  readonly focal: number;
  readonly target: PerspectiveTarget;
}

export interface PlanLine {
  readonly role: "grid" | "axis-x" | "axis-y" | "axis-z";
  readonly points: readonly ViewPoint[];
}

export interface PlanLabel {
  readonly text: string;
  readonly at: ViewPoint;
}

/** Сетка пола и нулевая точка. Координаты мира, шаг в метрах от (0, 0, 0). */
export interface PlanOverlay {
  readonly step: number;
  readonly lines: readonly PlanLine[];
  readonly labels: readonly PlanLabel[];
}

export interface PerspectiveProjection {
  readonly view: "3d";
  readonly marks: readonly OrthographicMark[];
  readonly plan: PlanOverlay;
}

export const DEFAULT_CAMERA: PerspectiveCamera = Object.freeze({
  yaw: -48,
  pitch: 32,
  distance: 42,
  focal: 46,
  target: Object.freeze({ x: 0, y: 4, z: 1.5 }),
});

export function projectPerspective(
  graph: SceneGraph,
  camera: PerspectiveCamera = DEFAULT_CAMERA,
  query: SceneQuery = {},
): PerspectiveProjection {
  assertCamera(camera);
  const marks = filterScene(graph, query).map((node) => projectNode(graph, node, camera));
  return Object.freeze({
    view: "3d",
    marks: Object.freeze(marks),
    plan: projectPlan(graph, camera),
  });
}

function projectNode(graph: SceneGraph, node: SceneNode, camera: PerspectiveCamera): OrthographicMark {
  const matrix = worldMatrix(graph, node.id);
  const body = node.extent ? projectExtent(matrix, node.extent, camera) : null;
  const mark: OrthographicMark = {
    nodeId: node.id,
    sourceId: node.sourceId,
    name: node.name,
    nodeKind: node.kind,
    discipline: node.discipline,
    layerId: node.layerId,
    permanence: node.permanence,
    shape: body
      ? body.shape
      : node.kind === "geometry" || node.kind === "underlay"
        ? projectOutline(matrix, node, camera)
        : {
            kind: "point",
            at: freezePoint(toScreen(translationOf(matrix), camera)),
            heading: freezePoint(headingOf(matrix, camera)),
          },
    ...(body ? { edges: body.edges } : {}),
  };
  return Object.freeze(mark);
}

function projectOutline(matrix: Mat4, node: SceneNode, camera: PerspectiveCamera): ViewShape {
  const shape = node.shape;
  if (shape === null) {
    const kind = node.kind === "underlay" ? "подложки" : "геометрии";
    throw new SceneError("invalid-shape", `У ${kind} «${node.name}» нет формы`);
  }
  if (shape.kind === "polyline") {
    return Object.freeze({
      kind: "polyline",
      points: freezePoints(
        dedupe(shape.points.map((point) => toScreen(transformPoint(matrix, point), camera))),
      ),
    });
  }
  const corners = boxCorners(shape.width, shape.depth, shape.height).map((corner) =>
    toScreen(transformPoint(matrix, corner), camera),
  );
  const hull = convexHull(corners);
  if (hull.length >= 3) {
    return Object.freeze({ kind: "polygon", points: freezePoints(hull) });
  }
  return Object.freeze({ kind: "polyline", points: freezePoints(hull) });
}

function toScreen(world: Vec3, camera: PerspectiveCamera): ViewPoint {
  const x = world.x - camera.target.x;
  const y = world.y - camera.target.y;
  const z = world.z - camera.target.z;
  const yaw = camera.yaw * DEG;
  const pitch = camera.pitch * DEG;
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const turnedX = cosYaw * x + sinYaw * y;
  const turnedY = -sinYaw * x + cosYaw * y;
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const depth = camera.distance - (cosPitch * turnedY - sinPitch * z);
  const lifted = sinPitch * turnedY + cosPitch * z;
  const scale = camera.focal / Math.max(depth, 0.25);
  return { x: turnedX * scale, y: lifted * scale };
}

function headingOf(matrix: Mat4, camera: PerspectiveCamera): ViewPoint {
  const origin = toScreen(translationOf(matrix), camera);
  const aimed = toScreen(transformPoint(matrix, { x: 1, y: 0, z: 0 }), camera);
  const dx = aimed.x - origin.x;
  const dy = aimed.y - origin.y;
  const length = Math.hypot(dx, dy);
  if (length < EPSILON) return { x: 0, y: 0 };
  return { x: dx / length, y: dy / length };
}

function assertCamera(camera: PerspectiveCamera): void {
  const numbers = [camera.yaw, camera.pitch, camera.distance, camera.focal, camera.target.x, camera.target.y, camera.target.z];
  if (numbers.some((value) => !Number.isFinite(value)) || camera.distance <= 0 || camera.focal <= 0) {
    throw new SceneError("invalid-query", "Камера 3D задана неверно");
  }
}

function projectExtent(
  matrix: Mat4,
  extent: Extent,
  camera: PerspectiveCamera,
): { shape: ViewShape; edges: readonly (readonly ViewPoint[])[] } {
  const corners = extentCorners(extent).map((corner) => toScreen(transformPoint(matrix, corner), camera));
  const edges = Object.freeze(
    BODY_EDGES.map(([from, to]) => {
      const start = corners[from];
      const end = corners[to];
      return Object.freeze([freezePoint(start ?? { x: 0, y: 0 }), freezePoint(end ?? { x: 0, y: 0 })]);
    }),
  );
  const hull = convexHull(corners);
  if (hull.length >= 3) {
    return { shape: Object.freeze({ kind: "polygon", points: freezePoints(hull) }), edges };
  }
  if (hull.length >= 2) {
    return { shape: Object.freeze({ kind: "polyline", points: freezePoints(hull) }), edges };
  }
  return {
    shape: Object.freeze({
      kind: "point",
      at: freezePoint(hull[0] ?? toScreen(translationOf(matrix), camera)),
      heading: freezePoint({ x: 0, y: 0 }),
    }),
    edges,
  };
}

const BODY_EDGES: readonly (readonly [number, number])[] = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

function projectPlan(graph: SceneGraph, camera: PerspectiveCamera): PlanOverlay {
  let minX = 0;
  let maxX = 0;
  let minY = 0;
  let maxY = 0;
  for (const node of Object.values(graph.nodes)) {
    const matrix = worldMatrix(graph, node.id);
    for (const corner of localCorners(node)) {
      const world = transformPoint(matrix, corner);
      minX = Math.min(minX, world.x);
      maxX = Math.max(maxX, world.x);
      minY = Math.min(minY, world.y);
      maxY = Math.max(maxY, world.y);
    }
  }
  const across = gridRange(minX, maxX);
  const along = gridRange(minY, maxY);
  const step = Math.max(across.step, along.step);
  const lines: PlanLine[] = [];
  for (let x = across.from; x <= across.to + EPSILON; x += step) {
    lines.push(line("grid", { x, y: along.from, z: 0 }, { x, y: along.to, z: 0 }, camera));
  }
  for (let y = along.from; y <= along.to + EPSILON; y += step) {
    lines.push(line("grid", { x: across.from, y, z: 0 }, { x: across.to, y, z: 0 }, camera));
  }
  lines.push(line("axis-x", { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, camera));
  lines.push(line("axis-y", { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, camera));
  lines.push(line("axis-z", { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, camera));
  const origin = toScreen({ x: 0, y: 0, z: 0 }, camera);
  const labels: PlanLabel[] = [
    { text: "0", at: { x: origin.x + 0.28, y: origin.y + 0.28 } },
    { text: "X", at: toScreen({ x: 1.4, y: 0, z: 0 }, camera) },
    { text: "Y", at: toScreen({ x: 0, y: 1.4, z: 0 }, camera) },
    { text: "Z", at: toScreen({ x: 0, y: 0, z: 1.35 }, camera) },
  ];
  return Object.freeze({
    step,
    lines: Object.freeze(lines),
    labels: Object.freeze(labels.map((label) => Object.freeze({ text: label.text, at: freezePoint(label.at) }))),
  });
}

function line(role: PlanLine["role"], from: Vec3, to: Vec3, camera: PerspectiveCamera): PlanLine {
  return Object.freeze({
    role,
    points: Object.freeze([
      freezePoint(toScreen(from, camera)),
      freezePoint(toScreen(to, camera)),
    ]),
  });
}

function gridRange(min: number, max: number): { from: number; to: number; step: number } {
  let from = Math.floor(Math.min(min, 0)) - 1;
  let to = Math.ceil(Math.max(max, 0)) + 1;
  if (to - from < 8) {
    from = Math.min(from, -4);
    to = Math.max(to, 4);
  }
  const step = to - from > 40 ? Math.ceil((to - from) / 40) : 1;
  from = Math.floor(from / step) * step;
  to = Math.ceil(to / step) * step;
  return { from, to, step };
}

function localCorners(node: SceneNode): readonly Vec3[] {
  if (node.extent) return extentCorners(node.extent);
  const shape = node.shape;
  if (shape?.kind === "box") return boxCorners(shape.width, shape.depth, shape.height);
  if (shape?.kind === "polyline" && shape.points.length > 0) return shape.points;
  return [{ x: 0, y: 0, z: 0 }];
}

function extentCorners(extent: Extent): readonly Vec3[] {
  const corners: Vec3[] = [];
  for (const x of [extent.min.x, extent.max.x]) {
    for (const y of [extent.min.y, extent.max.y]) {
      for (const z of [extent.min.z, extent.max.z]) corners.push({ x, y, z });
    }
  }
  return corners;
}

function boxCorners(width: number, depth: number, height: number): readonly Vec3[] {
  const corners: Vec3[] = [];
  for (const x of [-width / 2, width / 2]) {
    for (const y of [-depth / 2, depth / 2]) {
      for (const z of [-height / 2, height / 2]) corners.push({ x, y, z });
    }
  }
  return corners;
}

function dedupe(points: readonly ViewPoint[]): ViewPoint[] {
  const unique: ViewPoint[] = [];
  for (const point of points) {
    const previous = unique[unique.length - 1];
    if (previous && Math.abs(previous.x - point.x) < EPSILON && Math.abs(previous.y - point.y) < EPSILON) {
      continue;
    }
    unique.push(point);
  }
  return unique;
}

function convexHull(points: readonly ViewPoint[]): ViewPoint[] {
  const sorted = [...points].sort((left, right) => left.x - right.x || left.y - right.y);
  const unique = dedupe(sorted);
  if (unique.length <= 2) return unique;
  const lower: ViewPoint[] = [];
  for (const point of unique) {
    while (lower.length >= 2 && !turnsLeft(lower, point)) lower.pop();
    lower.push(point);
  }
  const upper: ViewPoint[] = [];
  for (let index = unique.length - 1; index >= 0; index -= 1) {
    const point = unique[index];
    if (!point) continue;
    while (upper.length >= 2 && !turnsLeft(upper, point)) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function turnsLeft(chain: readonly ViewPoint[], point: ViewPoint): boolean {
  const origin = chain[chain.length - 2];
  const through = chain[chain.length - 1];
  if (!origin || !through) return false;
  const cross = (through.x - origin.x) * (point.y - origin.y) - (through.y - origin.y) * (point.x - origin.x);
  return cross > EPSILON;
}

function freezePoint(point: ViewPoint): ViewPoint {
  return Object.freeze({ x: point.x, y: point.y });
}

function freezePoints(points: readonly ViewPoint[]): readonly ViewPoint[] {
  return Object.freeze(points.map((point) => freezePoint(point)));
}
