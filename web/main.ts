import { DEFAULT_CAMERA, SceneError, importMvrLights, parseDwgUnderlay, parseGdtf, projectOrthographic, projectPerspective, type Discipline, type Fixture, type OrthographicMark, type OrthographicView, type PlanOverlay, type SoundPortal } from "../src/index.ts";
import { formatEventDate, listBriefs } from "./briefs.ts";
import { addGdtf, gdtfFixture, gdtfMode } from "./catalog.ts";
import { createDemo } from "./demo.ts";
import { libraryFor, roleLabel, type LibraryItem } from "./library.ts";
import {
  HIT_RADIUS,
  addressConflict,
  frameOf,
  hitMark,
  nextAddress,
  viewBoxOf,
  viewPointFromSvg,
  worldFromView,
} from "./place.ts";

const demo = createDemo();
const { project } = demo;

type SceneView = OrthographicView | "3d";

type Screen = "home" | "plot";

let screen: Screen = "home";
let venueId = demo.venueId;
let plotId = demo.plotId;
let discipline: Discipline = "light";
let view: SceneView = "top";
let yaw = DEFAULT_CAMERA.yaw;
let pitch = DEFAULT_CAMERA.pitch;
let orbit: {
  pointerId: number;
  x: number;
  y: number;
  yaw: number;
  pitch: number;
  moved: boolean;
} | null = null;
let armed: LibraryItem | null = null;
let importError = "";
let mvrStatus = "";
let selected: { kind: "fixture"; id: string } | { kind: "portal"; id: string } | null = null;
let marks: readonly OrthographicMark[] = [];

const homeButton = element<HTMLButtonElement>("home-button");
const homeNote = element<HTMLElement>("home-note");
const briefs = element<HTMLElement>("briefs");
const projectSelect = element<HTMLSelectElement>("project");
const venueSelect = element<HTMLSelectElement>("venue");
const dateSelect = element<HTMLSelectElement>("date");
const library = element<HTMLElement>("library");
const hint = element<HTMLElement>("hint");
const card = element<HTMLElement>("card");
const plot = element<SVGSVGElement>("plot");
const importButton = element<HTMLButtonElement>("import-dwg");
const mvrButton = element<HTMLButtonElement>("import-mvr");
const dwgFile = element<HTMLInputElement>("dwg-file");
const mvrFile = element<HTMLInputElement>("mvr-file");
const underlayStatus = element<HTMLElement>("underlay-status");
const mvrStatusNode = element<HTMLElement>("mvr-status");
const importAlert = element<HTMLElement>("import-error");
const gdtfImport = element<HTMLElement>("gdtf-import");
const gdtfButton = element<HTMLButtonElement>("import-gdtf");
const gdtfFile = element<HTMLInputElement>("gdtf-file");
const gdtfStatus = element<HTMLElement>("gdtf-status");

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

homeButton.addEventListener("click", () => {
  if (screen === "home") return;
  screen = "home";
  armed = null;
  render();
});

briefs.addEventListener("click", (event) => {
  const row = event.target instanceof Element ? event.target.closest<HTMLButtonElement>(".brief") : null;
  const nextVenue = row?.dataset.venue;
  const nextPlot = row?.dataset.plot;
  if (!row || !nextVenue || !nextPlot) return;
  openPlot(nextVenue, nextPlot);
});

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
    if (next !== "top" && next !== "side" && next !== "3d") return;
    if (next === view) return;
    view = next;
    orbit = null;
    if (view === "3d") armed = null;
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
  mvrStatus = "";
  fillDates();
  render();
});

dateSelect.addEventListener("change", () => {
  plotId = dateSelect.value;
  selected = null;
  armed = null;
  importError = "";
  mvrStatus = "";
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

mvrButton.addEventListener("click", () => {
  mvrFile.click();
});

mvrFile.addEventListener("change", () => {
  const file = mvrFile.files?.[0];
  mvrFile.value = "";
  if (!file) return;
  const targetPlot = plotId;
  void readMvr(file, targetPlot);
});

gdtfButton.addEventListener("click", () => {
  gdtfFile.click();
});

gdtfFile.addEventListener("change", () => {
  const file = gdtfFile.files?.[0];
  gdtfFile.value = "";
  if (!file) return;
  void readGdtf(file);
});

plot.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  if (view === "3d") {
    orbit = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      yaw,
      pitch,
      moved: false,
    };
    plot.setPointerCapture(event.pointerId);
    return;
  }
  const point = clientToView(plot, event);
  if (armed) {
    place(armed, point);
    return;
  }
  selectAt(point);
});

plot.addEventListener("pointermove", (event) => {
  if (!orbit || orbit.pointerId !== event.pointerId || view !== "3d") return;
  const dx = event.clientX - orbit.x;
  const dy = event.clientY - orbit.y;
  if (!orbit.moved && Math.hypot(dx, dy) <= 3) return;
  orbit.moved = true;
  yaw = orbit.yaw + dx * 0.35;
  pitch = Math.min(80, Math.max(-80, orbit.pitch - dy * 0.25));
  render();
});

plot.addEventListener("pointerup", (event) => {
  if (!orbit || orbit.pointerId !== event.pointerId) return;
  const moved = orbit.moved;
  orbit = null;
  if (plot.hasPointerCapture(event.pointerId)) plot.releasePointerCapture(event.pointerId);
  if (moved || view !== "3d") return;
  selectAt(clientToView(plot, event));
});

plot.addEventListener("pointercancel", (event) => {
  if (orbit?.pointerId === event.pointerId) orbit = null;
});

void loadCatalog();

function selectAt(point: { x: number; y: number }): void {
  const hit = hitMark(marks, point, HIT_RADIUS);
  if (hit?.nodeKind === "sound-portal" && hit.sourceId) {
    selected = { kind: "portal", id: hit.sourceId };
  } else if (hit?.permanence === "plot" && hit.sourceId) {
    selected = { kind: "fixture", id: hit.sourceId };
  } else {
    selected = null;
  }
  render();
}

async function loadCatalog(): Promise<void> {
  try {
    const url = new URL("./fixtures/LIGHT_SKY@AQUAPEARL-PRO@V1.4.gdtf", import.meta.url);
    const response = await fetch(url);
    if (!response.ok) throw new Error("Не удалось прочитать библиотеку GDTF");
    addGdtf(parseGdtf(new Uint8Array(await response.arrayBuffer()), "LIGHT_SKY@AQUAPEARL-PRO@V1.4.gdtf"));
  } catch (caught) {
    importError = messageOf(caught);
  }
  render();
}

function place(item: LibraryItem, point: { x: number; y: number }): void {
  if (view === "3d") return;
  const layer = project.listLayers(plotId, item.discipline).find((entry) => entry.name === "Основной");
  if (!layer) return;
  const transform = worldFromView(view, point, item.kind);
  const fromCatalog = item.discipline === "light" && item.catalogId !== null;
  const base = {
    name: fromCatalog ? item.shortName || item.type : item.label,
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
          address: nextAddress(project.listFixtures(plotId, { discipline: "light" }), {
            footprintOf: slotLength,
            needed: fromCatalog ? item.footprint : 1,
          }),
          catalogId: fromCatalog ? item.catalogId : null,
          mode: fromCatalog ? item.mode : null,
          extent: fromCatalog ? (gdtfFixture(item.catalogId)?.extent ?? null) : null,
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

async function readGdtf(file: File): Promise<void> {
  try {
    const fixture = parseGdtf(new Uint8Array(await file.arrayBuffer()), file.name);
    const known = gdtfFixture(fixture.fixtureTypeId) !== null;
    addGdtf(fixture);
    gdtfStatus.classList.remove("error");
    gdtfStatus.textContent = known
      ? `${fixture.manufacturer} ${fixture.name} обновлён в библиотеке`
      : `${fixture.manufacturer} ${fixture.name} добавлен в библиотеку`;
    discipline = "light";
    importError = "";
  } catch (caught) {
    gdtfStatus.classList.add("error");
    gdtfStatus.textContent = messageOf(caught);
  }
  render();
}

async function readMvr(file: File, targetPlot: string): Promise<void> {
  try {
    const added = importMvrLights(project, targetPlot, new Uint8Array(await file.arrayBuffer()));
    if (targetPlot === plotId) {
      importError = "";
      mvrStatus = `В плот добавлено приборов: ${added.length}`;
    }
  } catch (caught) {
    if (targetPlot === plotId) importError = messageOf(caught);
  }
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

function openPlot(nextVenue: string, nextPlot: string): void {
  venueId = nextVenue;
  plotId = nextPlot;
  selected = null;
  armed = null;
  importError = "";
  mvrStatus = "";
  screen = "plot";
  venueSelect.value = venueId;
  fillDates();
  render();
}

function render(): void {
  document.body.dataset.screen = screen;
  document.body.dataset.view = view;
  document.body.dataset.placing = armed ? "true" : "false";
  homeButton.setAttribute("aria-current", screen === "home" ? "page" : "false");
  renderBriefs();
  if (screen === "home") return;
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-discipline]")) {
    button.setAttribute("aria-pressed", String(button.dataset.discipline === discipline));
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-view]")) {
    button.setAttribute("aria-pressed", String(button.dataset.view === view));
  }
  renderLibrary();
  renderUnderlay();
  const planStep = renderPlot();
  renderCard();
  gdtfImport.hidden = discipline !== "light";
  hint.textContent = armed
    ? `Постановка: ${armed.label}. Клик по схеме.`
    : view === "3d"
      ? `Вращайте схему перетаскиванием. Клик выбирает прибор. Сетка — ${planStep} м от нуля.`
      : "Выберите прибор и кликните по схеме.";
}

function renderBriefs(): void {
  homeNote.textContent = `Проект «${project.name}». Строка открывает плот зала на эту дату.`;
  briefs.replaceChildren();
  const rows = listBriefs(project);
  if (rows.length === 0) {
    const empty = document.createElement("p");
    empty.className = "note";
    empty.textContent = "Мероприятий пока нет.";
    briefs.append(empty);
    return;
  }
  for (const brief of rows) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "brief";
    row.dataset.venue = brief.venueId;
    row.dataset.plot = brief.plotId;
    const date = document.createElement("span");
    date.className = "brief-date";
    date.textContent = formatEventDate(brief.date);
    const venue = document.createElement("span");
    venue.textContent = brief.venueName;
    const open = document.createElement("span");
    open.className = "brief-open";
    open.textContent = "Открыть плот";
    row.append(date, venue, open);
    briefs.append(row);
  }
}

function renderLibrary(): void {
  library.replaceChildren();
  let heading = "";
  for (const item of libraryFor(discipline)) {
    if (item.discipline === "light" && item.catalogId) {
      const title = `${item.manufacturer} ${item.type}`;
      if (title !== heading) {
        const head = document.createElement("h3");
        head.textContent = title;
        library.append(head);
        heading = title;
      }
    }
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.label;
    const pressed = armed !== null && sameItem(armed, item);
    button.setAttribute("aria-pressed", String(pressed));
    button.addEventListener("click", () => {
      if (view === "3d") return;
      armed = pressed ? null : item;
      render();
    });
    library.append(button);
  }
}

function renderUnderlay(): void {
  const underlay = project.underlay(venueId);
  underlayStatus.textContent = underlay ? `Подложка: ${underlay.fileName}` : "Подложка не загружена";
  mvrStatusNode.textContent = mvrStatus;
  importAlert.textContent = importError;
}

function renderPlot(): number {
  const graph = project.sceneGraph(venueId, plotId);
  const query = { discipline };
  const projection =
    view === "3d"
      ? projectPerspective(graph, { ...DEFAULT_CAMERA, yaw, pitch }, query)
      : projectOrthographic(graph, view, query);
  marks = projection.marks;
  const plan = projection.view === "3d" ? projection.plan : null;
  const box = viewBoxOf(frameOf(marks, 2, plan ? planPoints(plan) : []));
  plot.setAttribute("viewBox", `${box.x} ${box.y} ${box.width} ${box.height}`);
  world.replaceChildren();
  if (plan) world.append(drawPlan(plan));
  for (const mark of marks) {
    if (mark.shape.kind === "point") world.append(drawPoint(mark));
    else world.append(drawOutline(mark));
  }
  return plan?.step ?? 1;
}

function planPoints(plan: PlanOverlay): { x: number; y: number }[] {
  const points = plan.lines.flatMap((line) => [...line.points]);
  for (const label of plan.labels) points.push(label.at);
  return points;
}

function drawPlan(plan: PlanOverlay): SVGElement {
  const group = svg("g");
  group.setAttribute("class", "plan");
  for (const line of plan.lines) {
    const element = svg("polyline");
    element.setAttribute("points", line.points.map((point) => `${point.x},${point.y}`).join(" "));
    element.setAttribute("class", `plan-${line.role}`);
    group.append(element);
  }
  const origin = plan.labels.find((label) => label.text === "0");
  if (origin) {
    const mark = svg("g");
    mark.setAttribute("class", "plan-origin");
    const title = svg("title");
    title.textContent = "Нулевая точка";
    const circle = svg("circle");
    circle.setAttribute("cx", String(origin.at.x - 0.28));
    circle.setAttribute("cy", String(origin.at.y - 0.28));
    circle.setAttribute("r", "0.12");
    mark.append(title, circle);
    group.append(mark);
  }
  for (const label of plan.labels) {
    const text = svg("text");
    text.textContent = label.text;
    text.setAttribute("x", String(label.at.x));
    text.setAttribute("y", String(label.at.y));
    text.setAttribute(
      "transform",
      `translate(${label.at.x} ${label.at.y}) scale(1,-1) translate(${-label.at.x} ${-label.at.y})`,
    );
    text.setAttribute("class", "plan-label");
    const title = svg("title");
    title.textContent =
      label.text === "0" ? "Нулевая точка" : label.text === "X" ? "Ширина" : label.text === "Y" ? "Глубина" : "Высота";
    text.append(title);
    group.append(text);
  }
  return group;
}

function sameItem(left: LibraryItem, right: LibraryItem): boolean {
  if (left.discipline !== right.discipline || left.kind !== right.kind || left.type !== right.type) return false;
  if (left.discipline !== "light" || right.discipline !== "light") return true;
  return left.catalogId === right.catalogId && left.mode === right.mode;
}

function slotLength(fixture: Fixture): number | null {
  if (!fixture.catalogId || !fixture.mode) return 1;
  const mode = gdtfMode(fixture.catalogId, fixture.mode);
  if (!mode || mode.footprint === null) return null;
  return mode.footprint;
}

function drawOutline(mark: OrthographicMark): SVGElement {
  if (mark.nodeKind === "light-fixture") return drawFixtureBody(mark);
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

function drawFixtureBody(mark: OrthographicMark): SVGElement {
  const shape = mark.shape;
  if (shape.kind === "point") return drawPoint(mark);
  const group = svg("g");
  const selectedMark = mark.sourceId !== null && selected?.id === mark.sourceId;
  group.setAttribute("class", "fixture");
  if (selectedMark) group.setAttribute("data-selected", "true");
  if (mark.sourceId) group.setAttribute("data-source", mark.sourceId);
  group.setAttribute("data-kind", mark.nodeKind);
  const element = svg(shape.kind === "polygon" ? "polygon" : "polyline");
  element.setAttribute("points", shape.points.map((point) => `${point.x},${point.y}`).join(" "));
  element.setAttribute("fill", "rgba(242,193,78,0.35)");
  element.setAttribute("stroke", selectedMark ? "#7ec8ff" : "#f2c14e");
  element.setAttribute("stroke-width", selectedMark ? "0.08" : "0.04");
  group.append(element);
  for (const edge of mark.edges ?? []) {
    const wire = svg("polyline");
    wire.setAttribute("points", edge.map((point) => `${point.x},${point.y}`).join(" "));
    wire.setAttribute("fill", "none");
    wire.setAttribute("stroke", selectedMark ? "#7ec8ff" : "#f6d98a");
    wire.setAttribute("stroke-width", "0.03");
    group.append(wire);
  }
  const anchor = shape.points[0];
  if (!anchor) return group;
  const labelX = shape.points.reduce((sum, point) => sum + point.x, 0) / shape.points.length;
  const labelY = shape.points.reduce((sum, point) => sum + point.y, 0) / shape.points.length;
  const label = svg("text");
  label.textContent = pointLabel(mark);
  label.setAttribute("x", String(labelX));
  label.setAttribute("y", String(labelY));
  label.setAttribute(
    "transform",
    `translate(${labelX} ${labelY}) scale(1,-1) translate(${-labelX} ${-labelY})`,
  );
  label.setAttribute("fill", "#f4f1ea");
  label.setAttribute("font-size", "0.45");
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("dominant-baseline", "middle");
  group.append(label);
  return group;
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
  if (fixture.catalogId && fixture.mode) {
    const catalog = gdtfFixture(fixture.catalogId);
    const modeLabel = document.createElement("label");
    modeLabel.textContent = "Режим ";
    const modeSelect = document.createElement("select");
    for (const mode of catalog?.modes ?? []) {
      const option = document.createElement("option");
      option.value = mode.name;
      option.textContent =
        mode.footprint === null ? `${mode.name} · пиксели не развёрнуты` : `${mode.name} · ${mode.footprint}`;
      modeSelect.append(option);
    }
    if (![...modeSelect.options].some((option) => option.value === fixture.mode)) {
      const option = document.createElement("option");
      option.value = fixture.mode;
      option.textContent = fixture.mode;
      modeSelect.append(option);
    }
    modeSelect.value = fixture.mode;
    modeSelect.addEventListener("change", () => {
      const next = gdtfMode(fixture.catalogId ?? "", modeSelect.value);
      const conflict =
        fixture.address === null
          ? null
          : addressConflict(
              project.listFixtures(plotId, { discipline: "light" }),
              fixture.address,
              next?.footprint ?? null,
              slotLength,
              fixture.id,
            );
      if (conflict) {
        error.textContent = conflict;
        modeSelect.value = project.fixture(plotId, fixture.id).mode ?? fixture.mode ?? "";
        return;
      }
      project.setFixtureMode(plotId, fixture.id, modeSelect.value);
      error.textContent = "";
      render();
    });
    modeLabel.append(modeSelect);
    const footprint = document.createElement("p");
    footprint.className = "note";
    const current = catalog?.modes.find((mode) => mode.name === fixture.mode);
    footprint.textContent = footprintText(fixture, current?.footprint ?? null);
    fields.append(modeLabel, footprint);
    if (current && current.channels.length > 0) {
      const list = document.createElement("ol");
      list.className = "channels";
      for (const channel of current.channels) {
        const row = document.createElement("li");
        const slots = channel.slots.join("+");
        row.textContent = `${channel.pretty} ${slots}${channel.geometry ? ` · ${channel.geometry}` : ""}`;
        list.append(row);
      }
      fields.append(list);
    }
  }
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
      const next = {
        universe: Number(universe.input.value),
        address: Number(channel.input.value),
      };
      const conflict = addressConflict(
        project.listFixtures(plotId, { discipline: "light" }),
        next,
        slotLength(fixture),
        slotLength,
        fixture.id,
      );
      if (conflict) {
        error.textContent = conflict;
        const current = project.fixture(plotId, fixture.id).address;
        if (current) {
          universe.input.value = String(current.universe);
          channel.input.value = String(current.address);
        }
        return;
      }
      try {
        project.setLightAddress(plotId, fixture.id, next);
        error.textContent = "";
        render();
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

function footprintText(fixture: Fixture, footprint: number | null): string {
  if (footprint === null) return "Футпринт не посчитан: пиксели режима не развёрнуты.";
  const address = fixture.address;
  if (!address) return `Футпринт ${footprint}.`;
  const end = address.address + footprint - 1;
  if (end > 512) return `Футпринт ${footprint}, с адреса ${address.universe}.${address.address} в юниверс не входит.`;
  return `Футпринт ${footprint}: ${address.universe}.${address.address}–${address.universe}.${end}.`;
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
