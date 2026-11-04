import { SceneError } from "./errors.ts";
import { filterScene, worldMatrix } from "./scene-graph.ts";
import { transformPoint, translationOf } from "./transform.ts";
import type { Mat4, SceneGraph, SceneNode, SceneQuery, Vec3 } from "./types.ts";
import type { OrthographicMark, ViewPoint, ViewShape } from "./orthographic.ts";

/**
 * 3D — та же проекция графа, что вид сверху и сбоку, с тем же фильтром.
 * Камера только крутит картинку. Лучей и нового формата данных нет.
 * Лист: X вправо, Y вверх. Высота зала видна вместе с шириной и глубиной.
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

export interface PerspectiveProjection {
  readonly view: "3d";
  readonly marks: readonly OrthographicMark[];
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
  });
}

function projectNode(graph: SceneGraph, node: SceneNode, camera: PerspectiveCamera): OrthographicMark {
  const matrix = worldMatrix(graph, node.id);
  const mark: OrthographicMark = {
    nodeId: node.id,
    sourceId: node.sourceId,
    name: node.name,
    nodeKind: node.kind,
    discipline: node.discipline,
    layerId: node.layerId,
    permanence: node.permanence,
    shape:
      node.kind === "geometry" || node.kind === "underlay"
        ? projectOutline(matrix, node, camera)
        : {
            kind: "point",
            at: freezePoint(toScreen(translationOf(matrix), camera)),
            heading: freezePoint(headingOf(matrix, camera)),
          },
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
