// Controllers: read the request, call a service, write the response (no rules here).
import type { Request, RequestHandler } from 'express';
import type { BracketSlot } from '../domain/knockout.ts';
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

export const addPlayer: RequestHandler = (request, response) => {
  const data = body(request);
  const bib = intOrNull(data.bib, 'bib');
  const result = service.addPlayer(id(request), {
    name: str(data.name, 'name'),
    delegation: optionalStr(data.delegation, 'delegation'),
    ranking: intOrNull(data.ranking, 'ranking'),
    ...(bib === null ? {} : { bib }),
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
    }),
  );
};

export const removePlayer: RequestHandler = (request, response) => {
  response.json(service.removePlayer(id(request), playerId(request)));
};

/** With { dryRun: true } it only reads the list and returns what would be imported. */
export const importPlayers: RequestHandler = (request, response) => {
  const data = body(request);
  const text = str(data.text, 'text');
  if (data.dryRun === true) {
    response.json(service.previewImport(text));
    return;
  }
  response.status(201).json(service.importPlayers(id(request), text));
};

export const previewGroupDraw: RequestHandler = (request, response) => {
  const size = Number(request.query.tamano);
  if (!Number.isInteger(size)) throw new HttpError(400, '«tamano» debe ser un número entero.');
  response.json(service.previewGroupDraw(id(request), size));
};

export const drawGroups: RequestHandler = (request, response) => {
  const groupSize = int(body(request).groupSize, 'groupSize');
  response.json(service.drawTournamentGroups(id(request), groupSize));
};

export const setGroupPlayers: RequestHandler = (request, response) => {
  const { playerIds } = body(request);
  if (!Array.isArray(playerIds) || !playerIds.every((value) => typeof value === 'string')) {
    throw new HttpError(400, '«playerIds» debe ser una lista de ids.');
  }
  response.json(service.setGroupPlayers(id(request), intParam(request, 'groupIndex'), playerIds));
};

export const updateSet: RequestHandler = (request, response) => {
  const data = body(request);
  response.json(
    service.updateSet(
      id(request),
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
      intParam(request, 'groupIndex'),
      intParam(request, 'matchIndex'),
      absent === null ? null : side(absent, 'absent'),
    ),
  );
};

export const drawKnockout: RequestHandler = (request, response) => {
  response.json(service.drawTournamentKnockout(id(request)));
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
      intParam(request, 'position'),
      slotOf(body(request).slot),
    ),
  );
};
