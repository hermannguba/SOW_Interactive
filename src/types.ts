export const DISCIPLINES = ["light", "sound", "video"] as const;

export type Discipline = (typeof DISCIPLINES)[number];

export const FIXTURE_KINDS = [
  "light-fixture",
  "active-speaker",
  "led-screen",
  "floor-prompter",
  "tv-on-stand",
] as const;

export type FixtureKind = (typeof FIXTURE_KINDS)[number];

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Углы в градусах. */
export interface Rotation {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface Transform {
  readonly position: Vec3;
  readonly rotation: Rotation;
}

/** Стартовый адрес DMX. Только у прибора света. */
export interface DmxAddress {
  readonly universe: number;
  readonly address: number;
}

export type GeometryShape =
  | {
      readonly kind: "box";
      readonly width: number;
      readonly depth: number;
      readonly height: number;
    }
  | {
      readonly kind: "polyline";
      readonly points: readonly Vec3[];
    };

export interface Geometry {
  readonly id: string;
  readonly name: string;
  readonly shape: GeometryShape;
  readonly transform: Transform;
}

/** Постоянный звуковой портал зала. */
export interface SoundPortal {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly transform: Transform;
}

export interface Layer {
  readonly id: string;
  readonly name: string;
  readonly discipline: Discipline;
}

export interface Fixture {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly discipline: Discipline;
  readonly kind: FixtureKind;
  readonly layerId: string;
  readonly parentId: string | null;
  readonly transform: Transform;
  readonly address: DmxAddress | null;
}

export interface PlotSnapshot {
  readonly id: string;
  readonly date: string;
  readonly layers: readonly Layer[];
  readonly fixtures: readonly Fixture[];
}

export interface VenueSnapshot {
  readonly id: string;
  readonly name: string;
  readonly geometry: readonly Geometry[];
  readonly portals: readonly SoundPortal[];
  readonly plots: readonly PlotSnapshot[];
}

export interface ProjectSnapshot {
  readonly version: 1;
  readonly id: string;
  readonly name: string;
  readonly venues: readonly VenueSnapshot[];
}

export interface NamedRef {
  readonly id: string;
  readonly name: string;
}

export interface PlotRef {
  readonly id: string;
  readonly venueId: string;
  readonly date: string;
}

interface FixtureDraftBase {
  readonly name: string;
  readonly type: string;
  readonly layerId: string;
  readonly transform: Transform;
  readonly parentId?: string | null;
}

export type AddFixtureInput =
  | (FixtureDraftBase & {
      readonly discipline: "light";
      readonly kind: "light-fixture";
      readonly address: DmxAddress;
    })
  | (FixtureDraftBase & {
      readonly discipline: "sound";
      readonly kind: "active-speaker";
    })
  | (FixtureDraftBase & {
      readonly discipline: "video";
      readonly kind: "led-screen" | "floor-prompter" | "tv-on-stand";
    });

export interface FixtureQuery {
  readonly discipline?: Discipline;
  readonly layerId?: string;
}

export type Mat4 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export const SCENE_NODE_KINDS = [
  "root",
  "venue",
  "plot",
  "geometry",
  "sound-portal",
  "light-fixture",
  "active-speaker",
  "led-screen",
  "floor-prompter",
  "tv-on-stand",
] as const;

export type SceneNodeKind = (typeof SCENE_NODE_KINDS)[number];

export type Permanence = "structure" | "venue" | "plot";

/**
 * Узел одного графа сцены.
 * Группы root, venue и plot не рисуются: через них читается дерево.
 */
export interface SceneNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly childIds: readonly string[];
  readonly name: string;
  readonly transform: Transform;
  readonly permanence: Permanence;
  readonly discipline: Discipline | null;
  readonly layerId: string | null;
  readonly kind: SceneNodeKind;
  readonly catalogType: string | null;
  readonly address: DmxAddress | null;
  readonly shape: GeometryShape | null;
  readonly sourceId: string | null;
}

export interface SceneGraph {
  readonly venueId: string;
  readonly plotId: string;
  readonly date: string;
  readonly rootId: string;
  readonly nodes: Readonly<Record<string, SceneNode>>;
}

/** layerIds имеет смысл только вместе с дисциплиной. */
export interface SceneQuery {
  readonly discipline?: Discipline;
  readonly layerIds?: readonly string[];
}
