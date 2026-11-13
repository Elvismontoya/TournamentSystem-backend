// Knockout rules: places group winners and runners-up in the main bracket (seed positions,
// runner-up in the opposite half, byes), checks hand-made draws, and plays the bracket out
// (each match winner advances to the next round). Pure functions: no UI, no database, no HTTP.

import {
  summarizeMatch,
  type GroupRules,
  type MatchResult,
  type MatchSummary,
  type Results,
} from './groupStage.ts';
import type { Player } from './players.ts';

/** What occupies a bracket position: a group qualifier (1st or 2nd of a group) or a bye. */
export type BracketSlot = { kind: 'qualifier'; place: 1 | 2; groupIndex: number } | { kind: 'bye' };

export interface KnockoutDraw {
  /** Bracket size (power of 2): 8, 16, 32, 64… */
  size: number;
  /** slots[0] is position 1 (top of the bracket), slots[size - 1] the last position. */
  slots: BracketSlot[];
  /** Constraints that couldn't be met (shown to the organizer). */
  warnings: string[];
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]] as [T, T];
  }
  return result;
}

/** Smallest power of 2 that fits all entrants (minimum 2). */
export function bracketSize(entrants: number): number {
  let size = 2;
  while (size < entrants) size *= 2;
  return size;
}

/**
 * Positions (1-based) for seeds 1..count in a bracket of `size`:
 * seed 1 → top (1), seed 2 → bottom (size), seeds 3-4 → the middle (size/2, size/2+1),
 * seeds 5-8 → quarter boundaries, seeds 9-16 → eighth boundaries… Each tier is drawn at random.
 * E.g. in a 64 draw: 3-4 → 32/33, 5-8 → 16/17/48/49, 9-16 → 8/9/24/25/40/41/56/57.
 */
export function seedPositions(size: number, count: number, random = Math.random): number[] {
  const positions: number[] = [];
  if (count >= 1) positions.push(1);
  if (count >= 2) positions.push(size);
  for (let tier = 2; positions.length < count && size / tier >= 2; tier *= 2) {
    const step = size / tier;
    const tierPositions: number[] = [];
    for (let i = 0; i < tier / 2; i++) {
      tierPositions.push((2 * i + 1) * step, (2 * i + 1) * step + 1);
    }
    positions.push(...shuffle(tierPositions, random).slice(0, count - positions.length));
  }
  return positions;
}

/**
 * Draws the main bracket for `groupCount` groups with 2 qualifiers each:
 * group winners are seeded by group number (winner of group 1 = seed 1); each runner-up is
 * drawn into the half OPPOSITE to its own group winner, so they can only meet in the final.
 * When the bracket isn't full, the best seeds get byes.
 */
export function drawKnockout(groupCount: number, random: () => number = Math.random): KnockoutDraw {
  const size = bracketSize(groupCount * 2);
  const slots = Array.from({ length: size }, (): BracketSlot | null => null);
  const half = (position: number) => (position <= size / 2 ? 0 : 1);

  const winnerPositions = seedPositions(size, groupCount, random);
  winnerPositions.forEach((position, groupIndex) => {
    slots[position - 1] = { kind: 'qualifier', place: 1, groupIndex };
  });

  // Byes go against the best seeds.
  const byes = size - groupCount * 2;
  for (const position of winnerPositions.slice(0, byes)) {
    const opponent = position % 2 === 1 ? position + 1 : position - 1;
    slots[opponent - 1] = { kind: 'bye' };
  }

  const freeInHalf = (target: 0 | 1) =>
    shuffle(
      slots.flatMap((slot, index) =>
        slot === null && half(index + 1) === target ? [index + 1] : [],
      ),
      random,
    );
  const free: [number[], number[]] = [freeInHalf(0), freeInHalf(1)];

  const groups = shuffle(
    Array.from({ length: groupCount }, (_, index) => index),
    random,
  );
  for (const groupIndex of groups) {
    const winnerHalf = half(winnerPositions[groupIndex] ?? 1);
    const target = winnerHalf === 0 ? 1 : 0;
    const position = free[target].pop() ?? free[winnerHalf].pop();
    if (position === undefined) continue;
    slots[position - 1] = { kind: 'qualifier', place: 2, groupIndex };
  }

  const filled = slots.map((slot): BracketSlot => slot ?? { kind: 'bye' });
  return { size, slots: filled, warnings: drawWarnings(filled) };
}

/** Stable key for a slot: "1-0" = 1st of group 1, "2-3" = 2nd of group 4, "bye". */
export function slotKey(slot: BracketSlot): string {
  return slot.kind === 'bye' ? 'bye' : `${String(slot.place)}-${String(slot.groupIndex)}`;
}

/** Rule checks for a (possibly hand-made) draw, as messages for the organizer. */
export function drawWarnings(slots: BracketSlot[]): string[] {
  const size = slots.length;
  const positionOf = (place: 1 | 2, groupIndex: number) =>
    slots.findIndex(
      (slot) => slot.kind === 'qualifier' && slot.place === place && slot.groupIndex === groupIndex,
    ) + 1;
  const half = (position: number) => (position <= size / 2 ? 0 : 1);
  const groupCount = Math.max(
    0,
    ...slots.map((slot) => (slot.kind === 'qualifier' ? slot.groupIndex + 1 : 0)),
  );

  const warnings: string[] = [];
  for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) {
    const winner = positionOf(1, groupIndex);
    const runnerUp = positionOf(2, groupIndex);
    if (winner && runnerUp && half(winner) === half(runnerUp)) {
      warnings.push(
        `El 1.º y el 2.º del grupo ${String(groupIndex + 1)} están en la misma mitad (posiciones ${String(winner)} y ${String(runnerUp)}): podrían cruzarse antes de la final.`,
      );
    }
  }
  for (let index = 0; index < size; index += 2) {
    if (slots[index]?.kind === 'bye' && slots[index + 1]?.kind === 'bye') {
      warnings.push(
        `Las posiciones ${String(index + 1)} y ${String(index + 2)} son ambas bye: ese cruce queda vacío.`,
      );
    }
  }
  return warnings;
}

/**
 * Puts `slot` at `position` (1-based) by swapping it with wherever it currently is,
 * so every qualifier stays in the bracket exactly once.
 */
export function moveSlot(draw: KnockoutDraw, position: number, slot: BracketSlot): KnockoutDraw {
  const target = position - 1;
  const key = slotKey(slot);
  const from = draw.slots.findIndex(
    (candidate, index) => index !== target && slotKey(candidate) === key,
  );
  if (from === -1 || slotKey(draw.slots[target] ?? slot) === key) return draw;

  const slots = [...draw.slots];
  [slots[from], slots[target]] = [slots[target], slots[from]] as [BracketSlot, BracketSlot];
  return { ...draw, slots, warnings: drawWarnings(slots) };
}

/* ---------- Playing the bracket ---------- */

/** Who occupies one side of a knockout match. */
export type Entrant =
  | { kind: 'player'; player: Player }
  /** Empty position: the other side passes straight through. */
  | { kind: 'bye' }
  /** Not known yet (group not finished, or the previous match not played). */
  | { kind: 'pending' };

export interface KnockoutMatch {
  /** 0 = first round; the last round is the final. */
  round: number;
  /** Match number inside its round (0 = top). */
  index: number;
  entrants: [Entrant, Entrant];
  /** What was entered, if anything. */
  result: MatchResult | undefined;
  summary: MatchSummary;
  /** Both sides are players: the match can be played (results entered). */
  playable: boolean;
  /** Who goes on to the next round: the winner, the side facing a bye, or pending. */
  advances: Entrant;
}

/** Results of knockout matches are keyed "round-index" (e.g. "0-3", "2-0"). */
export function knockoutMatchKey(round: number, index: number): string {
  return `${String(round)}-${String(index)}`;
}

/** Where the winner of (round, index) plays next: match and side, or null after the final. */
export function nextMatchOf(
  size: number,
  round: number,
  index: number,
): { round: number; index: number; side: 0 | 1 } | null {
  if (size / 2 ** (round + 1) <= 1) return null;
  return { round: round + 1, index: Math.floor(index / 2), side: index % 2 === 0 ? 0 : 1 };
}

function advancing(a: Entrant, b: Entrant, summary: MatchSummary): Entrant {
  if (a.kind === 'bye') return b;
  if (b.kind === 'bye') return a;
  if (a.kind === 'player' && b.kind === 'player' && summary.finished) {
    return summary.winner === 0 ? a : b;
  }
  return { kind: 'pending' };
}

/**
 * Plays the bracket out round by round: first-round sides come from the draw (`playerOf`
 * resolves each qualifier slot, null while the group isn't decided); in later rounds each
 * side is whoever advanced from the two matches feeding it. Returns every round's matches
 * (the last round holds the final) and the champion once the final is decided.
 */
export function playKnockout(
  draw: KnockoutDraw,
  playerOf: (slot: Extract<BracketSlot, { kind: 'qualifier' }>) => Player | null,
  results: Results,
  rules: GroupRules,
): { rounds: KnockoutMatch[][]; champion: Player | null } {
  let current: Entrant[] = draw.slots.map((slot): Entrant => {
    if (slot.kind === 'bye') return { kind: 'bye' };
    const player = playerOf(slot);
    return player ? { kind: 'player', player } : { kind: 'pending' };
  });

  const rounds: KnockoutMatch[][] = [];
  for (let round = 0; current.length > 1; round++) {
    const matches: KnockoutMatch[] = [];
    for (let index = 0; index < current.length / 2; index++) {
      const a = current[index * 2] ?? { kind: 'pending' };
      const b = current[index * 2 + 1] ?? { kind: 'pending' };
      const playable = a.kind === 'player' && b.kind === 'player';
      const result = results[knockoutMatchKey(round, index)];
      // A result only counts while both players are known.
      const summary = summarizeMatch(playable ? result : undefined, rules);
      matches.push({
        round,
        index,
        entrants: [a, b],
        result,
        summary,
        playable,
        advances: advancing(a, b, summary),
      });
    }
    rounds.push(matches);
    current = matches.map((match) => match.advances);
  }

  const last = current.at(0);
  return { rounds, champion: last?.kind === 'player' ? last.player : null };
}

/** Name of a round by the number of players in it. */
export function roundName(players: number): string {
  switch (players) {
    case 2:
      return 'Final';
    case 4:
      return 'Semifinal';
    case 8:
      return 'Cuartos de final';
    case 16:
      return 'Octavos de final';
    default:
      return `Ronda de ${String(players)}`;
  }
}
