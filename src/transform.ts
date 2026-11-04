import type { Mat4, Transform, Vec3 } from "./types.ts";
import { copyTransform } from "./values.ts";

/**
 * X — ширина зала, Y — глубина, Z — высота.
 * Поворот в градусах. К локальному вектору сначала применяется X, затем Y, затем Z.
 * Матрица column-major, вектор-столбец, правая тройка.
 */

const DEG = Math.PI / 180;

export function localMatrix(transform: Transform): Mat4 {
  const { position, rotation } = copyTransform(transform);
  const rx = rotation.x * DEG;
  const ry = rotation.y * DEG;
  const rz = rotation.z * DEG;
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);

  // R = Rz * Ry * Rx
  const r00 = cy * cz;
  const r01 = sx * sy * cz - cx * sz;
  const r02 = cx * sy * cz + sx * sz;
  const r10 = cy * sz;
  const r11 = sx * sy * sz + cx * cz;
  const r12 = cx * sy * sz - sx * cz;
  const r20 = -sy;
  const r21 = sx * cy;
  const r22 = cx * cy;

  return [
    r00, r10, r20, 0,
    r01, r11, r21, 0,
    r02, r12, r22, 0,
    position.x, position.y, position.z, 1,
  ];
}

export function multiplyMat4(left: Mat4, right: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        const leftValue = left[k * 4 + row];
        const rightValue = right[column * 4 + k];
        if (leftValue === undefined || rightValue === undefined) {
          throw new Error("Матрица 4×4 повреждена");
        }
        sum += leftValue * rightValue;
      }
      out[column * 4 + row] = sum;
    }
  }
  return out as unknown as Mat4;
}

export function transformPoint(matrix: Mat4, point: Vec3): Vec3 {
  const x = matrix[0] * point.x + matrix[4] * point.y + matrix[8] * point.z + matrix[12];
  const y = matrix[1] * point.x + matrix[5] * point.y + matrix[9] * point.z + matrix[13];
  const z = matrix[2] * point.x + matrix[6] * point.y + matrix[10] * point.z + matrix[14];
  return { x, y, z };
}

export function translationOf(matrix: Mat4): Vec3 {
  return { x: matrix[12], y: matrix[13], z: matrix[14] };
}
