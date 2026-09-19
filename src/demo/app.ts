import { randomBytes, randomUUID } from 'node:crypto';
import express, { type ErrorRequestHandler, type Express, type Request, type Response } from 'express';
import { z } from 'zod';
import { renderDocument, renderDocumentList, renderError, renderLogin } from './pages.js';
import {
  canRead, DocumentError, documentRevision, environmentExists, exportDocument, getEnvironmentState,
  issueSession, people, resolveSession, saveDocument, setEditorGrant,
  type EnvironmentState, type Role,
} from './store.js';

export { createEnvironment, getEnvironmentState, issueSession, resetEnvironment } from './store.js';
export type { Activity, EnvironmentState, Role, SessionCookie, Variant } from './store.js';

const shareInput = z.object({ role: z.literal('editor') }).strict();
const saveInput = z.object({ content: z.string().min(1).max(100_000), revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) }).strict();
const loginInput = z.object({ email: z.enum(['owner@fieldnotes.test', 'editor@fieldnotes.test', 'viewer@fieldnotes.test']) }).strict();

function publicDocument(state: EnvironmentState, role: Role) {
  return {
    id: state.documentId,
    documentId: state.documentId,
    title: 'Launch brief',
    content: state.content,
    revision: state.revision,
    grants: state.grants,
    activity: state.activity,
    canEdit: canRead(state, role) && role !== 'viewer',
    canShare: role === 'owner',
  };
}

function sendDocument(res: Response, state: EnvironmentState, role: Role): void {
  res.setHeader('x-document-revision', String(state.revision));
  res.json(publicDocument(state, role));
}

/** A mountable app; the host process chooses the loopback port and starts listening. */
export function createDemoApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.disable('etag');
  const workspace = express.Router({ mergeParams: true });
  app.use('/w/:id', workspace);

  workspace.use((req, res, next) => {
    const id = String(req.params.id);
    const nonce = randomBytes(18).toString('base64');
    res.locals.environmentId = id;
    res.locals.nonce = nonce;
    res.set({
      'x-request-id': randomUUID(),
      'x-document-revision': String(documentRevision(id)),
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'same-origin',
      'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'self'`,
    });
    if (!environmentExists(id)) {
      res.status(404).json({ error: 'Workspace not found.' });
      return;
    }
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      const origin = req.get('origin');
      if (req.get('sec-fetch-site') === 'cross-site' || (origin && origin !== `${req.protocol}://${req.get('host')}`)) {
        res.status(403).json({ error: 'Requests must originate from this workspace.' });
        return;
      }
    }
    next();
  });
  workspace.use(express.json({ limit: '128kb' }));
  workspace.use(express.urlencoded({ extended: false, limit: '8kb' }));

  // Human-only synthetic sign-in. Agent runners inject issueSession() cookies and block these routes.
  workspace.get('/login', (_req, res) => {
    res.type('html').send(renderLogin(res.locals.environmentId, res.locals.nonce));
  });
  workspace.post('/login', (req, res) => {
    const input = loginInput.safeParse(req.body);
    if (!input.success) {
      res.status(400).type('html').send(renderLogin(res.locals.environmentId, res.locals.nonce, 'Choose one of the team members listed below.'));
      return;
    }
    const role = (Object.keys(people) as Role[]).find(candidate => people[candidate].email === input.data.email)!;
    const cookie = issueSession(res.locals.environmentId, role);
    res.cookie(cookie.name, cookie.value, { httpOnly: true, sameSite: 'strict', path: cookie.path });
    res.redirect(303, cookie.path);
  });

  workspace.use((req, res, next) => {
    const role = resolveSession(res.locals.environmentId, req.headers.cookie);
    if (!role) {
      if (req.path === '/api' || req.path.startsWith('/api/')) {
        res.status(401).json({ error: 'Sign in to access this workspace.' });
      } else {
        res.status(401).type('html').send(renderError(res.locals.nonce, 'A shared space. A personal invitation.', 'Sign in as a team member to open this workspace.', `/w/${encodeURIComponent(res.locals.environmentId)}/login`));
      }
      return;
    }
    res.locals.role = role;
    next();
  });

  workspace.get(['/', '/documents'], (_req, res) => {
    // This page deliberately neither fetches nor embeds document content or the private fixture marker.
    res.type('html').send(renderDocumentList(res.locals.environmentId, res.locals.role, res.locals.nonce));
  });
  workspace.get('/documents/launch-brief', (_req, res) => {
    const state = getEnvironmentState(res.locals.environmentId);
    if (!canRead(state, res.locals.role)) res.status(403);
    // The shell is public metadata only. The protected content is fetched by the page with its session.
    res.type('html').send(renderDocument(res.locals.environmentId, res.locals.role, res.locals.nonce));
  });

  const save = (req: Request, res: Response): void => {
    const state = getEnvironmentState(res.locals.environmentId);
    if (!canRead(state, res.locals.role) || res.locals.role === 'viewer') {
      res.status(403).json({ error: 'You do not have permission to edit this document.' });
      return;
    }
    const input = saveInput.safeParse(req.body);
    if (!input.success) {
      res.status(400).json({ error: 'Provide document content and its integer revision.' });
      return;
    }
    sendDocument(res, saveDocument(state.id, res.locals.role, input.data.content, input.data.revision), res.locals.role);
  };
  workspace.route('/api/document')
    .get((_req, res) => {
      const state = getEnvironmentState(res.locals.environmentId);
      if (!canRead(state, res.locals.role)) {
        res.status(403).json({ error: 'You do not have access to this document.' });
        return;
      }
      sendDocument(res, state, res.locals.role);
    })
    .put(save).post(save).patch(save);

  for (const [path, granted] of [['/api/share', true], ['/api/revoke', false]] as const) {
    workspace.post(path, (req, res) => {
      if (res.locals.role !== 'owner') {
        res.status(403).json({ error: 'Only the owner can manage document sharing.' });
        return;
      }
      if (!shareInput.safeParse(req.body).success) {
        res.status(400).json({ error: 'Only the editor role can be granted or revoked.' });
        return;
      }
      sendDocument(res, setEditorGrant(res.locals.environmentId, res.locals.role, granted), res.locals.role);
    });
  }

  workspace.get('/api/export', (_req, res) => {
    const exported = exportDocument(res.locals.environmentId, res.locals.role);
    res.setHeader('x-document-revision', String(exported.state.revision));
    res.type('text/plain').send(exported.body);
  });
  workspace.use((_req, res) => { res.status(404).json({ error: 'Page not found.' }); });

  const errors: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) { next(error); return; }
    res.setHeader('x-document-revision', String(documentRevision(res.locals.environmentId)));
    if (error instanceof DocumentError) {
      res.status(error.status).json({ error: error.message });
    } else if (error.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Request body must be valid JSON.' });
    } else if (error.type === 'entity.too.large') {
      res.status(413).json({ error: 'This request is too large.' });
    } else {
      res.status(500).json({ error: 'Fieldnotes could not complete this request.' });
    }
  };
  workspace.use(errors);
  return app;
}
