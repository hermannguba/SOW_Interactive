export type SceneErrorCode =
  | "empty-name"
  | "invalid-id"
  | "invalid-date"
  | "invalid-transform"
  | "invalid-shape"
  | "invalid-address"
  | "invalid-snapshot"
  | "invalid-dwg"
  | "invalid-mvr"
  | "invalid-query"
  | "duplicate-id"
  | "duplicate-date"
  | "duplicate-address"
  | "unknown-venue"
  | "unknown-plot"
  | "unknown-layer"
  | "unknown-fixture"
  | "unknown-geometry"
  | "unknown-portal"
  | "unknown-node"
  | "unknown-parent"
  | "layer-discipline"
  | "kind-discipline"
  | "address-required"
  | "address-forbidden"
  | "layer-in-use"
  | "fixture-has-children"
  | "parent-cycle"
  | "plot-venue-mismatch";

export class SceneError extends Error {
  readonly code: SceneErrorCode;

  constructor(code: SceneErrorCode, message: string) {
    super(message);
    this.name = "SceneError";
    this.code = code;
  }
}
