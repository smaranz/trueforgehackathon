import { port, demoPort } from '../config.js';

export const targetUrl = process.env.PROBE_TARGET_URL || 'http://localhost:3000/signup';
export function allowedOrigins(): string[] {
  const configured = process.env.PROBE_TARGET_ORIGINS?.split(',').map(value => value.trim()).filter(Boolean) || [new URL(targetUrl).origin, `http://127.0.0.1:${demoPort}`];
  return configured.map(value => {
    const url = new URL(value);
    if (!isLocal(url) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('PROBE_TARGET_ORIGINS must contain exact loopback HTTP origins.');
    return url.origin;
  });
}
function isLocal(url: URL) {
  // Exact hostnames avoid DNS rebinding, alternate numeric forms and private-network targets.
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    && Boolean(url.port) && ![String(port), '5173', '8790'].includes(url.port);
}
export function validateWorkbenchTarget(raw: string): URL {
  const url = new URL(raw);
  if (!isLocal(url) || !allowedOrigins().includes(url.origin) || url.username || url.password || url.hash || url.search) {
    throw new Error('Use an approved local target without credentials, query parameters or fragments. Configure PROBE_TARGET_ORIGINS for another local app.');
  }
  return url;
}
export function allowBrowserRequest(raw: string, method: string, target: URL): boolean {
  try {
    const url = new URL(raw);
    return ['GET', 'HEAD'].includes(method) && url.origin === target.origin && !url.username && !url.password
      && !/(?:logout|signout|delete|reset|admin|cron)(?:\/|$)/i.test(url.pathname)
      && !/https?:|\/\/|%2f%2f/i.test(url.search);
  } catch { return false; }
}
export function selectElement(elements: import('../../shared/workbench.js').PageElement[], point: { x: number; y: number }) {
  const x = point.x * 1280, y = point.y * 800;
  return elements.filter(({ rect: r }) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height)
    .sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0];
}
