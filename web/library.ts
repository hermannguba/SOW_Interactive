import type { Discipline, FixtureKind } from "../src/index.ts";

export type LibraryItem =
  | {
      readonly discipline: "light";
      readonly kind: "light-fixture";
      readonly type: string;
      readonly label: string;
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
  { discipline: "light", kind: "light-fixture", type: "Sharpy", label: "Прожектор Sharpy" },
  { discipline: "light", kind: "light-fixture", type: "Aura", label: "Залив Aura" },
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
  return LIBRARY.filter((item) => item.discipline === discipline);
}

export function roleLabel(kind: FixtureKind | "sound-portal" | "geometry"): string {
  return ROLES[kind] ?? kind;
}
