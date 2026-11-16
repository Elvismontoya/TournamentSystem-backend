// Players and registration rules: ranking order, free registration numbers (Nr.),
// modalities and doubles/team codes. Pure functions: no UI, no database, no HTTP.

export type Gender = 'F' | 'M';

/**
 * What each player plays. Doubles, mixed doubles and teams hold a code shared by the
 * partners/teammates ("DF1", "DX2", "201"), as in the federation's spreadsheets; null = doesn't
 * play it.
 */
export interface PlayerModalities {
  individual: boolean;
  /** Doubles (men's or women's) pair code. */
  doubles: string | null;
  /** Mixed doubles pair code. */
  mixed: string | null;
  /** Team code. */
  team: string | null;
}

export interface Player {
  id: string;
  name: string;
  /** Registration number ("Nr."), fixed for the whole tournament. */
  bib: number;
  /** Delegation, league, club or team the player represents. */
  delegation: string;
  ranking: number | null;
  gender: Gender | null;
  /** Age category ("Sub 13", "Mayores (Libre)"…), or null if not given. */
  category: string | null;
  modalities: PlayerModalities;
}

/** Only individual play (the default for players added by hand). */
export const INDIVIDUAL_ONLY: PlayerModalities = {
  individual: true,
  doubles: null,
  mixed: null,
  team: null,
};

/** Players who play the individual event (the only one the draw handles for now). */
export function individualPlayers(players: Player[]): Player[] {
  return players.filter((player) => player.modalities.individual);
}

/** Highest ranking first; players without ranking go last (keeping their order). */
export function sortByRanking(players: Player[]): Player[] {
  return players.toSorted((a, b) => (b.ranking ?? -1) - (a.ranking ?? -1));
}

/** Written as a delegation, but meaning "none": these players never clash with anyone. */
const NO_DELEGATION = new Set([
  '',
  '-',
  'independiente',
  'independientes',
  'sin delegacion',
  'sin club',
  'ninguna',
  'ninguno',
  'libre',
  'n/a',
]);

/**
 * Delegation used to compare players: case, accents and extra spaces don't matter, and ""
 * means none (no delegation, "Independiente", "Sin delegación"…), which never clashes.
 */
export function delegationKey(player: Player): string {
  const key = player.delegation
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('es')
    .replace(/\s+/g, ' ')
    .trim();
  return NO_DELEGATION.has(key) ? '' : key;
}

/** Two players of the same (real) delegation. */
export function sameDelegation(a: Player, b: Player): boolean {
  const key = delegationKey(a);
  return key !== '' && key === delegationKey(b);
}

/** Smallest Nr. not used yet (1, 2, 3…), skipping the ones in `taken`. */
export function nextFreeBib(players: Player[], taken: number[] = []): number {
  const used = new Set([...players.map((player) => player.bib), ...taken]);
  let bib = 1;
  while (used.has(bib)) bib++;
  return bib;
}

/** A player to register: the Nr. is optional (the next free one is used). */
export interface NewPlayer {
  name: string;
  delegation: string;
  ranking: number | null;
  bib?: number;
  gender?: Gender | null;
  category?: string | null;
  /** Left out: individual only. */
  modalities?: PlayerModalities;
}
