import { SceneError } from "./errors.ts";
import { filterScene, worldMatrix } from "./scene-graph.ts";
import { transformPoint, translationOf } from "./transform.ts";
import type {
  Discipline,
  Mat4,
  Permanence,
  SceneGraph,
  SceneNode,
  SceneNodeKind,
  SceneQuery,
  Vec3,
} from "./types.ts";

/**
 * Вид сверху и вид сбоку читают граф и возвращают плоские точки и контуры.
 * Сверху ось листа Y — это глубина зала, высота отброшена.
 * Сбоку ось листа Y — это высота зала, глубина отброшена.
 * Параллелепипед симметричен относительно трансформа узла.
 * Направление точки — проекция локальной оси X.
 */

const EPSILON = 1e-9;

export type OrthographicView = "top" | "side";

export interface ViewPoint {
  readonly x: number;
  readonly y: number;
}

export interface ViewAxes {
  readonly horizontal: "x";
  readonly vertical: "y" | "z";
  readonly dropped: "y" | "z";
}

export type ViewShape =
  | { readonly kind: "point"; readonly at: ViewPoint; readonly heading: ViewPoint }
  | { readonly kind: "polyline"; readonly points: readonly ViewPoint[] }
  | { readonly kind: "polygon"; readonly points: readonly ViewPoint[] };

export interface OrthographicMark {
  readonly nodeId: string;
  readonly sourceId: string | null;
  readonly name: string;
  readonly nodeKind: SceneNodeKind;
  readonly discipline: Discipline | null;
  readonly layerId: string | null;
  readonly permanence: Permanence;
  readonly shape: ViewShape;
}

export interface OrthographicProjection {
  readonly view: OrthographicView;
  readonly axes: ViewAxes;
  readonly marks: readonly OrthographicMark[];
}

const AXES: Record<OrthographicView, ViewAxes> = {
  top: { horizontal: "x", vertical: "y", dropped: "z" },
  side: { horizontal: "x", vertical: "z", dropped: "y" },
};

export function projectOrthographic(
  graph: SceneGraph,
  view: OrthographicView,
  query: SceneQuery = {},
): OrthographicProjection {
  if (view !== "top" && view !== "side") {
    throw new SceneError("invalid-query", "Вид должен быть сверху или сбоку");
  }
  const marks = filterScene(graph, query).map((node) => projectNode(graph, node, view));
  return Object.freeze({
    view,
    axes: Object.freeze({ ...AXES[view] }),
    marks: Object.freeze(marks),
  });
}

function projectNode(
  graph: SceneGraph,
  node: SceneNode,
  view: OrthographicView,
): OrthographicMark {
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
      node.kind === "geometry"
        ? projectGeometry(matrix, node, view)
        : {
            kind: "point",
            at: freezePoint(toView(view, translationOf(matrix))),
            heading: freezePoint(headingOf(view, matrix)),
          },
  };
  return Object.freeze(mark);
}

function projectGeometry(matrix: Mat4, node: SceneNode, view: OrthographicView): ViewShape {
  const shape = node.shape;
  if (shape === null) {
    throw new SceneError("invalid-shape", `У геометрии «${node.name}» нет формы`);
  }
  if (shape.kind === "polyline") {
    return Object.freeze({
      kind: "polyline",
      points: freezePoints(
        dedupe(shape.points.map((point) => toView(view, transformPoint(matrix, point)))),
      ),
    });
  }
  const corners = boxCorners(shape.width, shape.depth, shape.height).map((corner) =>
    toView(view, transformPoint(matrix, corner)),
  );
  const hull = convexHull(corners);
  if (hull.length >= 3) {
    return Object.freeze({ kind: "polygon", points: freezePoints(hull) });
  }
  return Object.freeze({ kind: "polyline", points: freezePoints(hull) });
}

function boxCorners(width: number, depth: number, height: number): readonly Vec3[] {
  const corners: Vec3[] = [];
  for (const x of [-width / 2, width / 2]) {
    for (const y of [-depth / 2, depth / 2]) {
      for (const z of [-height / 2, height / 2]) {
        corners.push({ x, y, z });
      }
    }
  }
  return corners;
}

function toView(view: OrthographicView, world: Vec3): ViewPoint {
  if (view === "top") return { x: world.x, y: world.y };
  return { x: world.x, y: world.z };
}

function headingOf(view: OrthographicView, matrix: Mat4): ViewPoint {
  const origin = translationOf(matrix);
  const aimed = transformPoint(matrix, { x: 1, y: 0, z: 0 });
  const flat = toView(view, {
    x: aimed.x - origin.x,
    y: aimed.y - origin.y,
    z: aimed.z - origin.z,
  });
  const length = Math.hypot(flat.x, flat.y);
  if (length < EPSILON) return { x: 0, y: 0 };
  return { x: flat.x / length, y: flat.y / length };
}

function dedupe(points: readonly ViewPoint[]): ViewPoint[] {
  const unique: ViewPoint[] = [];
  for (const point of points) {
    const previous = unique[unique.length - 1];
    if (previous && samePoint(previous, point)) continue;
    unique.push(point);
  }
  return unique;
}

function samePoint(left: ViewPoint, right: ViewPoint): boolean {
  return Math.abs(left.x - right.x) < EPSILON && Math.abs(left.y - right.y) < EPSILON;
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
  const cross =
    (through.x - origin.x) * (point.y - origin.y) -
    (through.y - origin.y) * (point.x - origin.x);
  return cross > EPSILON;
}

function freezePoint(point: ViewPoint): ViewPoint {
  return Object.freeze({ x: point.x, y: point.y });
}

function freezePoints(points: readonly ViewPoint[]): readonly ViewPoint[] {
  return Object.freeze(points.map((point) => freezePoint(point)));
}
