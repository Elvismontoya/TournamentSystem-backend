// What the API returns for a tournament: the stored data plus everything computed from it
// (match summaries, group tables, tie-breaks, qualifiers, seeds…), so the frontend only
// has to show it. These shapes are the API contract (copied in the frontend's api/types.ts).

import {
  anyResults,
  computeGroupTable,
  countFinished,
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
  setsToWin,
  setWinner,
  summarizeMatch,
  type GroupRules,
  type GroupTable,
  type MatchResult,
  type MatchSummary,
  type Pairing,
  type Scoring,
} from '../domain/groupStage.ts';
import {
  bracketSize,
  nextMatchOf,
  playKnockout,
  roundName,
  type Entrant,
  type KnockoutDraw,
  type KnockoutMatch,
  type PlayedKnockout,
  type SlotPlayer,
} from '../domain/knockout.ts';
import { individualPlayers, nextFreeBib, sortByRanking, type Player } from '../domain/players.ts';
import { finalRanking, knockoutFinished, type RankingEntry } from '../domain/ranking.ts';
import type { Tournament } from '../models/tournament.ts';

/** Tournament settings plus limits, flattened for the frontend (Configuración and the rest). */
export interface SettingsView {
  sport: string;
  format: string;
  modalities: string[];
  categories: string[];
  startDate: string | null;
  endDate: string | null;
  location: string;
  minGroupSize: number;
  maxGroupSize: number;
  defaultGroupSize: number;
  /** 1 or 2. */
  qualifiersPerGroup: number;
  seeded: boolean;
  /** Results entered with the points of each set ("points") or the final score ("sets"). */
  scoring: Scoring;
  /** Group matches: best of N sets. */
  setsPerMatch: number;
  setsToWin: number;
  gamePoints: number;
  winMargin: number;
  knockoutSetsPerMatch: number;
  /** The semifinal losers play for 3rd place; when false, both share 3rd place. */
  thirdPlaceMatch: boolean;
  pointsWin: number;
  pointsLoss: number;
  pointsWalkover: number;
  /** Results were entered: match rules (sets, points per set, margin) can't change. */
  rulesLocked: boolean;
  /** Knockout results were entered: knockoutSetsPerMatch can't change. */
  knockoutRulesLocked: boolean;
  /** The match for 3rd place has results: it can't be turned off. */
  thirdPlaceLocked: boolean;
}

export interface KnockoutMatchView {
  round: number;
  index: number;
  /** "Cuartos de final", "Final"… */
  roundName: string;
  entrants: [Entrant, Entrant];
  /** What was entered (empty sets if nothing yet). */
  result: MatchResult;
  summary: MatchSummary;
  setWinners: (0 | 1 | null)[];
  notation: [string, string];
  /** Both players known: results can be entered. */
  playable: boolean;
  /** Who goes on: the winner, the side facing a bye, or pending. */
  advances: Entrant;
  /** The winner already has results in the next match: this one can't change. */
  locked: boolean;
}

export interface KnockoutView extends KnockoutDraw {
  /** Every round's matches; the last round holds the final. */
  rounds: KnockoutMatchView[][];
  /** Match for 3rd place (round = final's round, index 1), or null if it isn't played. */
  thirdPlace: KnockoutMatchView | null;
  champion: Player | null;
  /** Final decided and, if it is played, the match for 3rd place too. */
  finished: boolean;
  /** Any knockout result entered: the draw and the group stage can't change. */
  hasResults: boolean;
  /** Matches with two players, and how many of them are finished. */
  playable: number;
  played: number;
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
  knockout: KnockoutView | null;
  /** Final ranking (every player who played), once the knockout is over; null before. */
  ranking: RankingEntry[] | null;
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
  const { groupRules: rules, ...settings } = tournament.settings;
  return {
    sport: settings.sport,
    format: settings.format,
    modalities: settings.modalities,
    categories: settings.categories,
    startDate: settings.startDate,
    endDate: settings.endDate,
    location: settings.location,
    minGroupSize: MIN_GROUP_SIZE,
    maxGroupSize: MAX_GROUP_SIZE,
    defaultGroupSize: settings.defaultGroupSize,
    qualifiersPerGroup: settings.qualifiersPerGroup,
    seeded: settings.seeded,
    scoring: rules.scoring,
    setsPerMatch: rules.setsPerMatch,
    setsToWin: setsToWin(rules),
    gamePoints: rules.gamePoints,
    winMargin: rules.winMargin,
    knockoutSetsPerMatch: settings.knockoutSetsPerMatch,
    thirdPlaceMatch: settings.thirdPlaceMatch,
    pointsWin: rules.points.win,
    pointsLoss: rules.points.loss,
    pointsWalkover: rules.points.walkover,
    rulesLocked: anyResults(tournament.results) || anyResults(tournament.knockoutResults),
    knockoutRulesLocked: anyResults(tournament.knockoutResults),
    thirdPlaceLocked: knockoutRoundsOf(tournament)?.thirdPlace?.summary.started ?? false,
  };
}

/** Knockout matches use the group rules except for their own number of sets. */
export function knockoutRulesOf(tournament: Tournament): GroupRules {
  const { groupRules, knockoutSetsPerMatch } = tournament.settings;
  return { ...groupRules, setsPerMatch: knockoutSetsPerMatch };
}

/** Who holds each qualifier slot (1.º/2.º of a group) right now; null while undecided. */
export function slotPlayerOf(tournament: Tournament): SlotPlayer {
  const { groups, results, settings } = tournament;
  const { qualifiersPerGroup, groupRules } = settings;
  const qualifiers = (groups ?? []).map((group, groupIndex) =>
    getQualifiers(group, groupIndex, results, qualifiersPerGroup, groupRules),
  );
  return (slot) => qualifiers[slot.groupIndex]?.[slot.place - 1]?.player ?? null;
}

/** The bracket played out with the current group qualifiers; null before it is drawn. */
export function knockoutRoundsOf(tournament: Tournament): PlayedKnockout | null {
  const { knockout, groups, knockoutResults, settings } = tournament;
  if (!knockout || !groups) return null;
  return playKnockout(
    knockout,
    slotPlayerOf(tournament),
    knockoutResults,
    knockoutRulesOf(tournament),
    settings.thirdPlaceMatch,
  );
}

/** A knockout match by position; the match for 3rd place is match 1 of the final's round. */
export function knockoutMatchAt(
  played: PlayedKnockout,
  round: number,
  index: number,
): KnockoutMatch | undefined {
  if (round === played.rounds.length - 1 && index === 1) return played.thirdPlace ?? undefined;
  return played.rounds.at(round)?.at(index);
}

/**
 * A match can't change once a match it feeds has results: the next match (its winner) and,
 * for a semifinal, the match for 3rd place (its loser).
 */
export function knockoutMatchLocked(played: PlayedKnockout, round: number, index: number): boolean {
  const next = nextMatchOf(2 ** played.rounds.length, round, index);
  const fed = [
    next ? knockoutMatchAt(played, next.round, next.index) : undefined,
    round === played.rounds.length - 2 ? played.thirdPlace : null,
  ];
  return fed.some((match) => match?.summary.started ?? false);
}

function knockoutOf(tournament: Tournament): KnockoutView | null {
  const { knockout } = tournament;
  const played = knockoutRoundsOf(tournament);
  if (!knockout || !played) return null;
  const rules = knockoutRulesOf(tournament);

  const matchView = (match: KnockoutMatch, name: string): KnockoutMatchView => {
    const result = match.result ?? { sets: emptySets(rules) };
    return {
      round: match.round,
      index: match.index,
      roundName: name,
      entrants: match.entrants,
      result,
      summary: match.summary,
      setWinners: result.sets.map((set) => setWinner(set, rules)),
      notation: [setNotation(result, 0, rules), setNotation(result, 1, rules)],
      playable: match.playable,
      advances: match.advances,
      locked: knockoutMatchLocked(played, match.round, match.index),
    };
  };

  const rounds = played.rounds.map((matches, round) =>
    matches.map((match) => matchView(match, roundName(knockout.size / 2 ** round))),
  );
  const thirdPlace = played.thirdPlace ? matchView(played.thirdPlace, 'Tercer puesto') : null;
  const all = [...rounds.flat(), ...(thirdPlace ? [thirdPlace] : [])];
  return {
    ...knockout,
    rounds,
    thirdPlace,
    champion: played.champion,
    finished: knockoutFinished(played),
    hasResults: anyResults(tournament.knockoutResults),
    playable: all.filter((match) => match.playable).length,
    played: all.filter((match) => match.playable && match.summary.finished).length,
  };
}

/** Final ranking once the knockout is over (null before). */
function rankingOf(tournament: Tournament): RankingEntry[] | null {
  const { groups, results, settings } = tournament;
  const played = knockoutRoundsOf(tournament);
  if (!groups || !played) return null;
  const placings = groups.flatMap((group, groupIndex) =>
    computeGroupTable(group, groupIndex, results, settings.groupRules).rows.map((row) => ({
      player: row.player,
      position: row.position,
    })),
  );
  return finalRanking(played, placings);
}

function groupStageOf(tournament: Tournament): GroupStageView | null {
  const { groups, results } = tournament;
  const { qualifiersPerGroup, groupRules: rules } = tournament.settings;
  if (!groups) return null;

  const views = groups.map((group, groupIndex): GroupView => {
    const finished = countFinished(group, groupIndex, results, rules);
    const total = matchCount(group);
    const table = computeGroupTable(group, groupIndex, results, rules);
    const unresolved = table.rows.filter((row) => row.tieUnresolved);
    return {
      name: group.name,
      players: group.players,
      matches: pairingsFor(group.players.length).map((pair, index): MatchView => {
        const result = results[matchKey(groupIndex, index)];
        return {
          index,
          players: pair,
          result: result ?? { sets: emptySets(rules) },
          summary: summarizeMatch(result, rules),
          setWinners: (result?.sets ?? emptySets(rules)).map((set) => setWinner(set, rules)),
          notation: [setNotation(result, 0, rules), setNotation(result, 1, rules)],
        };
      }),
      table,
      finished,
      total,
      complete: finished === total,
      hasResults: groupHasResults(groupIndex, results),
      qualifiers: getQualifiers(group, groupIndex, results, qualifiersPerGroup, rules).map(
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
    // Individual players registered after the draw (or taken out by hand).
    withoutGroup: individualPlayers(tournament.players).filter(
      (player) => !locatePlayer(groups, player),
    ),
    played: views.reduce((sum, group) => sum + group.finished, 0),
    total: views.reduce((sum, group) => sum + group.total, 0),
    hasResults: views.some((group) => group.hasResults),
    knockoutSize: bracketSize(groups.length * qualifiersPerGroup),
  };
}

/** Seeds: before the draw, the top of the ranking for the default group size; after it,
 * the best-ranked players among those in a group, one per group. None if seeding is off. */
function seedsOf(tournament: Tournament): Player[] {
  const { groups, settings } = tournament;
  if (!settings.seeded) return [];
  if (!groups) {
    const players = individualPlayers(tournament.players);
    return players.slice(0, groupCountFor(players.length, settings.defaultGroupSize));
  }
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
    knockout: knockoutOf(tournament),
    ranking: rankingOf(tournament),
  };
}

export function drawPreview(players: Player[], groupSize: number, seeded = true): DrawPreview {
  const groupCount = groupCountFor(players.length, groupSize);
  const sizes = groupSizes(players.length, groupCount);
  return {
    groupSize,
    groupCount,
    sizes,
    seeds: seeded ? sortByRanking(players).slice(0, groupCount) : [],
    orders: [...new Set(sizes)]
      .sort((a, b) => a - b)
      .map((size) => ({ size, pairs: [...pairingsFor(size)] })),
  };
}
