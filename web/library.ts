import type { Discipline, FixtureKind } from "../src/index.ts";
import { gdtfLibrary } from "./catalog.ts";

export type LibraryItem =
  | {
      readonly discipline: "light";
      readonly kind: "light-fixture";
      readonly type: string;
      readonly label: string;
      readonly catalogId: string | null;
      readonly mode: string | null;
      readonly footprint: number | null;
      readonly manufacturer: string;
      readonly shortName: string;
    }
  | {
      readonly discipline: "sound";
      readonly kind: "active-speaker";
      readonly type: string;
      readonly label: string;
    }
  | {
      readonly discipline: "video";
      readonly kind: "led-screen" | "floor-prompter" | "tv-on-stand";
      readonly type: string;
      readonly label: string;
    };

const LIBRARY: readonly LibraryItem[] = [
  {
    discipline: "light",
    kind: "light-fixture",
    type: "Sharpy",
    label: "Прожектор Sharpy",
    catalogId: null,
    mode: null,
    footprint: null,
    manufacturer: "",
    shortName: "",
  },
  {
    discipline: "light",
    kind: "light-fixture",
    type: "Aura",
    label: "Залив Aura",
    catalogId: null,
    mode: null,
    footprint: null,
    manufacturer: "",
    shortName: "",
  },
  { discipline: "sound", kind: "active-speaker", type: "X12", label: "Активная колонка" },
  { discipline: "video", kind: "led-screen", type: "P3", label: "LED-экран" },
  { discipline: "video", kind: "floor-prompter", type: "LCD", label: "Напольный суфлёр" },
  { discipline: "video", kind: "tv-on-stand", type: "TV-55", label: "ТВ на стойке" },
];

const ROLES: Record<string, string> = {
  "light-fixture": "Прибор света",
  "active-speaker": "Активная колонка",
  "led-screen": "LED-экран",
  "floor-prompter": "Напольный суфлёр",
  "tv-on-stand": "ТВ на стойке",
  "sound-portal": "Портал зала",
  geometry: "Геометрия зала",
};

export function libraryFor(discipline: Discipline): readonly LibraryItem[] {
  const plain = LIBRARY.filter((item) => item.discipline === discipline);
  if (discipline !== "light") return plain;
  const fromGdtf: LibraryItem[] = [];
  for (const fixture of gdtfLibrary()) {
    for (const mode of fixture.modes) {
      fromGdtf.push({
        discipline: "light",
        kind: "light-fixture",
        type: fixture.name,
        label: mode.footprint === null ? `${mode.name} · пиксели не развёрнуты` : `${mode.name} · ${mode.footprint} адресов`,
        catalogId: fixture.fixtureTypeId,
        mode: mode.name,
        footprint: mode.footprint,
        manufacturer: fixture.manufacturer,
        shortName: fixture.shortName,
      });
    }
  }
  return [...plain, ...fromGdtf];
}

export function roleLabel(kind: FixtureKind | "sound-portal" | "geometry"): string {
  return ROLES[kind] ?? kind;
}
