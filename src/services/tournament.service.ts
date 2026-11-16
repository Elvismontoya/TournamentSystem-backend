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
import {
  nextFreeBib,
  parsePlayerList,
  sortByRanking,
  type NewPlayer,
  type Player,
} from '../domain/players.ts';
import { HttpError } from '../httpError.ts';
import type { Tournament, TournamentSettings } from '../models/tournament.ts';
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

function hasResults(tournament: Tournament): boolean {
  return anyResults(tournament.results);
}

function knockoutStarted(tournament: Tournament): boolean {
  return anyResults(tournament.knockoutResults);
}

function thirdPlaceStarted(tournament: Tournament): boolean {
  return knockoutRoundsOf(tournament)?.thirdPlace?.summary.started ?? false;
}

/** Once the bracket has results, the groups (who qualified) must stay as they are. */
function requireGroupStageOpen(tournament: Tournament): void {
  if (knockoutStarted(tournament)) {
    throw new HttpError(
      409,
      'Las llaves ya tienen resultados: los grupos y sus resultados no se pueden cambiar.',
    );
  }
}

function requireGroups(tournament: Tournament) {
  if (!tournament.groups) throw new HttpError(409, 'Primero sortea los grupos.');
  return tournament.groups;
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
  startDate: string | null;
  endDate: string | null;
  location: string;
  defaultGroupSize: number;
  qualifiersPerGroup?: number;
  seeded: boolean;
  scoring?: Scoring;
  setsPerMatch: number;
  gamePoints: number;
  winMargin: number;
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
  if (qualifiersPerGroup !== current.qualifiersPerGroup && knockoutStarted(tournament)) {
    throw new HttpError(
      409,
      'Las llaves ya tienen resultados: los clasificados por grupo no se pueden cambiar.',
    );
  }

  // "points" or "sets" (the controller already checked it).
  const scoring = update.scoring ?? current.groupRules.scoring;
  const setsPerMatch = bestOf(update.setsPerMatch, 'Fase de grupos');
  const knockoutSetsPerMatch = bestOf(update.knockoutSetsPerMatch, 'Llaves');
  const gamePoints = intIn(update.gamePoints, 1, 99, 'Los puntos por set van de 1 a 99.');
  const winMargin = intIn(
    update.winMargin,
    1,
    Math.min(10, gamePoints),
    'La diferencia mínima va de 1 a 10 y no puede superar los puntos por set.',
  );

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
  const rulesChanged =
    setsPerMatch !== rules.setsPerMatch ||
    scoring !== rules.scoring ||
    gamePoints !== rules.gamePoints ||
    winMargin !== rules.winMargin;
  if (rulesChanged && (hasResults(tournament) || knockoutStarted(tournament))) {
    throw new HttpError(
      409,
      'Ya hay resultados cargados: los sets por partido, la forma de cargar resultados, los puntos por set y la diferencia mínima no se pueden cambiar.',
    );
  }
  if (knockoutSetsPerMatch !== current.knockoutSetsPerMatch && knockoutStarted(tournament)) {
    throw new HttpError(
      409,
      'Las llaves ya tienen resultados: los sets por partido de las llaves no se pueden cambiar.',
    );
  }

  const thirdPlaceMatch = update.thirdPlaceMatch ?? current.thirdPlaceMatch;
  if (thirdPlaceMatch !== current.thirdPlaceMatch && thirdPlaceStarted(tournament)) {
    throw new HttpError(
      409,
      'El partido por el 3.er puesto ya tiene resultados: bórralos para quitarlo.',
    );
  }

  return {
    name,
    settings: {
      sport: text(update.sport, 'el deporte', true),
      format: text(update.format, 'el formato', true),
      modalities: names(update.modalities, 'modalidad'),
      categories: names(update.categories, 'categoría'),
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

  // No results yet: empty scoresheets must match the (possibly new) rules.
  const rules = settings.groupRules;
  if (
    rules.setsPerMatch !== previous.groupRules.setsPerMatch ||
    rules.scoring !== previous.groupRules.scoring
  ) {
    tournament.results = {};
    tournament.knockoutResults = {};
  }
  if (settings.knockoutSetsPerMatch !== previous.knockoutSetsPerMatch) {
    tournament.knockoutResults = {};
  }
  // The bracket is drawn for a number of qualifiers: a new number needs a new draw.
  if (settings.qualifiersPerGroup !== previous.qualifiersPerGroup) {
    tournament.knockout = null;
    tournament.knockoutResults = {};
  }
  // Turned off with nothing entered: drop its (empty) scoresheet, if any.
  const rounds = tournament.knockout ? Math.log2(tournament.knockout.size) : 0;
  if (!settings.thirdPlaceMatch && rounds >= 2) {
    const key = knockoutMatchKey(rounds - 1, 1);
    tournament.knockoutResults = Object.fromEntries(
      Object.entries(tournament.knockoutResults).filter(([candidate]) => candidate !== key),
    );
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
    groups: null,
    results: {},
    knockout: null,
    knockoutResults: {},
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
    };
  });
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

/**
 * Edits a registered player. Groups hold the same Player objects, so the change shows
 * everywhere; results don't depend on name, Nr. or ranking, so nothing else changes.
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
  Object.assign(player, {
    name: entry.name.trim(),
    delegation: entry.delegation.trim(),
    ranking: entry.ranking,
    bib: entry.bib,
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
  const place = tournament.groups ? locatePlayer(tournament.groups, player) : null;
  if (tournament.groups && place) {
    const group = tournament.groups[place.groupIndex];
    throw new HttpError(
      409,
      `${player.name} está en el Grupo ${group.name}: sácalo del grupo (Grupos → Editar) o vuelve a sortear antes de eliminarlo.`,
    );
  }
  tournament.players = tournament.players.filter((candidate) => candidate !== player);
  return save(tournament);
}

/**
 * Removes every registered player. Not allowed once results are entered; before that, the
 * group draw and the bracket (if any) are removed too, since they no longer have players.
 */
export function removeAllPlayers(tournamentId: string): TournamentView {
  const tournament = load(tournamentId);
  if (hasResults(tournament) || knockoutStarted(tournament)) {
    throw new HttpError(
      409,
      'Ya hay resultados cargados: no se puede eliminar a todos los jugadores.',
    );
  }
  tournament.players = [];
  tournament.groups = null;
  tournament.results = {};
  tournament.knockout = null;
  tournament.knockoutResults = {};
  return save(tournament);
}

/**
 * Header row ("Nombre, Delegación, Ranking") is skipped if present. It is blanked rather than
 * removed, so error messages keep the line numbers the user sees.
 */
function withoutHeader(text: string): string {
  const [first = '', ...rest] = text.split(/\r?\n/);
  return /^\s*nombre\b/i.test(first) ? ['', ...rest].join('\n') : text;
}

export function previewImport(text: string): { players: NewPlayer[]; errors: string[] } {
  return parsePlayerList(withoutHeader(text));
}

export function importPlayers(
  tournamentId: string,
  text: string,
): { view: TournamentView; added: Player[] } {
  const tournament = load(tournamentId);
  const { players, errors } = previewImport(text);
  if (errors.length > 0) {
    throw new HttpError(400, 'Hay líneas que no se pudieron leer.', errors);
  }
  if (players.length === 0) throw new HttpError(400, 'La lista está vacía.');
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

export function previewGroupDraw(tournamentId: string, groupSize: number): DrawPreview {
  validateGroupSize(groupSize);
  const tournament = load(tournamentId);
  return drawPreview(tournament.players, groupSize, tournament.settings.seeded);
}

export function drawTournamentGroups(tournamentId: string, groupSize: number): TournamentView {
  const tournament = load(tournamentId);
  validateGroupSize(groupSize);
  requireGroupStageOpen(tournament);
  if (tournament.players.length < MIN_GROUP_SIZE) {
    throw new HttpError(409, `Se necesitan al menos ${String(MIN_GROUP_SIZE)} jugadores.`);
  }
  if (hasResults(tournament)) {
    throw new HttpError(409, 'Ya hay resultados cargados: no se puede volver a sortear.');
  }
  tournament.groups = drawGroups(
    tournament.players,
    groupCountFor(tournament.players.length, groupSize),
    Math.random,
    tournament.settings.seeded,
  );
  tournament.results = {};
  tournament.knockout = null; // a new group draw invalidates the bracket draw
  tournament.knockoutResults = {};
  return save(tournament);
}

export function setGroupPlayers(
  tournamentId: string,
  groupIndex: number,
  playerIds: string[],
): TournamentView {
  const tournament = load(tournamentId);
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
    if (!player) throw new HttpError(400, 'Hay un jugador que no está inscrito.');
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
  return save(tournament);
}

function requireMatch(tournament: Tournament, groupIndex: number, matchIndex: number): string {
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
  groupIndex: number,
  matchIndex: number,
  setIndex: number,
  side: 0 | 1,
  value: number | null,
): TournamentView {
  const tournament = load(tournamentId);
  const key = requireMatch(tournament, groupIndex, matchIndex);
  tournament.results = withSet(
    tournament.results,
    key,
    tournament.settings.groupRules,
    setIndex,
    side,
    value,
  );
  return save(tournament);
}

/** Final score of a group match in sets ("3-1"), when the tournament is scored by sets. */
export function updateScore(
  tournamentId: string,
  groupIndex: number,
  matchIndex: number,
  side: 0 | 1,
  value: number | null,
): TournamentView {
  const tournament = load(tournamentId);
  const key = requireMatch(tournament, groupIndex, matchIndex);
  tournament.results = withScore(
    tournament.results,
    key,
    tournament.settings.groupRules,
    side,
    value,
  );
  return save(tournament);
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
  groupIndex: number,
  matchIndex: number,
  absent: 0 | 1 | null,
): TournamentView {
  const tournament = load(tournamentId);
  const key = requireMatch(tournament, groupIndex, matchIndex);
  // A walkover replaces any sets entered; undoing it starts from an empty scoresheet.
  tournament.results = withWalkover(
    tournament.results,
    key,
    tournament.settings.groupRules.setsPerMatch,
    absent,
  );
  return save(tournament);
}

/* ---------- Knockout ---------- */

function requireKnockoutNotStarted(tournament: Tournament): void {
  if (knockoutStarted(tournament)) {
    throw new HttpError(
      409,
      'Las llaves ya tienen resultados: no se puede volver a sortear ni mover posiciones.',
    );
  }
}

export function drawTournamentKnockout(tournamentId: string): TournamentView {
  const tournament = load(tournamentId);
  const groups = requireGroups(tournament);
  requireKnockoutNotStarted(tournament);
  // Qualifiers already known are kept apart from their delegation in the first round.
  tournament.knockout = drawKnockout(
    groups.length,
    Math.random,
    slotPlayerOf(tournament),
    tournament.settings.qualifiersPerGroup,
  );
  tournament.knockoutResults = {};
  return save(tournament);
}

export function moveKnockoutSlot(
  tournamentId: string,
  position: number,
  slot: BracketSlot,
): TournamentView {
  const tournament = load(tournamentId);
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
  return save(tournament);
}

/**
 * Checks a knockout match can take results: it exists, both players are known, and its
 * winner hasn't played the next match yet (changing it would change who is there).
 */
function requireKnockoutMatch(tournament: Tournament, round: number, index: number): string {
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
  round: number,
  index: number,
  setIndex: number,
  side: 0 | 1,
  value: number | null,
): TournamentView {
  const tournament = load(tournamentId);
  const key = requireKnockoutMatch(tournament, round, index);
  tournament.knockoutResults = withSet(
    tournament.knockoutResults,
    key,
    knockoutRulesOf(tournament),
    setIndex,
    side,
    value,
  );
  return save(tournament);
}

export function updateKnockoutScore(
  tournamentId: string,
  round: number,
  index: number,
  side: 0 | 1,
  value: number | null,
): TournamentView {
  const tournament = load(tournamentId);
  const key = requireKnockoutMatch(tournament, round, index);
  tournament.knockoutResults = withScore(
    tournament.knockoutResults,
    key,
    knockoutRulesOf(tournament),
    side,
    value,
  );
  return save(tournament);
}

export function setKnockoutWalkover(
  tournamentId: string,
  round: number,
  index: number,
  absent: 0 | 1 | null,
): TournamentView {
  const tournament = load(tournamentId);
  const key = requireKnockoutMatch(tournament, round, index);
  tournament.knockoutResults = withWalkover(
    tournament.knockoutResults,
    key,
    knockoutRulesOf(tournament).setsPerMatch,
    absent,
  );
  return save(tournament);
}
