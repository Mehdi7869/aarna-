import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApiApp } from './api-app.ts';

const app = createApiApp();

function normalizeVercelRequestUrl(rawUrl: string | undefined): string {
  const original = rawUrl || '/api/health';
  const parsed = new URL(original, 'http://localhost');
  const forwardedPath = parsed.searchParams.get('__vercel_path');

  if (forwardedPath !== null) {
    parsed.searchParams.delete('__vercel_path');
    if (
      parsed.pathname === '/api/index' ||
      parsed.pathname === '/api/index.mjs' ||
      parsed.pathname === '/api'
    ) {
      const cleanSubpath = forwardedPath.replace(/^\/+/, '');
      parsed.pathname = cleanSubpath ? `/api/${cleanSubpath}` : '/api';
    }
  } else if (
    !parsed.pathname.startsWith('/api/') &&
    parsed.pathname !== '/api'
  ) {
    parsed.pathname = `/api${parsed.pathname.startsWith('/') ? '' : '/'}${parsed.pathname}`;
  }

  const query = parsed.searchParams.toString();
  return query ? `${parsed.pathname}?${query}` : parsed.pathname;
}

export default function handler(req: IncomingMessage, res: ServerResponse) {
  req.url = normalizeVercelRequestUrl(req.url);
  return app(
    req as Parameters<typeof app>[0],
    res as Parameters<typeof app>[1]
  );
}
