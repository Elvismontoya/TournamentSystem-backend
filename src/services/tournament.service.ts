// Tournament actions: validate, apply the rules (domain/) and save (repositories/).
// Every action returns the updated view, so the frontend always shows the server's state.

import {
  drawGroups,
  emptySets,
  groupCountFor,
  matchKey,
  MAX_GROUP_SIZE,
  MIN_GROUP_SIZE,
  pairingsFor,
  replaceGroupPlayers,
  SETS_PER_MATCH,
  type MatchResult,
} from '../domain/groupStage.ts';
import { drawKnockout, moveSlot, type BracketSlot } from '../domain/knockout.ts';
import {
  nextFreeBib,
  parsePlayerList,
  sortByRanking,
  type NewPlayer,
  type Player,
} from '../domain/players.ts';
import { HttpError } from '../httpError.ts';
import type { Tournament } from '../models/tournament.ts';
import { findTournament, saveTournament } from '../repositories/tournament.repository.ts';
import {
  drawPreview,
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
  return Object.values(tournament.results).some(
    (result) =>
      result?.walkover !== undefined ||
      result?.sets.some(([first, second]) => first !== null || second !== null),
  );
}

function requireGroups(tournament: Tournament) {
  if (!tournament.groups) throw new HttpError(409, 'Primero sortea los grupos.');
  return tournament.groups;
}

export function getTournament(tournamentId: string): TournamentView {
  return tournamentView(load(tournamentId));
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

function register(tournament: Tournament, entries: NewPlayer[]): Player[] {
  const remaining = tournament.capacity - tournament.players.length;
  if (entries.length > remaining) {
    throw new HttpError(
      409,
      remaining === 0
        ? 'No quedan cupos.'
        : `Solo quedan ${String(remaining)} cupos y se quieren inscribir ${String(entries.length)}.`,
    );
  }
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
  return drawPreview(load(tournamentId).players, groupSize);
}

export function drawTournamentGroups(tournamentId: string, groupSize: number): TournamentView {
  const tournament = load(tournamentId);
  validateGroupSize(groupSize);
  if (tournament.players.length < MIN_GROUP_SIZE) {
    throw new HttpError(409, `Se necesitan al menos ${String(MIN_GROUP_SIZE)} jugadores.`);
  }
  if (hasResults(tournament)) {
    throw new HttpError(409, 'Ya hay resultados cargados: no se puede volver a sortear.');
  }
  tournament.groups = drawGroups(
    tournament.players,
    groupCountFor(tournament.players.length, groupSize),
  );
  tournament.results = {};
  tournament.knockout = null; // a new group draw invalidates the bracket draw
  return save(tournament);
}

export function setGroupPlayers(
  tournamentId: string,
  groupIndex: number,
  playerIds: string[],
): TournamentView {
  const tournament = load(tournamentId);
  const groups = requireGroups(tournament);
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
  if (!Number.isInteger(setIndex) || setIndex < 0 || setIndex >= SETS_PER_MATCH) {
    throw new HttpError(404, 'Set no encontrado.');
  }
  if (value !== null && (!Number.isInteger(value) || value < 0 || value > 99)) {
    throw new HttpError(400, 'Los puntos de un set van de 0 a 99.');
  }
  const current: MatchResult = tournament.results[key] ?? { sets: emptySets() };
  if (current.walkover !== undefined) {
    throw new HttpError(409, 'El partido está marcado como W.O.: deshazlo para cargar sets.');
  }
  tournament.results = {
    ...tournament.results,
    [key]: {
      ...current,
      sets: current.sets.map((set, index) => {
        if (index !== setIndex) return set;
        return side === 0 ? [value, set[1]] : [set[0], value];
      }),
    },
  };
  return save(tournament);
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
  tournament.results = {
    ...tournament.results,
    [key]: absent === null ? { sets: emptySets() } : { sets: emptySets(), walkover: absent },
  };
  return save(tournament);
}

/* ---------- Knockout ---------- */

export function drawTournamentKnockout(tournamentId: string): TournamentView {
  const tournament = load(tournamentId);
  const groups = requireGroups(tournament);
  tournament.knockout = drawKnockout(groups.length);
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
  } else if (!knockout.slots.some((candidate) => candidate.kind === 'bye')) {
    throw new HttpError(400, 'Este cuadro no tiene byes.');
  }
  tournament.knockout = moveSlot(knockout, position, slot);
  return save(tournament);
}
