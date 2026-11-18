// Tournament actions: validate, apply the rules (domain/) and save (repositories/).
// Every action returns the updated view, so the frontend always shows the server's state.

import {
  anyResults,
  DEFAULT_GROUP_SIZE,
  DEFAULT_RULES,
  drawGroups,
  emptySets,
  groupCountFor,
  locatePlayer,
  matchKey,
  MAX_GROUP_SIZE,
  MIN_GROUP_SIZE,
  pairingsFor,
  replaceGroupPlayers,
  setsToWin,
  type GroupRules,
  type MatchResult,
  type Results,
  type Scoring,
} from '../domain/groupStage.ts';
import { drawKnockout, knockoutMatchKey, moveSlot, type BracketSlot } from '../domain/knockout.ts';
import { readPlayerRows } from '../domain/playerImport.ts';
import {
  individualPlayers,
  INDIVIDUAL_ONLY,
  nextFreeBib,
  sortByRanking,
  type NewPlayer,
  type Player,
} from '../domain/players.ts';
import { HttpError } from '../httpError.ts';
import {
  allScopes,
  commitScope,
  competitionOfPlayer,
  competitionsOf,
  DIVISIONS,
  scopeOf,
  type Division,
  type CategoryScope,
  type Tournament,
  type TournamentSettings,
} from '../models/tournament.ts';
import {
  deleteTournament as removeTournament,
  findTournament,
  listTournaments as findAllTournaments,
  saveTournament,
} from '../repositories/tournament.repository.ts';
import {
  drawPreview,
  knockoutMatchAt,
  knockoutMatchLocked,
  knockoutRoundsOf,
  knockoutRulesOf,
  slotPlayerOf,
  tournamentView,
  type DrawPreview,
  type TournamentView,
} from './tournament.view.ts';

function load(tournamentId: string): Tournament {
  const tournament = findTournament(tournamentId);
  if (!tournament) throw new HttpError(404, 'Torneo no encontrado.');
  return tournament;
}

function save(tournament: Tournament): TournamentView {
  saveTournament(tournament);
  return tournamentView(tournament);
}

/** A category's competition, to change it (written back with saveScope). */
function loadScope(
  tournamentId: string,
  category: string,
): { tournament: Tournament; scope: CategoryScope } {
  const tournament = load(tournamentId);
  if (!competitionsOf(tournament.settings).some((competition) => competition.key === category)) {
    throw new HttpError(404, `El torneo no tiene la competencia «${category}».`);
  }
  return { tournament, scope: scopeOf(tournament, category) };
}

function saveScope(tournament: Tournament, scope: CategoryScope): TournamentView {
  commitScope(tournament, scope);
  return save(tournament);
}

function hasResults(scope: CategoryScope): boolean {
  return anyResults(scope.results);
}

function knockoutStarted(scope: CategoryScope): boolean {
  return anyResults(scope.knockoutResults);
}

function thirdPlaceStarted(scope: CategoryScope): boolean {
  return knockoutRoundsOf(scope)?.thirdPlace?.summary.started ?? false;
}

/** Results entered in any category (rules are shared by every category). */
function anyCategory(tournament: Tournament, test: (scope: CategoryScope) => boolean): boolean {
  return allScopes(tournament).some(test);
}

/** Once the bracket has results, the groups (who qualified) must stay as they are. */
function requireGroupStageOpen(scope: CategoryScope): void {
  if (knockoutStarted(scope)) {
    throw new HttpError(
      409,
      'Las llaves ya tienen resultados: los grupos y sus resultados no se pueden cambiar.',
    );
  }
}

function requireGroups(scope: CategoryScope) {
  if (!scope.groups) throw new HttpError(409, 'Primero sortea los grupos.');
  return scope.groups;
}
export function getTournament(tournamentId: string): TournamentView {
  return tournamentView(load(tournamentId));
}

/* ---------- Settings ---------- */

/**
 * What the creation wizard and Configuración send: the name plus every setting (flat).
 * Fields marked optional keep their current value when left out (or the default when
 * creating).
 */
export interface SettingsUpdate {
  name: string;
  sport: string;
  format: string;
  modalities: string[];
  categories: string[];
  /** Masculino/Femenino, or Mixto alone. Left out: keeps the current ones. */
  divisions?: string[];
  startDate: string | null;
  endDate: string | null;
  location: string;
  defaultGroupSize: number;
  qualifiersPerGroup?: number;
  seeded: boolean;
  scoring?: Scoring;
  setsPerMatch: number;
  /** Always 11 (fixed); optional, kept for clients that still send it. */
  gamePoints?: number;
  /** Always 2 (fixed); optional, kept for clients that still send it. */
  winMargin?: number;
  knockoutSetsPerMatch: number;
  thirdPlaceMatch?: boolean;
  pointsWin: number;
  pointsLoss: number;
  pointsWalkover: number;
}

/** Settings of a brand-new tournament, before the wizard's values are applied. */
const NEW_TOURNAMENT_SETTINGS: TournamentSettings = {
  sport: 'Tenis de mesa',
  format: 'Grupos + eliminación',
  modalities: ['Individual'],
  categories: [],
  divisions: ['Masculino', 'Femenino'],
  startDate: null,
  endDate: null,
  location: '',
  defaultGroupSize: DEFAULT_GROUP_SIZE,
  qualifiersPerGroup: 2,
  seeded: true,
  groupRules: DEFAULT_RULES,
  knockoutSetsPerMatch: 5,
  thirdPlaceMatch: false,
};

const MAX_TEXT = 100;
const MAX_NAMES = 30;

function text(value: string, label: string, required = false): string {
  const trimmed = value.trim();
  if (required && trimmed === '') throw new HttpError(400, `Escribe ${label}.`);
  if (trimmed.length > MAX_TEXT) {
    throw new HttpError(400, `${label} admite hasta ${String(MAX_TEXT)} caracteres.`);
  }
  return trimmed;
}

/** Divisions by gender: "Masculino" and/or "Femenino", or "Mixto" alone. */
function divisionsOf(values: string[]): Division[] {
  const chosen = DIVISIONS.filter((division) => values.includes(division));
  if (chosen.length === 0 || chosen.length !== new Set(values).size) {
    throw new HttpError(400, 'Elige la rama: Masculino, Femenino o Mixto.');
  }
  if (chosen.includes('Mixto') && chosen.length > 1) {
    throw new HttpError(400, 'La rama Mixto va sola: en ella juegan hombres y mujeres juntos.');
  }
  return chosen;
}

const genderName = (player: Pick<Player, 'gender'>) =>
  player.gender === 'F' ? 'femenino' : player.gender === 'M' ? 'masculino' : 'sin género';

/** A list of catalog names (modalities, categories): trimmed, without repeats, at least one. */
function names(values: string[], label: string): string[] {
  const cleaned = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (cleaned.length === 0) throw new HttpError(400, `Elige al menos una ${label}.`);
  if (cleaned.length > MAX_NAMES || cleaned.some((value) => value.length > MAX_TEXT)) {
    throw new HttpError(400, `Hay demasiadas ${label}s o alguna es demasiado larga.`);
  }
  return cleaned;
}

function intIn(value: number, min: number, max: number, message: string): number {
  if (!Number.isInteger(value) || value < min || value > max) throw new HttpError(400, message);
  return value;
}

function isoDate(value: string | null, label: string): string | null {
  if (value === null || value.trim() === '') return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime())) {
    throw new HttpError(400, `La ${label} no es una fecha válida (AAAA-MM-DD).`);
  }
  if (date.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, `La ${label} no existe en el calendario.`);
  }
  return value;
}

function bestOf(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1 || value > 9 || value % 2 === 0) {
    throw new HttpError(400, `${label}: los partidos son al mejor de 1, 3, 5, 7 o 9 sets.`);
  }
  return value;
}

/**
 * Checks every setting and returns the tournament's new name and settings. Match rules
 * (sets per match, scoring mode, points per set, margin) can't change once results are
 * entered, since they decide who won each match already played.
 */
function checkedSettings(
  tournament: Tournament,
  update: SettingsUpdate,
): { name: string; settings: TournamentSettings } {
  const current = tournament.settings;

  const name = text(update.name, 'el nombre del torneo', true);
  const startDate = isoDate(update.startDate, 'fecha de inicio');
  if (startDate === null) throw new HttpError(400, 'Elige la fecha de inicio.');
  const endDate = isoDate(update.endDate, 'fecha de fin');
  if (endDate && endDate < startDate) {
    throw new HttpError(400, 'La fecha de fin no puede ser anterior a la de inicio.');
  }

  const defaultGroupSize = intIn(
    update.defaultGroupSize,
    MIN_GROUP_SIZE,
    MAX_GROUP_SIZE,
    `Los grupos deben ser de ${String(MIN_GROUP_SIZE)} a ${String(MAX_GROUP_SIZE)} jugadores.`,
  );
  const qualifiersPerGroup = update.qualifiersPerGroup ?? current.qualifiersPerGroup;
  if (qualifiersPerGroup !== 1 && qualifiersPerGroup !== 2) {
    throw new HttpError(400, 'Clasifican 1 o 2 jugadores por grupo.');
  }
  if (
    qualifiersPerGroup !== current.qualifiersPerGroup &&
    anyCategory(tournament, knockoutStarted)
  ) {
    throw new HttpError(
      409,
      'Las llaves ya tienen resultados: los clasificados por grupo no se pueden cambiar.',
    );
  }

  // "points" or "sets" (the controller already checked it).
  const scoring = update.scoring ?? current.groupRules.scoring;
  const setsPerMatch = bestOf(update.setsPerMatch, 'Fase de grupos');
  const knockoutSetsPerMatch = bestOf(update.knockoutSetsPerMatch, 'Llaves');
  // Fixed by the rules of table tennis: sets to 11 with a 2-point lead. They may be left
  // out; sent, they must be those.
  const { gamePoints, winMargin } = DEFAULT_RULES;
  if (
    (update.gamePoints !== undefined && update.gamePoints !== gamePoints) ||
    (update.winMargin !== undefined && update.winMargin !== winMargin)
  ) {
    throw new HttpError(
      400,
      `Los sets son a ${String(gamePoints)} puntos con ${String(winMargin)} de diferencia (regla del tenis de mesa): no se pueden cambiar.`,
    );
  }

  const pointsWin = intIn(update.pointsWin, 0, 99, 'Los puntos por victoria van de 0 a 99.');
  const pointsLoss = intIn(update.pointsLoss, 0, 99, 'Los puntos por derrota van de 0 a 99.');
  const pointsWalkover = intIn(update.pointsWalkover, 0, 99, 'Los puntos por W.O. van de 0 a 99.');
  if (pointsWin <= pointsLoss) {
    throw new HttpError(400, 'La victoria debe dar más puntos que la derrota.');
  }
  if (pointsWalkover > pointsLoss) {
    throw new HttpError(400, 'El W.O. no puede dar más puntos que una derrota jugada.');
  }

  const rules = current.groupRules;
  const rulesChanged = setsPerMatch !== rules.setsPerMatch || scoring !== rules.scoring;
  if (
    rulesChanged &&
    anyCategory(tournament, (scope) => hasResults(scope) || knockoutStarted(scope))
  ) {
    throw new HttpError(
      409,
      'Ya hay resultados cargados: los sets por partido y la forma de cargar resultados no se pueden cambiar.',
    );
  }
  if (
    knockoutSetsPerMatch !== current.knockoutSetsPerMatch &&
    anyCategory(tournament, knockoutStarted)
  ) {
    throw new HttpError(
      409,
      'Las llaves ya tienen resultados: los sets por partido de las llaves no se pueden cambiar.',
    );
  }

  const thirdPlaceMatch = update.thirdPlaceMatch ?? current.thirdPlaceMatch;
  if (thirdPlaceMatch !== current.thirdPlaceMatch && anyCategory(tournament, thirdPlaceStarted)) {
    throw new HttpError(
      409,
      'El partido por el 3.er puesto ya tiene resultados: bórralos para quitarlo.',
    );
  }

  const categories = names(update.categories, 'categoría');
  const divisions = divisionsOf(update.divisions ?? current.divisions);
  // Every competition that goes away must have nothing drawn, and every player must still
  // have a competition (their category, and their gender's division unless it is mixed).
  const next = { ...current, categories, divisions };
  const keys = new Set(competitionsOf(next).map((competition) => competition.key));
  for (const scope of allScopes(tournament)) {
    if (!keys.has(scope.category) && scope.groups) {
      throw new HttpError(
        409,
        `«${scope.category}» ya tiene grupos sorteados: no se puede quitar esa categoría o rama.`,
      );
    }
  }
  const homeless = tournament.players.find((player) => !competitionOfPlayer(next, player));
  if (homeless) {
    throw new HttpError(
      409,
      `${homeless.name} (${homeless.category ?? 'sin categoría'}, ${genderName(homeless)}) se quedaría sin competencia: elimínalo o cámbialo antes de quitar esa categoría o rama.`,
    );
  }
  return {
    name,
    settings: {
      sport: text(update.sport, 'el deporte', true),
      format: text(update.format, 'el formato', true),
      modalities: names(update.modalities, 'modalidad'),
      categories,
      divisions,
      startDate,
      endDate,
      location: text(update.location, 'El lugar'),
      defaultGroupSize,
      qualifiersPerGroup,
      seeded: update.seeded,
      groupRules: {
        setsPerMatch,
        scoring,
        gamePoints,
        winMargin,
        points: { win: pointsWin, loss: pointsLoss, walkover: pointsWalkover },
      },
      knockoutSetsPerMatch,
      thirdPlaceMatch,
    },
  };
}

/** Saves Configuración (see checkedSettings for what can't change once there are results). */
export function updateSettings(tournamentId: string, update: SettingsUpdate): TournamentView {
  const tournament = load(tournamentId);
  const previous = tournament.settings;
  const { name, settings } = checkedSettings(tournament, update);
  tournament.name = name;
  tournament.settings = settings;

  // Competitions taken out (with nothing drawn) lose their (empty) draw.
  const keys = new Set(competitionsOf(settings).map((competition) => competition.key));
  tournament.stages = Object.fromEntries(
    Object.entries(tournament.stages).filter(([key]) => keys.has(key)),
  );
  for (const scope of allScopes(tournament)) {
    // No results yet: empty scoresheets must match the (possibly new) rules.
    const rules = settings.groupRules;
    if (
      rules.setsPerMatch !== previous.groupRules.setsPerMatch ||
      rules.scoring !== previous.groupRules.scoring
    ) {
      scope.results = {};
      scope.knockoutResults = {};
    }
    if (settings.knockoutSetsPerMatch !== previous.knockoutSetsPerMatch) {
      scope.knockoutResults = {};
    }
    // The bracket is drawn for a number of qualifiers: a new number needs a new draw.
    if (settings.qualifiersPerGroup !== previous.qualifiersPerGroup) {
      scope.knockout = null;
      scope.knockoutResults = {};
    }
    // Turned off with nothing entered: drop its (empty) scoresheet, if any.
    const rounds = scope.knockout ? Math.log2(scope.knockout.size) : 0;
    if (!settings.thirdPlaceMatch && rounds >= 2) {
      const key = knockoutMatchKey(rounds - 1, 1);
      scope.knockoutResults = Object.fromEntries(
        Object.entries(scope.knockoutResults).filter(([candidate]) => candidate !== key),
      );
    }
    if (tournament.stages[scope.category]) commitScope(tournament, scope);
  }
  return save(tournament);
}
/** URL-friendly id from the name ("Open Nacional 2026" → "open-nacional-2026"), unique. */
function newTournamentId(name: string): string {
  const base =
    name
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'torneo';
  let id = base;
  for (let copy = 2; findTournament(id); copy++) id = `${base}-${String(copy)}`;
  return id;
}

/** Creates a tournament with every setting from the creation wizard (no players yet). */
export function createTournament(input: SettingsUpdate): TournamentView {
  const draft: Tournament = {
    id: '',
    name: '',
    settings: structuredClone(NEW_TOURNAMENT_SETTINGS),
    players: [],
    stages: {},
  };
  const { name, settings } = checkedSettings(draft, input);
  return save({ ...draft, id: newTournamentId(name), name, settings });
}

/** One line of "Mis torneos". */
export interface TournamentSummary {
  id: string;
  name: string;
  sport: string;
  format: string;
  modalities: string[];
  categories: string[];
  startDate: string | null;
  registered: number;
}

export function listTournaments(): TournamentSummary[] {
  return findAllTournaments().map(({ id, name, settings, players }) => ({
    id,
    name,
    sport: settings.sport,
    format: settings.format,
    modalities: settings.modalities,
    categories: settings.categories,
    startDate: settings.startDate,
    registered: players.length,
  }));
}

export function deleteTournament(tournamentId: string): void {
  if (!removeTournament(tournamentId)) throw new HttpError(404, 'Torneo no encontrado.');
}

/* ---------- Registration ---------- */

function validateNewPlayer(entry: NewPlayer, players: Player[]): void {
  if (entry.name.trim() === '') throw new HttpError(400, 'Escribe el nombre del jugador.');
  // Required by hand ("Independiente" if none); imported lists may still leave it empty.
  if (entry.delegation.trim() === '') {
    throw new HttpError(400, 'Escribe la liga, delegación o club del jugador.');
  }
  if (entry.bib !== undefined) {
    if (!Number.isInteger(entry.bib) || entry.bib < 1) {
      throw new HttpError(400, 'El Nr. debe ser un número entero mayor que 0.');
    }
    const owner = players.find((player) => player.bib === entry.bib);
    if (owner) throw new HttpError(409, `El Nr. ${String(entry.bib)} ya es de ${owner.name}.`);
  }
  if (entry.ranking !== null && (!Number.isInteger(entry.ranking) || entry.ranking < 0)) {
    throw new HttpError(400, 'El ranking debe ser un número entero (0 o más).');
  }
  if (entry.category && entry.category.trim().length > 60) {
    throw new HttpError(400, 'La categoría admite hasta 60 caracteres.');
  }
}

/**
 * The tournament category a player goes to: the one given (it must be the tournament's), or
 * the only one when the tournament has a single category.
 */
function categoryFor(tournament: Tournament, given: string | null | undefined): string {
  const { categories } = tournament.settings;
  const name = given?.trim() ?? '';
  if (name === '') {
    const only = categories.at(0);
    if (categories.length === 1 && only !== undefined) return only;
    throw new HttpError(400, 'Elige la categoría del jugador.');
  }
  if (!categories.includes(name)) {
    throw new HttpError(400, `La categoría «${name}» no es de este torneo.`);
  }
  return name;
}

/**
 * Why a player has no competition in the tournament (their gender's division doesn't exist,
 * or no gender was given), or null when they have one.
 */
function divisionProblem(
  settings: TournamentSettings,
  player: Pick<Player, 'category' | 'gender'>,
): string | null {
  if (settings.divisions.includes('Mixto')) return null;
  if (player.gender === null) return 'falta el género (F o M)';
  const division = player.gender === 'F' ? 'Femenino' : 'Masculino';
  return settings.divisions.includes(division)
    ? null
    : `el torneo no tiene rama ${division.toLowerCase()}`;
}

/** Registers players: there is no limit of places ("cupos"). */
function register(tournament: Tournament, entries: NewPlayer[]): Player[] {
  const assigned: number[] = [];
  const added = entries.map((entry): Player => {
    const bib = entry.bib ?? nextFreeBib(tournament.players, assigned);
    assigned.push(bib);
    return {
      id: crypto.randomUUID(),
      bib,
      name: entry.name.trim(),
      delegation: entry.delegation.trim(),
      ranking: entry.ranking,
      gender: entry.gender ?? null,
      category: categoryFor(tournament, entry.category),
      modalities: entry.modalities ?? { ...INDIVIDUAL_ONLY },
    };
  });
  for (const player of added) {
    const problem = divisionProblem(tournament.settings, player);
    if (problem) throw new HttpError(400, `${player.name}: ${problem}.`);
  }
  // Players added after the draw stay "sin grupo" until placed by hand or redrawn.
  tournament.players = sortByRanking([...tournament.players, ...added]);
  return added;
}

export function addPlayer(
  tournamentId: string,
  entry: NewPlayer,
): { view: TournamentView; added: Player } {
  const tournament = load(tournamentId);
  validateNewPlayer(entry, tournament.players);
  const [added] = register(tournament, [entry]);
  return { view: save(tournament), added };
}

function requirePlayer(tournament: Tournament, playerId: string): Player {
  const player = tournament.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new HttpError(404, 'Jugador no encontrado.');
  return player;
}

/** The group a player is in, in their competition's draw (or null). */
function groupOf(tournament: Tournament, player: Player): string | null {
  const competition = competitionOfPlayer(tournament.settings, player);
  if (!competition) return null;
  const { groups } = scopeOf(tournament, competition.key);
  const place = groups ? locatePlayer(groups, player) : null;
  return groups && place ? (groups[place.groupIndex]?.name ?? null) : null;
}

/**
 * Edits a registered player. Groups hold the same Player objects, so the change shows
 * everywhere; results don't depend on name, Nr. or ranking, so nothing else changes.
 * The category can only change while the player is in no group.
 */
export function updatePlayer(
  tournamentId: string,
  playerId: string,
  entry: NewPlayer & { bib: number },
): TournamentView {
  const tournament = load(tournamentId);
  const player = requirePlayer(tournament, playerId);
  validateNewPlayer(
    entry,
    tournament.players.filter((candidate) => candidate !== player),
  );
  const category =
    entry.category === undefined ? player.category : categoryFor(tournament, entry.category);
  const gender = entry.gender === undefined ? player.gender : entry.gender;
  const problem = divisionProblem(tournament.settings, { category, gender });
  if (problem) throw new HttpError(400, `${player.name}: ${problem}.`);
  // Category and gender decide the competition: it can only change while in no group.
  const from = competitionOfPlayer(tournament.settings, player);
  const to = competitionOfPlayer(tournament.settings, { ...player, category, gender });
  const group = groupOf(tournament, player);
  if (from?.key !== to?.key && group !== null) {
    throw new HttpError(
      409,
      `${player.name} está en el Grupo ${group} de ${from?.key ?? ''}: sácalo del grupo antes de cambiarle la categoría o el género.`,
    );
  } // Gender only changes when sent; modalities stay as imported.
  Object.assign(player, {
    name: entry.name.trim(),
    delegation: entry.delegation.trim(),
    ranking: entry.ranking,
    bib: entry.bib,
    category,
    gender,
  });
  tournament.players = sortByRanking(tournament.players);
  return save(tournament);
}

/**
 * Removes a registered player who isn't in any group (before the draw, or "sin grupo").
 * A player in a group must be taken out first: their group's matches would change.
 */
export function removePlayer(tournamentId: string, playerId: string): TournamentView {
  const tournament = load(tournamentId);
  const player = requirePlayer(tournament, playerId);
  const group = groupOf(tournament, player);
  if (group !== null) {
    throw new HttpError(
      409,
      `${player.name} está en el Grupo ${group}: sácalo del grupo (Grupos → Editar) o vuelve a sortear antes de eliminarlo.`,
    );
  }
  tournament.players = tournament.players.filter((candidate) => candidate !== player);
  return save(tournament);
}

/**
 * Removes every registered player. Not allowed once results are entered in any category;
 * before that, every draw and bracket is removed too, since they no longer have players.
 */
export function removeAllPlayers(tournamentId: string): TournamentView {
  const tournament = load(tournamentId);
  if (anyCategory(tournament, (scope) => hasResults(scope) || knockoutStarted(scope))) {
    throw new HttpError(
      409,
      'Ya hay resultados cargados: no se puede eliminar a todos los jugadores.',
    );
  }
  tournament.players = [];
  tournament.stages = {};
  return save(tournament);
}

/** Where each category of the file goes: a tournament category, or null (not imported). */
export type CategoryMap = Partial<Record<string, string | null>>;

/** A category found in the file and where its players go. */
export interface FileCategory {
  /** As written in the file ("" when the cell is empty). */
  name: string;
  count: number;
  /** Tournament category its players go to; null = not imported (or not assigned yet). */
  target: string | null;
  /** False while it isn't assigned (the import can't go on). */
  assigned: boolean;
}

export interface ImportPreview {
  players: NewPlayer[];
  errors: string[];
  /** Rows without an X in IND. */
  skipped: number;
  /** Players of file categories marked "no importar". */
  skippedByCategory: number;
  fileCategories: FileCategory[];
}

/**
 * How a spreadsheet would be imported, without importing: the individual players read, the
 * file's categories and where each goes (`categoryMap`; a category with the same name as one
 * of the tournament goes there by itself), every problem (rows that can't be read, a number
 * already taken, a category not assigned…) and how many rows are skipped.
 */
export function previewImport(
  tournamentId: string,
  rows: string[][],
  categoryMap: CategoryMap = {},
): ImportPreview {
  const tournament = load(tournamentId);
  const { categories } = tournament.settings;
  const read = readPlayerRows(rows);
  const errors = [...read.errors];

  const counts = new Map<string, number>();
  for (const player of read.players) {
    const name = player.category ?? '';
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const fileCategories = [...counts].map(([name, count]): FileCategory => {
    if (Object.hasOwn(categoryMap, name)) {
      const target = categoryMap[name] ?? null;
      if (target !== null && !categories.includes(target)) {
        throw new HttpError(400, `La categoría «${target}» no es de este torneo.`);
      }
      return { name, count, target, assigned: true };
    }
    // Same name as a tournament category, or no category with a single-category tournament.
    const only = categories.at(0);
    if (categories.includes(name)) return { name, count, target: name, assigned: true };
    if (name === '' && categories.length === 1 && only !== undefined) {
      return { name, count, target: only, assigned: true };
    }
    return { name, count, target: null, assigned: false };
  });
  for (const category of fileCategories.filter((entry) => !entry.assigned)) {
    errors.push(
      `Elige a qué categoría del torneo van los de «${category.name || 'Sin categoría'}» (o «No importar»).`,
    );
  }

  const targetOf = (name: string) =>
    fileCategories.find((category) => category.name === name)?.target ?? null;
  const players: NewPlayer[] = [];
  let skippedByCategory = 0;
  for (const player of read.players) {
    const target = targetOf(player.category ?? '');
    if (target === null) {
      skippedByCategory++;
      continue;
    }
    players.push({ ...player, category: target });
    const problem = divisionProblem(tournament.settings, {
      category: target,
      gender: player.gender ?? null,
    });
    if (problem) errors.push(`${player.name}: ${problem}.`);
    const owner = tournament.players.find((candidate) => candidate.bib === player.bib);
    if (owner) {
      errors.push(`${player.name}: el número ${String(player.bib)} ya es de ${owner.name}.`);
    }
  }
  return { players, errors, skipped: read.skipped, skippedByCategory, fileCategories };
}

export function importPlayers(
  tournamentId: string,
  rows: string[][],
  categoryMap: CategoryMap = {},
): { view: TournamentView; added: Player[] } {
  const tournament = load(tournamentId);
  const { players, errors } = previewImport(tournamentId, rows, categoryMap);
  if (errors.length > 0) {
    throw new HttpError(400, 'Hay problemas por resolver antes de importar.', errors);
  }
  if (players.length === 0) throw new HttpError(400, 'No hay jugadores para importar.');
  const added = register(tournament, players);
  return { view: save(tournament), added };
}
/* ---------- Group stage ---------- */

function validateGroupSize(groupSize: number): void {
  if (!Number.isInteger(groupSize) || groupSize < MIN_GROUP_SIZE || groupSize > MAX_GROUP_SIZE) {
    throw new HttpError(
      400,
      `Los grupos deben ser de ${String(MIN_GROUP_SIZE)} a ${String(MAX_GROUP_SIZE)} jugadores.`,
    );
  }
}

export function previewGroupDraw(
  tournamentId: string,
  category: string,
  groupSize: number,
): DrawPreview {
  validateGroupSize(groupSize);
  const { scope: tournament } = loadScope(tournamentId, category);
  return drawPreview(individualPlayers(tournament.players), groupSize, tournament.settings.seeded);
}

export function drawTournamentGroups(
  tournamentId: string,
  category: string,
  groupSize: number,
): TournamentView {
  const { tournament: owner, scope: tournament } = loadScope(tournamentId, category);
  validateGroupSize(groupSize);
  requireGroupStageOpen(tournament);
  // Only the individual event is drawn for now.
  const players = individualPlayers(tournament.players);
  if (players.length < MIN_GROUP_SIZE) {
    throw new HttpError(
      409,
      `Se necesitan al menos ${String(MIN_GROUP_SIZE)} jugadores en individual.`,
    );
  }
  if (hasResults(tournament)) {
    throw new HttpError(409, 'Ya hay resultados cargados: no se puede volver a sortear.');
  }
  tournament.groups = drawGroups(
    players,
    groupCountFor(players.length, groupSize),
    Math.random,
    tournament.settings.seeded,
  );
  tournament.results = {};
  tournament.knockout = null; // a new group draw invalidates the bracket draw
  tournament.knockoutResults = {};
  return saveScope(owner, tournament);
}

export function setGroupPlayers(
  tournamentId: string,
  category: string,
  groupIndex: number,
  playerIds: string[],
): TournamentView {
  const { tournament: owner, scope: tournament } = loadScope(tournamentId, category);
  const groups = requireGroups(tournament);
  requireGroupStageOpen(tournament);
  if (!Number.isInteger(groupIndex) || groupIndex < 0 || groupIndex >= groups.length) {
    throw new HttpError(404, 'Grupo no encontrado.');
  }
  if (playerIds.length < MIN_GROUP_SIZE || playerIds.length > MAX_GROUP_SIZE) {
    throw new HttpError(
      400,
      `Un grupo necesita entre ${String(MIN_GROUP_SIZE)} y ${String(MAX_GROUP_SIZE)} jugadores.`,
    );
  }
  if (new Set(playerIds).size !== playerIds.length) {
    throw new HttpError(400, 'Un jugador está repetido en el grupo.');
  }
  const players = playerIds.map((id) => {
    const player = tournament.players.find((candidate) => candidate.id === id);
    if (!player) throw new HttpError(400, 'Hay un jugador que no está inscrito en esta categoría.');
    if (!player.modalities.individual) {
      throw new HttpError(400, `${player.name} no juega individual: no puede estar en un grupo.`);
    }
    return player;
  });

  const { groups: next, touched } = replaceGroupPlayers(groups, groupIndex, players);
  tournament.groups = next;
  // Matches of every group touched changed: their results no longer apply.
  tournament.results = Object.fromEntries(
    Object.entries(tournament.results).filter(
      ([key]) => !touched.some((index) => key.startsWith(`${String(index)}-`)),
    ),
  );
  return saveScope(owner, tournament);
}

function requireMatch(tournament: CategoryScope, groupIndex: number, matchIndex: number): string {
  const groups = requireGroups(tournament);
  requireGroupStageOpen(tournament);
  const group = Number.isInteger(groupIndex) ? groups[groupIndex] : undefined;
  if (!group) throw new HttpError(404, 'Grupo no encontrado.');
  if (
    !Number.isInteger(matchIndex) ||
    matchIndex < 0 ||
    matchIndex >= pairingsFor(group.players.length).length
  ) {
    throw new HttpError(404, 'Partido no encontrado.');
  }
  return matchKey(groupIndex, matchIndex);
}

export function updateSet(
  tournamentId: string,
  category: string,
  groupIndex: number,
  matchIndex: number,
  setIndex: number,
  side: 0 | 1,
  value: number | null,
): TournamentView {
  const { tournament: owner, scope: tournament } = loadScope(tournamentId, category);
  const key = requireMatch(tournament, groupIndex, matchIndex);
  tournament.results = withSet(
    tournament.results,
    key,
    tournament.settings.groupRules,
    setIndex,
    side,
    value,
  );
  return saveScope(owner, tournament);
}

/** Final score of a group match in sets ("3-1"), when the tournament is scored by sets. */
export function updateScore(
  tournamentId: string,
  category: string,
  groupIndex: number,
  matchIndex: number,
  side: 0 | 1,
  value: number | null,
): TournamentView {
  const { tournament: owner, scope: tournament } = loadScope(tournamentId, category);
  const key = requireMatch(tournament, groupIndex, matchIndex);
  tournament.results = withScore(
    tournament.results,
    key,
    tournament.settings.groupRules,
    side,
    value,
  );
  return saveScope(owner, tournament);
}

/** Results with one set score changed (shared by group and knockout matches). */
function withSet(
  results: Results,
  key: string,
  rules: GroupRules,
  setIndex: number,
  side: 0 | 1,
  value: number | null,
): Results {
  const { setsPerMatch } = rules;
  if (rules.scoring === 'sets') {
    throw new HttpError(409, 'Este torneo se carga solo con el marcador final en sets (3-1).');
  }
  if (!Number.isInteger(setIndex) || setIndex < 0 || setIndex >= setsPerMatch) {
    throw new HttpError(404, 'Set no encontrado.');
  }
  if (value !== null && (!Number.isInteger(value) || value < 0 || value > 999)) {
    throw new HttpError(400, 'Los puntos de un set van de 0 a 999.');
  }
  const current: MatchResult = results[key] ?? {
    sets: emptySets({ ...DEFAULT_RULES, setsPerMatch }),
  };
  if (current.walkover !== undefined) {
    throw new HttpError(409, 'El partido está marcado como W.O.: deshazlo para cargar sets.');
  }
  return {
    ...results,
    [key]: {
      ...current,
      sets: current.sets.map((set, index) => {
        if (index !== setIndex) return set;
        return side === 0 ? [value, set[1]] : [set[0], value];
      }),
    },
  };
}

/** Results with one side of the final score in sets changed (scoring "sets"). */
function withScore(
  results: Results,
  key: string,
  rules: GroupRules,
  side: 0 | 1,
  value: number | null,
): Results {
  if (rules.scoring !== 'sets') {
    throw new HttpError(409, 'Este torneo se carga con los puntos de cada set.');
  }
  const toWin = setsToWin(rules);
  if (value !== null && (!Number.isInteger(value) || value < 0 || value > toWin)) {
    throw new HttpError(
      400,
      `Al mejor de ${String(rules.setsPerMatch)}, los sets ganados van de 0 a ${String(toWin)}.`,
    );
  }
  const current: MatchResult = results[key] ?? { sets: emptySets(rules) };
  if (current.walkover !== undefined) {
    throw new HttpError(
      409,
      'El partido está marcado como W.O.: deshazlo para cargar el marcador.',
    );
  }
  const score = current.score ?? [null, null];
  return {
    ...results,
    [key]: { ...current, score: side === 0 ? [value, score[1]] : [score[0], value] },
  };
}

/** Results with a walkover set (absent side) or undone (null): either way the sets start empty. */
function withWalkover(
  results: Results,
  key: string,
  setsPerMatch: number,
  absent: 0 | 1 | null,
): Results {
  const sets = emptySets({ ...DEFAULT_RULES, setsPerMatch });
  return { ...results, [key]: absent === null ? { sets } : { sets, walkover: absent } };
}

/** Marks who didn't show up (the other wins by W.O.); null undoes it. */
export function setWalkover(
  tournamentId: string,
  category: string,
  groupIndex: number,
  matchIndex: number,
  absent: 0 | 1 | null,
): TournamentView {
  const { tournament: owner, scope: tournament } = loadScope(tournamentId, category);
  const key = requireMatch(tournament, groupIndex, matchIndex);
  // A walkover replaces any sets entered; undoing it starts from an empty scoresheet.
  tournament.results = withWalkover(
    tournament.results,
    key,
    tournament.settings.groupRules.setsPerMatch,
    absent,
  );
  return saveScope(owner, tournament);
}

/* ---------- Knockout ---------- */

function requireKnockoutNotStarted(tournament: CategoryScope): void {
  if (knockoutStarted(tournament)) {
    throw new HttpError(
      409,
      'Las llaves ya tienen resultados: no se puede volver a sortear ni mover posiciones.',
    );
  }
}

export function drawTournamentKnockout(tournamentId: string, category: string): TournamentView {
  const { tournament: owner, scope: tournament } = loadScope(tournamentId, category);
  const groups = requireGroups(tournament);
  if (groups.length === 1) {
    throw new HttpError(
      409,
      'Es un grupo único: no hay llaves, la tabla del grupo es el resultado final.',
    );
  }
  requireKnockoutNotStarted(tournament);
  // Qualifiers already known are kept apart from their delegation in the first round.
  tournament.knockout = drawKnockout(
    groups.length,
    Math.random,
    slotPlayerOf(tournament),
    tournament.settings.qualifiersPerGroup,
  );
  tournament.knockoutResults = {};
  return saveScope(owner, tournament);
}

export function moveKnockoutSlot(
  tournamentId: string,
  category: string,
  position: number,
  slot: BracketSlot,
): TournamentView {
  const { tournament: owner, scope: tournament } = loadScope(tournamentId, category);
  const groups = requireGroups(tournament);
  const { knockout } = tournament;
  if (!knockout) throw new HttpError(409, 'Primero sortea o arma las llaves.');
  requireKnockoutNotStarted(tournament);
  if (!Number.isInteger(position) || position < 1 || position > knockout.size) {
    throw new HttpError(404, 'Posición fuera del cuadro.');
  }
  if (slot.kind === 'qualifier') {
    if (
      !Number.isInteger(slot.groupIndex) ||
      slot.groupIndex < 0 ||
      slot.groupIndex >= groups.length
    ) {
      throw new HttpError(400, 'Ese grupo no existe.');
    }
    if (slot.place > tournament.settings.qualifiersPerGroup) {
      throw new HttpError(400, 'En este torneo solo clasifica el 1.º de cada grupo.');
    }
  } else if (!knockout.slots.some((candidate) => candidate.kind === 'bye')) {
    throw new HttpError(400, 'Este cuadro no tiene byes.');
  }
  tournament.knockout = moveSlot(knockout, position, slot);
  return saveScope(owner, tournament);
}

/**
 * Checks a knockout match can take results: it exists, both players are known, and its
 * winner hasn't played the next match yet (changing it would change who is there).
 */
function requireKnockoutMatch(tournament: CategoryScope, round: number, index: number): string {
  const played = knockoutRoundsOf(tournament);
  if (!tournament.knockout || !played) {
    throw new HttpError(409, 'Primero sortea o arma las llaves.');
  }
  const match =
    Number.isInteger(round) && Number.isInteger(index)
      ? knockoutMatchAt(played, round, index)
      : undefined;
  if (!match) throw new HttpError(404, 'Partido de llaves no encontrado.');
  if (!match.playable) {
    const bye = match.entrants.some((entrant) => entrant.kind === 'bye');
    throw new HttpError(
      409,
      bye
        ? 'En este cruce hay un bye: el jugador pasa directo, no hay partido.'
        : 'Este partido aún no tiene a sus dos jugadores definidos.',
    );
  }
  if (knockoutMatchLocked(played, round, index)) {
    throw new HttpError(
      409,
      'Ya hay resultados en el partido siguiente (o en el del 3.er puesto): bórralos primero para cambiar este.',
    );
  }
  return knockoutMatchKey(round, index);
}

export function updateKnockoutSet(
  tournamentId: string,
  category: string,
  round: number,
  index: number,
  setIndex: number,
  side: 0 | 1,
  value: number | null,
): TournamentView {
  const { tournament: owner, scope: tournament } = loadScope(tournamentId, category);
  const key = requireKnockoutMatch(tournament, round, index);
  tournament.knockoutResults = withSet(
    tournament.knockoutResults,
    key,
    knockoutRulesOf(tournament),
    setIndex,
    side,
    value,
  );
  return saveScope(owner, tournament);
}

export function updateKnockoutScore(
  tournamentId: string,
  category: string,
  round: number,
  index: number,
  side: 0 | 1,
  value: number | null,
): TournamentView {
  const { tournament: owner, scope: tournament } = loadScope(tournamentId, category);
  const key = requireKnockoutMatch(tournament, round, index);
  tournament.knockoutResults = withScore(
    tournament.knockoutResults,
    key,
    knockoutRulesOf(tournament),
    side,
    value,
  );
  return saveScope(owner, tournament);
}

export function setKnockoutWalkover(
  tournamentId: string,
  category: string,
  round: number,
  index: number,
  absent: 0 | 1 | null,
): TournamentView {
  const { tournament: owner, scope: tournament } = loadScope(tournamentId, category);
  const key = requireKnockoutMatch(tournament, round, index);
  tournament.knockoutResults = withWalkover(
    tournament.knockoutResults,
    key,
    knockoutRulesOf(tournament).setsPerMatch,
    absent,
  );
  return saveScope(owner, tournament);
}
