// Controllers: read the request, call a service, write the response (no rules here).
import type { Request, RequestHandler } from 'express';
import type { BracketSlot } from '../domain/knockout.ts';
import { textToRows } from '../domain/playerImport.ts';
import type { Gender } from '../domain/players.ts';
import { HttpError } from '../httpError.ts';
import * as service from '../services/tournament.service.ts';
import {
  body,
  bool,
  int,
  intOrNull,
  intParam,
  optionalStr,
  side,
  str,
  strList,
  strOrNull,
  textParam,
} from './parse.ts';

const id = (request: Request) => textParam(request, 'tournamentId');
/** Category of the competition (/categorias/:category/…), as in the settings. */
const category = (request: Request) => textParam(request, 'category');

export const getTournament: RequestHandler = (request, response) => {
  response.json(service.getTournament(id(request)));
};

/** Body of POST /api/torneos and PUT /configuracion: name plus every setting. */
function settingsBody(data: Record<string, unknown>): service.SettingsUpdate {
  const scoring = data.scoring === undefined ? undefined : str(data.scoring, 'scoring');
  if (scoring !== undefined && scoring !== 'points' && scoring !== 'sets') {
    throw new HttpError(400, '«scoring» debe ser "points" o "sets".');
  }
  return {
    name: str(data.name, 'name'),
    sport: str(data.sport, 'sport'),
    format: str(data.format, 'format'),
    modalities: strList(data.modalities, 'modalities'),
    categories: strList(data.categories, 'categories'),
    ...(data.divisions === undefined ? {} : { divisions: strList(data.divisions, 'divisions') }),
    startDate: strOrNull(data.startDate, 'startDate'),
    endDate: strOrNull(data.endDate, 'endDate'),
    location: optionalStr(data.location, 'location'),
    defaultGroupSize: int(data.defaultGroupSize, 'defaultGroupSize'),
    seeded: bool(data.seeded, 'seeded'),
    setsPerMatch: int(data.setsPerMatch, 'setsPerMatch'),
    gamePoints: int(data.gamePoints, 'gamePoints'),
    winMargin: int(data.winMargin, 'winMargin'),
    knockoutSetsPerMatch: int(data.knockoutSetsPerMatch, 'knockoutSetsPerMatch'),
    // Optional: left out, they keep their current value (or the default when creating).
    ...(scoring === undefined ? {} : { scoring }),
    ...(data.qualifiersPerGroup === undefined
      ? {}
      : { qualifiersPerGroup: int(data.qualifiersPerGroup, 'qualifiersPerGroup') }),
    ...(data.thirdPlaceMatch === undefined
      ? {}
      : { thirdPlaceMatch: bool(data.thirdPlaceMatch, 'thirdPlaceMatch') }),
    pointsWin: int(data.pointsWin, 'pointsWin'),
    pointsLoss: int(data.pointsLoss, 'pointsLoss'),
    pointsWalkover: int(data.pointsWalkover, 'pointsWalkover'),
  };
}

export const listTournaments: RequestHandler = (_request, response) => {
  response.json(service.listTournaments());
};

export const createTournament: RequestHandler = (request, response) => {
  response.status(201).json(service.createTournament(settingsBody(body(request))));
};

export const updateSettings: RequestHandler = (request, response) => {
  response.json(service.updateSettings(id(request), settingsBody(body(request))));
};

export const deleteTournament: RequestHandler = (request, response) => {
  service.deleteTournament(id(request));
  response.sendStatus(204);
};

/** "F", "M" or null (not given). */
function genderOf(value: unknown): Gender | null {
  if (value === undefined || value === null || value === '') return null;
  if (value === 'F' || value === 'M') return value;
  throw new HttpError(400, '«gender» debe ser "F", "M" o null.');
}

/** Gender and category of a player, only when sent (an edit may leave them out). */
function playerDetails(data: Record<string, unknown>): {
  gender?: Gender | null;
  category?: string | null;
} {
  return {
    ...(data.gender === undefined ? {} : { gender: genderOf(data.gender) }),
    ...(data.category === undefined ? {} : { category: strOrNull(data.category, 'category') }),
  };
}

export const addPlayer: RequestHandler = (request, response) => {
  const data = body(request);
  const bib = intOrNull(data.bib, 'bib');
  const individual = data.individual === undefined ? true : bool(data.individual, 'individual');
  const result = service.addPlayer(id(request), {
    name: str(data.name, 'name'),
    delegation: optionalStr(data.delegation, 'delegation'),
    ranking: intOrNull(data.ranking, 'ranking'),
    ...(bib === null ? {} : { bib }),
    ...playerDetails(data),
    modalities: { individual, doubles: null, mixed: null, team: null },
  });
  response.status(201).json(result);
};

const playerId = (request: Request) => textParam(request, 'playerId');

export const updatePlayer: RequestHandler = (request, response) => {
  const data = body(request);
  response.json(
    service.updatePlayer(id(request), playerId(request), {
      name: str(data.name, 'name'),
      delegation: optionalStr(data.delegation, 'delegation'),
      ranking: intOrNull(data.ranking, 'ranking'),
      bib: int(data.bib, 'bib'),
      ...playerDetails(data),
    }),
  );
};
export const removeAllPlayers: RequestHandler = (request, response) => {
  response.json(service.removeAllPlayers(id(request)));
};

export const removePlayer: RequestHandler = (request, response) => {
  response.json(service.removePlayer(id(request), playerId(request)));
};

/** Rows of the spreadsheet: a list of rows, each a list of cell texts. */
function rowsOf(value: unknown): string[][] {
  if (
    !Array.isArray(value) ||
    !value.every((row) => Array.isArray(row) && row.every((cell) => typeof cell === 'string'))
  ) {
    throw new HttpError(400, '«rows» debe ser una lista de filas (listas de textos).');
  }
  return value;
}

/**
 * Imports players from a spreadsheet: { rows } (cells of the first sheet, read by the
 * frontend) or { text } (a pasted list). With { dryRun: true } it only reads them and
 * returns what would be imported, with every problem found.
 */
export const importPlayers: RequestHandler = (request, response) => {
  const data = body(request);
  const rows = data.rows === undefined ? textToRows(str(data.text, 'text')) : rowsOf(data.rows);
  const map = categoryMapOf(data.categoryMap);
  if (data.dryRun === true) {
    response.json(service.previewImport(id(request), rows, map));
    return;
  }
  response.status(201).json(service.importPlayers(id(request), rows, map));
};

/** { "JUVENIL": "Sub 19", "PREJUVENIL": null } — file category → tournament category or null. */
function categoryMapOf(value: unknown): service.CategoryMap {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(
      400,
      '«categoryMap» debe ser un objeto { categoría del archivo: categoría }.',
    );
  }
  const map: service.CategoryMap = {};
  for (const [from, to] of Object.entries(value as Record<string, unknown>)) {
    if (to !== null && typeof to !== 'string') {
      throw new HttpError(400, '«categoryMap»: cada valor debe ser una categoría o null.');
    }
    map[from] = to;
  }
  return map;
}

export const previewGroupDraw: RequestHandler = (request, response) => {
  const size = Number(request.query.tamano);
  if (!Number.isInteger(size)) throw new HttpError(400, '«tamano» debe ser un número entero.');
  response.json(service.previewGroupDraw(id(request), category(request), size));
};

export const drawGroups: RequestHandler = (request, response) => {
  const groupSize = int(body(request).groupSize, 'groupSize');
  response.json(service.drawTournamentGroups(id(request), category(request), groupSize));
};

export const setGroupPlayers: RequestHandler = (request, response) => {
  const { playerIds } = body(request);
  if (!Array.isArray(playerIds) || !playerIds.every((value) => typeof value === 'string')) {
    throw new HttpError(400, '«playerIds» debe ser una lista de ids.');
  }
  response.json(
    service.setGroupPlayers(
      id(request),
      category(request),
      intParam(request, 'groupIndex'),
      playerIds,
    ),
  );
};

export const updateSet: RequestHandler = (request, response) => {
  const data = body(request);
  response.json(
    service.updateSet(
      id(request),
      category(request),
      intParam(request, 'groupIndex'),
      intParam(request, 'matchIndex'),
      intParam(request, 'setIndex'),
      side(data.side, 'side'),
      intOrNull(data.value, 'value'),
    ),
  );
};

export const updateScore: RequestHandler = (request, response) => {
  const data = body(request);
  response.json(
    service.updateScore(
      id(request),
      category(request),
      intParam(request, 'groupIndex'),
      intParam(request, 'matchIndex'),
      side(data.side, 'side'),
      intOrNull(data.value, 'value'),
    ),
  );
};

export const updateKnockoutScore: RequestHandler = (request, response) => {
  const data = body(request);
  response.json(
    service.updateKnockoutScore(
      id(request),
      category(request),
      intParam(request, 'round'),
      intParam(request, 'matchIndex'),
      side(data.side, 'side'),
      intOrNull(data.value, 'value'),
    ),
  );
};

export const setWalkover: RequestHandler = (request, response) => {
  const { absent } = body(request);
  response.json(
    service.setWalkover(
      id(request),
      category(request),
      intParam(request, 'groupIndex'),
      intParam(request, 'matchIndex'),
      absent === null ? null : side(absent, 'absent'),
    ),
  );
};

export const drawKnockout: RequestHandler = (request, response) => {
  response.json(service.drawTournamentKnockout(id(request), category(request)));
};

function slotOf(value: unknown): BracketSlot {
  const data =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  if (data.kind === 'bye') return { kind: 'bye' };
  if (data.kind === 'qualifier') {
    const place = int(data.place, 'slot.place');
    if (place !== 1 && place !== 2) throw new HttpError(400, '«slot.place» debe ser 1 o 2.');
    return { kind: 'qualifier', place, groupIndex: int(data.groupIndex, 'slot.groupIndex') };
  }
  throw new HttpError(
    400,
    '«slot» debe ser { kind: "qualifier", place, groupIndex } o { kind: "bye" }.',
  );
}

export const updateKnockoutSet: RequestHandler = (request, response) => {
  const data = body(request);
  response.json(
    service.updateKnockoutSet(
      id(request),
      category(request),
      intParam(request, 'round'),
      intParam(request, 'matchIndex'),
      intParam(request, 'setIndex'),
      side(data.side, 'side'),
      intOrNull(data.value, 'value'),
    ),
  );
};

export const setKnockoutWalkover: RequestHandler = (request, response) => {
  const { absent } = body(request);
  response.json(
    service.setKnockoutWalkover(
      id(request),
      category(request),
      intParam(request, 'round'),
      intParam(request, 'matchIndex'),
      absent === null ? null : side(absent, 'absent'),
    ),
  );
};

export const moveKnockoutSlot: RequestHandler = (request, response) => {
  response.json(
    service.moveKnockoutSlot(
      id(request),
      category(request),
      intParam(request, 'position'),
      slotOf(body(request).slot),
    ),
  );
};
