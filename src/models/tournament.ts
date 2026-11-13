// What is stored for a tournament. Today it lives in memory (repositories/); with Sequelize
// it maps to tables: Torneo, Participante, Grupo, Partido, Resultado.
// Group tables, positions and qualifiers are NOT stored: they are computed from the results.

import type { Group, GroupRules, Results } from '../domain/groupStage.ts';
import type { KnockoutDraw } from '../domain/knockout.ts';
import type { Player } from '../domain/players.ts';

/** Everything the organizer edits in Configuración (except the name). */
export interface TournamentSettings {
  /* General: shown on the tournament page. */
  sport: string;
  category: string;
  /** ISO dates (YYYY-MM-DD), or null if not set. */
  startDate: string | null;
  endDate: string | null;
  location: string;

  /* Format */
  participantType: string;
  format: string;
  /** Places ("cupos"). */
  capacity: number;
  /** Group size suggested when drawing the groups. */
  defaultGroupSize: number;
  /** Players per group that advance to the knockout stage (the bracket supports 2). */
  qualifiersPerGroup: number;
  /** When true, the top of the ranking heads the groups in the draw. */
  seeded: boolean;

  /* Rules */
  /** How group matches are played and scored. */
  groupRules: GroupRules;
  /** Best of N sets in the main bracket. */
  knockoutSetsPerMatch: number;
}

export interface Tournament {
  id: string;
  name: string;
  settings: TournamentSettings;
  /** Registered players (kept sorted by ranking). */
  players: Player[];
  /** Drawn groups (they hold the same Player objects as `players`), or null before the draw. */
  groups: Group[] | null;
  /** Match results keyed by "groupIndex-matchIndex". */
  results: Results;
  /** Main bracket draw, or null before it is drawn. */
  knockout: KnockoutDraw | null;
  /** Knockout match results keyed by "round-index" (round 0 = first round). */
  knockoutResults: Results;
}
