// What is stored for a tournament. Today it lives in memory (repositories/); with Sequelize
// it maps to tables: Torneo, Participante, Grupo, Partido, Resultado.
// Group tables, positions and qualifiers are NOT stored: they are computed from the results.

import type { Group, GroupRules, Results } from '../domain/groupStage.ts';
import type { KnockoutDraw } from '../domain/knockout.ts';
import type { Player } from '../domain/players.ts';

/** Everything the organizer edits in Configuración (except the name). */
export interface TournamentSettings {
  /* General: shown on the tournament page. Sport, format, modalities and categories are
     names from catalogs that will live in their own tables (Deporte, Formato, Modalidad,
     Categoría). */
  sport: string;
  format: string;
  /** "Individual", "Dobles"… (at least one). */
  modalities: string[];
  /** "Sub 11", "Sub 13", "Mayores"… (at least one). */
  categories: string[];
  /** ISO date (YYYY-MM-DD). */
  startDate: string | null;
  endDate: string | null;
  location: string;

  /* Format */
  /** Group size suggested when drawing the groups. */
  defaultGroupSize: number;
  /** Players per group that advance to the knockout stage: 1 or 2. */
  qualifiersPerGroup: 1 | 2;
  /** When true, the top of the ranking heads the groups in the draw. */
  seeded: boolean;

  /* Rules */
  /** How group matches are played and scored. */
  groupRules: GroupRules;
  /** Best of N sets in the main bracket. */
  knockoutSetsPerMatch: number;
  /** The semifinal losers play for 3rd place; when false, both share 3rd place. */
  thirdPlaceMatch: boolean;
}

/**
 * The competition of one category: categories never mix, so each one has its own groups,
 * results and bracket.
 */
export interface CategoryStage {
  /** Drawn groups (they hold the same Player objects as `players`), or null before the draw. */
  groups: Group[] | null;
  /** Match results keyed by "groupIndex-matchIndex". */
  results: Results;
  /** Main bracket draw, or null before it is drawn. */
  knockout: KnockoutDraw | null;
  /**
   * Knockout match results keyed by "round-index" (round 0 = first round). The match for
   * 3rd place is match 1 of the final's round.
   */
  knockoutResults: Results;
}

export interface Tournament {
  id: string;
  name: string;
  settings: TournamentSettings;
  /** Registered players of every category (kept sorted by ranking). */
  players: Player[];
  /** Competition of each category, by category name (created when first used). */
  stages: Partial<Record<string, CategoryStage>>;
}

/**
 * One category of a tournament seen as a single competition: its players and its stage.
 * The rules (domain/) and the view work on this; changes are written back with
 * `commitScope`.
 */
export interface CategoryScope extends CategoryStage {
  id: string;
  name: string;
  settings: TournamentSettings;
  category: string;
  /** Players of this category only. */
  players: Player[];
}

export function emptyStage(): CategoryStage {
  return { groups: null, results: {}, knockout: null, knockoutResults: {} };
}

/** The category's players and competition (an empty one if nothing was drawn yet). */
export function scopeOf(tournament: Tournament, category: string): CategoryScope {
  const stage = tournament.stages[category] ?? emptyStage();
  return {
    id: tournament.id,
    name: tournament.name,
    settings: tournament.settings,
    category,
    players: tournament.players.filter((player) => player.category === category),
    groups: stage.groups,
    results: stage.results,
    knockout: stage.knockout,
    knockoutResults: stage.knockoutResults,
  };
}

/** Writes a category's competition back into the tournament. */
export function commitScope(tournament: Tournament, scope: CategoryScope): void {
  tournament.stages[scope.category] = {
    groups: scope.groups,
    results: scope.results,
    knockout: scope.knockout,
    knockoutResults: scope.knockoutResults,
  };
}

/** Every category's competition (one per category of the settings). */
export function allScopes(tournament: Tournament): CategoryScope[] {
  return tournament.settings.categories.map((category) => scopeOf(tournament, category));
}
