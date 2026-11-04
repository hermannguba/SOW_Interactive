import { unzipSync } from "fflate";
import { SceneError } from "./errors.ts";
import { multiplyMat4, transformPoint } from "./transform.ts";
import type { Extent, Mat4, Vec3 } from "./types.ts";

/**
 * Разбор description.xml из архива GDTF в карточку библиотеки.
 * Берутся имя типа, режимы, явные слоты DMX и габарит Geometry/Axis.
 * Лучи, колёса, сетки и значения каналов не читаются.
 * Матрица геометрии — 4×4, перенос в четвёртом столбце, метры.
 */

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export interface GdtfChannel {
  readonly dmxBreak: number;
  readonly slots: readonly number[];
  readonly attribute: string;
  readonly pretty: string;
  readonly original: string;
  readonly geometry: string;
}

export interface GdtfBreak {
  readonly dmxBreak: number;
  readonly footprint: number;
}

export interface GdtfMode {
  readonly name: string;
  readonly description: string;
  readonly geometry: string;
  /** false, если слоты пикселей задаются ссылками GeometryReference, а не Offset. */
  readonly expanded: boolean;
  /** Футпринт основного разрыва. Пусто, пока режим не развёрнут. */
  readonly footprint: number | null;
  readonly breaks: readonly GdtfBreak[];
  readonly channels: readonly GdtfChannel[];
}

export interface GdtfFixture {
  readonly fixtureTypeId: string;
  readonly name: string;
  readonly shortName: string;
  readonly longName: string;
  readonly manufacturer: string;
  readonly description: string;
  /** Строка файла, как её пишет MVR в GDTFSpec. */
  readonly spec: string;
  readonly revision: string | null;
  readonly extent: Extent | null;
  readonly modes: readonly GdtfMode[];
}

export function parseGdtf(bytes: Uint8Array, spec: string): GdtfFixture {
  const fileName = spec.trim();
  if (fileName === "") throw new SceneError("invalid-gdtf", "У файла GDTF нет имени");
  if (bytes.byteLength === 0) throw new SceneError("invalid-gdtf", "Файл GDTF пустой");
  const xml = descriptionXml(bytes);
  let root: XmlNode;
  try {
    root = parseXml(xml);
  } catch (error) {
    if (error instanceof SceneError) throw error;
    throw new SceneError("invalid-gdtf", "Не удалось прочитать GDTF");
  }
  const gdtf = child(root, "GDTF") ?? root;
  const fixtureType = child(gdtf, "FixtureType");
  if (!fixtureType) throw new SceneError("invalid-gdtf", "В GDTF нет типа прибора");
  const name = required(fixtureType, "Name", "имени типа");
  const fixtureTypeId = required(fixtureType, "FixtureTypeID", "идентификатора типа");
  const manufacturer = textOf(attr(fixtureType, "Manufacturer"));
  if (manufacturer === "") throw new SceneError("invalid-gdtf", "У типа прибора нет производителя");
  const models = readModels(child(fixtureType, "Models"));
  const geometries = child(fixtureType, "Geometries");
  const extent = geometries ? extentOf(geometries, models) : null;
  const pretty = readPretty(child(fixtureType, "AttributeDefinitions"));
  const modesNode = child(fixtureType, "DMXModes");
  if (!modesNode) throw new SceneError("invalid-gdtf", "В GDTF нет режимов DMX");
  const modes = modesNode.children
    .filter((node) => node.name.toLowerCase() === "dmxmode")
    .map((mode) => readMode(mode, geometries, pretty));
  if (modes.length === 0) throw new SceneError("invalid-gdtf", "В GDTF нет режимов DMX");
  return {
    fixtureTypeId,
    name,
    shortName: textOf(attr(fixtureType, "ShortName")) || name,
    longName: textOf(attr(fixtureType, "LongName")) || name,
    manufacturer,
    description: textOf(attr(fixtureType, "Description")),
    spec: fileName,
    revision: latestRevision(child(fixtureType, "Revisions")),
    extent,
    modes,
  };
}

interface ModelSize {
  readonly length: number;
  readonly width: number;
  readonly height: number;
}

function readModels(node: XmlNode | null): ReadonlyMap<string, ModelSize> {
  const models = new Map<string, ModelSize>();
  if (!node) return models;
  for (const model of node.children) {
    if (model.name.toLowerCase() !== "model") continue;
    const name = textOf(attr(model, "Name"));
    if (name === "" || name.toLowerCase() === "none") continue;
    const length = numberAttr(model, "Length");
    const width = numberAttr(model, "Width");
    const height = numberAttr(model, "Height");
    if (length <= 0 || width <= 0 || height <= 0) continue;
    models.set(name, { length, width, height });
  }
  return models;
}

function extentOf(geometries: XmlNode, models: ReadonlyMap<string, ModelSize>): Extent | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  let found = false;
  const visit = (node: XmlNode, parent: Mat4): void => {
    const world = multiplyMat4(parent, positionOf(node));
    const tag = node.name.toLowerCase();
    if (tag === "geometry" || tag === "axis") {
      const modelName = textOf(attr(node, "Model"));
      const model = modelName.toLowerCase() === "none" ? undefined : models.get(modelName);
      if (model) {
        found = true;
        for (const corner of boxCorners(model)) {
          const point = transformPoint(world, corner);
          minX = Math.min(minX, point.x);
          minY = Math.min(minY, point.y);
          minZ = Math.min(minZ, point.z);
          maxX = Math.max(maxX, point.x);
          maxY = Math.max(maxY, point.y);
          maxZ = Math.max(maxZ, point.z);
        }
      }
    }
    if (tag === "geometryreference") return;
    for (const childNode of node.children) visit(childNode, world);
  };
  for (const node of geometries.children) visit(node, IDENTITY);
  if (!found) return null;
  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
  };
}

function boxCorners(model: ModelSize): readonly Vec3[] {
  const corners: Vec3[] = [];
  for (const x of [-model.length / 2, model.length / 2]) {
    for (const y of [-model.width / 2, model.width / 2]) {
      for (const z of [-model.height / 2, model.height / 2]) corners.push({ x, y, z });
    }
  }
  return corners;
}

function readMode(
  mode: XmlNode,
  geometries: XmlNode | null,
  pretty: ReadonlyMap<string, string>,
): GdtfMode {
  const name = required(mode, "Name", "имени режима");
  const geometry = textOf(attr(mode, "Geometry"));
  const referenced = referencedNames(geometries, geometry);
  const channels: GdtfChannel[] = [];
  let overwrite = false;
  const holder = child(mode, "DMXChannels");
  for (const channel of holder?.children ?? []) {
    if (channel.name.toLowerCase() !== "dmxchannel") continue;
    const dmxBreakText = textOf(attr(channel, "DMXBreak")) || "1";
    if (dmxBreakText.toLowerCase() === "overwrite") {
      overwrite = true;
      continue;
    }
    const dmxBreak = Number(dmxBreakText);
    if (!Number.isInteger(dmxBreak) || dmxBreak < 1) {
      throw new SceneError("invalid-gdtf", `У режима «${name}» сломан номер разрыва`);
    }
    const slots = slotsOf(attr(channel, "Offset"), name);
    if (slots.length === 0) continue;
    const logical = channel.children.find((node) => node.name.toLowerCase() === "logicalchannel");
    const attribute = attributeName(logical ? attr(logical, "Attribute") : undefined);
    const geometryName = textOf(attr(channel, "Geometry")) || geometry;
    if (referenced.has(geometryName)) overwrite = true;
    const fn = logical?.children.find((node) => node.name.toLowerCase() === "channelfunction");
    channels.push({
      dmxBreak,
      slots,
      attribute,
      pretty: pretty.get(attribute) || attribute,
      original: textOf(fn ? attr(fn, "OriginalAttribute") : undefined),
      geometry: geometryName,
    });
  }
  channels.sort((left, right) => left.dmxBreak - right.dmxBreak || (left.slots[0] ?? 0) - (right.slots[0] ?? 0));
  const expanded = !overwrite;
  const breaks = expanded ? breaksOf(channels) : [];
  const primary = breaks.find((item) => item.dmxBreak === 1) ?? breaks[0];
  return {
    name,
    description: textOf(attr(mode, "Description")),
    geometry,
    expanded,
    footprint: expanded ? (primary?.footprint ?? null) : null,
    breaks,
    channels,
  };
}

function slotsOf(value: string | undefined, mode: string): number[] {
  const text = textOf(value);
  if (text === "" || text.toLowerCase() === "none") return [];
  return text.split(",").map((part) => {
    const slot = Number(part.trim());
    if (!Number.isInteger(slot) || slot < 1) {
      throw new SceneError("invalid-gdtf", `У режима «${mode}» сломан адрес канала`);
    }
    return slot;
  });
}

function breaksOf(channels: readonly GdtfChannel[]): GdtfBreak[] {
  const max = new Map<number, number>();
  for (const channel of channels) {
    const peak = channel.slots.reduce((best, slot) => Math.max(best, slot), 0);
    max.set(channel.dmxBreak, Math.max(max.get(channel.dmxBreak) ?? 0, peak));
  }
  return [...max.entries()]
    .map(([dmxBreak, footprint]) => ({ dmxBreak, footprint }))
    .sort((left, right) => left.dmxBreak - right.dmxBreak);
}

function referencedNames(geometries: XmlNode | null, rootName: string): ReadonlySet<string> {
  const names = new Set<string>();
  if (!geometries || rootName === "") return names;
  const root = geometries.children.find(
    (node) => textOf(attr(node, "Name")) === rootName,
  );
  if (!root) return names;
  const visit = (node: XmlNode): void => {
    if (node.name.toLowerCase() === "geometryreference") {
      const target = textOf(attr(node, "Geometry"));
      const hasBreak = node.children.some((childNode) => childNode.name.toLowerCase() === "break");
      if (target !== "" && hasBreak) names.add(target);
      return;
    }
    for (const childNode of node.children) visit(childNode);
  };
  visit(root);
  return names;
}

function attributeName(value: string | undefined): string {
  const text = textOf(value);
  const segment = text.split(".").pop()?.trim() ?? "";
  return segment === "" ? "Канал" : segment;
}

function readPretty(definitions: XmlNode | null): ReadonlyMap<string, string> {
  const pretty = new Map<string, string>();
  const attributes = definitions ? child(definitions, "Attributes") : null;
  for (const attribute of attributes?.children ?? []) {
    if (attribute.name.toLowerCase() !== "attribute") continue;
    const name = textOf(attr(attribute, "Name"));
    const label = textOf(attr(attribute, "Pretty"));
    if (name !== "" && label !== "") pretty.set(name, label);
  }
  return pretty;
}

function latestRevision(node: XmlNode | null): string | null {
  let best: string | null = null;
  for (const revision of node?.children ?? []) {
    if (revision.name.toLowerCase() !== "revision") continue;
    const date = textOf(attr(revision, "Date"));
    if (date === "") continue;
    if (best === null || date > best) best = date;
  }
  return best;
}

function positionOf(node: XmlNode): Mat4 {
  const text = textOf(attr(node, "Position"));
  if (text === "") return IDENTITY;
  const groups = text.match(/\{[^{}]+\}/g);
  const label = textOf(attr(node, "Name")) || node.name;
  if (!groups || groups.length !== 4) {
    throw new SceneError("invalid-gdtf", `Не удалось прочитать положение «${label}»`);
  }
  const rows = groups.map((group) => group.slice(1, -1).split(",").map((item) => Number(item.trim())));
  if (rows.some((row) => row.length !== 4 || row.some((value) => !Number.isFinite(value)))) {
    throw new SceneError("invalid-gdtf", `Не удалось прочитать положение «${label}»`);
  }
  const row0 = rows[0];
  const row1 = rows[1];
  const row2 = rows[2];
  if (!row0 || !row1 || !row2) {
    throw new SceneError("invalid-gdtf", `Не удалось прочитать положение «${label}»`);
  }
  return [
    row0[0] ?? 0,
    row1[0] ?? 0,
    row2[0] ?? 0,
    0,
    row0[1] ?? 0,
    row1[1] ?? 0,
    row2[1] ?? 0,
    0,
    row0[2] ?? 0,
    row1[2] ?? 0,
    row2[2] ?? 0,
    0,
    row0[3] ?? 0,
    row1[3] ?? 0,
    row2[3] ?? 0,
    1,
  ];
}

function numberAttr(node: XmlNode, name: string): number {
  const text = textOf(attr(node, name));
  if (text === "") return 0;
  const value = Number(text);
  return Number.isFinite(value) ? value : 0;
}

function required(node: XmlNode, name: string, label: string): string {
  const value = textOf(attr(node, name));
  if (value === "") throw new SceneError("invalid-gdtf", `В GDTF нет ${label}`);
  return value;
}

function textOf(value: string | undefined): string {
  return value?.trim() ?? "";
}

function descriptionXml(bytes: Uint8Array): string {
  if (bytes.byteLength < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new SceneError("invalid-gdtf", "Это не файл GDTF");
  }
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new SceneError("invalid-gdtf", "Не удалось прочитать GDTF");
  }
  const entry = Object.entries(files).find(([name]) =>
    name.replaceAll("\\", "/").toLowerCase().endsWith("description.xml"),
  );
  if (!entry) throw new SceneError("invalid-gdtf", "Это не файл GDTF");
  return new TextDecoder("utf-8").decode(entry[1]).replace(/^\uFEFF/, "");
}

interface XmlNode {
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: readonly XmlNode[];
}

function child(node: XmlNode, name: string): XmlNode | null {
  return node.children.find((item) => item.name.toLowerCase() === name.toLowerCase()) ?? null;
}

function attr(node: XmlNode, name: string): string | undefined {
  const found = Object.entries(node.attrs).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return found?.[1];
}

function parseXml(source: string): XmlNode {
  const parsed = parseContent(source, 0, null);
  if (parsed.index < source.length && source.slice(parsed.index).trim() !== "") {
    throw new SceneError("invalid-gdtf", "Не удалось прочитать GDTF");
  }
  return { name: "#root", attrs: {}, children: parsed.nodes };
}

function parseContent(
  source: string,
  start: number,
  until: string | null,
): { nodes: XmlNode[]; index: number } {
  const nodes: XmlNode[] = [];
  let index = start;
  while (index < source.length) {
    const char = source[index];
    if (char !== "<") {
      const next = source.indexOf("<", index);
      index = next === -1 ? source.length : next;
      continue;
    }
    if (source.startsWith("<!--", index)) {
      const end = source.indexOf("-->", index + 4);
      if (end < 0) throw new SceneError("invalid-gdtf", "Не удалось прочитать GDTF");
      index = end + 3;
      continue;
    }
    if (source.startsWith("<?", index)) {
      const end = source.indexOf("?>", index + 2);
      if (end < 0) throw new SceneError("invalid-gdtf", "Не удалось прочитать GDTF");
      index = end + 2;
      continue;
    }
    if (source.startsWith("</", index)) {
      const end = source.indexOf(">", index + 2);
      if (end < 0) throw new SceneError("invalid-gdtf", "Не удалось прочитать GDTF");
      const name = localName(source.slice(index + 2, end).trim());
      if (until === null || name.toLowerCase() !== until.toLowerCase()) {
        throw new SceneError("invalid-gdtf", "Не удалось прочитать GDTF");
      }
      return { nodes, index: end + 1 };
    }
    const end = source.indexOf(">", index + 1);
    if (end < 0) throw new SceneError("invalid-gdtf", "Не удалось прочитать GDTF");
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
      nodes.push({ name, attrs, children: [] });
      continue;
    }
    const inner = parseContent(source, index, name);
    nodes.push({ name, attrs, children: inner.nodes });
    index = inner.index;
  }
  if (until !== null) throw new SceneError("invalid-gdtf", "Не удалось прочитать GDTF");
  return { nodes, index };
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
    if (source[index] !== "=") throw new SceneError("invalid-gdtf", "Не удалось прочитать GDTF");
    index += 1;
    while (index < source.length && /\s/.test(source[index] ?? "")) index += 1;
    const quote = source[index];
    if (quote !== '"' && quote !== "'") throw new SceneError("invalid-gdtf", "Не удалось прочитать GDTF");
    index += 1;
    const valueStart = index;
    while (index < source.length && source[index] !== quote) index += 1;
    if (index >= source.length) throw new SceneError("invalid-gdtf", "Не удалось прочитать GDTF");
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
