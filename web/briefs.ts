import type { Project } from "../src/index.ts";

/** Строка главной: плот зала на дату ивента. Ядро от этого не меняется. */
export interface EventBrief {
  readonly plotId: string;
  readonly venueId: string;
  readonly venueName: string;
  readonly date: string;
  readonly fixtureCount: number;
}

const MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
] as const;

/** Все ТЗ проекта, от ранней даты ивента к поздней. */
export function listBriefs(project: Project): readonly EventBrief[] {
  const briefs: EventBrief[] = [];
  for (const venue of project.listVenues()) {
    for (const plot of project.listPlots(venue.id)) {
      briefs.push({
        plotId: plot.id,
        venueId: venue.id,
        venueName: venue.name,
        date: plot.date,
        fixtureCount: project.listFixtures(plot.id).length,
      });
    }
  }
  briefs.sort((left, right) => left.date.localeCompare(right.date) || left.venueName.localeCompare(right.venueName, "ru"));
  return briefs;
}

export function formatEventDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  const monthName = MONTHS[Number(month) - 1];
  if (!year || !day || !monthName) return iso;
  return `${Number(day)} ${monthName} ${year}`;
}
