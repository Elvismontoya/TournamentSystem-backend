// Players and registration rules: ranking order, free registration numbers (Nr.)
// and reading a pasted/CSV player list. Pure functions: no UI, no database, no HTTP.

export interface Player {
  id: string;
  name: string;
  /** Registration number ("Nr."), fixed for the whole tournament. */
  bib: number;
  /** Delegation, league, club or team the player represents. */
  delegation: string;
  ranking: number | null;
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
}

/**
 * Reads a pasted list, one player per line: "name, delegation, ranking points".
 * Fields may be separated by comma, semicolon or tab; delegation and ranking are optional.
 * Lines that can't be read are returned in `errors` (1-based line numbers).
 */
export function parsePlayerList(text: string): { players: NewPlayer[]; errors: string[] } {
  const players: NewPlayer[] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.trim() === '') return;
    const [name = '', delegation = '', ranking = '', ...rest] = line
      .split(/[,;\t]/)
      .map((field) => field.trim());
    const lineNumber = String(index + 1);
    if (name === '' || rest.some((field) => field !== '')) {
      errors.push(`Línea ${lineNumber}: usa «nombre, delegación, ranking».`);
      return;
    }
    if (ranking !== '' && !/^\d+$/.test(ranking)) {
      errors.push(`Línea ${lineNumber}: el ranking «${ranking}» no es un número.`);
      return;
    }
    players.push({ name, delegation, ranking: ranking === '' ? null : Number(ranking) });
  });
  return { players, errors };
}
