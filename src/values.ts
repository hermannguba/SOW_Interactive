import { SceneError } from "./errors.ts";
import {
  DISCIPLINES,
  type DmxAddress,
  type Discipline,
  type FixtureKind,
  type GeometryShape,
  type Rotation,
  type Transform,
  type Vec3,
} from "./types.ts";

const KIND_BY_DISCIPLINE: Record<Discipline, ReadonlySet<FixtureKind>> = {
  light: new Set(["light-fixture"]),
  sound: new Set(["active-speaker"]),
  video: new Set(["led-screen", "floor-prompter", "tv-on-stand"]),
};

const DISCIPLINE_LABEL: Record<Discipline, string> = {
  light: "свет",
  sound: "звук",
  video: "видео",
};

export function isDiscipline(value: unknown): value is Discipline {
  return (
    typeof value === "string" &&
    (DISCIPLINES as readonly string[]).includes(value)
  );
}

export function disciplineLabel(discipline: Discipline): string {
  return DISCIPLINE_LABEL[discipline];
}

export function assertId(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new SceneError("invalid-id", "Идентификатор должен быть непустой строкой");
  }
  return value;
}

export function assertName(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new SceneError("empty-name", "Имя не может быть пустым");
  }
  return value.trim();
}

export function assertDate(value: unknown): string {
  if (typeof value !== "string") {
    throw new SceneError(
      "invalid-date",
      "Дата мероприятия должна быть календарной в формате ГГГГ-ММ-ДД",
    );
  }
  const date = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new SceneError(
      "invalid-date",
      "Дата мероприятия должна быть календарной в формате ГГГГ-ММ-ДД",
    );
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  const real =
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day;
  if (!real) {
    throw new SceneError(
      "invalid-date",
      "Дата мероприятия должна быть календарной в формате ГГГГ-ММ-ДД",
    );
  }
  return date;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function copyVec3(value: unknown): Vec3 {
  if (typeof value !== "object" || value === null) {
    throw new SceneError("invalid-transform", "Позиция задаётся числами X, Y и Z");
  }
  const point = value as Record<string, unknown>;
  if (!finite(point.x) || !finite(point.y) || !finite(point.z)) {
    throw new SceneError("invalid-transform", "Позиция задаётся конечными числами X, Y и Z");
  }
  return { x: point.x, y: point.y, z: point.z };
}

function copyRotation(value: unknown): Rotation {
  if (typeof value !== "object" || value === null) {
    throw new SceneError("invalid-transform", "Поворот задаётся градусами X, Y и Z");
  }
  const rotation = value as Record<string, unknown>;
  if (!finite(rotation.x) || !finite(rotation.y) || !finite(rotation.z)) {
    throw new SceneError("invalid-transform", "Поворот задаётся конечными градусами X, Y и Z");
  }
  return { x: rotation.x, y: rotation.y, z: rotation.z };
}

export function copyTransform(value: unknown): Transform {
  if (typeof value !== "object" || value === null) {
    throw new SceneError("invalid-transform", "У объекта нет трансформа");
  }
  const transform = value as Record<string, unknown>;
  return {
    position: copyVec3(transform.position),
    rotation: copyRotation(transform.rotation),
  };
}

export function copyShape(value: unknown): GeometryShape {
  if (typeof value !== "object" || value === null) {
    throw new SceneError("invalid-shape", "У геометрии нет формы");
  }
  const shape = value as Record<string, unknown>;
  if (shape.kind === "box") {
    if (!finite(shape.width) || !finite(shape.depth) || !finite(shape.height)) {
      throw new SceneError("invalid-shape", "Размеры параллелепипеда должны быть числами");
    }
    if (shape.width <= 0 || shape.depth <= 0 || shape.height <= 0) {
      throw new SceneError("invalid-shape", "Размеры параллелепипеда должны быть больше нуля");
    }
    return { kind: "box", width: shape.width, depth: shape.depth, height: shape.height };
  }
  if (shape.kind === "polyline") {
    if (!Array.isArray(shape.points) || shape.points.length < 2) {
      throw new SceneError("invalid-shape", "Ломаная должна содержать хотя бы две точки");
    }
    return {
      kind: "polyline",
      points: shape.points.map((point) => {
        try {
          return copyVec3(point);
        } catch (error) {
          if (error instanceof SceneError && error.code === "invalid-transform") {
            throw new SceneError(
              "invalid-shape",
              "Точка ломаной задаётся конечными числами X, Y и Z",
            );
          }
          throw error;
        }
      }),
    };
  }
  throw new SceneError("invalid-shape", "Форма геометрии не поддерживается");
}

export function copyAddress(value: unknown): DmxAddress {
  if (typeof value !== "object" || value === null) {
    throw new SceneError("invalid-address", "Адрес света — это юниверс и канал");
  }
  const address = value as Record<string, unknown>;
  if (!Number.isInteger(address.universe) || (address.universe as number) < 1) {
    throw new SceneError("invalid-address", "Юниверс должен быть целым числом от 1");
  }
  if (
    !Number.isInteger(address.address) ||
    (address.address as number) < 1 ||
    (address.address as number) > 512
  ) {
    throw new SceneError("invalid-address", "Адрес должен быть целым числом от 1 до 512");
  }
  return { universe: address.universe as number, address: address.address as number };
}

export function assertKind(discipline: Discipline, kind: unknown): FixtureKind {
  const allowed = KIND_BY_DISCIPLINE[discipline];
  if (typeof kind !== "string" || !allowed.has(kind as FixtureKind)) {
    throw new SceneError(
      "kind-discipline",
      `Вид прибора «${String(kind)}» не относится к дисциплине «${disciplineLabel(discipline)}»`,
    );
  }
  return kind as FixtureKind;
}

export function addressKey(address: DmxAddress): string {
  return `${address.universe}:${address.address}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
