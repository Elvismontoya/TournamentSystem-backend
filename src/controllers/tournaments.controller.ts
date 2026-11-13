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
  strOrNull,
  textParam,
} from './parse.ts';

const id = (request: Request) => textParam(request, 'tournamentId');

export const getTournament: RequestHandler = (request, response) => {
  response.json(service.getTournament(id(request)));
};

export const updateSettings: RequestHandler = (request, response) => {
  const data = body(request);
  response.json(
    service.updateSettings(id(request), {
      name: str(data.name, 'name'),
      sport: optionalStr(data.sport, 'sport'),
      category: optionalStr(data.category, 'category'),
      startDate: strOrNull(data.startDate, 'startDate'),
      endDate: strOrNull(data.endDate, 'endDate'),
      location: optionalStr(data.location, 'location'),
      courts: intOrNull(data.courts, 'courts'),
      participantType: optionalStr(data.participantType, 'participantType'),
      format: optionalStr(data.format, 'format'),
      capacity: int(data.capacity, 'capacity'),
      defaultGroupSize: int(data.defaultGroupSize, 'defaultGroupSize'),
      seeded: bool(data.seeded, 'seeded'),
      setsPerMatch: int(data.setsPerMatch, 'setsPerMatch'),
      gamePoints: int(data.gamePoints, 'gamePoints'),
      winMargin: int(data.winMargin, 'winMargin'),
      knockoutSetsPerMatch: int(data.knockoutSetsPerMatch, 'knockoutSetsPerMatch'),
      pointsWin: int(data.pointsWin, 'pointsWin'),
      pointsLoss: int(data.pointsLoss, 'pointsLoss'),
      pointsWalkover: int(data.pointsWalkover, 'pointsWalkover'),
    }),
  );
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
