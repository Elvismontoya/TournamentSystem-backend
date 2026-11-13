// Entry point: starts the HTTP server. Everything else is in app.ts.
import { createApp } from './app.ts';

const port = Number(process.env.PORT ?? 3000);

// Express 5 passes listen errors (e.g. port already in use) to this callback.
createApp().listen(port, (error) => {
  if (error) {
    const inUse = (error as NodeJS.ErrnoException).code === 'EADDRINUSE';
    console.error(
      inUse
        ? `El puerto ${String(port)} ya está en uso: cierra el otro proceso o cambia PORT en backend/.env.`
        : error,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`API escuchando en http://localhost:${String(port)}/api`);
});
