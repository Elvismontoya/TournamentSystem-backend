// Express app: middleware, routes and error handling (no listen, so it can be tested).
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { HttpError } from './httpError.ts';
import { apiRouter } from './routes/index.ts';

/**
 * CORS for the frontend, which runs on another origin (another port in development, another
 * domain in production). Allowed origins come from CORS_ORIGINS, comma separated.
 */
function cors(allowed: string[]): RequestHandler {
  return (request, response, next) => {
    const origin = request.headers.origin;
    if (origin && allowed.includes(origin)) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
      response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (request.method === 'OPTIONS') {
      response.sendStatus(204);
      return;
    }
    next();
  };
}

export function createApp() {
  const app = express();
  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.use(cors(origins));
  app.use(express.json());

  app.use('/api', apiRouter);

  app.use((_request, response) => {
    response.status(404).json({ error: 'Ruta no encontrada.' });
  });

  const handleError: ErrorRequestHandler = (error: unknown, _request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    if (error instanceof HttpError) {
      response.status(error.status).json({ error: error.message, details: error.details });
      return;
    }
    if (error instanceof SyntaxError) {
      response.status(400).json({ error: 'El cuerpo de la petición no es JSON válido.' });
      return;
    }
    console.error(error);
    response.status(500).json({ error: 'Error interno del servidor.' });
  };
  app.use(handleError);

  return app;
}
