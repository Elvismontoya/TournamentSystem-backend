// Routes: only map URL + method to a controller. Mounted at /api/torneos.
import { Router } from 'express';
import * as controller from '../controllers/tournaments.controller.ts';

export const tournamentsRouter = Router();

const base = '/:tournamentId';

tournamentsRouter.get(base, controller.getTournament);

// Registration
tournamentsRouter.post(`${base}/participantes`, controller.addPlayer);
tournamentsRouter.post(`${base}/participantes/importar`, controller.importPlayers);

// Group stage
tournamentsRouter.get(`${base}/grupos/vista-previa`, controller.previewGroupDraw);
tournamentsRouter.post(`${base}/grupos/sorteo`, controller.drawGroups);
tournamentsRouter.put(`${base}/grupos/:groupIndex/jugadores`, controller.setGroupPlayers);
tournamentsRouter.put(
  `${base}/grupos/:groupIndex/partidos/:matchIndex/sets/:setIndex`,
  controller.updateSet,
);
tournamentsRouter.put(`${base}/grupos/:groupIndex/partidos/:matchIndex/wo`, controller.setWalkover);

// Knockout
tournamentsRouter.post(`${base}/llaves/sorteo`, controller.drawKnockout);
tournamentsRouter.put(`${base}/llaves/posiciones/:position`, controller.moveKnockoutSlot);
