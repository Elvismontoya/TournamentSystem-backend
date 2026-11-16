// Routes: only map URL + method to a controller. Mounted at /api/torneos.
import { Router } from 'express';
import * as controller from '../controllers/tournaments.controller.ts';

export const tournamentsRouter = Router();

const base = '/:tournamentId';

tournamentsRouter.get('/', controller.listTournaments);
tournamentsRouter.post('/', controller.createTournament);
tournamentsRouter.get(base, controller.getTournament);
tournamentsRouter.delete(base, controller.deleteTournament);

// Settings
tournamentsRouter.put(`${base}/configuracion`, controller.updateSettings);

// Registration
tournamentsRouter.post(`${base}/participantes`, controller.addPlayer);
tournamentsRouter.post(`${base}/participantes/importar`, controller.importPlayers);
tournamentsRouter.put(`${base}/participantes/:playerId`, controller.updatePlayer);
tournamentsRouter.delete(`${base}/participantes/:playerId`, controller.removePlayer);

// Group stage
tournamentsRouter.get(`${base}/grupos/vista-previa`, controller.previewGroupDraw);
tournamentsRouter.post(`${base}/grupos/sorteo`, controller.drawGroups);
tournamentsRouter.put(`${base}/grupos/:groupIndex/jugadores`, controller.setGroupPlayers);
tournamentsRouter.put(
  `${base}/grupos/:groupIndex/partidos/:matchIndex/sets/:setIndex`,
  controller.updateSet,
);
tournamentsRouter.put(
  `${base}/grupos/:groupIndex/partidos/:matchIndex/marcador`,
  controller.updateScore,
);
tournamentsRouter.put(`${base}/grupos/:groupIndex/partidos/:matchIndex/wo`, controller.setWalkover);

// Knockout
tournamentsRouter.post(`${base}/llaves/sorteo`, controller.drawKnockout);
tournamentsRouter.put(`${base}/llaves/posiciones/:position`, controller.moveKnockoutSlot);
tournamentsRouter.put(
  `${base}/llaves/rondas/:round/partidos/:matchIndex/sets/:setIndex`,
  controller.updateKnockoutSet,
);
tournamentsRouter.put(
  `${base}/llaves/rondas/:round/partidos/:matchIndex/marcador`,
  controller.updateKnockoutScore,
);
tournamentsRouter.put(
  `${base}/llaves/rondas/:round/partidos/:matchIndex/wo`,
  controller.setKnockoutWalkover,
);
