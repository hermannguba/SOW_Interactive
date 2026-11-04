import { unzipSync } from "fflate";
import { SceneError } from "./errors.ts";
import type { Project } from "./project.ts";
import { multiplyMat4 } from "./transform.ts";
import type { DmxAddress, Mat4, Transform } from "./types.ts";

/**
 * MVR — архив с GeneralSceneDescription.xml.
 * В плот выбранной даты попадают только световые Fixture:
 * тип, позиция, поворот, юниверс и адрес.
 * Экраны, проекторы и прочая геометрия не становятся приборами.
 * Матрица MVR: три строки поворота и перенос в четвёртой строке.
 * Поворот читается так же, как в ядре: сначала X, затем Y, затем Z.
 */

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export interface MvrLight {
  readonly name: string;
  readonly type: string;
  readonly transform: Transform;
  readonly address: DmxAddress;
}

export function parseMvrLights(bytes: Uint8Array): readonly MvrLight[] {
  if (bytes.byteLength === 0) throw new SceneError("invalid-mvr", "Файл пустой");
  const xml = sceneXml(bytes);
  let root: XmlNode;
  try {
    root = parseXml(xml);
  } catch (error) {
    if (error instanceof SceneError) throw error;
    throw new SceneError("invalid-mvr", "Не удалось прочитать MVR");
  }
  const scene = findFirst(root, "Scene") ?? root;
  const drafts: MvrLight[] = [];
  walk(scene, IDENTITY, drafts);
  if (drafts.length === 0) {
    throw new SceneError("invalid-mvr", "В MVR нет световых приборов");
  }
  const seen = new Set<string>();
  for (const light of drafts) {
    const key = addressKey(light.address);
    if (seen.has(key)) {
      throw new SceneError("invalid-mvr", `Адрес ${key} повторяется в MVR`);
    }
    seen.add(key);
  }
  return drafts;
}

export function importMvrLights(project: Project, plotId: string, bytes: Uint8Array): readonly string[] {
  const lights = parseMvrLights(bytes);
  const taken = new Set(
    project
      .listFixtures(plotId, { discipline: "light" })
      .flatMap((fixture) => (fixture.address ? [addressKey(fixture.address)] : [])),
  );
  for (const light of lights) {
    const key = addressKey(light.address);
    if (taken.has(key)) throw new SceneError("duplicate-address", `Адрес ${key} уже занят`);
    taken.add(key);
  }

  const layers = project.listLayers(plotId, "light");
  let layerId = layers.find((layer) => layer.name === "Основной")?.id ?? layers[0]?.id;
  const createdLayer = layerId === undefined;
  if (!layerId) layerId = project.addLayer(plotId, { name: "Основной", discipline: "light" });

  const added: string[] = [];
  try {
    for (const light of lights) {
      added.push(
        project.addFixture(plotId, {
          name: light.name,
          type: light.type,
          discipline: "light",
          kind: "light-fixture",
          layerId,
          transform: light.transform,
          address: light.address,
        }),
      );
    }
  } catch (error) {
    for (const id of added.reverse()) project.removeFixture(plotId, id);
    if (createdLayer) project.removeLayer(plotId, layerId);
    throw error;
  }
  return added;
}

function addressKey(address: DmxAddress): string {
  return `${address.universe}.${address.address}`;
}

function sceneXml(bytes: Uint8Array): string {
  if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new SceneError("invalid-mvr", "Это не файл MVR");
  }
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new SceneError("invalid-mvr", "Не удалось прочитать MVR");
  }
  const entry = Object.entries(files).find(([name]) =>
    name.replaceAll("\\", "/").toLowerCase().endsWith("generalscenedescription.xml"),
  );
  if (!entry) throw new SceneError("invalid-mvr", "Это не файл MVR");
  return new TextDecoder("utf-8").decode(entry[1]).replace(/^\uFEFF/, "");
}

interface XmlNode {
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: readonly XmlNode[];
  readonly text: string;
}

function walk(node: XmlNode, parent: Mat4, into: MvrLight[]): void {
  const local = readMatrix(node);
  const world = local ? multiplyMat4(parent, local) : parent;
  if (node.name.toLowerCase() === "fixture") into.push(readFixture(node, world));
  for (const child of node.children) walk(child, world, into);
}

function readFixture(node: XmlNode, world: Mat4): MvrLight {
  const name = textOr(attr(node.attrs, "name"), "Прибор");
  const type = fixtureType(attr(node.attrs, "gdtfSpec"), name);
  return {
    name,
    type,
    transform: transformOf(world, name),
    address: addressOf(node, name),
  };
}

function fixtureType(spec: string | undefined, name: string): string {
  if (!spec) return name;
  const cleaned = spec.trim().replace(/\.gdtf$/i, "");
  const split = cleaned.indexOf("@");
  const type = (split >= 0 ? cleaned.slice(split + 1) : cleaned).trim();
  return type === "" ? name : type;
}

function textOr(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? fallback : trimmed;
}

function addressOf(node: XmlNode, label: string): DmxAddress {
  const holder = node.children.find((child) => child.name.toLowerCase() === "addresses");
  const list = (holder ? holder.children : node.children).filter(
    (child) => child.name.toLowerCase() === "address",
  );
  const chosen = [...list].sort((left, right) => breakOf(left) - breakOf(right))[0];
  if (!chosen) throw new SceneError("invalid-mvr", `У прибора «${label}» нет адреса DMX`);
  const absolute = Number(chosen.text.trim());
  if (!Number.isInteger(absolute) || absolute < 1) {
    throw new SceneError("invalid-mvr", `У прибора «${label}» нет адреса DMX`);
  }
  return {
    universe: Math.floor((absolute - 1) / 512) + 1,
    address: ((absolute - 1) % 512) + 1,
  };
}

function breakOf(node: XmlNode): number {
  const raw = attr(node.attrs, "break");
  if (raw === undefined || raw.trim() === "") return 0;
  const value = Number(raw);
  return Number.isInteger(value) ? value : 0;
}

function readMatrix(node: XmlNode): Mat4 | null {
  const matrix = node.children.find((child) => child.name.toLowerCase() === "matrix");
  if (!matrix || matrix.text.trim() === "") return null;
  return parseMatrix(matrix.text, textOr(attr(node.attrs, "name"), "MVR"));
}

function parseMatrix(source: string, label: string): Mat4 {
  const groups = source.match(/\{[^{}]+\}/g);
  if (!groups || groups.length !== 4) {
    throw new SceneError("invalid-mvr", `Не удалось прочитать положение прибора «${label}»`);
  }
  const rows = groups.map((group) => group.slice(1, -1).split(",").map((item) => Number(item.trim())));
  if (rows.some((row) => row.length !== 4 || row.some((value) => !Number.isFinite(value)))) {
    throw new SceneError("invalid-mvr", `Не удалось прочитать положение прибора «${label}»`);
  }
  const row0 = rows[0];
  const row1 = rows[1];
  const row2 = rows[2];
  const row3 = rows[3];
  if (!row0 || !row1 || !row2 || !row3) {
    throw new SceneError("invalid-mvr", `Не удалось прочитать положение прибора «${label}»`);
  }
  const r00 = row0[0] ?? 0;
  const r01 = row0[1] ?? 0;
  const r02 = row0[2] ?? 0;
  const r10 = row1[0] ?? 0;
  const r11 = row1[1] ?? 0;
  const r12 = row1[2] ?? 0;
  const r20 = row2[0] ?? 0;
  const r21 = row2[1] ?? 0;
  const r22 = row2[2] ?? 0;
  return [r00, r10, r20, 0, r01, r11, r21, 0, r02, r12, r22, 0, row3[0] ?? 0, row3[1] ?? 0, row3[2] ?? 0, 1];
}

function transformOf(matrix: Mat4, label: string): Transform {
  const position = { x: matrix[12], y: matrix[13], z: matrix[14] };
  const r00 = matrix[0];
  const r10 = matrix[1];
  const r20 = matrix[2];
  const r11 = matrix[5];
  const r21 = matrix[6];
  const r12 = matrix[9];
  const r22 = matrix[10];
  if (
    [position.x, position.y, position.z, r00, r10, r20, r11, r21, r12, r22].some(
      (value) => value === undefined || !Number.isFinite(value),
    )
  ) {
    throw new SceneError("invalid-mvr", `Не удалось прочитать положение прибора «${label}»`);
  }
  const sy = -(r20 ?? 0);
  const cy = Math.hypot(r00 ?? 0, r10 ?? 0);
  const ry = Math.atan2(sy, cy);
  const rz = cy > 1e-6 ? Math.atan2(r10 ?? 0, r00 ?? 0) : 0;
  const rx = cy > 1e-6 ? Math.atan2(r21 ?? 0, r22 ?? 0) : Math.atan2(-(r12 ?? 0), r11 ?? 0);
  return {
    position,
    rotation: { x: (rx * 180) / Math.PI, y: (ry * 180) / Math.PI, z: (rz * 180) / Math.PI },
  };
}

function findFirst(node: XmlNode, name: string): XmlNode | null {
  if (node.name.toLowerCase() === name.toLowerCase()) return node;
  for (const child of node.children) {
    const found = findFirst(child, name);
    if (found) return found;
  }
  return null;
}

function attr(attrs: Readonly<Record<string, string>>, key: string): string | undefined {
  const found = Object.entries(attrs).find(([name]) => name.toLowerCase() === key.toLowerCase());
  return found?.[1];
}

function parseXml(source: string): XmlNode {
  const parsed = parseContent(source, 0, null);
  if (parsed.index < source.length && source.slice(parsed.index).trim() !== "") {
    throw new SceneError("invalid-mvr", "Не удалось прочитать MVR");
  }
  return { name: "#root", attrs: {}, children: parsed.nodes, text: parsed.text };
}

function parseContent(
  source: string,
  start: number,
  until: string | null,
): { nodes: XmlNode[]; index: number; text: string } {
  const nodes: XmlNode[] = [];
  let text = "";
  let index = start;
  while (index < source.length) {
    const char = source[index];
    if (char !== "<") {
      const next = source.indexOf("<", index);
      const end = next === -1 ? source.length : next;
      text += source.slice(index, end);
      index = end;
      continue;
    }
    if (source.startsWith("<!--", index)) {
      const end = source.indexOf("-->", index + 4);
      if (end < 0) throw new SceneError("invalid-mvr", "Не удалось прочитать MVR");
      index = end + 3;
      continue;
    }
    if (source.startsWith("<?", index)) {
      const end = source.indexOf("?>", index + 2);
      if (end < 0) throw new SceneError("invalid-mvr", "Не удалось прочитать MVR");
      index = end + 2;
      continue;
    }
    if (source.startsWith("</", index)) {
      const end = source.indexOf(">", index + 2);
      if (end < 0) throw new SceneError("invalid-mvr", "Не удалось прочитать MVR");
      const name = localName(source.slice(index + 2, end).trim());
      if (until === null || name.toLowerCase() !== until.toLowerCase()) {
        throw new SceneError("invalid-mvr", "Не удалось прочитать MVR");
      }
      return { nodes, index: end + 1, text: decodeXml(text) };
    }
    const end = source.indexOf(">", index + 1);
    if (end < 0) throw new SceneError("invalid-mvr", "Не удалось прочитать MVR");
    let raw = source.slice(index + 1, end).trim();
    if (raw.startsWith("!")) {
      index = end + 1;
      continue;
    }
    const selfClosing = raw.endsWith("/");
    if (selfClosing) raw = raw.slice(0, -1).trim();
    const split = raw.search(/\s/);
    const name = localName(split === -1 ? raw : raw.slice(0, split));
    const attrs = parseAttrs(split === -1 ? "" : raw.slice(split));
    index = end + 1;
    if (selfClosing) {
      nodes.push({ name, attrs, children: [], text: "" });
      continue;
    }
    const inner = parseContent(source, index, name);
    nodes.push({ name, attrs, children: inner.nodes, text: inner.text.trim() });
    index = inner.index;
  }
  if (until !== null) throw new SceneError("invalid-mvr", "Не удалось прочитать MVR");
  return { nodes, index, text: decodeXml(text) };
}

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let index = 0;
  while (index < source.length) {
    while (index < source.length && /\s/.test(source[index] ?? "")) index += 1;
    if (index >= source.length) break;
    const nameStart = index;
    while (index < source.length && source[index] !== "=" && !/\s/.test(source[index] ?? "")) index += 1;
    const name = localName(source.slice(nameStart, index));
    while (index < source.length && /\s/.test(source[index] ?? "")) index += 1;
    if (source[index] !== "=") throw new SceneError("invalid-mvr", "Не удалось прочитать MVR");
    index += 1;
    while (index < source.length && /\s/.test(source[index] ?? "")) index += 1;
    const quote = source[index];
    if (quote !== '"' && quote !== "'") throw new SceneError("invalid-mvr", "Не удалось прочитать MVR");
    index += 1;
    const valueStart = index;
    while (index < source.length && source[index] !== quote) index += 1;
    if (index >= source.length) throw new SceneError("invalid-mvr", "Не удалось прочитать MVR");
    attrs[name] = decodeXml(source.slice(valueStart, index));
    index += 1;
  }
  return attrs;
}

function localName(name: string): string {
  const colon = name.lastIndexOf(":");
  return (colon >= 0 ? name.slice(colon + 1) : name).trim();
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}
