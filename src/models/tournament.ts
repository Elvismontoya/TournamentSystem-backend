// What is stored for a tournament. Today it lives in memory (repositories/); with Sequelize
// it maps to tables: Torneo, Participante, Grupo, Partido, Resultado.
// Group tables, positions and qualifiers are NOT stored: they are computed from the results.

import type { Group, Results } from '../domain/groupStage.ts';
import type { KnockoutDraw } from '../domain/knockout.ts';
import type { Player } from '../domain/players.ts';

export interface Tournament {
  id: string;
  name: string;
  /** Places ("cupos"). */
  capacity: number;
  qualifiersPerGroup: number;
  /** Registered players (kept sorted by ranking). */
  players: Player[];
  /** Drawn groups (they hold the same Player objects as `players`), or null before the draw. */
  groups: Group[] | null;
  /** Match results keyed by "groupIndex-matchIndex". */
  results: Results;
  /** Main bracket draw, or null before it is drawn. */
  knockout: KnockoutDraw | null;
}
