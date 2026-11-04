import { SceneError } from "./errors.ts";
import { randomIds, type IdGenerator } from "./ids.ts";
import { buildSceneGraph } from "./scene-graph.ts";
import { parseSnapshot } from "./snapshot.ts";
import type {
  AddFixtureInput,
  Discipline,
  DmxAddress,
  Extent,
  Fixture,
  FixtureQuery,
  Geometry,
  GeometryShape,
  Layer,
  NamedRef,
  PlotRef,
  PlotSnapshot,
  ProjectSnapshot,
  SceneGraph,
  SoundPortal,
  Transform,
  Vec3,
  VenueSnapshot,
  VenueUnderlay,
} from "./types.ts";
import {
  addressKey,
  assertDate,
  assertId,
  assertKind,
  assertName,
  copyAddress,
  copyShape,
  copyTransform,
  copyVec3,
  isDiscipline,
} from "./values.ts";

interface PlotRecord {
  id: string;
  venueId: string;
  date: string;
  layers: Map<string, Layer>;
  layerOrder: string[];
  fixtures: Map<string, Fixture>;
  fixtureOrder: string[];
  addresses: Map<string, string>;
}

interface VenueRecord {
  id: string;
  name: string;
  geometry: Map<string, Geometry>;
  geometryOrder: string[];
  portals: Map<string, SoundPortal>;
  portalOrder: string[];
  underlay: VenueUnderlay | null;
  plots: Map<string, PlotRecord>;
  plotOrder: string[];
  dates: Map<string, string>;
}

/** Проект — корень документа. Зал хранит постоянное, плот на дату — смену. */
export class Project {
  readonly id: string;
  private projectName: string;
  private readonly ids: IdGenerator;
  private readonly taken = new Set<string>();
  private readonly venues = new Map<string, VenueRecord>();
  private readonly venueOrder: string[] = [];
  private readonly plots = new Map<string, PlotRecord>();

  private constructor(id: string, name: string, ids: IdGenerator) {
    this.id = id;
    this.projectName = name;
    this.ids = ids;
    this.taken.add(id);
  }

  static create(input: { name: string; ids?: IdGenerator }): Project {
    const ids = input.ids ?? randomIds();
    return new Project(assertId(ids()), assertName(input.name), ids);
  }

  static fromSnapshot(input: unknown): Project {
    const snapshot = parseSnapshot(input);
    const project = new Project(assertId(snapshot.id), assertName(snapshot.name), randomIds());
    for (const venue of snapshot.venues) {
      project.insertVenue(venue);
      for (const geometry of venue.geometry) project.insertGeometry(venue.id, geometry);
      for (const portal of venue.portals) project.insertPortal(venue.id, portal);
      for (const plot of venue.plots) {
        project.insertPlot(venue.id, plot);
        for (const layer of plot.layers) project.insertLayer(plot.id, layer);
        for (const fixture of plot.fixtures) {
          project.insertFixture(plot.id, { ...fixture, parentId: null });
        }
        for (const fixture of plot.fixtures) {
          if (fixture.parentId !== null) {
            project.setFixtureParent(plot.id, fixture.id, fixture.parentId);
          }
        }
      }
    }
    return project;
  }

  get name(): string {
    return this.projectName;
  }

  rename(name: string): void {
    this.projectName = assertName(name);
  }

  toSnapshot(): ProjectSnapshot {
    return {
      version: 1,
      id: this.id,
      name: this.projectName,
      venues: this.venueOrder.map((id) => this.venueSnapshot(this.venueOrThrow(id))),
    };
  }

  addVenue(input: { name: string }): string {
    const id = this.nextId();
    this.insertVenue({
      id,
      name: input.name,
      geometry: [],
      portals: [],
      underlay: null,
      plots: [],
    });
    return id;
  }

  renameVenue(venueId: string, name: string): void {
    this.venueOrThrow(venueId).name = assertName(name);
  }

  listVenues(): readonly NamedRef[] {
    return this.venueOrder.map((id) => {
      const venue = this.venueOrThrow(id);
      return { id: venue.id, name: venue.name };
    });
  }

  addGeometry(
    venueId: string,
    input: { name: string; shape: GeometryShape; transform: Transform },
  ): string {
    const id = this.nextId();
    this.insertGeometry(venueId, {
      id,
      name: input.name,
      shape: input.shape,
      transform: input.transform,
    });
    return id;
  }

  renameGeometry(venueId: string, geometryId: string, name: string): void {
    const venue = this.venueOrThrow(venueId);
    const geometry = this.geometryOrThrow(venueId, geometryId);
    venue.geometry.set(geometryId, { ...geometry, name: assertName(name) });
  }

  setGeometryTransform(venueId: string, geometryId: string, transform: Transform): void {
    const venue = this.venueOrThrow(venueId);
    const geometry = this.geometryOrThrow(venueId, geometryId);
    venue.geometry.set(geometryId, { ...geometry, transform: copyTransform(transform) });
  }

  setGeometryShape(venueId: string, geometryId: string, shape: GeometryShape): void {
    const venue = this.venueOrThrow(venueId);
    const geometry = this.geometryOrThrow(venueId, geometryId);
    venue.geometry.set(geometryId, { ...geometry, shape: copyShape(shape) });
  }

  removeGeometry(venueId: string, geometryId: string): void {
    const venue = this.venueOrThrow(venueId);
    this.geometryOrThrow(venueId, geometryId);
    venue.geometry.delete(geometryId);
    removeId(venue.geometryOrder, geometryId);
    this.taken.delete(geometryId);
  }

  setUnderlay(venueId: string, underlay: VenueUnderlay): void {
    this.venueOrThrow(venueId).underlay = copyUnderlay(underlay);
  }

  underlay(venueId: string): VenueUnderlay | null {
    const stored = this.venueOrThrow(venueId).underlay;
    return stored ? copyUnderlay(stored) : null;
  }

  listGeometry(venueId: string): readonly Geometry[] {
    const venue = this.venueOrThrow(venueId);
    return venue.geometryOrder.map((id) => copyGeometry(this.geometryOrThrow(venueId, id)));
  }

  addSoundPortal(
    venueId: string,
    input: { name: string; type: string; transform: Transform },
  ): string {
    const id = this.nextId();
    this.insertPortal(venueId, {
      id,
      name: input.name,
      type: input.type,
      transform: input.transform,
    });
    return id;
  }

  renameSoundPortal(venueId: string, portalId: string, name: string): void {
    const venue = this.venueOrThrow(venueId);
    const portal = this.portalOrThrow(venueId, portalId);
    venue.portals.set(portalId, { ...portal, name: assertName(name) });
  }

  setSoundPortalType(venueId: string, portalId: string, type: string): void {
    const venue = this.venueOrThrow(venueId);
    const portal = this.portalOrThrow(venueId, portalId);
    venue.portals.set(portalId, { ...portal, type: assertName(type) });
  }

  setSoundPortalTransform(venueId: string, portalId: string, transform: Transform): void {
    const venue = this.venueOrThrow(venueId);
    const portal = this.portalOrThrow(venueId, portalId);
    venue.portals.set(portalId, { ...portal, transform: copyTransform(transform) });
  }

  removeSoundPortal(venueId: string, portalId: string): void {
    const venue = this.venueOrThrow(venueId);
    this.portalOrThrow(venueId, portalId);
    venue.portals.delete(portalId);
    removeId(venue.portalOrder, portalId);
    this.taken.delete(portalId);
  }

  listSoundPortals(venueId: string): readonly SoundPortal[] {
    const venue = this.venueOrThrow(venueId);
    return venue.portalOrder.map((id) => copyPortal(this.portalOrThrow(venueId, id)));
  }

  addPlot(venueId: string, input: { date: string }): string {
    const id = this.nextId();
    this.insertPlot(venueId, { id, date: input.date, layers: [], fixtures: [] });
    return id;
  }

  setPlotDate(plotId: string, date: string): void {
    const plot = this.plotOrThrow(plotId);
    const venue = this.venueOrThrow(plot.venueId);
    const next = assertDate(date);
    const owner = venue.dates.get(next);
    if (owner !== undefined && owner !== plot.id) {
      throw new SceneError("duplicate-date", "На эту дату плот уже есть");
    }
    venue.dates.delete(plot.date);
    plot.date = next;
    venue.dates.set(next, plot.id);
  }

  removePlot(plotId: string): void {
    const plot = this.plotOrThrow(plotId);
    const venue = this.venueOrThrow(plot.venueId);
    for (const layerId of plot.layerOrder) this.taken.delete(layerId);
    for (const fixtureId of plot.fixtureOrder) this.taken.delete(fixtureId);
    this.taken.delete(plot.id);
    venue.dates.delete(plot.date);
    venue.plots.delete(plot.id);
    removeId(venue.plotOrder, plot.id);
    this.plots.delete(plot.id);
  }

  listPlots(venueId: string): readonly PlotRef[] {
    const venue = this.venueOrThrow(venueId);
    return venue.plotOrder.map((id) => {
      const plot = this.plotOrThrow(id);
      return { id: plot.id, venueId: plot.venueId, date: plot.date };
    });
  }

  plotByDate(venueId: string, date: string): PlotRef | null {
    const venue = this.venueOrThrow(venueId);
    const plotId = venue.dates.get(assertDate(date));
    if (plotId === undefined) return null;
    const plot = this.plotOrThrow(plotId);
    return { id: plot.id, venueId: plot.venueId, date: plot.date };
  }

  addLayer(plotId: string, input: { name: string; discipline: Discipline }): string {
    const id = this.nextId();
    this.insertLayer(plotId, { id, name: input.name, discipline: input.discipline });
    return id;
  }

  renameLayer(plotId: string, layerId: string, name: string): void {
    const plot = this.plotOrThrow(plotId);
    const layer = this.layerOrThrow(plotId, layerId);
    plot.layers.set(layerId, { ...layer, name: assertName(name) });
  }

  removeLayer(plotId: string, layerId: string): void {
    const plot = this.plotOrThrow(plotId);
    this.layerOrThrow(plotId, layerId);
    const used = plot.fixtureOrder.some((id) => plot.fixtures.get(id)?.layerId === layerId);
    if (used) throw new SceneError("layer-in-use", "Слой занят приборами");
    plot.layers.delete(layerId);
    removeId(plot.layerOrder, layerId);
    this.taken.delete(layerId);
  }

  listLayers(plotId: string, discipline?: Discipline): readonly Layer[] {
    const plot = this.plotOrThrow(plotId);
    if (discipline !== undefined) assertDiscipline(discipline);
    return plot.layerOrder
      .map((id) => this.layerOrThrow(plotId, id))
      .filter((layer) => discipline === undefined || layer.discipline === discipline)
      .map((layer) => ({ id: layer.id, name: layer.name, discipline: layer.discipline }));
  }

  addFixture(plotId: string, input: AddFixtureInput): string {
    if (input.discipline !== "light" && "address" in input && input.address != null) {
      throw new SceneError("address-forbidden", "Адрес и юниверс задаются только у прибора света");
    }
    const id = this.nextId();
    this.insertFixture(plotId, {
      id,
      name: input.name,
      type: input.type,
      discipline: input.discipline,
      kind: input.kind,
      layerId: input.layerId,
      parentId: input.parentId ?? null,
      transform: input.transform,
      address: input.discipline === "light" ? input.address : null,
      catalogId: input.discipline === "light" ? (input.catalogId ?? null) : null,
      mode: input.discipline === "light" ? (input.mode ?? null) : null,
      extent: input.discipline === "light" ? (input.extent ?? null) : null,
    });
    return id;
  }

  renameFixture(plotId: string, fixtureId: string, name: string): void {
    const fixture = this.fixtureOrThrow(plotId, fixtureId);
    this.replaceFixture(plotId, { ...fixture, name: assertName(name) });
  }

  setFixtureType(plotId: string, fixtureId: string, type: string): void {
    const fixture = this.fixtureOrThrow(plotId, fixtureId);
    this.replaceFixture(plotId, { ...fixture, type: assertName(type) });
  }

  /** Меняет имя режима GDTF. Футпринт остаётся в каталоге, габарит не меняется. */
  setFixtureMode(plotId: string, fixtureId: string, mode: string): void {
    const fixture = this.fixtureOrThrow(plotId, fixtureId);
    if (fixture.catalogId === null) {
      throw new SceneError("invalid-catalog", "Режим есть только у прибора из библиотеки");
    }
    this.replaceFixture(plotId, { ...fixture, mode: assertName(mode) });
  }

  setFixtureTransform(plotId: string, fixtureId: string, transform: Transform): void {
    const fixture = this.fixtureOrThrow(plotId, fixtureId);
    this.replaceFixture(plotId, { ...fixture, transform: copyTransform(transform) });
  }

  setFixtureLayer(plotId: string, fixtureId: string, layerId: string): void {
    const fixture = this.fixtureOrThrow(plotId, fixtureId);
    const layer = this.layerOrThrow(plotId, layerId);
    if (layer.discipline !== fixture.discipline) {
      throw new SceneError(
        "layer-discipline",
        "Слой относится к другой дисциплине",
      );
    }
    this.replaceFixture(plotId, { ...fixture, layerId: layer.id });
  }

  /**
   * Меняет родителя в графе. Локальный трансформ не пересчитывается:
   * позиция и поворот заданы относительно родителя.
   */
  setFixtureParent(plotId: string, fixtureId: string, parentId: string | null): void {
    const plot = this.plotOrThrow(plotId);
    const fixture = this.fixtureOrThrow(plotId, fixtureId);
    if (parentId !== null) {
      if (!plot.fixtures.has(parentId)) {
        throw new SceneError("unknown-parent", `Родитель «${parentId}» не найден в этом плоте`);
      }
      if (this.closesCycle(plot, fixtureId, parentId)) {
        throw new SceneError("parent-cycle", "Прибор нельзя сделать потомком самого себя");
      }
    }
    this.replaceFixture(plotId, { ...fixture, parentId });
  }

  setLightAddress(plotId: string, fixtureId: string, address: DmxAddress): void {
    const plot = this.plotOrThrow(plotId);
    const fixture = this.fixtureOrThrow(plotId, fixtureId);
    if (fixture.discipline !== "light" || fixture.address === null) {
      throw new SceneError("address-forbidden", "Адрес и юниверс задаются только у прибора света");
    }
    const next = copyAddress(address);
    this.claimAddress(plot, fixture.id, next, fixture.address);
    this.replaceFixture(plotId, { ...fixture, address: next });
  }

  removeFixture(plotId: string, fixtureId: string): void {
    const plot = this.plotOrThrow(plotId);
    const fixture = this.fixtureOrThrow(plotId, fixtureId);
    const hasChild = plot.fixtureOrder.some((id) => plot.fixtures.get(id)?.parentId === fixtureId);
    if (hasChild) {
      throw new SceneError("fixture-has-children", "Нельзя удалить прибор: на нём закреплены другие");
    }
    if (fixture.address) plot.addresses.delete(addressKey(fixture.address));
    plot.fixtures.delete(fixtureId);
    removeId(plot.fixtureOrder, fixtureId);
    this.taken.delete(fixtureId);
  }

  fixture(plotId: string, fixtureId: string): Fixture {
    return copyFixture(this.fixtureOrThrow(plotId, fixtureId));
  }

  listFixtures(plotId: string, query?: FixtureQuery): readonly Fixture[] {
    const plot = this.plotOrThrow(plotId);
    const discipline = query?.discipline;
    const layerId = query?.layerId;
    if (discipline !== undefined) assertDiscipline(discipline);
    if (layerId !== undefined) {
      const layer = this.layerOrThrow(plotId, layerId);
      if (discipline !== undefined && layer.discipline !== discipline) {
        throw new SceneError("layer-discipline", "Слой относится к другой дисциплине");
      }
    }
    return plot.fixtureOrder
      .map((id) => this.fixtureOrThrow(plotId, id))
      .filter((fixture) => {
        if (discipline !== undefined && fixture.discipline !== discipline) return false;
        if (layerId !== undefined && fixture.layerId !== layerId) return false;
        return true;
      })
      .map((fixture) => copyFixture(fixture));
  }

  sceneGraph(venueId: string, plotId: string): SceneGraph {
    this.venueOrThrow(venueId);
    this.plotOrThrow(plotId);
    return buildSceneGraph(this.toSnapshot(), venueId, plotId);
  }

  private nextId(): string {
    return assertId(this.ids());
  }

  private claim(id: string): void {
    if (this.taken.has(id)) {
      throw new SceneError("duplicate-id", `Идентификатор «${id}» уже занят`);
    }
    this.taken.add(id);
  }

  private insertVenue(venue: VenueSnapshot): void {
    const id = assertId(venue.id);
    const name = assertName(venue.name);
    this.claim(id);
    this.venues.set(id, {
      id,
      name,
      geometry: new Map(),
      geometryOrder: [],
      portals: new Map(),
      portalOrder: [],
      underlay: venue.underlay ? copyUnderlay(venue.underlay) : null,
      plots: new Map(),
      plotOrder: [],
      dates: new Map(),
    });
    this.venueOrder.push(id);
  }

  private insertGeometry(venueId: string, geometry: Geometry): void {
    const venue = this.venueOrThrow(venueId);
    const id = assertId(geometry.id);
    const stored: Geometry = {
      id,
      name: assertName(geometry.name),
      shape: copyShape(geometry.shape),
      transform: copyTransform(geometry.transform),
    };
    this.claim(id);
    venue.geometry.set(id, stored);
    venue.geometryOrder.push(id);
  }

  private insertPortal(venueId: string, portal: SoundPortal): void {
    const venue = this.venueOrThrow(venueId);
    const id = assertId(portal.id);
    const stored: SoundPortal = {
      id,
      name: assertName(portal.name),
      type: assertName(portal.type),
      transform: copyTransform(portal.transform),
    };
    this.claim(id);
    venue.portals.set(id, stored);
    venue.portalOrder.push(id);
  }

  private insertPlot(venueId: string, plot: PlotSnapshot): void {
    const venue = this.venueOrThrow(venueId);
    const id = assertId(plot.id);
    const date = assertDate(plot.date);
    if (venue.dates.has(date)) {
      throw new SceneError("duplicate-date", "На эту дату плот уже есть");
    }
    this.claim(id);
    const record: PlotRecord = {
      id,
      venueId,
      date,
      layers: new Map(),
      layerOrder: [],
      fixtures: new Map(),
      fixtureOrder: [],
      addresses: new Map(),
    };
    venue.plots.set(id, record);
    venue.plotOrder.push(id);
    venue.dates.set(date, id);
    this.plots.set(id, record);
  }

  private insertLayer(plotId: string, layer: Layer): void {
    const plot = this.plotOrThrow(plotId);
    const id = assertId(layer.id);
    assertDiscipline(layer.discipline);
    const stored: Layer = { id, name: assertName(layer.name), discipline: layer.discipline };
    this.claim(id);
    plot.layers.set(id, stored);
    plot.layerOrder.push(id);
  }

  private insertFixture(plotId: string, fixture: Fixture): void {
    const plot = this.plotOrThrow(plotId);
    const id = assertId(fixture.id);
    assertDiscipline(fixture.discipline);
    const kind = assertKind(fixture.discipline, fixture.kind);
    const layer = this.layerOrThrow(plotId, fixture.layerId);
    if (layer.discipline !== fixture.discipline) {
      throw new SceneError("layer-discipline", "Слой относится к другой дисциплине");
    }
    const parentId = fixture.parentId;
    if (parentId !== null) {
      if (parentId === id) {
        throw new SceneError("parent-cycle", "Прибор нельзя сделать потомком самого себя");
      }
      if (!plot.fixtures.has(parentId)) {
        throw new SceneError("unknown-parent", `Родитель «${parentId}» не найден в этом плоте`);
      }
    }
    const address = this.addressFor(fixture);
    const catalog = catalogOf(fixture);
    const stored: Fixture = {
      id,
      name: assertName(fixture.name),
      type: assertName(fixture.type),
      discipline: fixture.discipline,
      kind,
      layerId: layer.id,
      parentId,
      transform: copyTransform(fixture.transform),
      address,
      catalogId: catalog.catalogId,
      mode: catalog.mode,
      extent: catalog.extent,
    };
    if (address) this.assertAddressFree(plot, id, address);
    this.claim(id);
    if (address) plot.addresses.set(addressKey(address), id);
    plot.fixtures.set(id, stored);
    plot.fixtureOrder.push(id);
  }

  private addressFor(fixture: Fixture): DmxAddress | null {
    if (fixture.discipline === "light") {
      if (fixture.address === null) {
        throw new SceneError("address-required", "Прибору света нужны юниверс и адрес");
      }
      return copyAddress(fixture.address);
    }
    if (fixture.address !== null) {
      throw new SceneError("address-forbidden", "Адрес и юниверс задаются только у прибора света");
    }
    return null;
  }

  private assertAddressFree(plot: PlotRecord, fixtureId: string, next: DmxAddress): void {
    const owner = plot.addresses.get(addressKey(next));
    if (owner !== undefined && owner !== fixtureId) {
      throw new SceneError(
        "duplicate-address",
        `Адрес ${next.universe}.${next.address} уже занят`,
      );
    }
  }

  private claimAddress(
    plot: PlotRecord,
    fixtureId: string,
    next: DmxAddress,
    previous: DmxAddress | null,
  ): void {
    this.assertAddressFree(plot, fixtureId, next);
    if (previous) plot.addresses.delete(addressKey(previous));
    plot.addresses.set(addressKey(next), fixtureId);
  }

  private replaceFixture(plotId: string, fixture: Fixture): void {
    const plot = this.plotOrThrow(plotId);
    plot.fixtures.set(fixture.id, fixture);
  }

  private closesCycle(plot: PlotRecord, fixtureId: string, parentId: string): boolean {
    let current: string | null = parentId;
    const seen = new Set<string>();
    while (current !== null) {
      if (current === fixtureId) return true;
      if (seen.has(current)) return true;
      seen.add(current);
      current = plot.fixtures.get(current)?.parentId ?? null;
    }
    return false;
  }

  private venueSnapshot(venue: VenueRecord): VenueSnapshot {
    return {
      id: venue.id,
      name: venue.name,
      geometry: this.listGeometry(venue.id),
      portals: this.listSoundPortals(venue.id),
      underlay: venue.underlay ? copyUnderlay(venue.underlay) : null,
      plots: venue.plotOrder.map((plotId) => {
        const plot = this.plotOrThrow(plotId);
        return {
          id: plot.id,
          date: plot.date,
          layers: this.listLayers(plot.id),
          fixtures: this.listFixtures(plot.id),
        };
      }),
    };
  }

  private venueOrThrow(venueId: string): VenueRecord {
    const venue = this.venues.get(venueId);
    if (!venue) throw new SceneError("unknown-venue", `Зал «${venueId}» не найден`);
    return venue;
  }

  private plotOrThrow(plotId: string): PlotRecord {
    const plot = this.plots.get(plotId);
    if (!plot) throw new SceneError("unknown-plot", `Плот «${plotId}» не найден`);
    return plot;
  }

  private geometryOrThrow(venueId: string, geometryId: string): Geometry {
    const geometry = this.venueOrThrow(venueId).geometry.get(geometryId);
    if (!geometry) {
      throw new SceneError("unknown-geometry", `Геометрия «${geometryId}» не найдена в этом зале`);
    }
    return geometry;
  }

  private portalOrThrow(venueId: string, portalId: string): SoundPortal {
    const portal = this.venueOrThrow(venueId).portals.get(portalId);
    if (!portal) {
      throw new SceneError("unknown-portal", `Портал «${portalId}» не найден в этом зале`);
    }
    return portal;
  }

  private layerOrThrow(plotId: string, layerId: string): Layer {
    const layer = this.plotOrThrow(plotId).layers.get(layerId);
    if (!layer) throw new SceneError("unknown-layer", `Слой «${layerId}» не найден в этом плоте`);
    return layer;
  }

  private fixtureOrThrow(plotId: string, fixtureId: string): Fixture {
    const fixture = this.plotOrThrow(plotId).fixtures.get(fixtureId);
    if (!fixture) {
      throw new SceneError("unknown-fixture", `Прибор «${fixtureId}» не найден в этом плоте`);
    }
    return fixture;
  }
}

function assertDiscipline(value: Discipline): void {
  if (!isDiscipline(value)) {
    throw new SceneError("invalid-snapshot", "Неизвестная дисциплина");
  }
}

function removeId(order: string[], id: string): void {
  const index = order.indexOf(id);
  if (index >= 0) order.splice(index, 1);
}

function copyGeometry(geometry: Geometry): Geometry {
  return {
    id: geometry.id,
    name: geometry.name,
    shape: copyShape(geometry.shape),
    transform: copyTransform(geometry.transform),
  };
}

function copyUnderlay(underlay: VenueUnderlay): VenueUnderlay {
  const fileName = assertName(underlay.fileName);
  if (!Array.isArray(underlay.strokes) || underlay.strokes.length === 0) {
    throw new SceneError("invalid-shape", "У подложки нет линий");
  }
  return {
    fileName,
    strokes: underlay.strokes.map((stroke) => {
      if (!Array.isArray(stroke.points) || stroke.points.length < 2) {
        throw new SceneError("invalid-shape", "Линия подложки должна содержать хотя бы две точки");
      }
      return {
        points: stroke.points.map((point: Vec3) => copyUnderlayPoint(point)),
      };
    }),
  };
}

function copyUnderlayPoint(point: Vec3): Vec3 {
  try {
    return copyVec3(point);
  } catch (error) {
    if (error instanceof SceneError && error.code === "invalid-transform") {
      throw new SceneError("invalid-shape", "Точка подложки задаётся конечными числами X, Y и Z");
    }
    throw error;
  }
}

function copyPortal(portal: SoundPortal): SoundPortal {
  return {
    id: portal.id,
    name: portal.name,
    type: portal.type,
    transform: copyTransform(portal.transform),
  };
}

function catalogOf(fixture: Fixture): {
  catalogId: string | null;
  mode: string | null;
  extent: Extent | null;
} {
  const catalogId = fixture.catalogId?.trim() ?? "";
  const mode = fixture.mode?.trim() ?? "";
  const extent = fixture.extent;
  if (fixture.discipline !== "light") {
    if (catalogId !== "" || mode !== "" || extent) {
      throw new SceneError("catalog-forbidden", "Библиотека GDTF задаётся только у прибора света");
    }
    return { catalogId: null, mode: null, extent: null };
  }
  if (catalogId === "" && mode === "" && !extent) {
    return { catalogId: null, mode: null, extent: null };
  }
  if (catalogId === "" || mode === "") {
    throw new SceneError("invalid-catalog", "У прибора из библиотеки нужны тип и режим");
  }
  return {
    catalogId,
    mode,
    extent: extent ? copyExtent(extent) : null,
  };
}

function copyExtent(extent: Extent): Extent {
  return {
    min: copyVec3(extent.min),
    max: copyVec3(extent.max),
  };
}

function copyFixture(fixture: Fixture): Fixture {
  const catalog = catalogOf(fixture);
  return {
    id: fixture.id,
    name: fixture.name,
    type: fixture.type,
    discipline: fixture.discipline,
    kind: fixture.kind,
    layerId: fixture.layerId,
    parentId: fixture.parentId,
    transform: copyTransform(fixture.transform),
    address: fixture.address ? { ...fixture.address } : null,
    catalogId: catalog.catalogId,
    mode: catalog.mode,
    extent: catalog.extent,
  };
}
