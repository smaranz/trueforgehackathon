import type { RequestHandler } from 'express';
import { origin, port } from './config.js';

export const localOnly: RequestHandler = (req, res, next) => {
  const host = req.get('host') || '';
  if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host) || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '')) {
    res.status(403).json({ error: 'Probe only serves loopback clients.' }); return;
  }
  const allowedOrigins = [origin, `http://localhost:${port}`, `http://[::1]:${port}`, 'http://127.0.0.1:5173', 'http://localhost:5173'];
  const requestOrigin = req.get('origin');
  if (req.get('sec-fetch-site') === 'cross-site' || requestOrigin && !allowedOrigins.includes(requestOrigin)) {
    res.status(403).json({ error: 'Cross-origin access is not allowed.' }); return;
  }
  res.set({
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'",
  });
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  next();
};

/** Bounded fixed-window buckets. Never trust forwarding headers on a loopback-only server. */
export function rateLimiter(limit: number, windowMs = 60000, now = Date.now): RequestHandler {
  const buckets = new Map<string, { count: number; reset: number }>();
  return (req, res, next) => {
    const time = now();
    const key = req.socket.remoteAddress || 'unknown';
    for (const [id, bucket] of buckets) if (bucket.reset <= time) buckets.delete(id);
    let bucket = buckets.get(key);
    if (!bucket) { bucket = { count: 0, reset: time + windowMs }; buckets.set(key, bucket); }
    const wait = Math.max(1, Math.ceil((bucket.reset - time) / 1000));
    res.set({ 'RateLimit-Limit': String(limit), 'RateLimit-Remaining': String(Math.max(0, limit - bucket.count - 1)), 'RateLimit-Reset': String(wait), 'RateLimit-Policy': `${limit};w=${Math.ceil(windowMs / 1000)}` });
    if (bucket.count >= limit) {
      res.set('Retry-After', String(wait)); res.status(429).json({ error: `Too many requests. Retry in ${wait}s.`, retryAfter: wait }); return;
    }
    bucket.count++; next();
  };
}
export function streamLimiter(maximum = 8): RequestHandler {
  let connections = 0;
  return (_req, res, next) => {
    if (connections >= maximum) { res.set('Retry-After', '15'); res.status(429).json({ error: 'Too many live streams. Close another tab and retry.' }); return; }
    connections++;
    res.once('close', () => { connections--; }); next();
  };
}

export function isExpensiveApiPath(raw: string): boolean {
  // Express routes are case-insensitive and accept a trailing slash by default.
  const path = raw.replace(/\/+$/, '').toLowerCase();
  return /^\/(?:audits|runs|signup\/run|demo\/load|probe\/connect|runs\/[^/]+\/verify)$/.test(path)
    || /^\/workbench\/(?:scan|investigate|stress|import|jobs\/[^/]+\/(?:propose|build))$/.test(path);
}
