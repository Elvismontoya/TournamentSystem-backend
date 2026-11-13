// Group stage rules (table tennis): draw, match order, set/match results, standings and
// ITTF tie-breaks, manual group changes. Pure functions: no UI, no database, no HTTP.
// Used today by the frontend (in memory); meant to become part of the backend services.

import { sortByRanking, type Player } from './players.ts';

export interface Group {
  name: string;
  /** Index + 1 is the player's number inside the group (1 = seeded player). */
  players: Player[];
}

/** Points of one set: [first player, second player]; null = not entered yet. */
export type SetScore = [number | null, number | null];

/** What was entered for one match. */
export interface MatchResult {
  sets: SetScore[];
  /** Side (0 = first player, 1 = second) that didn't show up: the other wins by walkover. */
  walkover?: 0 | 1;
}

/** Results per match, keyed by matchKey(). */
export type Results = Partial<Record<string, MatchResult>>;

/** A match inside a group: indexes of the two players (0 = player 1). */
export type Pairing = readonly [number, number];

export const MIN_GROUP_SIZE = 3;
export const MAX_GROUP_SIZE = 6;
/** Players per group suggested when drawing (and used to pick seeds before the draw). */
export const DEFAULT_GROUP_SIZE = 4;

/** Group of 3: 1-3, 1-2, 2-3. */
const ORDER_3: readonly Pairing[] = [
  [0, 2],
  [0, 1],
  [1, 2],
];

/** Group of 4 (organizer's order): 1-3, 2-4, 1-2, 3-4, 1-4, 2-3. */
const ORDER_4: readonly Pairing[] = [
  [0, 2],
  [1, 3],
  [0, 1],
  [2, 3],
  [0, 3],
  [1, 2],
];

/** Round-robin by the circle method (Berger tables), one round after another. */
function bergerPairings(size: number): Pairing[] {
  const slots = size % 2 === 0 ? size : size + 1; // odd sizes get a bye slot
  const order = Array.from({ length: slots }, (_, index) => index);
  const pairs: Pairing[] = [];
  for (let round = 0; round < slots - 1; round++) {
    for (let index = 0; index < slots / 2; index++) {
      const a = order[index] ?? 0;
      const b = order[slots - 1 - index] ?? 0;
      if (a < size && b < size) pairs.push(a < b ? [a, b] : [b, a]);
    }
    const last = order.pop();
    if (last !== undefined) order.splice(1, 0, last); // keep the first fixed, rotate the rest
  }
  return pairs;
}

/** Match order for a group of `size` players (3-6). */
export function pairingsFor(size: number): readonly Pairing[] {
  if (size === 3) return ORDER_3;
  if (size === 4) return ORDER_4;
  return bergerPairings(size);
}

/**
 * How many groups to make for a chosen group size. No group is bigger than the chosen
 * size: when it doesn't divide exactly, some groups get one player less. Only if that
 * would leave groups under the minimum (3) do some groups get one more instead.
 * E.g. 16 players: size 3 → 5 groups (4,3,3,3,3); 4 → 4 (4,4,4,4); 5 → 4 (4,4,4,4);
 * 6 → 3 (6,5,5).
 */
export function groupCountFor(players: number, size: number): number {
  const notBigger = Math.max(1, Math.ceil(players / size));
  if (Math.floor(players / notBigger) >= MIN_GROUP_SIZE) return notBigger;
  return Math.max(1, Math.floor(players / size));
}

/** Sizes of each group when `players` are dealt into `groupCount` groups. */
export function groupSizes(players: number, groupCount: number): number[] {
  const base = Math.floor(players / groupCount);
  const extra = players % groupCount;
  return Array.from({ length: groupCount }, (_, index) => base + (index < extra ? 1 : 0));
}

export const SETS_PER_MATCH = 5; // best of 5
export const SETS_TO_WIN = 3;
const GAME_POINTS = 11;
const POINTS_FOR_WIN = 2;
const POINTS_FOR_LOSS = 1;
/** Group points for the player who didn't show up (Configuración: "No presentado (W.O.)"). */
const POINTS_FOR_WALKOVER = 0;

export function matchKey(groupIndex: number, matchIndex: number): string {
  return `${String(groupIndex)}-${String(matchIndex)}`;
}

export function emptySets(): SetScore[] {
  return Array.from({ length: SETS_PER_MATCH }, (): SetScore => [null, null]);
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]] as [T, T];
  }
  return result;
}

/**
 * Seeded random draw: the top `groupCount` players by ranking head one group each
 * (seed 1 → group 1, seed 2 → group 2…); everyone else is shuffled and dealt in turn.
 */
export function drawGroups(
  players: Player[],
  groupCount: number,
  random: () => number = Math.random,
): Group[] {
  const byRanking = sortByRanking(players);
  const groups: Group[] = byRanking.slice(0, groupCount).map((seed, index) => ({
    name: String(index + 1),
    players: [seed],
  }));
  shuffle(byRanking.slice(groupCount), random).forEach((player, index) => {
    groups[index % groupCount]?.players.push(player);
  });
  return groups;
}

/** Index of the set winner (0 or 1), or null if the score isn't a valid finished set. */
export function setWinner([first, second]: SetScore): 0 | 1 | null {
  if (first === null || second === null) return null;
  const high = Math.max(first, second);
  const low = Math.min(first, second);
  const valid =
    high === GAME_POINTS ? low <= GAME_POINTS - 2 : high > GAME_POINTS && high - low === 2;
  if (!valid) return null;
  return first > second ? 0 : 1;
}

export interface MatchSummary {
  /** Sets won by each player. */
  sets: [number, number];
  /** Game points won by each player in the decided sets. */
  points: [number, number];
  /** Number of sets that count toward the result. */
  decidedSets: number;
  started: boolean;
  finished: boolean;
  winner: 0 | 1 | null;
  /** True when the match was decided by walkover (no-show). */
  walkover: boolean;
}

/** A walkover counts as 3-0 in sets, 11-0 each, for tie-breaks (common regulation). */
function walkoverSummary(absent: 0 | 1): MatchSummary {
  const winner = absent === 0 ? 1 : 0;
  const sets: [number, number] = [0, 0];
  const points: [number, number] = [0, 0];
  sets[winner] = SETS_TO_WIN;
  points[winner] = GAME_POINTS * SETS_TO_WIN;
  return {
    sets,
    points,
    decidedSets: SETS_TO_WIN,
    started: true,
    finished: true,
    winner,
    walkover: true,
  };
}

export function summarizeMatch(result: MatchResult | undefined): MatchSummary {
  if (result?.walkover !== undefined) return walkoverSummary(result.walkover);

  const won: [number, number] = [0, 0];
  const points: [number, number] = [0, 0];
  let decidedSets = 0;
  let started = false;

  for (const set of result?.sets ?? []) {
    if (set[0] !== null || set[1] !== null) started = true;
    if (won[0] === SETS_TO_WIN || won[1] === SETS_TO_WIN) continue;
    const winner = setWinner(set);
    if (winner === null) continue;
    won[winner]++;
    points[0] += set[0] ?? 0;
    points[1] += set[1] ?? 0;
    decidedSets++;
  }

  const finished = won[0] === SETS_TO_WIN || won[1] === SETS_TO_WIN;
  return {
    sets: won,
    points,
    decidedSets,
    started,
    finished,
    winner: finished ? (won[0] > won[1] ? 0 : 1) : null,
    walkover: false,
  };
}

/**
 * Scoresheet shorthand from one player's side: a won set shows the opponent's points
 * ("5"), a lost set shows the player's own points as negative ("-9"). E.g. "5, -9, 6, 3".
 * A walkover shows "W.O.".
 */
export function setNotation(result: MatchResult | undefined, side: 0 | 1): string {
  if (result?.walkover !== undefined) return 'W.O.';
  const other = side === 0 ? 1 : 0;
  const parts: string[] = [];
  let won: [number, number] = [0, 0];
  for (const set of result?.sets ?? []) {
    if (won[0] === SETS_TO_WIN || won[1] === SETS_TO_WIN) break;
    const winner = setWinner(set);
    if (winner === null) continue;
    won = winner === 0 ? [won[0] + 1, won[1]] : [won[0], won[1] + 1];
    parts.push(winner === side ? String(set[other] ?? 0) : `-${String(set[side] ?? 0)}`);
  }
  return parts.join(', ');
}

/**
 * Finds the match between two players of a group of `size` and from which side
 * `rowIndex` plays.
 */
export function findMatch(
  size: number,
  rowIndex: number,
  colIndex: number,
): { matchIndex: number; side: 0 | 1 } | null {
  const pairings = pairingsFor(size);
  const matchIndex = pairings.findIndex(
    ([a, b]) => (a === rowIndex && b === colIndex) || (a === colIndex && b === rowIndex),
  );
  if (matchIndex === -1) return null;
  return { matchIndex, side: pairings[matchIndex]?.[0] === rowIndex ? 0 : 1 };
}

export interface StandingRow {
  player: Player;
  /** Player's number inside the group (1-6). */
  number: number;
  played: number;
  won: number;
  lost: number;
  setsFor: number;
  setsAgainst: number;
  pointsFor: number;
  pointsAgainst: number;
  /** Group points: 2 per win, 1 per loss. */
  points: number;
  /** Current position (1 = leader). */
  position: number;
  /** True when the player is in a tie that no criterion could break (needs a draw). */
  tieUnresolved: boolean;
}

/** Criterion that broke a tie, or 'unresolved' when every criterion was equal. */
export type TieCriterion = 'matchPoints' | 'sets' | 'points' | 'unresolved';

/** Results of the tied players counting only the matches played between them. */
export interface TieStats {
  row: StandingRow;
  matchPoints: number;
  setsWon: number;
  setsLost: number;
  pointsWon: number;
  pointsLost: number;
}

export interface TieDetail {
  /** Group points shared by the tied players. */
  points: number;
  /** Tied players in their final order, with their results between them. */
  players: TieStats[];
  decidedBy: TieCriterion;
}

export interface GroupTable {
  /** Rows in the group's player order (1-4), each with its position. */
  rows: StandingRow[];
  /** Every tie on group points (2 or more players), resolved or not. */
  ties: TieDetail[];
}

interface DecidedMatch {
  home: StandingRow;
  away: StandingRow;
  summary: MatchSummary;
}

/** Results of `players` counting only the matches between them. */
function statsBetween(players: StandingRow[], decided: DecidedMatch[]): TieStats[] {
  const stats = players.map((row): TieStats => ({
    row,
    matchPoints: 0,
    setsWon: 0,
    setsLost: 0,
    pointsWon: 0,
    pointsLost: 0,
  }));
  const find = (row: StandingRow) => stats.find((entry) => entry.row === row);

  for (const { home, away, summary } of decided) {
    const h = find(home);
    const a = find(away);
    if (!h || !a) continue;
    h.setsWon += summary.sets[0];
    h.setsLost += summary.sets[1];
    a.setsWon += summary.sets[1];
    a.setsLost += summary.sets[0];
    h.pointsWon += summary.points[0];
    h.pointsLost += summary.points[1];
    a.pointsWon += summary.points[1];
    a.pointsLost += summary.points[0];
    const lossPoints = summary.walkover ? POINTS_FOR_WALKOVER : POINTS_FOR_LOSS;
    h.matchPoints += summary.winner === 0 ? POINTS_FOR_WIN : lossPoints;
    a.matchPoints += summary.winner === 1 ? POINTS_FOR_WIN : lossPoints;
  }
  return stats;
}

/** Sort comparator for won/lost ratios (higher first), without dividing by zero. */
function compareRatio(aWon: number, aLost: number, bWon: number, bLost: number): number {
  return bWon * aLost - aWon * bLost;
}

const TIE_CRITERIA: [Exclude<TieCriterion, 'unresolved'>, (a: TieStats, b: TieStats) => number][] =
  [
    ['matchPoints', (a, b) => b.matchPoints - a.matchPoints],
    ['sets', (a, b) => compareRatio(a.setsWon, a.setsLost, b.setsWon, b.setsLost)],
    ['points', (a, b) => compareRatio(a.pointsWon, a.pointsLost, b.pointsWon, b.pointsLost)],
  ];

/**
 * ITTF tie-break: order tied players using ONLY the matches between them —
 * match points → set ratio → point ratio. When a criterion separates some players but
 * leaves others still tied, the remaining ones restart from match points among themselves.
 */
function resolveTie(
  players: StandingRow[],
  decided: DecidedMatch[],
): { order: StandingRow[]; decidedBy: TieCriterion } {
  const stats = statsBetween(players, decided);

  for (const [criterion, compare] of TIE_CRITERIA) {
    const sorted = stats.toSorted(compare);
    const buckets: TieStats[][] = [];
    for (const entry of sorted) {
      const last = buckets.at(-1);
      if (last && compare(last[0] ?? entry, entry) === 0) last.push(entry);
      else buckets.push([entry]);
    }
    if (buckets.length === 1) continue; // everyone equal on this criterion

    const order = buckets.flatMap((bucket) =>
      bucket.length === 1
        ? bucket.map((entry) => entry.row)
        : resolveTie(
            bucket.map((entry) => entry.row),
            decided,
          ).order,
    );
    return { order, decidedBy: criterion };
  }

  // Nothing separates them: mark as unresolved (to be settled by a draw); keep ranking order.
  for (const row of players) row.tieUnresolved = true;
  return {
    order: players.toSorted((a, b) => (b.player.ranking ?? 0) - (a.player.ranking ?? 0)),
    decidedBy: 'unresolved',
  };
}

/**
 * Group table: rows in the group's player order (1-4) with positions, plus the detail
 * of every tie on group points. Win = 2 pts, loss = 1 pt; ties follow resolveTie().
 */
export function computeGroupTable(group: Group, groupIndex: number, results: Results): GroupTable {
  const rows: StandingRow[] = group.players.map((player, index) => ({
    player,
    number: index + 1,
    played: 0,
    won: 0,
    lost: 0,
    setsFor: 0,
    setsAgainst: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    points: 0,
    position: 0,
    tieUnresolved: false,
  }));
  const decided: DecidedMatch[] = [];

  pairingsFor(group.players.length).forEach(([first, second], matchIndex) => {
    const home = rows[first];
    const away = rows[second];
    const summary = summarizeMatch(results[matchKey(groupIndex, matchIndex)]);
    if (!summary.finished) return;

    home.played++;
    away.played++;
    home.setsFor += summary.sets[0];
    home.setsAgainst += summary.sets[1];
    away.setsFor += summary.sets[1];
    away.setsAgainst += summary.sets[0];
    home.pointsFor += summary.points[0];
    home.pointsAgainst += summary.points[1];
    away.pointsFor += summary.points[1];
    away.pointsAgainst += summary.points[0];

    const [winner, loser] = summary.winner === 0 ? [home, away] : [away, home];
    winner.won++;
    winner.points += POINTS_FOR_WIN;
    loser.lost++;
    loser.points += summary.walkover ? POINTS_FOR_WALKOVER : POINTS_FOR_LOSS;
    decided.push({ home, away, summary });
  });

  // Group by points (highest first); players sharing points go through the tie-break.
  const ranked: StandingRow[] = [];
  const ties: TieDetail[] = [];
  const pointValues = [...new Set(rows.map((row) => row.points))].sort((a, b) => b - a);
  for (const points of pointValues) {
    const tied = rows.filter((row) => row.points === points);
    if (tied.length === 1 || points === 0) {
      ranked.push(...tied.toSorted((a, b) => (b.player.ranking ?? 0) - (a.player.ranking ?? 0)));
      continue;
    }
    const { order, decidedBy } = resolveTie(tied, decided);
    ranked.push(...order);
    const stats = statsBetween(tied, decided);
    ties.push({
      points,
      decidedBy,
      players: order.flatMap((row) => stats.filter((entry) => entry.row === row)),
    });
  }
  for (const row of rows) row.position = ranked.indexOf(row) + 1;
  return { rows, ties };
}

/**
 * The players finishing 1st, 2nd… (`count` places) once the group is finished; null for a
 * place that isn't decided yet (group unfinished, or an unresolved tie across the cut).
 */
export function getQualifiers(
  group: Group,
  groupIndex: number,
  results: Results,
  count: number,
): (StandingRow | null)[] {
  const empty = Array.from({ length: count }, () => null);
  if (countFinished(group, groupIndex, results) < pairingsFor(group.players.length).length) {
    return empty;
  }

  const { rows } = computeGroupTable(group, groupIndex, results);
  const unresolved = rows.filter((row) => row.tieUnresolved);
  const pending =
    unresolved.some((row) => row.position <= count) &&
    unresolved.some((row) => row.position > count);

  return Array.from({ length: count }, (_, index) => {
    const row = rows.find((candidate) => candidate.position === index + 1);
    return !row || (pending && row.tieUnresolved) ? null : row;
  });
}

/** Rows in the group's player order (1-4) with each player's position. */
export function computeStandings(
  group: Group,
  groupIndex: number,
  results: Results,
): StandingRow[] {
  return computeGroupTable(group, groupIndex, results).rows;
}

/** True when any match of the group has something entered (sets or a walkover). */
export function groupHasResults(groupIndex: number, results: Results): boolean {
  const prefix = `${String(groupIndex)}-`;
  return Object.entries(results).some(
    ([key, result]) => key.startsWith(prefix) && summarizeMatch(result).started,
  );
}

/** Where a player currently is: group index and position (0-based), or null. */
export function locatePlayer(
  groups: Group[],
  player: Player,
): { groupIndex: number; position: number } | null {
  for (const [groupIndex, group] of groups.entries()) {
    const position = group.players.indexOf(player);
    if (position !== -1) return { groupIndex, position };
  }
  return null;
}

/**
 * Sets the players of one group by hand (3-6 players). A player taken from another group
 * is swapped: their old spot is filled, in order, by a player leaving this group; if no
 * one is leaving, that other group just loses the player. Players leaving with no spot to
 * fill end up without a group. Nobody is ever duplicated.
 * Returns the new groups and the indexes of every group touched.
 */
export function replaceGroupPlayers(
  groups: Group[],
  groupIndex: number,
  players: Player[],
): { groups: Group[]; touched: number[] } {
  const next = groups.map((group) => ({ ...group, players: [...group.players] }));
  const target = next[groupIndex];
  const leaving = target.players.filter((player) => !players.includes(player));
  const touched = new Set([groupIndex]);
  for (const player of players) {
    if (target.players.includes(player)) continue;
    const origin = locatePlayer(next, player);
    if (!origin) continue; // came from "sin grupo"
    const originPlayers = next[origin.groupIndex].players;
    const replacement = leaving.shift();
    if (replacement) originPlayers[origin.position] = replacement;
    else originPlayers.splice(origin.position, 1);
    touched.add(origin.groupIndex);
  }
  target.players = players;
  return { groups: next, touched: [...touched] };
}

/** Number of finished matches in a group. */
export function countFinished(group: Group, groupIndex: number, results: Results): number {
  return pairingsFor(group.players.length).filter(
    (_, matchIndex) => summarizeMatch(results[matchKey(groupIndex, matchIndex)]).finished,
  ).length;
}

/** Total matches of a group (depends on its size). */
export function matchCount(group: Group): number {
  return pairingsFor(group.players.length).length;
}
