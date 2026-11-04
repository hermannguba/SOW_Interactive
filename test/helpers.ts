import assert from "node:assert/strict";
import { SceneError, type SceneErrorCode, type Transform } from "../src/index.ts";

export function sequentialIds(): () => string {
  let n = 0;
  return () => `id-${++n}`;
}

export function at(
  x: number,
  y: number,
  z: number,
  rotation: { x?: number; y?: number; z?: number } = {},
): Transform {
  return {
    position: { x, y, z },
    rotation: { x: rotation.x ?? 0, y: rotation.y ?? 0, z: rotation.z ?? 0 },
  };
}

export function expectError(run: () => void, code: SceneErrorCode): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof SceneError, String(error));
    assert.equal(error.code, code);
    return true;
  });
}

export function expectClose(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ~= ${expected}`);
}

export function expectVec(
  actual: { readonly x: number; readonly y: number; readonly z: number },
  x: number,
  y: number,
  z: number,
): void {
  expectClose(actual.x, x);
  expectClose(actual.y, y);
  expectClose(actual.z, z);
}
