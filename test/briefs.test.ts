import assert from "node:assert/strict";
import { test } from "node:test";
import { Project } from "../src/index.ts";
import { formatEventDate, listBriefs } from "../web/briefs.ts";
import { createDemo } from "../web/demo.ts";
import { sequentialIds } from "./helpers.ts";

test("главная собирает все ТЗ по дате ивента", () => {
  const demo = createDemo();
  const before = JSON.stringify(demo.project.toSnapshot());
  const briefs = listBriefs(demo.project);
  assert.deepEqual(
    briefs.map((brief) => `${brief.date} ${brief.venueName}`),
    [
      "2026-06-01 Главный зал",
      "2026-06-15 Главный зал",
      "2026-07-01 Малый зал",
      "2026-07-20 Малый зал",
    ],
  );
  assert.equal(briefs[0]?.fixtureCount, 1);
  assert.equal(briefs[3]?.fixtureCount, 0);
  assert.equal(JSON.stringify(demo.project.toSnapshot()), before);
  assert.equal(formatEventDate("2026-06-01"), "1 июня 2026");
});

test("одна дата у двух залов не ломает порядок", () => {
  const project = Project.create({ name: "Лето", ids: sequentialIds() });
  const later = project.addVenue({ name: "Яма" });
  const earlier = project.addVenue({ name: "Арена" });
  project.addPlot(later, { date: "2026-08-02" });
  project.addPlot(earlier, { date: "2026-08-02" });
  project.addPlot(earlier, { date: "2026-08-01" });
  assert.deepEqual(
    listBriefs(project).map((brief) => `${brief.date} ${brief.venueName}`),
    ["2026-08-01 Арена", "2026-08-02 Арена", "2026-08-02 Яма"],
  );
});
