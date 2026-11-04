import { SceneError } from "./errors.ts";
import { localMatrix, multiplyMat4, translationOf } from "./transform.ts";
import type {
  Fixture,
  Geometry,
  Mat4,
  PlotSnapshot,
  ProjectSnapshot,
  SceneGraph,
  SceneNode,
  SceneQuery,
  SoundPortal,
  Transform,
} from "./types.ts";
import { isDiscipline } from "./values.ts";

/**
 * Один граф на зал и плот даты.
 * Группы зала и плота стоят в начале координат, поэтому прибор без родителя
 * лежит в координатах зала.
 * Фильтр не создаёт второй граф и не двигает узлы: виды читают тот же граф.
 */

const IDENTITY: Transform = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
};

export function buildSceneGraph(
  snapshot: ProjectSnapshot,
  venueId: string,
  plotId: string,
): SceneGraph {
  const venue = snapshot.venues.find((item) => item.id === venueId);
  if (!venue) {
    throw new SceneError("unknown-venue", `Зал «${venueId}» не найден`);
  }
  const plot = venue.plots.find((item) => item.id === plotId);
  if (!plot) {
    const elsewhere = snapshot.venues.some((item) =>
      item.plots.some((candidate) => candidate.id === plotId),
    );
    throw new SceneError(
      elsewhere ? "plot-venue-mismatch" : "unknown-plot",
      elsewhere
        ? `Плот «${plotId}» относится к другому залу`
        : `Плот «${plotId}» не найден`,
    );
  }

  assertAcyclic(plot);

  const rootId = nodeId("root", `${venueId}:${plotId}`);
  const venueNodeId = nodeId("venue", venueId);
  const plotNodeId = nodeId("plot", plotId);
  const nodes: Record<string, SceneNode> = {};

  const childrenOf = new Map<string | null, string[]>();
  for (const fixture of plot.fixtures) {
    const siblings = childrenOf.get(fixture.parentId) ?? [];
    siblings.push(nodeId("fixture", fixture.id));
    childrenOf.set(fixture.parentId, siblings);
  }

  const underlayIds = (venue.underlay?.strokes ?? []).map((_, index) =>
    nodeId("underlay", `${venue.id}:${index}`),
  );
  const geometryIds = venue.geometry.map((item) => nodeId("geometry", item.id));
  const portalIds = venue.portals.map((item) => nodeId("portal", item.id));

  nodes[rootId] = freezeNode({
    id: rootId,
    parentId: null,
    childIds: [venueNodeId, plotNodeId],
    name: `${venue.name} · ${plot.date}`,
    transform: IDENTITY,
    permanence: "structure",
    discipline: null,
    layerId: null,
    kind: "root",
    catalogType: null,
    address: null,
    shape: null,
    sourceId: null,
  });

  nodes[venueNodeId] = freezeNode({
    id: venueNodeId,
    parentId: rootId,
    childIds: [...underlayIds, ...geometryIds, ...portalIds],
    name: venue.name,
    transform: IDENTITY,
    permanence: "structure",
    discipline: null,
    layerId: null,
    kind: "venue",
    catalogType: null,
    address: null,
    shape: null,
    sourceId: venue.id,
  });

  nodes[plotNodeId] = freezeNode({
    id: plotNodeId,
    parentId: rootId,
    childIds: childrenOf.get(null) ?? [],
    name: plot.date,
    transform: IDENTITY,
    permanence: "structure",
    discipline: null,
    layerId: null,
    kind: "plot",
    catalogType: null,
    address: null,
    shape: null,
    sourceId: plot.id,
  });

  venue.underlay?.strokes.forEach((stroke, index) => {
    const id = underlayIds[index];
    if (!id) return;
    nodes[id] = underlayNode(venue.underlay?.fileName ?? "Подложка", stroke.points, id, venueNodeId);
  });
  for (const geometry of venue.geometry) {
    const id = nodeId("geometry", geometry.id);
    nodes[id] = geometryNode(geometry, id, venueNodeId);
  }
  for (const portal of venue.portals) {
    const id = nodeId("portal", portal.id);
    nodes[id] = portalNode(portal, id, venueNodeId);
  }
  for (const fixture of plot.fixtures) {
    const id = nodeId("fixture", fixture.id);
    const parentId =
      fixture.parentId === null ? plotNodeId : nodeId("fixture", fixture.parentId);
    nodes[id] = fixtureNode(fixture, id, parentId, childrenOf.get(fixture.id) ?? []);
  }

  return Object.freeze({
    venueId: venue.id,
    plotId: plot.id,
    date: plot.date,
    rootId,
    nodes: Object.freeze(nodes),
  });
}

function assertAcyclic(plot: PlotSnapshot): void {
  const byId = new Map(plot.fixtures.map((fixture) => [fixture.id, fixture]));
  const state = new Map<string, "visit" | "done">();

  const visit = (id: string): void => {
    const mark = state.get(id);
    if (mark === "done") return;
    if (mark === "visit") {
      throw new SceneError("parent-cycle", "Приборы замкнуты в цикл родительства");
    }
    state.set(id, "visit");
    const fixture = byId.get(id);
    if (!fixture) {
      throw new SceneError("unknown-parent", `Родитель «${id}» не найден в этом плоте`);
    }
    if (fixture.parentId !== null) {
      if (!byId.has(fixture.parentId)) {
        throw new SceneError(
          "unknown-parent",
          `Родитель «${fixture.parentId}» не найден в этом плоте`,
        );
      }
      visit(fixture.parentId);
    }
    state.set(id, "done");
  };

  for (const fixture of plot.fixtures) visit(fixture.id);
}

function underlayNode(
  name: string,
  points: readonly { x: number; y: number; z: number }[],
  id: string,
  parentId: string,
): SceneNode {
  return freezeNode({
    id,
    parentId,
    childIds: [],
    name,
    transform: IDENTITY,
    permanence: "venue",
    discipline: null,
    layerId: null,
    kind: "underlay",
    catalogType: null,
    address: null,
    shape: { kind: "polyline", points },
    sourceId: null,
  });
}

function geometryNode(geometry: Geometry, id: string, parentId: string): SceneNode {
  return freezeNode({
    id,
    parentId,
    childIds: [],
    name: geometry.name,
    transform: geometry.transform,
    permanence: "venue",
    discipline: null,
    layerId: null,
    kind: "geometry",
    catalogType: null,
    address: null,
    shape: geometry.shape,
    sourceId: geometry.id,
  });
}

function portalNode(portal: SoundPortal, id: string, parentId: string): SceneNode {
  return freezeNode({
    id,
    parentId,
    childIds: [],
    name: portal.name,
    transform: portal.transform,
    permanence: "venue",
    discipline: "sound",
    layerId: null,
    kind: "sound-portal",
    catalogType: portal.type,
    address: null,
    shape: null,
    sourceId: portal.id,
  });
}

function fixtureNode(
  fixture: Fixture,
  id: string,
  parentId: string,
  childIds: readonly string[],
): SceneNode {
  return freezeNode({
    id,
    parentId,
    childIds,
    name: fixture.name,
    transform: fixture.transform,
    permanence: "plot",
    discipline: fixture.discipline,
    layerId: fixture.layerId,
    kind: fixture.kind,
    catalogType: fixture.type,
    address: fixture.address,
    shape: null,
    sourceId: fixture.id,
  });
}

function freezeNode(node: SceneNode): SceneNode {
  const address = node.address
    ? Object.freeze({ universe: node.address.universe, address: node.address.address })
    : null;
  return Object.freeze({
    ...node,
    childIds: Object.freeze([...node.childIds]),
    transform: Object.freeze({
      position: Object.freeze({ ...node.transform.position }),
      rotation: Object.freeze({ ...node.transform.rotation }),
    }),
    address,
    shape: freezeShape(node.shape),
  });
}

function freezeShape(shape: SceneNode["shape"]): SceneNode["shape"] {
  if (shape === null) return null;
  if (shape.kind === "box") {
    return Object.freeze({
      kind: "box",
      width: shape.width,
      depth: shape.depth,
      height: shape.height,
    });
  }
  return Object.freeze({
    kind: "polyline",
    points: Object.freeze(shape.points.map((point) => Object.freeze({ ...point }))),
  });
}

function nodeId(prefix: string, id: string): string {
  return `${prefix}:${id}`;
}

export function sceneNode(graph: SceneGraph, id: string): SceneNode {
  const node = graph.nodes[id];
  if (!node) throw new SceneError("unknown-node", `Узел «${id}» не найден в графе`);
  return node;
}

export function children(graph: SceneGraph, id: string): readonly SceneNode[] {
  return sceneNode(graph, id).childIds.map((childId) => sceneNode(graph, childId));
}

export function walk(graph: SceneGraph): readonly SceneNode[] {
  const ordered: SceneNode[] = [];
  const visit = (id: string): void => {
    const node = sceneNode(graph, id);
    ordered.push(node);
    for (const childId of node.childIds) visit(childId);
  };
  visit(graph.rootId);
  return ordered;
}

export function findBySource(graph: SceneGraph, sourceId: string): SceneNode | null {
  for (const node of walk(graph)) {
    if (node.sourceId === sourceId) return node;
  }
  return null;
}

export function worldMatrix(graph: SceneGraph, id: string): Mat4 {
  const chain: SceneNode[] = [];
  const seen = new Set<string>();
  let current: string | null = id;
  while (current !== null) {
    if (seen.has(current)) {
      throw new SceneError("parent-cycle", "В графе цикл родительства");
    }
    seen.add(current);
    const node: SceneNode = sceneNode(graph, current);
    chain.push(node);
    current = node.parentId;
  }
  chain.reverse();
  let matrix = localMatrix(IDENTITY);
  for (const node of chain) {
    matrix = multiplyMat4(matrix, localMatrix(node.transform));
  }
  return matrix;
}

export function worldPosition(graph: SceneGraph, id: string): { x: number; y: number; z: number } {
  return translationOf(worldMatrix(graph, id));
}

/**
 * Геометрия и подложка зала входят в любой фильтр.
 * Портал виден без фильтра и в дисциплине «звук»: слоя у него нет.
 * Прибор плота виден, если дисциплина совпала и его слой выбран.
 */
export function matchesSceneQuery(node: SceneNode, query: SceneQuery): boolean {
  const layers = normalizeQuery(query);
  if (node.kind === "geometry" || node.kind === "underlay") return true;
  if (node.kind === "sound-portal") {
    return query.discipline === undefined || query.discipline === "sound";
  }
  if (node.permanence !== "plot") return false;
  if (query.discipline !== undefined && node.discipline !== query.discipline) return false;
  if (layers !== undefined) {
    return node.layerId !== null && layers.has(node.layerId);
  }
  return true;
}

export function filterScene(graph: SceneGraph, query: SceneQuery): readonly SceneNode[] {
  normalizeQuery(query);
  return walk(graph).filter((node) => matchesSceneQuery(node, query));
}

function normalizeQuery(query: SceneQuery): ReadonlySet<string> | undefined {
  if (query.layerIds !== undefined && query.discipline === undefined) {
    throw new SceneError(
      "invalid-query",
      "Слой фильтрует приборы только внутри дисциплины",
    );
  }
  if (query.discipline !== undefined && !isDiscipline(query.discipline)) {
    throw new SceneError("invalid-query", "Неизвестная дисциплина фильтра");
  }
  if (query.layerIds === undefined) return undefined;
  return new Set(query.layerIds);
}
