// All API routes, mounted at /api.
import { Router } from 'express';
import { tournamentsRouter } from './tournaments.routes.ts';

export const apiRouter = Router();

apiRouter.get('/health', (_request, response) => {
  response.json({ status: 'ok' });
});

apiRouter.use('/torneos', tournamentsRouter);
