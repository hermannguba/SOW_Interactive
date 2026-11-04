import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { localMatrix, transformPoint } from "../src/index.ts";
import { at, expectClose, expectError, expectVec } from "./helpers.ts";

describe("локальный трансформ", () => {
  test("без поворота сдвигает точку на позицию", () => {
    const matrix = localMatrix(at(10, 2, 4));
    expectVec(transformPoint(matrix, { x: 0, y: 0, z: 0 }), 10, 2, 4);
    expectVec(transformPoint(matrix, { x: 1, y: 0, z: 0 }), 11, 2, 4);
  });

  test("рысканье 90° вокруг высоты переводит локальный X в Y", () => {
    const matrix = localMatrix(at(0, 0, 0, { z: 90 }));
    expectVec(transformPoint(matrix, { x: 1, y: 0, z: 0 }), 0, 1, 0);
    expectVec(transformPoint(matrix, { x: 0, y: 1, z: 0 }), -1, 0, 0);
    expectVec(transformPoint(matrix, { x: 0, y: 0, z: 1 }), 0, 0, 1);
    expectClose(matrix[0] ?? 0, 0);
    expectClose(matrix[1] ?? 0, 1);
  });

  test("сдвиг и рысканье складываются", () => {
    const matrix = localMatrix(at(10, 0, 0, { z: 90 }));
    expectVec(transformPoint(matrix, { x: 1, y: 0, z: 0 }), 10, 1, 0);
  });

  test("бесконечная координата отвергается", () => {
    expectError(() => localMatrix(at(Number.NaN, 0, 0)), "invalid-transform");
    expectError(() => localMatrix(at(0, 0, Number.POSITIVE_INFINITY)), "invalid-transform");
  });
});
