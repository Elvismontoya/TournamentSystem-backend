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

/** The example tournament's only category: groups and bracket go under it. */
const CATEGORY = `/categorias/${encodeURIComponent('Mayores (Libre) · Masculino')}`;

/**
 * Each category has its own competition (view.categories[]). These tests use the example
 * tournament's only category: its draw, bracket and ranking are copied to the top of the view.
 */
function withCategory(data: Json): Json {
  const flat = (value: unknown): unknown => {
    if (typeof value !== 'object' || value === null) return value;
    const record = value as Record<string, unknown>;
    const categories = record.categories as Record<string, unknown>[] | undefined;
    const first = Array.isArray(categories) ? categories[0] : undefined;
    const view = record.view === undefined ? {} : { view: flat(record.view) };
    if (!first) return { ...record, ...view };
    const { seedIds, groupStage, knockout, ranking } = first;
    return { ...record, ...view, seedIds, groupStage, knockout, ranking };
  };
  return flat(data) as Json;
}

async function call(method: string, path: string, body?: unknown) {
  const scoped = /^\/(grupos|llaves)\b/.test(path) ? `${CATEGORY}${path}` : path;
  const response = await fetch(`${base}${scoped}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, data: withCategory((await response.json()) as Json) };
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
      gender: 'M',
    });
    assert.equal(added.status, 201);
    assert.equal((added.data.added as { bib: number }).bib, 17);

    const duplicate = await call('POST', '/participantes', {
      name: 'Otro',
      delegation: 'Club Norte',
      bib: 7,
    });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.data.error, 'El Nr. 7 ya es de Carlos Silva.');

    // The delegation is required ("Independiente" if none).
    const noDelegation = await call('POST', '/participantes', {
      name: 'Sin Liga',
      delegation: ' ',
      ranking: null,
      gender: 'M',
    });
    assert.equal(noDelegation.status, 400);
    assert.equal(noDelegation.data.error, 'Escribe la liga, delegación o club del jugador.');
  });

  it('importar: vista previa con errores por línea, luego importa', async () => {
    const preview = await call('POST', '/participantes/importar', {
      text: 'Nombre, Delegación, Ranking, Género\nAna Gómez, Club Sur, 1700, M\nMal, X, abc, M',
      dryRun: true,
    });
    // "Mal, X, abc" is the 3rd row (the header counts as row 1).
    assert.deepEqual(preview.data.errors, ['Fila 3: el ranking «abc» no es un número.']);

    const rejected = await call('POST', '/participantes/importar', { text: 'Mal, X, abc' });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.data.details?.length, 1);

    const imported = await call('POST', '/participantes/importar', {
      text: 'Nombre, Delegación, Ranking, Género\nAna Gómez, Club Sur, 1700, M\nPedro Lara; Liga Este; ; M',
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

  it('edita un jugador: el cambio se ve también en su grupo', async () => {
    const before = (await call('GET', '')).data as unknown as View;
    const target = before.groupStage?.groups[0].players[0];
    assert.ok(target);
    const taken = await call('PUT', `/participantes/${target.id}`, {
      name: 'Otro nombre',
      delegation: 'Club',
      ranking: 1000,
      bib: 12, // Marcos Ruiz
    });
    assert.equal(taken.status, 409);

    const { status, data } = await call('PUT', `/participantes/${target.id}`, {
      name: 'Nombre Editado',
      delegation: 'Club Editado',
      ranking: 1,
      bib: 99,
    });
    const view = data as unknown as View;
    assert.equal(status, 200);
    const edited = view.players.find((player) => player.id === target.id);
    assert.ok(edited);
    assert.equal(edited.name, 'Nombre Editado');
    assert.equal(edited.bib, 99);
    assert.equal(
      (view.groupStage?.groups[0].players[0] as { name?: string } | undefined)?.name,
      'Nombre Editado',
    );
  });

  it('elimina solo a jugadores sin grupo', async () => {
    const before = (await call('GET', '')).data as unknown as View;
    const inGroup = before.groupStage?.groups[0].players[0];
    assert.ok(inGroup);
    const blocked = await call('DELETE', `/participantes/${inGroup.id}`);
    assert.equal(blocked.status, 409);

    const added = await call('POST', '/participantes', {
      name: 'Sin Grupo',
      delegation: 'Club Norte',
      ranking: null,
      gender: 'M',
    });
    const newcomer = added.data.added as { id: string };
    const removed = await call('DELETE', `/participantes/${newcomer.id}`);
    const view = removed.data as unknown as View;
    assert.equal(removed.status, 200);
    assert.equal(view.players.length, before.players.length);
    assert.equal(view.groupStage?.withoutGroup.length, 0);
    assert.equal((await call('DELETE', `/participantes/${newcomer.id}`)).status, 404);
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

describe('Configuración del torneo', () => {
  const settings = {
    name: 'Open Nacional 2026 (editado)',
    sport: 'Tenis de mesa',
    format: 'Grupos + eliminación',
    modalities: ['Individual'],
    categories: ['Mayores (Libre)', 'Sub 13'],
    startDate: '2026-11-20',
    endDate: '2026-11-21',
    location: 'Coliseo Norte',
    defaultGroupSize: 4,
    seeded: true,
    setsPerMatch: 3,
    gamePoints: 11,
    winMargin: 2,
    knockoutSetsPerMatch: 5,
    pointsWin: 3,
    pointsLoss: 1,
    pointsWalkover: 0,
  };

  interface SettingsResponse extends View {
    name: string;
    settings: { setsPerMatch: number; setsToWin: number; rulesLocked: boolean };
  }

  it('rechaza valores inválidos', async () => {
    const noCategory = await call('PUT', '/configuracion', { ...settings, categories: [] });
    assert.equal(noCategory.status, 400);
    // Its only category has players: it can't be taken out.
    const removed = await call('PUT', '/configuracion', { ...settings, categories: ['Sub 13'] });
    assert.equal(removed.status, 409);
    const noStart = await call('PUT', '/configuracion', { ...settings, startDate: null });
    assert.equal(noStart.status, 400);
    const points = await call('PUT', '/configuracion', { ...settings, pointsWin: 1 });
    assert.equal(points.status, 400);
    const dates = await call('PUT', '/configuracion', { ...settings, endDate: '2026-11-01' });
    assert.equal(dates.status, 400);
    const sets = await call('PUT', '/configuracion', { ...settings, setsPerMatch: 4 });
    assert.equal(sets.status, 400);
  });

  it('guarda la configuración y aplica las reglas a los partidos', async () => {
    const saved = await call('PUT', '/configuracion', settings);
    const view = saved.data as unknown as SettingsResponse;
    assert.equal(saved.status, 200);
    assert.equal(view.name, settings.name);
    assert.equal(view.settings.setsPerMatch, 3);
    assert.equal(view.settings.setsToWin, 2);
    assert.equal(view.settings.rulesLocked, false);

    // Best of 3 now: two sets finish the match, and a win is worth 3 points.
    let after: SettingsResponse | null = null;
    for (let set = 0; set < 2; set++) {
      await call('PUT', `/grupos/1/partidos/0/sets/${String(set)}`, { side: 0, value: 11 });
      after = (await call('PUT', `/grupos/1/partidos/0/sets/${String(set)}`, { side: 1, value: 5 }))
        .data as unknown as SettingsResponse;
    }
    assert.ok(after?.groupStage);
    assert.equal(after.groupStage.groups[1].matches[0].summary.finished, true);
    assert.ok(after.groupStage.groups[1].table.rows.some((row) => row.points === 3));
    assert.equal(after.settings.rulesLocked, true);
  });

  it('con resultados cargados no deja cambiar las reglas de juego', async () => {
    const locked = await call('PUT', '/configuracion', { ...settings, setsPerMatch: 5 });
    assert.equal(locked.status, 409);
    // Everything else can still change.
    const renamed = await call('PUT', '/configuracion', { ...settings, location: 'Otro lugar' });
    assert.equal(renamed.status, 200);
  });
});

interface Entrant {
  kind: 'player' | 'bye' | 'pending';
  player?: { id: string; bib: number };
}
interface KnockoutMatch {
  round: number;
  index: number;
  entrants: Entrant[];
  playable: boolean;
  summary: { finished: boolean };
  advances: Entrant;
}
interface KnockoutResponse {
  name: string;
  settings: Record<string, unknown>;
  knockout: {
    rounds: KnockoutMatch[][];
    thirdPlace: KnockoutMatch | null;
    champion: { id: string } | null;
    finished: boolean;
    hasResults: boolean;
  };
  groupStage: { groups: { matches: unknown[] }[] };
  ranking: { position: number; player: { id: string }; reached: string }[] | null;
}

describe('Llaves: resultados y avance', () => {
  const knockoutPath = (match: { round: number; index: number }) =>
    `/llaves/rondas/${String(match.round)}/partidos/${String(match.index)}`;

  it('no deja cargar un partido sin sus dos jugadores', async () => {
    const view = (await call('GET', '')).data as unknown as KnockoutResponse;
    const waiting = view.knockout.rounds[0].find((match) => !match.playable);
    assert.ok(waiting);
    const blocked = await call('PUT', `${knockoutPath(waiting)}/wo`, { absent: 1 });
    assert.equal(blocked.status, 409);
  });

  it('al terminar los grupos, el ganador avanza a la ronda siguiente', async () => {
    // Close every group match: the second player never shows up.
    const groups = ((await call('GET', '')).data as unknown as KnockoutResponse).groupStage.groups;
    for (const [groupIndex, group] of groups.entries()) {
      for (let matchIndex = 0; matchIndex < group.matches.length; matchIndex++) {
        await call('PUT', `/grupos/${String(groupIndex)}/partidos/${String(matchIndex)}/wo`, {
          absent: 1,
        });
      }
    }
    let view = (await call('GET', '')).data as unknown as KnockoutResponse;
    const first = view.knockout.rounds[0].find((match) => match.playable);
    assert.ok(first);
    view = (await call('PUT', `${knockoutPath(first)}/wo`, { absent: 1 }))
      .data as unknown as KnockoutResponse;
    const played = view.knockout.rounds[0][first.index];
    assert.equal(played.summary.finished, true);
    assert.deepEqual(played.advances, played.entrants[0]);
    const next = view.knockout.rounds[1][Math.floor(first.index / 2)];
    assert.deepEqual(next.entrants[first.index % 2], played.entrants[0]);
    assert.equal(view.knockout.hasResults, true);
  });

  it('con resultados en las llaves no se cambian grupos, cuadro ni sets de llaves', async () => {
    assert.equal((await call('PUT', '/grupos/0/partidos/0/wo', { absent: 0 })).status, 409);
    assert.equal((await call('POST', '/llaves/sorteo')).status, 409);
    const moved = await call('PUT', '/llaves/posiciones/1', { slot: { kind: 'bye' } });
    assert.equal(moved.status, 409);
  });

  /** Saves Configuración with the current values, except for `thirdPlaceMatch`. */
  const setThirdPlace = async (thirdPlaceMatch: boolean) => {
    const { name, settings } = (await call('GET', '')).data as unknown as KnockoutResponse;
    return call('PUT', '/configuracion', { ...settings, name, thirdPlaceMatch });
  };

  it('activa el partido por el 3.er puesto', async () => {
    const saved = await setThirdPlace(true);
    assert.equal(saved.status, 200);
    const view = saved.data as unknown as KnockoutResponse;
    assert.equal(view.settings.thirdPlaceMatch, true);
    assert.ok(view.knockout.thirdPlace);
    assert.equal(view.knockout.thirdPlace.playable, false);
  });

  it('se juega hasta el campeón y no se puede cambiar un partido ya superado', async () => {
    let view = (await call('GET', '')).data as unknown as KnockoutResponse;
    for (let round = 0; round < view.knockout.rounds.length; round++) {
      for (const match of view.knockout.rounds[round]) {
        if (match.playable && !match.summary.finished) {
          view = (await call('PUT', `${knockoutPath(match)}/wo`, { absent: 1 }))
            .data as unknown as KnockoutResponse;
        }
      }
    }
    assert.ok(view.knockout.champion);
    const final = view.knockout.rounds.at(-1)?.[0];
    assert.ok(final);
    assert.equal(view.knockout.champion.id, final.entrants[0].player?.id);

    const semi = view.knockout.rounds.at(-2)?.find((match) => match.playable);
    assert.ok(semi);
    const changed = await call('PUT', `${knockoutPath(semi)}/wo`, { absent: 0 });
    assert.equal(changed.status, 409);
  });

  it('con campeón pero sin 3.er puesto, el torneo aún no termina', async () => {
    const view = (await call('GET', '')).data as unknown as KnockoutResponse;
    assert.equal(view.knockout.finished, false);
    assert.equal(view.ranking, null);
    assert.equal(view.knockout.thirdPlace?.playable, true);
  });

  it('al jugar el 3.er puesto sale la clasificación final', async () => {
    const before = (await call('GET', '')).data as unknown as KnockoutResponse;
    const third = before.knockout.thirdPlace;
    assert.ok(third);
    const { data } = await call('PUT', `${knockoutPath(third)}/wo`, { absent: 1 });
    const view = data as unknown as KnockoutResponse;
    assert.equal(view.knockout.finished, true);
    assert.ok(view.ranking);
    // Podium, then shared places (how many depends on the draw and its byes), in order.
    const positions = view.ranking.map((entry) => entry.position);
    assert.deepEqual(positions.slice(0, 5), [1, 2, 3, 4, 5]);
    assert.ok(
      positions.every((position, index) => index === 0 || position >= positions[index - 1]),
    );
    const inGroups = before.groupStage.groups.reduce(
      (sum, group) => sum + (group as unknown as { players: unknown[] }).players.length,
      0,
    );
    assert.equal(view.ranking.length, inGroups);
    assert.equal(view.ranking[0].player.id, view.knockout.champion?.id);
    assert.equal(view.ranking[2].player.id, third.entrants[0].player?.id);
    assert.equal(view.ranking[2].reached, 'Tercer puesto');

    // With its result entered, the semifinals are locked and it can't be turned off.
    const semi = view.knockout.rounds.at(-2)?.[0];
    assert.ok(semi);
    assert.equal((await call('PUT', `${knockoutPath(semi)}/wo`, { absent: 0 })).status, 409);
    assert.equal((await setThirdPlace(false)).status, 409);
  });

  it('borrado el 3.er puesto, se puede quitar y los semifinalistas comparten el 3.º', async () => {
    const before = (await call('GET', '')).data as unknown as KnockoutResponse;
    const third = before.knockout.thirdPlace;
    assert.ok(third);
    await call('PUT', `${knockoutPath(third)}/wo`, { absent: null });
    const saved = await setThirdPlace(false);
    assert.equal(saved.status, 200);
    const view = saved.data as unknown as KnockoutResponse;
    assert.equal(view.knockout.thirdPlace, null);
    assert.deepEqual(
      view.ranking?.slice(0, 5).map((entry) => entry.position),
      [1, 2, 3, 3, 5],
    );
  });
});

describe('Crear torneo', () => {
  const root = () => base.replace(/\/open-nacional-2026$/, '');
  async function request(method: string, path: string, data?: unknown) {
    const response = await fetch(`${root()}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    return { status: response.status, data: (await response.json()) as Record<string, unknown> };
  }
  const wizard = {
    name: 'Copa Sub 13 Ñandú',
    sport: 'Tenis de mesa',
    format: 'Grupos + eliminación',
    modalities: ['Individual'],
    categories: ['Sub 11', 'Sub 13'],
    divisions: ['Mixto'],
    startDate: '2026-12-05',
    endDate: null,
    location: '',
    defaultGroupSize: 3,
    qualifiersPerGroup: 1,
    seeded: false,
    scoring: 'sets',
    setsPerMatch: 5,
    gamePoints: 11,
    winMargin: 2,
    knockoutSetsPerMatch: 5,
    thirdPlaceMatch: true,
    pointsWin: 2,
    pointsLoss: 1,
    pointsWalkover: 0,
  };

  it('valida los obligatorios y crea el torneo con toda su configuración', async () => {
    assert.equal((await request('POST', '', { ...wizard, modalities: [] })).status, 400);
    assert.equal((await request('POST', '', { ...wizard, name: ' ' })).status, 400);

    const created = await request('POST', '', wizard);
    assert.equal(created.status, 201);
    const view = created.data as {
      id: string;
      players: unknown[];
      settings: { categories: string[]; scoring: string; qualifiersPerGroup: number };
    };
    assert.equal(view.id, 'copa-sub-13-nandu');
    assert.deepEqual(view.players, []);
    assert.deepEqual(view.settings.categories, ['Sub 11', 'Sub 13']);
    assert.equal(view.settings.scoring, 'sets');
    assert.equal(view.settings.qualifiersPerGroup, 1);

    // Same name again: a different id.
    const again = await request('POST', '', wizard);
    assert.equal((again.data as { id: string }).id, 'copa-sub-13-nandu-2');

    const list = await request('GET', '');
    const ids = (list.data as unknown as { id: string; registered: number }[]).map(
      (entry) => entry.id,
    );
    assert.ok(ids.includes('copa-sub-13-nandu'));
  });

  const sub11 = `/categorias/${encodeURIComponent('Sub 11 · Mixto')}`;
  const sub13 = `/categorias/${encodeURIComponent('Sub 13 · Mixto')}`;
  interface CategoryData {
    name: string;
    registered: number;
    groupStage: {
      groups: { players: { name: string }[]; matches: { summary: { finished: boolean } }[] }[];
    } | null;
  }
  const categoryOf = (data: Record<string, unknown>, name: string) =>
    (data.categories as CategoryData[]).find((category) => category.name === name);

  it('con «solo sets» se carga el marcador final y no los puntos de cada set', async () => {
    const id = '/copa-sub-13-nandu';
    for (const name of ['Ana', 'Bea', 'Caro']) {
      await request('POST', `${id}/participantes`, {
        name,
        delegation: 'Club',
        ranking: null,
        category: 'Sub 11',
      });
    }
    await request('POST', `${id}${sub11}/grupos/sorteo`, { groupSize: 3 });
    const path = `${id}${sub11}/grupos/0/partidos/0`;
    const bySet = await request('PUT', `${path}/sets/0`, { side: 0, value: 11 });
    assert.equal(bySet.status, 409);
    const tooMany = await request('PUT', `${path}/marcador`, { side: 0, value: 4 });
    assert.equal(tooMany.status, 400);
    await request('PUT', `${path}/marcador`, { side: 0, value: 3 });
    const { data } = await request('PUT', `${path}/marcador`, { side: 1, value: 1 });
    const match = categoryOf(data, 'Sub 11 · Mixto')?.groupStage?.groups.at(0)?.matches.at(0);
    assert.equal(match?.summary.finished, true);
  });

  it('cada categoría tiene sus propios grupos: no se mezclan', async () => {
    const id = '/copa-sub-13-nandu';
    // Two categories: the player's category is required.
    const missing = await request('POST', `${id}/participantes`, {
      name: 'Sin Cat',
      delegation: 'Club',
      ranking: null,
    });
    assert.equal(missing.status, 400);
    for (const name of ['Dani', 'Eva', 'Fer']) {
      await request('POST', `${id}/participantes`, {
        name,
        delegation: 'Club',
        ranking: null,
        category: 'Sub 13',
      });
    }
    const { data } = await request('POST', `${id}${sub13}/grupos/sorteo`, { groupSize: 3 });
    const sub13Names = categoryOf(data, 'Sub 13 · Mixto')?.groupStage?.groups.flatMap((group) =>
      group.players.map((player) => player.name),
    );
    assert.deepEqual(sub13Names?.toSorted(), ['Dani', 'Eva', 'Fer']);
    // Sub 11 keeps its own draw and its result.
    const sub11Names = categoryOf(data, 'Sub 11 · Mixto')?.groupStage?.groups.flatMap((group) =>
      group.players.map((player) => player.name),
    );
    assert.deepEqual(sub11Names?.toSorted(), ['Ana', 'Bea', 'Caro']);
    // A category the tournament doesn't have.
    const unknown = await request('POST', `${id}/categorias/Senior/grupos/sorteo`, {
      groupSize: 3,
    });
    assert.equal(unknown.status, 404);
  });

  it('al importar, cada categoría del archivo se asigna a una del torneo (o no se importa)', async () => {
    const id = '/copa-sub-13-nandu-2';
    const rows = [
      ['NUMBER', 'NOMBRE', 'LIGA', 'GENERO', 'IND', 'CATEG'],
      ['1', 'Gabi', 'AMAGÁ', 'F', 'X', 'PREJUVENIL'],
      ['2', 'Hugo', 'ANDES', 'M', 'X', 'JUVENIL'],
      ['3', 'Iris', 'JERICÓ', 'F', 'X', 'SUB11'],
    ];
    const preview = await request('POST', `${id}/participantes/importar`, { rows, dryRun: true });
    // "SUB11" is the tournament's "Sub 11"; the other two still need a decision.
    assert.equal((preview.data.errors as string[]).length, 2);
    const imported = await request('POST', `${id}/participantes/importar`, {
      rows,
      categoryMap: { PREJUVENIL: 'Sub 11', JUVENIL: null },
    });
    assert.equal(imported.status, 201);
    const players = (imported.data.view as { players: { name: string; category: string }[] })
      .players;
    assert.deepEqual(players.map((player) => `${player.name}: ${player.category}`).toSorted(), [
      'Gabi: Sub 11',
      'Iris: Sub 11',
    ]);
  });

  it('con un grupo único no hay llaves: la tabla del grupo es el resultado final', async () => {
    const id = '/copa-sub-13-nandu';
    // Sub 11 has a single group of 3 (match 0 already 3-1): play the other two.
    for (const match of [1, 2]) {
      const path = `${id}${sub11}/grupos/0/partidos/${String(match)}/marcador`;
      await request('PUT', path, { side: 0, value: 3 });
      await request('PUT', path, { side: 1, value: 0 });
    }
    const { data } = await request('GET', id);
    const sub11View = categoryOf(data, 'Sub 11 · Mixto') as CategoryData & {
      finished: boolean;
      singleGroup: boolean;
      champion: { name: string } | null;
      ranking: { position: number; reached: string; player: { name: string } }[] | null;
    };
    assert.equal(sub11View.singleGroup, true);
    assert.equal(sub11View.finished, true);
    const ranking = sub11View.ranking ?? [];
    assert.deepEqual(
      ranking.map((entry) => entry.position),
      [1, 2, 3],
    );
    const [first] = ranking;
    assert.ok(first);
    assert.equal(first.reached, 'Campeón');
    assert.equal(sub11View.champion?.name, first.player.name);
    const knockout = await request('POST', `${id}${sub11}/llaves/sorteo`);
    assert.equal(knockout.status, 409);
  });

  it('las ramas también se separan: masculino y femenino juegan aparte', async () => {
    const mixedWithOthers = await request('POST', '', {
      ...wizard,
      divisions: ['Mixto', 'Femenino'],
    });
    assert.equal(mixedWithOthers.status, 400);

    const created = await request('POST', '', {
      ...wizard,
      name: 'Copa por ramas',
      categories: ['Sub 13'],
      divisions: ['Masculino', 'Femenino'],
    });
    const id = `/${String(created.data.id)}`;
    assert.deepEqual(
      (created.data.categories as CategoryData[]).map((competition) => competition.name),
      ['Sub 13 · Masculino', 'Sub 13 · Femenino'],
    );
    // Without a gender there is no division to play in.
    const noGender = await request('POST', `${id}/participantes`, {
      name: 'X',
      delegation: 'Club',
      ranking: null,
    });
    assert.equal(noGender.status, 400);
    for (const [name, gender] of [
      ['Ana', 'F'],
      ['Bea', 'F'],
      ['Caro', 'F'],
      ['Dani', 'M'],
      ['Elio', 'M'],
      ['Fede', 'M'],
    ]) {
      await request('POST', `${id}/participantes`, {
        name,
        delegation: 'Club',
        gender,
        ranking: null,
      });
    }
    const women = `/categorias/${encodeURIComponent('Sub 13 · Femenino')}`;
    const { data } = await request('POST', `${id}${women}/grupos/sorteo`, { groupSize: 3 });
    const names = categoryOf(data, 'Sub 13 · Femenino')?.groupStage?.groups.flatMap((group) =>
      group.players.map((player) => player.name),
    );
    assert.deepEqual(names?.toSorted(), ['Ana', 'Bea', 'Caro']);
    assert.equal(categoryOf(data, 'Sub 13 · Masculino')?.registered, 3);
  });

  it('elimina a todos los jugadores (y sus grupos) solo si no hay resultados', async () => {
    // This one has a result entered: not allowed.
    const blocked = await request('DELETE', '/copa-sub-13-nandu/participantes');
    assert.equal(blocked.status, 409);

    const id = '/copa-sub-13-nandu-2';
    await request('POST', `${id}/participantes`, {
      name: 'Juan',
      delegation: 'Club',
      ranking: null,
      category: 'Sub 11',
    });
    await request('POST', `${id}${sub11}/grupos/sorteo`, { groupSize: 3 });
    const { status, data } = await request('DELETE', `${id}/participantes`);
    assert.equal(status, 200);
    assert.deepEqual(data.players, []);
    assert.equal(categoryOf(data, 'Sub 11 · Mixto')?.groupStage, null);
  });
});
describe('Eliminar torneo', () => {
  it('elimina el torneo', async () => {
    const removed = await fetch(base, { method: 'DELETE' });
    assert.equal(removed.status, 204);
    const gone = await fetch(base);
    assert.equal(gone.status, 404);
  });
});
