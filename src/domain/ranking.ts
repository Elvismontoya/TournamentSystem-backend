// Final ranking of a finished tournament: knockout players by the round they reached, then
// the players eliminated in the groups by their place in their group. Pure functions.

import { losing, roundName, type Entrant, type PlayedKnockout } from './knockout.ts';
import type { Player } from './players.ts';

export interface RankingEntry {
  /** Shared by players eliminated in the same round (e.g. every quarterfinal loser is 5th). */
  position: number;
  player: Player;
  /** Where they finished: "Campeón", "Subcampeón", "Cuartos de final"… */
  reached: string;
}

/** A group player and their final place in the group table. */
export interface GroupPlacing {
  player: Player;
  position: number;
}

/** The knockout is over: the final is decided and, if it is played, the match for 3rd place. */
export function knockoutFinished({ champion, thirdPlace }: PlayedKnockout): boolean {
  return champion !== null && (thirdPlace === null || thirdPlace.advances.kind !== 'pending');
}

/**
 * Final ranking, or null while the knockout isn't over.
 * - 1st the champion, 2nd the finalist.
 * - With a match for 3rd place: its winner 3rd and its loser 4th; without it, both
 *   semifinal losers share 3rd.
 * - Earlier rounds: every loser of a round shares the place after that round's players
 *   (quarterfinal losers 5th, round of 16 losers 9th…).
 * - Players eliminated in the groups follow, by their place in the group: every 3rd of a
 *   group shares the next place, then every 4th…
 */
export function finalRanking(
  played: PlayedKnockout,
  groupPlacings: GroupPlacing[],
): RankingEntry[] | null {
  const { rounds, champion, thirdPlace } = played;
  const final = rounds.at(-1)?.at(0);
  if (!champion || !final || !knockoutFinished(played)) return null;

  const size = 2 ** rounds.length;
  const entries: RankingEntry[] = [{ position: 1, player: champion, reached: 'Campeón' }];
  const add = (entrant: Entrant, position: number, reached: string) => {
    if (entrant.kind === 'player') entries.push({ position, player: entrant.player, reached });
  };

  add(losing(final), 2, 'Subcampeón');
  for (let round = rounds.length - 2; round >= 0; round--) {
    const semifinal = round === rounds.length - 2;
    if (semifinal && thirdPlace) {
      add(thirdPlace.advances, 3, 'Tercer puesto');
      add(losing(thirdPlace), 4, 'Cuarto puesto');
      continue;
    }
    const position = size / 2 ** (round + 1) + 1;
    const reached = semifinal ? 'Semifinal' : roundName(size / 2 ** round);
    for (const match of rounds[round] ?? []) add(losing(match), position, reached);
  }

  // Everyone in the knockout is in already (each lost once, or won it all).
  const inKnockout = new Set(entries.map((entry) => entry.player.id));
  const byGroupPlace = new Map<number, Player[]>();
  for (const placing of [...groupPlacings].sort((a, b) => a.position - b.position)) {
    if (inKnockout.has(placing.player.id)) continue;
    byGroupPlace.set(placing.position, [
      ...(byGroupPlace.get(placing.position) ?? []),
      placing.player,
    ]);
  }
  let position = entries.length + 1;
  for (const [groupPlace, players] of byGroupPlace) {
    for (const player of players) {
      entries.push({
        position,
        player,
        reached: `Fase de grupos (${String(groupPlace)}.º de grupo)`,
      });
    }
    position += players.length;
  }
  return entries;
}
