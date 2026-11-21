import express, { type Request, type Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createApiApp } from './src/api-app.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = createApiApp();

async function startServer() {
  const PORT = 3000;

  if (process.env.NODE_ENV !== 'production') {
    let viteMiddleware: express.RequestHandler | null = null;
    const viteReadyPromise = import('vite')
      .then(({ createServer: createViteServer }) =>
        createViteServer({
          server: { middlewareMode: true },
          appType: 'spa',
        })
      )
      .then((vite) => {
        viteMiddleware = vite.middlewares as unknown as express.RequestHandler;
      })
      .catch((err) => {
        console.error('Failed to initialize Vite dev middleware:', err);
      });

    // All /api/* routes are already registered above and respond immediately (<200ms).
    // Non-API requests wait briefly for Vite middleware only during initial boot.
    app.use(async (req, res, next) => {
      if (!viteMiddleware) {
        await viteReadyPromise;
      }
      if (viteMiddleware) {
        viteMiddleware(req, res, next);
      } else {
        next();
      }
    });
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection in server:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception in server:', err);
});

startServer();
