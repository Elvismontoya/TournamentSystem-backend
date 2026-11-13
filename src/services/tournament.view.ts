// What the API returns for a tournament: the stored data plus everything computed from it
// (match summaries, group tables, tie-breaks, qualifiers, seeds…), so the frontend only
// has to show it. These shapes are the API contract (copied in the frontend's api/types.ts).

import {
  computeGroupTable,
  countFinished,
  DEFAULT_GROUP_SIZE,
  emptySets,
  getQualifiers,
  groupCountFor,
  groupHasResults,
  groupSizes,
  locatePlayer,
  matchCount,
  matchKey,
  MAX_GROUP_SIZE,
  MIN_GROUP_SIZE,
  pairingsFor,
  setNotation,
  SETS_PER_MATCH,
  SETS_TO_WIN,
  setWinner,
  summarizeMatch,
  type GroupTable,
  type MatchResult,
  type MatchSummary,
  type Pairing,
} from '../domain/groupStage.ts';
import { bracketSize, type KnockoutDraw } from '../domain/knockout.ts';
import { nextFreeBib, sortByRanking, type Player } from '../domain/players.ts';
import type { Tournament } from '../models/tournament.ts';

export interface SettingsView {
  minGroupSize: number;
  maxGroupSize: number;
  defaultGroupSize: number;
  qualifiersPerGroup: number;
  setsPerMatch: number;
  setsToWin: number;
  capacity: number;
}

export interface MatchView {
  /** Match number inside the group (order of play). */
  index: number;
  /** Positions inside the group (0-based) of the two players. */
  players: Pairing;
  /** What was entered (empty sets if nothing yet). */
  result: MatchResult;
  summary: MatchSummary;
  /** Winner of each entered set (null = not entered or not a valid set). */
  setWinners: (0 | 1 | null)[];
  /** Scoresheet shorthand from each player's side ("5, -9, 6" or "W.O."). */
  notation: [string, string];
}

export interface GroupView {
  name: string;
  players: Player[];
  matches: MatchView[];
  table: GroupTable;
  finished: number;
  total: number;
  complete: boolean;
  hasResults: boolean;
  /** 1st, 2nd… of the group once decided (null while pending). */
  qualifiers: (Player | null)[];
  /** Finished, but an unresolved tie straddles the qualification cut (needs a draw). */
  qualificationPending: boolean;
}

export interface GroupStageView {
  groups: GroupView[];
  /** Registered players not in any group (added after the draw or taken out by hand). */
  withoutGroup: Player[];
  played: number;
  total: number;
  hasResults: boolean;
  /** Size the main bracket will have (power of 2). */
  knockoutSize: number;
}

export interface TournamentView {
  id: string;
  name: string;
  settings: SettingsView;
  /** Registered players, highest ranking first. */
  players: Player[];
  /** Nr. a new player gets if none is given. */
  nextBib: number;
  /** Seeded players (top of the ranking, one per group), in seed order. */
  seedIds: string[];
  groupStage: GroupStageView | null;
  knockout: KnockoutDraw | null;
}

export interface DrawPreview {
  groupSize: number;
  groupCount: number;
  sizes: number[];
  /** Players who will head each group, in group order. */
  seeds: Player[];
  /** Match order for each group size present. */
  orders: { size: number; pairs: Pairing[] }[];
}

function settingsOf(tournament: Tournament): SettingsView {
  return {
    minGroupSize: MIN_GROUP_SIZE,
    maxGroupSize: MAX_GROUP_SIZE,
    defaultGroupSize: DEFAULT_GROUP_SIZE,
    qualifiersPerGroup: tournament.qualifiersPerGroup,
    setsPerMatch: SETS_PER_MATCH,
    setsToWin: SETS_TO_WIN,
    capacity: tournament.capacity,
  };
}

function groupStageOf(tournament: Tournament): GroupStageView | null {
  const { groups, results, qualifiersPerGroup } = tournament;
  if (!groups) return null;

  const views = groups.map((group, groupIndex): GroupView => {
    const finished = countFinished(group, groupIndex, results);
    const total = matchCount(group);
    const table = computeGroupTable(group, groupIndex, results);
    const unresolved = table.rows.filter((row) => row.tieUnresolved);
    return {
      name: group.name,
      players: group.players,
      matches: pairingsFor(group.players.length).map((pair, index): MatchView => {
        const result = results[matchKey(groupIndex, index)];
        return {
          index,
          players: pair,
          result: result ?? { sets: emptySets() },
          summary: summarizeMatch(result),
          setWinners: (result?.sets ?? emptySets()).map(setWinner),
          notation: [setNotation(result, 0), setNotation(result, 1)],
        };
      }),
      table,
      finished,
      total,
      complete: finished === total,
      hasResults: groupHasResults(groupIndex, results),
      qualifiers: getQualifiers(group, groupIndex, results, qualifiersPerGroup).map(
        (row) => row?.player ?? null,
      ),
      qualificationPending:
        finished === total &&
        unresolved.some((row) => row.position <= qualifiersPerGroup) &&
        unresolved.some((row) => row.position > qualifiersPerGroup),
    };
  });

  return {
    groups: views,
    withoutGroup: tournament.players.filter((player) => !locatePlayer(groups, player)),
    played: views.reduce((sum, group) => sum + group.finished, 0),
    total: views.reduce((sum, group) => sum + group.total, 0),
    hasResults: views.some((group) => group.hasResults),
    knockoutSize: bracketSize(groups.length * qualifiersPerGroup),
  };
}

/** Seeds: before the draw, the top of the ranking for the default group size; after it,
 * the best-ranked players among those in a group, one per group. */
function seedsOf(tournament: Tournament): Player[] {
  const { groups, players } = tournament;
  if (!groups) return players.slice(0, groupCountFor(players.length, DEFAULT_GROUP_SIZE));
  return sortByRanking(groups.flatMap((group) => group.players)).slice(0, groups.length);
}

export function tournamentView(tournament: Tournament): TournamentView {
  return {
    id: tournament.id,
    name: tournament.name,
    settings: settingsOf(tournament),
    players: tournament.players,
    nextBib: nextFreeBib(tournament.players),
    seedIds: seedsOf(tournament).map((player) => player.id),
    groupStage: groupStageOf(tournament),
    knockout: tournament.knockout,
  };
}

export function drawPreview(players: Player[], groupSize: number): DrawPreview {
  const groupCount = groupCountFor(players.length, groupSize);
  const sizes = groupSizes(players.length, groupCount);
  return {
    groupSize,
    groupCount,
    sizes,
    seeds: sortByRanking(players).slice(0, groupCount),
    orders: [...new Set(sizes)]
      .sort((a, b) => a - b)
      .map((size) => ({ size, pairs: [...pairingsFor(size)] })),
  };
}
