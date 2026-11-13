# TournamentSystem-backend

API for the tournament platform: Node.js + Express. It holds the **tournament rules** and the
data. The frontend (the **TournamentSystem** project) only shows what this API returns.

## Getting started

```bash
npm install
npm run dev        # http://localhost:3000/api (restarts on change)
```

Node 22.18+ runs the `.ts` files directly, with no build step. That is why only erasable syntax
is used (`erasableSyntaxOnly`): no `enum`s and no `namespace`s.

**Data is in memory for now.** The server starts with the example tournament
(`open-nacional-2026`, 16 players), and every restart goes back to it.

## Configuration (`.env`, see `.env.example`)

| Variable       | Default                 | What                                                        |
| -------------- | ----------------------- | ----------------------------------------------------------- |
| `PORT`         | `3000`                  | Port.                                                       |
| `CORS_ORIGINS` | `http://localhost:5173` | Frontend origins allowed to call the API (comma separated). |
| `DATABASE_URL` | —                       | Supabase PostgreSQL (when the repositories use it).         |

## Layers

`server.ts → app.ts → routes → controllers → services → repositories → models`

| Folder / file   | Does                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| `server.ts`     | Starts the HTTP server.                                                                                     |
| `app.ts`        | Express: CORS, JSON, `/api`, 404 and errors (`HttpError` → status + message).                               |
| `routes/`       | URL + method → controller.                                                                                  |
| `controllers/`  | Read the request (type checks, 400), call a service, respond.                                               |
| `services/`     | The actions: validate, apply the rules (`domain/`), save. `tournament.view.ts` builds what the API returns. |
| `domain/`       | **Tournament rules**: pure functions (registration, groups, ITTF tie-breaks, brackets).                     |
| `repositories/` | Storage. Today an in-memory map; later Sequelize + Supabase, same functions.                                |
| `models/`       | What is stored for a tournament.                                                                            |
| `data/`         | Example tournament (seed).                                                                                  |

Group tables, positions and qualifiers are **not** stored: they are computed from the results
on every request.

## Endpoints

Base: `/api/torneos/:tournamentId`. Every change returns the updated tournament (the same as
the `GET`), with everything already computed.

| Method | Route                                                     | Body                                      |
| ------ | --------------------------------------------------------- | ----------------------------------------- |
| GET    | `/`                                                       | —                                         |
| POST   | `/participantes`                                          | `{ name, delegation?, ranking?, bib? }`   |
| POST   | `/participantes/importar`                                 | `{ text, dryRun? }` (`dryRun`: read only) |
| GET    | `/grupos/vista-previa?tamano=4`                           | —                                         |
| POST   | `/grupos/sorteo`                                          | `{ groupSize }`                           |
| PUT    | `/grupos/:groupIndex/jugadores`                           | `{ playerIds }`                           |
| PUT    | `/grupos/:groupIndex/partidos/:matchIndex/sets/:setIndex` | `{ side: 0 \| 1, value }`                 |
| PUT    | `/grupos/:groupIndex/partidos/:matchIndex/wo`             | `{ absent: 0 \| 1 \| null }`              |
| POST   | `/llaves/sorteo`                                          | —                                         |
| PUT    | `/llaves/posiciones/:position`                            | `{ slot }`                                |

Plus `GET /api/health`. Errors answer `{ error, details? }` (e.g. one message per invalid line
of an imported list).

The response shapes are in `src/services/tournament.view.ts`. The frontend copies them in its
`src/api/types.ts`: when they change, update both.

## Scripts

| Script              | Does                                   |
| ------------------- | -------------------------------------- |
| `npm run dev`       | Development (restarts on change).      |
| `npm start`         | Production.                            |
| `npm test`          | Rules tests and API tests (real HTTP). |
| `npm run typecheck` | TypeScript.                            |
| `npm run lint`      | ESLint.                                |
| `npm run format`    | Prettier.                              |

## Next steps

1. Sequelize + Supabase in `repositories/` (same functions: `findTournament`,
   `saveTournament`), with Nr. unique per tournament (`UNIQUE (torneo_id, nr)`).
2. Create and list tournaments (today there is only the example one).
3. Deploy on Railway (`npm start`) with `CORS_ORIGINS` set to the frontend's domain.
