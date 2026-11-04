import { DISCIPLINES, Project, type Discipline, type Transform } from "../src/index.ts";

export interface DemoHall {
  readonly project: Project;
  readonly venueId: string;
  readonly plotId: string;
}

/** Несколько залов. Геометрия и порталы остаются у зала, плот — у даты. */
export function createDemo(): DemoHall {
  const project = Project.create({ name: "Демо" });
  const main = addMainHall(project);
  addSmallHall(project);
  const plotId = project.listPlots(main)[0]?.id;
  if (!plotId) throw new Error("у главного зала нет даты");
  return { project, venueId: main, plotId };
}

function addMainHall(project: Project): string {
  const venueId = project.addVenue({ name: "Главный зал" });
  project.addGeometry(venueId, {
    name: "Сцена",
    shape: { kind: "box", width: 16, depth: 8, height: 1 },
    transform: at(0, 4, 0.5),
  });
  project.addGeometry(venueId, {
    name: "Задник",
    shape: {
      kind: "polyline",
      points: [
        { x: -8, y: 8, z: 0 },
        { x: 8, y: 8, z: 0 },
        { x: 8, y: 8, z: 6 },
        { x: -8, y: 8, z: 6 },
      ],
    },
    transform: at(0, 0, 0),
  });
  project.addSoundPortal(venueId, {
    name: "Портал L",
    type: "K1",
    transform: at(-9, 2, 4),
  });
  project.addSoundPortal(venueId, {
    name: "Портал R",
    type: "K1",
    transform: at(9, 2, 4),
  });
  const opening = addDatedPlot(project, venueId, "2026-06-01");
  const encore = addDatedPlot(project, venueId, "2026-06-15");
  addLight(project, opening, "Фронт", "Sharpy", at(-3, 2, 6));
  addLight(project, encore, "Контровой", "Aura", at(4, 6, 7));
  return venueId;
}

function addSmallHall(project: Project): void {
  const venueId = project.addVenue({ name: "Малый зал" });
  project.addGeometry(venueId, {
    name: "Камерная сцена",
    shape: { kind: "box", width: 8, depth: 6, height: 0.8 },
    transform: at(0, 3, 0.4),
  });
  project.addSoundPortal(venueId, {
    name: "Портал",
    type: "X8",
    transform: at(-4.5, 1, 3),
  });
  const opening = addDatedPlot(project, venueId, "2026-07-01");
  addDatedPlot(project, venueId, "2026-07-20");
  const layerId = layerNamed(project, opening, "sound");
  project.addFixture(opening, {
    name: "Боковая",
    type: "X12",
    discipline: "sound",
    kind: "active-speaker",
    layerId,
    transform: at(0, 1, 2),
  });
}

function addDatedPlot(project: Project, venueId: string, date: string): string {
  const plotId = project.addPlot(venueId, { date });
  for (const discipline of DISCIPLINES) {
    project.addLayer(plotId, { name: "Основной", discipline: discipline as Discipline });
    project.addLayer(plotId, { name: "Дополнительный", discipline: discipline as Discipline });
  }
  return plotId;
}

function addLight(
  project: Project,
  plotId: string,
  name: string,
  type: string,
  transform: Transform,
): void {
  project.addFixture(plotId, {
    name,
    type,
    discipline: "light",
    kind: "light-fixture",
    layerId: layerNamed(project, plotId, "light"),
    transform,
    address: { universe: 1, address: 11 },
  });
}

function layerNamed(project: Project, plotId: string, discipline: Discipline): string {
  const layer = project.listLayers(plotId, discipline).find((entry) => entry.name === "Основной");
  if (!layer) throw new Error("нет слоя");
  return layer.id;
}

function at(x: number, y: number, z: number): Transform {
  return {
    position: { x, y, z },
    rotation: { x: 0, y: 0, z: 0 },
  };
}
