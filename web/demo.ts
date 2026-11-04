import { DISCIPLINES, Project, type Discipline } from "../src/index.ts";

export interface DemoHall {
  readonly project: Project;
  readonly venueId: string;
  readonly plotId: string;
}

/** Один зал в памяти: сцена, задник и постоянный звуковой портал. Плот пустой. */
export function createDemo(): DemoHall {
  const project = Project.create({ name: "Демо" });
  const venueId = project.addVenue({ name: "Главный зал" });
  project.addGeometry(venueId, {
    name: "Сцена",
    shape: { kind: "box", width: 16, depth: 8, height: 1 },
    transform: {
      position: { x: 0, y: 4, z: 0.5 },
      rotation: { x: 0, y: 0, z: 0 },
    },
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
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    },
  });
  project.addSoundPortal(venueId, {
    name: "Портал L",
    type: "K1",
    transform: {
      position: { x: -9, y: 2, z: 4 },
      rotation: { x: 0, y: 0, z: 0 },
    },
  });
  const plotId = project.addPlot(venueId, { date: "2026-06-01" });
  for (const discipline of DISCIPLINES) {
    project.addLayer(plotId, { name: "Основной", discipline: discipline as Discipline });
    project.addLayer(plotId, { name: "Дополнительный", discipline: discipline as Discipline });
  }
  return { project, venueId, plotId };
}
