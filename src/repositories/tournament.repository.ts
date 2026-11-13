// Tournament storage. For now an in-memory map seeded with the example tournament: data is
// lost when the server restarts. Replace these functions with Sequelize queries (Supabase)
// keeping the same signatures, and the services won't need to change.

import { EXAMPLE_PLAYERS, EXAMPLE_TOURNAMENT } from '../data/exampleTournament.ts';
import { sortByRanking } from '../domain/players.ts';
import type { Tournament } from '../models/tournament.ts';

const tournaments = new Map<string, Tournament>();

function seed(): void {
  tournaments.set(EXAMPLE_TOURNAMENT.id, {
    ...EXAMPLE_TOURNAMENT,
    players: sortByRanking(EXAMPLE_PLAYERS.map((player) => ({ ...player }))),
    groups: null,
    results: {},
    knockout: null,
  });
}
seed();

export function findTournament(id: string): Tournament | undefined {
  return tournaments.get(id);
}

export function saveTournament(tournament: Tournament): void {
  tournaments.set(tournament.id, tournament);
}
