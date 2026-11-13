// Tournament rules tests. Run with: npm run test:domain  (Node runs the .ts files directly)

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeGroupTable,
  drawGroups,
  getQualifiers,
  groupCountFor,
  groupSizes,
  matchKey,
  pairingsFor,
  replaceGroupPlayers,
  setWinner,
  summarizeMatch,
  type Group,
  type Results,
  type SetScore,
} from '../src/domain/groupStage.ts';
import { drawKnockout, moveSlot, seedPositions } from '../src/domain/knockout.ts';
import { nextFreeBib, parsePlayerList, sortByRanking, type Player } from '../src/domain/players.ts';

const player = (bib: number, ranking: number | null = null): Player => ({
  id: `p${String(bib)}`,
  bib,
  name: `Jugador ${String(bib)}`,
  delegation: 'Club',
  ranking,
});

/** Sets for a match the first player wins `home`-`away` (11-5 each set). */
function score(home: number, away: number): SetScore[] {
  const sets: SetScore[] = [];
  for (let i = 0; i < home; i++) sets.push([11, 5]);
  for (let i = 0; i < away; i++) sets.push([5, 11]);
  return sets;
}

describe('orden de partidos', () => {
  it('grupo de 4 sigue el orden del organizador: 1-3, 2-4, 1-2, 3-4, 1-4, 2-3', () => {
    assert.deepEqual(pairingsFor(4), [
      [0, 2],
      [1, 3],
      [0, 1],
      [2, 3],
      [0, 3],
      [1, 2],
    ]);
  });

  it('en grupos de 3 a 6 cada pareja juega exactamente una vez', () => {
    for (let size = 3; size <= 6; size++) {
      const keys = pairingsFor(size).map(([a, b]) => `${String(a)}-${String(b)}`);
      assert.equal(keys.length, (size * (size - 1)) / 2);
      assert.equal(new Set(keys).size, keys.length);
    }
  });
});

describe('cantidad y tamaño de grupos', () => {
  it('ningún grupo pasa del tamaño elegido', () => {
    assert.deepEqual(groupSizes(16, groupCountFor(16, 5)), [4, 4, 4, 4]);
    assert.deepEqual(groupSizes(16, groupCountFor(16, 6)), [6, 5, 5]);
    for (let players = 9; players <= 64; players++) {
      for (let size = 3; size <= 6; size++) {
        const sizes = groupSizes(players, groupCountFor(players, size));
        assert.ok(
          Math.min(...sizes) >= 3,
          `${String(players)} jugadores, grupos de ${String(size)}`,
        );
        assert.ok(
          Math.max(...sizes) <= Math.max(size, 3) || Math.min(...sizes) === 3,
          `${String(players)} jugadores, grupos de ${String(size)}: ${sizes.join(',')}`,
        );
      }
    }
  });

  it('el sorteo pone a los mejores del ranking como jugador 1 de cada grupo', () => {
    const players = Array.from({ length: 16 }, (_, i) => player(i + 1, 2000 - i * 10));
    const groups = drawGroups(players, 4);
    assert.deepEqual(
      groups.map((group) => group.players[0].bib),
      [1, 2, 3, 4],
    );
    const all = groups.flatMap((group) => group.players.map((p) => p.bib));
    assert.equal(new Set(all).size, 16);
  });
});

describe('sets y partidos', () => {
  it('un set vale con 11 y diferencia de 2, o más de 11 con diferencia exacta de 2', () => {
    assert.equal(setWinner([11, 9]), 0);
    assert.equal(setWinner([11, 10]), null);
    assert.equal(setWinner([10, 12]), 1);
    assert.equal(setWinner([13, 10]), null);
    assert.equal(setWinner([null, 11]), null);
  });

  it('un W.O. cuenta como 3-0 y 33-0', () => {
    const summary = summarizeMatch({ sets: [], walkover: 1 });
    assert.equal(summary.winner, 0);
    assert.deepEqual(summary.sets, [3, 0]);
    assert.deepEqual(summary.points, [33, 0]);
  });
});

describe('tabla del grupo', () => {
  const group: Group = { name: '1', players: [player(1), player(2), player(3), player(4)] };

  /** Results by pairing order for a group at index 0. */
  const resultsFor = (matches: SetScore[][], walkovers: Record<number, 0 | 1> = {}): Results =>
    Object.fromEntries(
      matches.map((sets, index) => [
        matchKey(0, index),
        index in walkovers ? { sets: [], walkover: walkovers[index] } : { sets },
      ]),
    );

  it('victoria 2 puntos, derrota 1, W.O. 0', () => {
    // Order: 1-3, 2-4, 1-2, 3-4, 1-4, 2-3. Lower number always wins; 4 doesn't show up vs 2.
    const results = resultsFor(
      [score(3, 0), [], score(3, 0), score(3, 0), score(3, 0), score(3, 0)],
      { 1: 1 },
    );
    const { rows } = computeGroupTable(group, 0, results);
    assert.deepEqual(
      rows.map((row) => [row.position, row.points]),
      [
        [1, 6],
        [2, 5],
        [3, 4],
        [4, 2],
      ],
    );
  });

  it('triple empate: se resuelve solo con los partidos entre los empatados (sets)', () => {
    // 1 beats 2 3-0, 2 beats 3 3-0, 3 beats 1 3-2; everyone beats 4.
    const results = resultsFor([
      score(2, 3), // 1-3: 3 wins
      score(3, 0), // 2-4
      score(3, 0), // 1-2
      score(3, 0), // 3-4
      score(3, 0), // 1-4
      score(3, 0), // 2-3
    ]);
    const { rows, ties } = computeGroupTable(group, 0, results);
    assert.deepEqual(
      rows.map((row) => row.position),
      [1, 2, 3, 4],
    );
    assert.equal(ties.length, 1);
    assert.equal(ties[0].players.length, 3);
    assert.equal(ties[0].decidedBy, 'sets');
    assert.deepEqual(
      getQualifiers(group, 0, results, 2).map((row) => row?.player.bib),
      [1, 2],
    );
  });

  it('sin terminar el grupo no hay clasificados', () => {
    const results = resultsFor([score(3, 0)]);
    assert.deepEqual(getQualifiers(group, 0, results, 2), [null, null]);
  });
});

describe('cambios manuales de grupo', () => {
  it('un jugador traído de otro grupo se intercambia con el que sale', () => {
    const [a, b, c, d, e, f] = [1, 2, 3, 4, 5, 6].map((bib) => player(bib));
    const groups: Group[] = [
      { name: '1', players: [a, b, c] },
      { name: '2', players: [d, e, f] },
    ];
    const { groups: next, touched } = replaceGroupPlayers(groups, 0, [a, e, c]);
    assert.deepEqual(
      next.map((group) => group.players.map((p) => p.bib)),
      [
        [1, 5, 3],
        [4, 2, 6],
      ],
    );
    assert.deepEqual(touched.toSorted(), [0, 1]);
  });
});

describe('llaves', () => {
  it('cabezas de serie en un cuadro de 64 como la planilla', () => {
    const positions = seedPositions(64, 8);
    assert.deepEqual(positions.slice(0, 2), [1, 64]);
    assert.deepEqual(
      positions.slice(2, 4).toSorted((x, y) => x - y),
      [32, 33],
    );
    assert.deepEqual(
      positions.slice(4, 8).toSorted((x, y) => x - y),
      [16, 17, 48, 49],
    );
  });

  it('el 2.º siempre cae en la mitad contraria a su 1.º', () => {
    for (let run = 0; run < 500; run++) {
      for (const groupCount of [2, 3, 4, 5, 8, 12, 16, 32]) {
        const draw = drawKnockout(groupCount);
        assert.deepEqual(draw.warnings, [], `${String(groupCount)} grupos`);
        assert.equal(draw.slots.filter((slot) => slot.kind === 'qualifier').length, groupCount * 2);
      }
    }
  });

  it('con 3 grupos (cuadro de 8) los 2 mejores primeros pasan con bye', () => {
    const draw = drawKnockout(3);
    assert.equal(draw.size, 8);
    assert.equal(draw.slots[1].kind, 'bye'); // next to 1.º G1 (position 1)
    assert.equal(draw.slots[6].kind, 'bye'); // next to 1.º G2 (position 8)
  });

  it('mover a mano intercambia posiciones sin perder ni duplicar a nadie', () => {
    const draw = drawKnockout(4);
    const moved = moveSlot(draw, 2, { kind: 'qualifier', place: 2, groupIndex: 0 });
    assert.deepEqual(moved.slots[1], { kind: 'qualifier', place: 2, groupIndex: 0 });
    const keys = (slots: typeof draw.slots) => slots.map((slot) => JSON.stringify(slot)).toSorted();
    assert.deepEqual(keys(moved.slots), keys(draw.slots));
    // 1.º and 2.º of group 1 are now both in the top half (positions 1 and 2).
    assert.ok(
      moved.warnings.some((warning) => warning.includes('grupo 1 están en la misma mitad')),
    );
  });
});

describe('inscripción', () => {
  it('el Nr. libre es el menor que no está usado', () => {
    assert.equal(nextFreeBib([player(1), player(2), player(4)]), 3);
    assert.equal(nextFreeBib([player(1), player(2)], [3]), 4);
  });

  it('ranking de mayor a menor, sin ranking al final', () => {
    const sorted = sortByRanking([player(1, null), player(2, 1500), player(3, 2000)]);
    assert.deepEqual(
      sorted.map((p) => p.bib),
      [3, 2, 1],
    );
  });

  it('lee la lista pegada y reporta las líneas mal escritas', () => {
    const { players, errors } = parsePlayerList(
      'Ana Gómez, Club Sur, 1700\nPedro Lara; Liga Este\n\nMal Ranking, X, abc',
    );
    assert.deepEqual(players, [
      { name: 'Ana Gómez', delegation: 'Club Sur', ranking: 1700 },
      { name: 'Pedro Lara', delegation: 'Liga Este', ranking: null },
    ]);
    assert.deepEqual(errors, ['Línea 4: el ranking «abc» no es un número.']);
  });
});
