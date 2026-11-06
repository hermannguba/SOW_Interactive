import type { GdtfFixture, GdtfMode } from "../src/gdtf.ts";

let fixtures: readonly GdtfFixture[] = [];

export function installGdtf(next: readonly GdtfFixture[]): void {
  fixtures = next;
}

/** Добавляет тип в библиотеку. Тот же FixtureTypeID заменяет прежнюю запись. */
export function addGdtf(fixture: GdtfFixture): void {
  fixtures = [...fixtures.filter((item) => item.fixtureTypeId !== fixture.fixtureTypeId), fixture];
}

export function gdtfLibrary(): readonly GdtfFixture[] {
  return fixtures;
}

export function gdtfFixture(id: string): GdtfFixture | null {
  return fixtures.find((fixture) => fixture.fixtureTypeId === id) ?? null;
}

export function gdtfMode(id: string, mode: string): GdtfMode | null {
  return gdtfFixture(id)?.modes.find((item) => item.name === mode) ?? null;
}
