// Routes: only map URL + method to a controller. Mounted at /api/torneos.
import { Router } from 'express';
import * as controller from '../controllers/tournaments.controller.ts';

export const tournamentsRouter = Router();

const base = '/:tournamentId';
/** Each category plays its own competition: groups and bracket go under its name. */
const stage = `${base}/categorias/:category`;

tournamentsRouter.get('/', controller.listTournaments);
tournamentsRouter.post('/', controller.createTournament);
tournamentsRouter.get(base, controller.getTournament);
tournamentsRouter.delete(base, controller.deleteTournament);

// Settings
tournamentsRouter.put(`${base}/configuracion`, controller.updateSettings);

// Registration
tournamentsRouter.post(`${base}/participantes`, controller.addPlayer);
tournamentsRouter.post(`${base}/participantes/importar`, controller.importPlayers);
tournamentsRouter.delete(`${base}/participantes`, controller.removeAllPlayers);
tournamentsRouter.put(`${base}/participantes/:playerId`, controller.updatePlayer);
tournamentsRouter.delete(`${base}/participantes/:playerId`, controller.removePlayer);

// Group stage
tournamentsRouter.get(`${stage}/grupos/vista-previa`, controller.previewGroupDraw);
tournamentsRouter.post(`${stage}/grupos/sorteo`, controller.drawGroups);
tournamentsRouter.put(`${stage}/grupos/:groupIndex/jugadores`, controller.setGroupPlayers);
tournamentsRouter.put(
  `${stage}/grupos/:groupIndex/partidos/:matchIndex/sets/:setIndex`,
  controller.updateSet,
);
tournamentsRouter.put(
  `${stage}/grupos/:groupIndex/partidos/:matchIndex/marcador`,
  controller.updateScore,
);
tournamentsRouter.put(
  `${stage}/grupos/:groupIndex/partidos/:matchIndex/wo`,
  controller.setWalkover,
);

// Knockout
tournamentsRouter.post(`${stage}/llaves/sorteo`, controller.drawKnockout);
tournamentsRouter.put(`${stage}/llaves/posiciones/:position`, controller.moveKnockoutSlot);
tournamentsRouter.put(
  `${stage}/llaves/rondas/:round/partidos/:matchIndex/sets/:setIndex`,
  controller.updateKnockoutSet,
);
tournamentsRouter.put(
  `${stage}/llaves/rondas/:round/partidos/:matchIndex/marcador`,
  controller.updateKnockoutScore,
);
tournamentsRouter.put(
  `${stage}/llaves/rondas/:round/partidos/:matchIndex/wo`,
  controller.setKnockoutWalkover,
);
