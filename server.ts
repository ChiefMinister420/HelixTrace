import 'dotenv/config';
import express from 'express';
import path from 'path';
import type { RequestHandler } from 'express';
import { createServer as createViteServer } from 'vite';
import { getDb } from './server/db.ts';
import {
  handleAuthStatus,
  handleBootstrapAdmin,
  handleGetMe,
  handleLogin,
  handleRegister,
  authenticateJWT,
} from './server/auth.ts';
import { apiRouter } from './server/routes.ts';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));

  let activeDialect = 'initializing';
  let viteMiddleware: RequestHandler | null = null;

  const initPromise = (async () => {
    const db = await getDb();
    activeDialect = db.dialect;

    if (process.env.NODE_ENV !== 'production') {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      viteMiddleware = vite.middlewares;
    }
  })();

  initPromise.catch((err) => {
    console.error('[server] Initialization error:', err);
    process.exit(1);
  });

  // Public health check responds immediately once HTTP server is bound
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, dbClient: activeDialect });
  });

  // Ensure DB & Vite are ready before handling application/API requests
  app.use(async (_req, _res, next) => {
    try {
      await initPromise;
      next();
    } catch (err) {
      next(err);
    }
  });

  // Public authentication routes
  app.get('/api/auth/status', handleAuthStatus);
  app.post('/api/auth/bootstrap', handleBootstrapAdmin);
  app.post('/api/auth/register', handleRegister);
  app.post('/api/auth/login', handleLogin);
  app.get('/api/auth/me', authenticateJWT, handleGetMe);

  // Secured application API routes
  app.use('/api', apiRouter);

  // Unknown /api route handler
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  if (process.env.NODE_ENV !== 'production') {
    app.use((req, res, next) => {
      if (viteMiddleware) {
        viteMiddleware(req, res, next);
      } else {
        next();
      }
    });
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] HelixTrace listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[server] Fatal startup error:', err);
  process.exit(1);
});
