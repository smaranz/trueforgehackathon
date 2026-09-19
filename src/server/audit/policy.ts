export const AUDIT_TARGET = 'http://localhost:3000/signup' as const;
export const AUDIT_ORIGIN = 'http://localhost:3000';
export const AUDIT_MODEL = 'openai/gpt-5-6-sol';
export const auditRoutes = ['/', '/landing', '/signup', '/signin', '/onboarding', '/onboarding/complete', '/dashboard', '/plan', '/plan/colleges', '/plan/roadmap', '/plan/strategy', '/plan/projects', '/apply', '/essays', '/essays/coach', '/essays/prompts', '/essays/comparison', '/essays/inspiration', '/essays/insights', '/sat', '/sat/onboarding', '/sat/practice', '/sat/review', '/sat/skills', '/sat/exams', '/sat/vocab', '/sat/games', '/sat/classroom', '/sat/predictor', '/sat/resources', '/counselor', '/counselor/documents', '/settings', '/privacy', '/terms', '/profile', '/list', '/chances'];
const methods: Record<string, string[]> = {
  '/api/auth/signup': ['POST'], '/api/auth/signin': ['POST'], '/api/profile': ['GET', 'PUT'],
  '/api/onboarding/progress': ['GET', 'PUT', 'DELETE'], '/api/college-list': ['GET', 'PUT'],
  '/api/essays/documents': ['GET', 'PUT', 'DELETE'], '/api/counselor/documents': ['GET', 'POST', 'DELETE'],
  '/api/counselor/applications': ['GET', 'POST', 'PATCH', 'DELETE'], '/api/counselor/tasks': ['GET', 'POST', 'PATCH'],
  '/api/counselor/records': ['GET', 'POST', 'PATCH', 'DELETE'], '/api/counselor/chats': ['GET', 'POST', 'DELETE'],
};
const metered = ['/api/onboarding/analyze', '/api/chat', '/api/chance-explain', '/api/essays/analyze', '/api/essays/coach', '/api/sat/questions', '/api/sat/ai/explain', '/api/sat/ai/socratic', '/api/sat/ai/analyze-passage', '/api/counselor/session-summary'];
function parsed(raw: string): URL | undefined {
  try {
    const url = new URL(raw);
    if (url.username || url.password || /%2f|%5c|%00|\\/i.test(raw)) return;
    for (const [key, value] of url.searchParams) if (/^(url|next|redirect|redirect_to|callback|returnTo)$/i.test(key) && value && new URL(value, url.origin).origin !== url.origin) return;
    return url;
  } catch { return; }
}
export function isAuditNavigation(raw: string): boolean {
  const url = parsed(raw); return Boolean(url && url.origin === AUDIT_ORIGIN && auditRoutes.includes(url.pathname));
}
export function requestPolicy(raw: string, method: string, options: { authOrigin?: string; allowWrites?: boolean } = {}): { allowed: boolean; reason?: string; auth?: boolean; metered?: boolean } {
  const url = parsed(raw); const deny = { allowed: false, reason: 'Outside the approved product routes or action scope' };
  if (!url) return deny;
  if (options.allowWrites === false && !['GET', 'HEAD'].includes(method)) return deny;
  if (options.authOrigin && url.origin === options.authOrigin && /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(options.authOrigin)) {
    const allowed = (method === 'GET' && url.pathname === '/auth/v1/user') || (method === 'POST' && url.pathname === '/auth/v1/token' && ['refresh_token', 'password'].includes(url.searchParams.get('grant_type') || '')) || (method === 'POST' && url.pathname === '/auth/v1/logout');
    return { allowed, auth: true, reason: allowed ? undefined : deny.reason };
  }
  if (url.origin !== AUDIT_ORIGIN) return deny;
  if (['GET', 'HEAD'].includes(method) && (auditRoutes.includes(url.pathname) || /^\/_next\/static\//.test(url.pathname) || /^\/(?:images|fonts)\/[a-z0-9_./-]+$/i.test(url.pathname) || ['/favicon.ico', '/favicon.svg'].includes(url.pathname))) return { allowed: true };
  if (url.pathname === '/api/counselor/records' && !['goals', 'scholarships', 'aid'].includes(url.searchParams.get('type') || '')) return deny;
  if (methods[url.pathname]?.includes(method)) return { allowed: true, auth: url.pathname.startsWith('/api/auth/') };
  if (method === 'POST' && metered.includes(url.pathname)) return { allowed: true, metered: true };
  return deny;
}
export function safeActionLabel(label: string): boolean {
  return !/google|oauth|buy\b|checkout|upgrade|purchase|delete (?:my )?account|reset password|change (?:password|email)|invite|publish|share (?:public|link)|send (?:application|invitation)|start (?:voice|call)|microphone|connect (?:calendar|account)|discord/i.test(label);
}
