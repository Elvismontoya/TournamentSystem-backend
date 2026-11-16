// Reads a player list from spreadsheet rows (Excel or CSV, already split into cells by the
// frontend), as federations send them: columns are found by their header (NUMBER, NOMBRE,
// LIGA, CODIGO, GENERO, TEAM, IND, DB, DX, CATEG, RANKING…), in any order. A list without
// a header row is read as "name, delegation, ranking". For now only the individual event is
// imported: rows without an X in IND are skipped, and DB/DX/TEAM are ignored. Pure functions.

import { INDIVIDUAL_ONLY, type Gender, type NewPlayer } from './players.ts';

type Column =
  'bib' | 'name' | 'delegation' | 'code' | 'gender' | 'individual' | 'category' | 'ranking';

/** Header texts (lowercase, without accents, spaces or symbols) for each column. */
const HEADERS: Record<Column, string[]> = {
  bib: ['number', 'numero', 'nr', 'no', 'num', 'dorsal'],
  name: ['nombre', 'nombres', 'jugador', 'name', 'nombrecompleto'],
  delegation: ['liga', 'delegacion', 'club', 'equipodelegacion'],
  code: ['codigo', 'cod', 'code'],
  gender: ['genero', 'sexo', 'rama', 'gender'],
  individual: ['ind', 'individual', 'sencillos', 'singles'],
  category: ['categ', 'categoria', 'cat', 'category'],
  ranking: ['rkpoints', 'rkpuntos', 'ranking', 'rank', 'puntos', 'puntosranking'],
};

/** Lowercase, without accents and without anything that isn't a letter or digit. */
function key(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function columnOf(header: string): Column | null {
  const normalized = key(header);
  for (const [column, names] of Object.entries(HEADERS) as [Column, string[]][]) {
    if (names.includes(normalized)) return column;
  }
  return null;
}

/** Age categories offered today (they will come from the Categoría table). */
const CATEGORY_NAMES: Record<string, string> = {
  sub11: 'Sub 11',
  sub13: 'Sub 13',
  sub16: 'Sub 16',
  sub19: 'Sub 19',
  mayores: 'Mayores (Libre)',
  libre: 'Mayores (Libre)',
  mayoreslibre: 'Mayores (Libre)',
  senior: 'Senior',
};

/** "SUB11", "sub-11", "Sub 11" → "Sub 11"; anything not in the catalog is kept as written. */
export function categoryName(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  return CATEGORY_NAMES[key(trimmed)] ?? trimmed;
}

function genderOf(text: string): Gender | null | 'invalid' {
  const value = key(text);
  if (value === '') return null;
  if (['f', 'fem', 'femenino', 'mujer', 'dama', 'damas'].includes(value)) return 'F';
  if (['m', 'masc', 'masculino', 'hombre', 'varon', 'varones', 'h'].includes(value)) return 'M';
  return 'invalid';
}

/** An IND cell: empty = doesn't play individual; anything else ("X", "x") = plays. */
const marked = (text: string) => text.trim() !== '';

export interface PlayerRowsResult {
  /** Players of the individual event. */
  players: NewPlayer[];
  /** One message per row that can't be read ("Fila 4: …", as numbered in the sheet). */
  errors: string[];
  /** Rows without an X in IND (other modalities only): not imported for now. */
  skipped: number;
}

/**
 * Reads the rows of the first sheet. The header row is the first one with a "NOMBRE" column
 * (it can be below a title); without one, columns are name, delegation, ranking.
 * Only the individual event is imported for now: with an IND column, rows without an X there
 * are skipped; DB, DX and TEAM are ignored. Row numbers in messages are the sheet's.
 */
export function readPlayerRows(rows: string[][]): PlayerRowsResult {
  const headerIndex = rows.findIndex((row) => row.some((cell) => columnOf(cell) === 'name'));
  const columns: Partial<Record<Column, number>> = {};
  if (headerIndex === -1) {
    columns.name = 0;
    columns.delegation = 1;
    columns.ranking = 2;
  } else {
    rows[headerIndex]?.forEach((cell, index) => {
      const column = columnOf(cell);
      if (column && columns[column] === undefined) columns[column] = index;
    });
  }
  // Without an IND column (a plain list), everyone plays individual.
  const hasIndividual = columns.individual !== undefined;

  const players: NewPlayer[] = [];
  const errors: string[] = [];
  const bibs = new Map<number, string>();
  let skipped = 0;

  rows.forEach((row, index) => {
    if (index <= headerIndex) return;
    const cell = (column: Column) => {
      const at = columns[column];
      return at === undefined ? '' : (row[at] ?? '').trim();
    };
    if (row.every((value) => value.trim() === '')) return;
    if (hasIndividual && !marked(cell('individual'))) {
      skipped++;
      return;
    }
    const where = `Fila ${String(index + 1)}`;

    const name = cell('name');
    if (name === '') {
      errors.push(`${where}: falta el nombre.`);
      return;
    }
    const bibText = cell('bib');
    let bib: number | undefined;
    if (bibText !== '') {
      bib = Number(bibText);
      if (!Number.isInteger(bib) || bib < 1) {
        errors.push(`${where}: el número «${bibText}» no es un entero mayor que 0.`);
        return;
      }
      const owner = bibs.get(bib);
      if (owner) {
        errors.push(`${where}: el número ${String(bib)} ya es de ${owner} en el archivo.`);
        return;
      }
      bibs.set(bib, name);
    }
    const rankingText = cell('ranking');
    if (rankingText !== '' && !/^\d+$/.test(rankingText)) {
      errors.push(`${where}: el ranking «${rankingText}» no es un número.`);
      return;
    }
    const gender = genderOf(cell('gender'));
    if (gender === 'invalid') {
      errors.push(`${where}: el género «${cell('gender')}» debe ser F o M.`);
      return;
    }

    players.push({
      name,
      // The code is the league's short name: used when the league is empty.
      delegation: cell('delegation') || cell('code'),
      ranking: rankingText === '' ? null : Number(rankingText),
      ...(bib === undefined ? {} : { bib }),
      gender,
      category: categoryName(cell('category')),
      modalities: { ...INDIVIDUAL_ONLY },
    });
  });
  return { players, errors, skipped };
}
/** A pasted text list as rows (one per line; cells split by comma, semicolon or tab). */
export function textToRows(text: string): string[][] {
  return text.split(/\r?\n/).map((line) => line.split(/[,;\t]/).map((cell) => cell.trim()));
}
