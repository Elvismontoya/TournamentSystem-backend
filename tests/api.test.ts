// API tests: real HTTP requests against the app (in-memory example tournament).
// Run with: npm test

import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../src/app.ts';

type Json = Record<string, unknown> & {
  error?: string;
  details?: string[];
};

let base = '';
let close: () => void = () => undefined;

before(async () => {
  const server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://localhost:${String((server.address() as AddressInfo).port)}/api/torneos/open-nacional-2026`;
  close = () => server.close();
});
after(() => {
  close();
});

async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: (await response.json()) as Json };
}

interface View {
  players: { id: string; bib: number; name: string }[];
  nextBib: number;
  seedIds: string[];
  groupStage: {
    groups: {
      players: { id: string }[];
      matches: { summary: { finished: boolean; winner: number | null }; notation: string[] }[];
      table: { rows: { points: number }[] };
      finished: number;
    }[];
    withoutGroup: unknown[];
    hasResults: boolean;
  } | null;
  knockout: { size: number; slots: unknown[]; warnings: string[] } | null;
}

describe('API del torneo', () => {
  it('devuelve el torneo de ejemplo', async () => {
    const { status, data } = await call('GET', '');
    const view = data as unknown as View;
    assert.equal(status, 200);
    assert.equal(view.players.length, 16);
    assert.equal(view.nextBib, 17);
    assert.equal(view.seedIds.length, 4);
    assert.equal(view.groupStage, null);
  });

  it('404 si el torneo no existe', async () => {
    const response = await fetch(base.replace('open-nacional-2026', 'no-existe'));
    assert.equal(response.status, 404);
  });

  it('inscribe un jugador y rechaza un Nr. repetido', async () => {
    const added = await call('POST', '/participantes', {
      name: 'Luis Campos',
      delegation: 'Club Norte',
      ranking: 2300,
    });
    assert.equal(added.status, 201);
    assert.equal((added.data.added as { bib: number }).bib, 17);

    const duplicate = await call('POST', '/participantes', { name: 'Otro', bib: 7 });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.data.error, 'El Nr. 7 ya es de Carlos Silva.');
  });

  it('importar: vista previa con errores por línea, luego importa', async () => {
    const preview = await call('POST', '/participantes/importar', {
      text: 'Nombre, Delegación, Ranking\nAna Gómez, Club Sur, 1700\nMal, X, abc',
      dryRun: true,
    });
    // "Mal, X, abc" is the 3rd line the user typed (the header counts as line 1).
    assert.deepEqual(preview.data.errors, ['Línea 3: el ranking «abc» no es un número.']);

    const rejected = await call('POST', '/participantes/importar', { text: 'Mal, X, abc' });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.data.details?.length, 1);

    const imported = await call('POST', '/participantes/importar', {
      text: 'Ana Gómez, Club Sur, 1700\nPedro Lara; Liga Este',
    });
    assert.equal(imported.status, 201);
    assert.equal((imported.data.view as View).players.length, 19);
  });

  it('vista previa y sorteo de grupos', async () => {
    const preview = await call('GET', '/grupos/vista-previa?tamano=4');
    assert.deepEqual(preview.data.sizes, [4, 4, 4, 4, 3]);

    const invalid = await call('POST', '/grupos/sorteo', { groupSize: 9 });
    assert.equal(invalid.status, 400);

    const drawn = await call('POST', '/grupos/sorteo', { groupSize: 4 });
    const view = drawn.data as unknown as View;
    assert.equal(drawn.status, 200);
    assert.ok(view.groupStage);
    assert.equal(view.groupStage.groups.length, 5);
    assert.equal(view.groupStage.withoutGroup.length, 0);
  });

  it('carga sets: el partido termina 3-0 y suma en la tabla', async () => {
    let view: View | null = null;
    for (let set = 0; set < 3; set++) {
      await call('PUT', `/grupos/0/partidos/0/sets/${String(set)}`, { side: 0, value: 11 });
      view = (await call('PUT', `/grupos/0/partidos/0/sets/${String(set)}`, { side: 1, value: 7 }))
        .data as unknown as View;
    }
    assert.ok(view?.groupStage);
    const match = view.groupStage.groups[0].matches[0];
    assert.equal(match.summary.finished, true);
    assert.equal(match.summary.winner, 0);
    assert.deepEqual(match.notation, ['7, 7, 7', '-7, -7, -7']);
    assert.equal(view.groupStage.hasResults, true);

    const redraw = await call('POST', '/grupos/sorteo', { groupSize: 4 });
    assert.equal(redraw.status, 409);
  });

  it('W.O.: el ausente pierde 3-0 y no se pueden cargar sets encima', async () => {
    const { data } = await call('PUT', '/grupos/0/partidos/1/wo', { absent: 1 });
    const stage = (data as unknown as View).groupStage;
    assert.ok(stage);
    assert.equal(stage.groups[0].matches[1].summary.winner, 0);
    const blocked = await call('PUT', '/grupos/0/partidos/1/sets/0', { side: 0, value: 11 });
    assert.equal(blocked.status, 409);
  });

  it('editar un grupo intercambia jugadores y borra sus resultados', async () => {
    const before = (await call('GET', '')).data as unknown as View;
    const [groupA, groupB] = before.groupStage?.groups ?? [];
    const ids = groupA.players.map((player) => player.id);
    ids[1] = groupB.players[1].id;
    const { status, data } = await call('PUT', '/grupos/0/jugadores', { playerIds: ids });
    const view = data as unknown as View;
    assert.equal(status, 200);
    assert.ok(view.groupStage);
    assert.equal(view.groupStage.groups[0].players[1].id, groupB.players[1].id);
    assert.equal(view.groupStage.groups[1].players[1].id, groupA.players[1].id);
    assert.equal(view.groupStage.groups[0].finished, 0);
  });

  it('sortea las llaves y mueve una posición a mano', async () => {
    const drawn = (await call('POST', '/llaves/sorteo')).data as unknown as View;
    assert.ok(drawn.knockout);
    assert.equal(drawn.knockout.size, 16);
    assert.deepEqual(drawn.knockout.warnings, []);

    const moved = await call('PUT', '/llaves/posiciones/2', {
      slot: { kind: 'qualifier', place: 2, groupIndex: 0 },
    });
    const knockout = (moved.data as unknown as View).knockout;
    assert.ok(knockout);
    assert.deepEqual(knockout.slots[1], { kind: 'qualifier', place: 2, groupIndex: 0 });
    assert.ok(knockout.warnings.some((warning) => warning.includes('grupo 1')));
  });
});
