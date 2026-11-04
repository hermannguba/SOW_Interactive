import { SceneError, parseDwgUnderlay, projectOrthographic, type Discipline, type Fixture, type OrthographicMark, type OrthographicView, type SoundPortal } from "../src/index.ts";
import { createDemo } from "./demo.ts";
import { libraryFor, roleLabel, type LibraryItem } from "./library.ts";
import {
  HIT_RADIUS,
  frameOf,
  hitMark,
  nextAddress,
  viewBoxOf,
  viewPointFromSvg,
  worldFromView,
} from "./place.ts";

const demo = createDemo();
const { project } = demo;

let venueId = demo.venueId;
let plotId = demo.plotId;
let discipline: Discipline = "light";
let view: OrthographicView = "top";
let armed: LibraryItem | null = null;
let importError = "";
let selected: { kind: "fixture"; id: string } | { kind: "portal"; id: string } | null = null;
let marks: readonly OrthographicMark[] = [];

const projectSelect = element<HTMLSelectElement>("project");
const venueSelect = element<HTMLSelectElement>("venue");
const dateSelect = element<HTMLSelectElement>("date");
const library = element<HTMLElement>("library");
const hint = element<HTMLElement>("hint");
const card = element<HTMLElement>("card");
const plot = element<SVGSVGElement>("plot");
const importButton = element<HTMLButtonElement>("import-dwg");
const dwgFile = element<HTMLInputElement>("dwg-file");
const underlayStatus = element<HTMLElement>("underlay-status");
const importAlert = element<HTMLElement>("import-error");

const world = document.createElementNS("http://www.w3.org/2000/svg", "g");
world.setAttribute("transform", "scale(1,-1)");
plot.append(world);

fillSelect(
  projectSelect,
  [{ value: project.id, label: project.name }],
  project.id,
);
fillSelect(
  venueSelect,
  project.listVenues().map((venue) => ({ value: venue.id, label: venue.name })),
  venueId,
);
fillDates();

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-discipline]")) {
  button.addEventListener("click", () => {
    const next = button.dataset.discipline;
    if (next !== "light" && next !== "sound" && next !== "video") return;
    if (next === discipline) return;
    discipline = next;
    armed = null;
    if (selected?.kind === "fixture") {
      const fixture = project.fixture(plotId, selected.id);
      if (fixture.discipline !== discipline) selected = null;
    }
    if (selected?.kind === "portal" && discipline !== "sound") selected = null;
    render();
  });
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-view]")) {
  button.addEventListener("click", () => {
    const next = button.dataset.view;
    if (next !== "top" && next !== "side") return;
    view = next;
    render();
  });
}

venueSelect.addEventListener("change", () => {
  venueId = venueSelect.value;
  const nextPlot = plotsOf(venueId)[0];
  if (!nextPlot) return;
  plotId = nextPlot.id;
  selected = null;
  armed = null;
  importError = "";
  fillDates();
  render();
});

dateSelect.addEventListener("change", () => {
  plotId = dateSelect.value;
  selected = null;
  armed = null;
  render();
});

importButton.addEventListener("click", () => {
  dwgFile.click();
});

dwgFile.addEventListener("change", () => {
  const file = dwgFile.files?.[0];
  dwgFile.value = "";
  if (!file) return;
  const targetVenue = venueId;
  void readUnderlay(file, targetVenue);
});

plot.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  const point = clientToView(plot, event);
  if (armed) {
    place(armed, point);
    return;
  }
  const hit = hitMark(marks, point, HIT_RADIUS);
  if (hit?.nodeKind === "sound-portal" && hit.sourceId) {
    selected = { kind: "portal", id: hit.sourceId };
  } else if (hit?.permanence === "plot" && hit.sourceId) {
    selected = { kind: "fixture", id: hit.sourceId };
  } else {
    selected = null;
  }
  render();
});

render();

function place(item: LibraryItem, point: { x: number; y: number }): void {
  const layer = project.listLayers(plotId, item.discipline).find((entry) => entry.name === "Основной");
  if (!layer) return;
  const transform = worldFromView(view, point, item.kind);
  const base = {
    name: item.label,
    type: item.type,
    layerId: layer.id,
    transform,
  };
  const id =
    item.discipline === "light"
      ? project.addFixture(plotId, {
          ...base,
          discipline: "light",
          kind: "light-fixture",
          address: nextAddress(project.listFixtures(plotId, { discipline: "light" })),
        })
      : item.discipline === "sound"
        ? project.addFixture(plotId, {
            ...base,
            discipline: "sound",
            kind: "active-speaker",
          })
        : project.addFixture(plotId, {
            ...base,
            discipline: "video",
            kind: item.kind,
          });
  selected = { kind: "fixture", id };
  render();
}

async function readUnderlay(file: File, targetVenue: string): Promise<void> {
  try {
    const underlay = parseDwgUnderlay(new Uint8Array(await file.arrayBuffer()), file.name);
    project.setUnderlay(targetVenue, underlay);
    if (targetVenue === venueId) importError = "";
  } catch (caught) {
    if (targetVenue === venueId) importError = messageOf(caught);
  }
  render();
}

function render(): void {
  document.body.dataset.placing = armed ? "true" : "false";
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-discipline]")) {
    button.setAttribute("aria-pressed", String(button.dataset.discipline === discipline));
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-view]")) {
    button.setAttribute("aria-pressed", String(button.dataset.view === view));
  }
  renderLibrary();
  renderUnderlay();
  renderPlot();
  renderCard();
  hint.textContent = armed
    ? `Постановка: ${armed.label}. Клик по схеме.`
    : "Выберите прибор и кликните по схеме.";
}

function renderLibrary(): void {
  library.replaceChildren();
  for (const item of libraryFor(discipline)) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.label;
    const pressed = armed?.type === item.type && armed.kind === item.kind;
    button.setAttribute("aria-pressed", String(pressed));
    button.addEventListener("click", () => {
      armed = pressed ? null : item;
      render();
    });
    library.append(button);
  }
}

function renderUnderlay(): void {
  const underlay = project.underlay(venueId);
  underlayStatus.textContent = underlay ? `Подложка: ${underlay.fileName}` : "Подложка не загружена";
  importAlert.textContent = importError;
}

function renderPlot(): void {
  const projection = projectOrthographic(project.sceneGraph(venueId, plotId), view, { discipline });
  marks = projection.marks;
  const box = viewBoxOf(frameOf(marks));
  plot.setAttribute("viewBox", `${box.x} ${box.y} ${box.width} ${box.height}`);
  world.replaceChildren();
  for (const mark of marks) {
    if (mark.shape.kind === "point") world.append(drawPoint(mark));
    else world.append(drawOutline(mark));
  }
}

function drawOutline(mark: OrthographicMark): SVGElement {
  const shape = mark.shape;
  if (shape.kind === "point") throw new Error("контур не точка");
  const element = svg(shape.kind === "polygon" ? "polygon" : "polyline");
  element.setAttribute("points", shape.points.map((point) => `${point.x},${point.y}`).join(" "));
  const underlay = mark.nodeKind === "underlay";
  element.setAttribute("class", underlay ? "underlay" : "geometry");
  element.setAttribute("data-kind", underlay ? "underlay" : "geometry");
  element.setAttribute("fill", !underlay && shape.kind === "polygon" ? "rgba(244,241,234,0.08)" : "none");
  element.setAttribute("stroke", underlay ? "#9aa7b8" : "#c8c2b4");
  element.setAttribute("stroke-width", underlay ? "0.06" : "0.08");
  return element;
}

function drawPoint(mark: OrthographicMark): SVGElement {
  const shape = mark.shape;
  if (shape.kind !== "point") throw new Error("ожидалась точка");
  const group = svg("g");
  const selectedMark = mark.sourceId !== null && selected?.id === mark.sourceId;
  group.setAttribute("class", mark.nodeKind === "sound-portal" ? "portal" : "fixture");
  if (selectedMark) group.setAttribute("data-selected", "true");
  if (mark.sourceId) group.setAttribute("data-source", mark.sourceId);
  group.setAttribute("data-kind", mark.nodeKind);
  group.setAttribute("data-x", String(shape.at.x));
  group.setAttribute("data-y", String(shape.at.y));
  const radius = 0.35;
  if (mark.nodeKind === "sound-portal") {
    const diamond = svg("polygon");
    const { x, y } = shape.at;
    diamond.setAttribute(
      "points",
      `${x},${y + radius} ${x + radius},${y} ${x},${y - radius} ${x - radius},${y}`,
    );
    diamond.setAttribute("fill", "#8fd0c6");
    group.append(diamond);
  } else {
    const circle = svg("circle");
    circle.setAttribute("cx", String(shape.at.x));
    circle.setAttribute("cy", String(shape.at.y));
    circle.setAttribute("r", String(radius));
    circle.setAttribute("fill", "#f2c14e");
    group.append(circle);
  }
  if (selectedMark) {
    const ring = svg("circle");
    ring.setAttribute("cx", String(shape.at.x));
    ring.setAttribute("cy", String(shape.at.y));
    ring.setAttribute("r", "0.55");
    ring.setAttribute("fill", "none");
    ring.setAttribute("stroke", "#7ec8ff");
    ring.setAttribute("stroke-width", "0.08");
    group.append(ring);
  }
  const heading = svg("line");
  heading.setAttribute("x1", String(shape.at.x));
  heading.setAttribute("y1", String(shape.at.y));
  heading.setAttribute("x2", String(shape.at.x + shape.heading.x * 0.9));
  heading.setAttribute("y2", String(shape.at.y + shape.heading.y * 0.9));
  heading.setAttribute("stroke", "#f4f1ea");
  heading.setAttribute("stroke-width", "0.06");
  group.append(heading);
  const label = svg("text");
  const labelX = shape.at.x + 0.5;
  const labelY = shape.at.y;
  label.textContent = pointLabel(mark);
  label.setAttribute("x", String(labelX));
  label.setAttribute("y", String(labelY));
  label.setAttribute(
    "transform",
    `translate(${labelX} ${labelY}) scale(1,-1) translate(${-labelX} ${-labelY})`,
  );
  label.setAttribute("fill", "#f4f1ea");
  label.setAttribute("font-size", "0.55");
  label.setAttribute("dominant-baseline", "middle");
  group.append(label);
  return group;
}

function pointLabel(mark: OrthographicMark): string {
  if (mark.permanence === "plot" && mark.sourceId) {
    return project.fixture(plotId, mark.sourceId).type;
  }
  if (mark.nodeKind === "sound-portal" && mark.sourceId) {
    return project.listSoundPortals(venueId).find((portal) => portal.id === mark.sourceId)?.type ?? mark.name;
  }
  return mark.name;
}

function renderCard(): void {
  card.replaceChildren();
  if (!selected) {
    const empty = document.createElement("p");
    empty.className = "note";
    empty.textContent = "Ничего не выбрано. Выберите прибор на схеме.";
    card.append(empty);
    return;
  }
  if (selected.kind === "portal") {
    const portal = project.listSoundPortals(venueId).find((item) => item.id === selected?.id);
    if (!portal) {
      selected = null;
      renderCard();
      return;
    }
    card.append(readOnlyCard(portal));
    return;
  }
  const fixture = project.fixture(plotId, selected.id);
  card.append(fixtureCard(fixture));
}

function readOnlyCard(portal: SoundPortal): HTMLElement {
  const fields = document.createElement("div");
  fields.className = "card-fields";
  const role = document.createElement("p");
  role.className = "note";
  role.textContent = roleLabel("sound-portal");
  const type = labeledInput("Тип", portal.type);
  type.input.disabled = true;
  const note = document.createElement("p");
  note.className = "note";
  note.textContent = "Постоянный портал зала. Слой и адрес у него не задаются.";
  fields.append(role, type.label, note);
  return fields;
}

function fixtureCard(fixture: Fixture): HTMLElement {
  const fields = document.createElement("div");
  fields.className = "card-fields";
  const role = document.createElement("p");
  role.className = "note";
  role.textContent = roleLabel(fixture.kind);
  const type = labeledInput("Тип", fixture.type);
  const error = document.createElement("p");
  error.className = "error";
  error.setAttribute("role", "alert");
  type.input.addEventListener("change", () => {
    try {
      project.setFixtureType(plotId, fixture.id, type.input.value);
      error.textContent = "";
      type.input.value = project.fixture(plotId, fixture.id).type;
      renderPlot();
    } catch (caught) {
      error.textContent = caught instanceof SceneError && caught.code === "empty-name"
        ? "Тип не может быть пустым"
        : messageOf(caught);
      type.input.value = project.fixture(plotId, fixture.id).type;
    }
  });
  const layerLabel = document.createElement("label");
  layerLabel.textContent = "Слой ";
  const layerSelect = document.createElement("select");
  for (const layer of project.listLayers(plotId, fixture.discipline)) {
    const option = document.createElement("option");
    option.value = layer.id;
    option.textContent = layer.name;
    layerSelect.append(option);
  }
  layerSelect.value = fixture.layerId;
  layerSelect.addEventListener("change", () => {
    project.setFixtureLayer(plotId, fixture.id, layerSelect.value);
    renderPlot();
  });
  layerLabel.append(layerSelect);
  fields.append(role, type.label, layerLabel);
  if (fixture.discipline === "light" && fixture.address) {
    const address = fixture.address;
    const row = document.createElement("div");
    row.className = "address";
    const universe = labeledInput("Юниверс", String(address.universe));
    const channel = labeledInput("Адрес", String(address.address));
    universe.input.type = "number";
    channel.input.type = "number";
    universe.input.min = "1";
    channel.input.min = "1";
    channel.input.max = "512";
    const commit = (): void => {
      try {
        project.setLightAddress(plotId, fixture.id, {
          universe: Number(universe.input.value),
          address: Number(channel.input.value),
        });
        error.textContent = "";
      } catch (caught) {
        error.textContent = messageOf(caught);
        const current = project.fixture(plotId, fixture.id).address;
        if (current) {
          universe.input.value = String(current.universe);
          channel.input.value = String(current.address);
        }
      }
    };
    universe.input.addEventListener("change", commit);
    channel.input.addEventListener("change", commit);
    row.append(universe.label, channel.label);
    fields.append(row);
  }
  fields.append(error);
  return fields;
}

function fillDates(): void {
  fillSelect(
    dateSelect,
    plotsOf(venueId).map((plot) => ({ value: plot.id, label: plot.date })),
    plotId,
  );
}

function plotsOf(id: string) {
  return [...project.listPlots(id)].sort((left, right) => left.date.localeCompare(right.date));
}

function fillSelect(
  select: HTMLSelectElement,
  options: readonly { value: string; label: string }[],
  current: string,
): void {
  select.replaceChildren();
  for (const option of options) {
    const element = document.createElement("option");
    element.value = option.value;
    element.textContent = option.label;
    select.append(element);
  }
  select.value = current;
}

function labeledInput(caption: string, value: string): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = document.createElement("label");
  label.append(document.createTextNode(`${caption} `));
  const input = document.createElement("input");
  input.value = value;
  input.autocomplete = "off";
  label.append(input);
  return { label, input };
}

function clientToView(svg: SVGSVGElement, event: PointerEvent): { x: number; y: number } {
  const matrix = svg.getScreenCTM();
  if (!matrix) return { x: 0, y: 0 };
  const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  return viewPointFromSvg(local.x, local.y);
}

function messageOf(caught: unknown): string {
  return caught instanceof Error ? caught.message : "Не удалось сохранить";
}

function element<T extends Element>(id: string): T {
  const found = document.querySelector(`#${id}`);
  if (!found) throw new Error(`нет элемента ${id}`);
  return found as T;
}

function svg<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS("http://www.w3.org/2000/svg", name);
}
