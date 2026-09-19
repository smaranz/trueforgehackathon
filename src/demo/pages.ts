import { documentClient } from './client.js';
import { people, type Role } from './store.js';
import { styles } from './styles.js';

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

const paths = {
  notebook: '<path d="M5 3h12a2 2 0 0 1 2 2v16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z"/><path d="M7 3v18M11 8h4M11 12h4"/>',
  file: '<path d="M5 3h9l5 5v13H5V3Z"/><path d="M14 3v6h5M9 13h6M9 17h4"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  back: '<path d="M20 12H4m6-6-6 6 6 6"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
  share: '<circle cx="8" cy="8" r="3"/><path d="M2 20v-2a6 6 0 0 1 12 0v2M19 7v8m-4-4h8"/>',
  export: '<path d="M12 3v12m-4-4 4 4 4-4M4 15v6h16v-6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
} as const;
const icon = (name: keyof typeof paths) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
const brand = (base: string) => `<a class="brand" href="${base}">${icon('notebook')}<span>fieldnotes</span></a>`;
const rules = `<section class="rules" aria-label="Document access rules"><h2 class="rules-title">${icon('lock')} A note on access</h2><p><strong>Owners</strong> manage sharing and can read, edit, and export.</p><p><strong>Editors with access</strong> can read, edit, and export. <strong>Viewers</strong> can read and export, but cannot save changes.</p><p>Removing someone’s access takes effect immediately, including for document exports.</p></section>`;

function frame(title: string, nonce: string, body: string, script = ''): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(title)} · Fieldnotes</title><link rel="icon" href="data:,"><style nonce="${nonce}">${styles}</style></head><body>${body}${script ? `<script nonce="${nonce}">${script}</script>` : ''}</body></html>`;
}

function sidebar(base: string, role: Role): string {
  const person = people[role];
  return `<aside class="sidebar"><div>${brand(base)}<p class="workspace-label">THE TEAM WORKSPACE</p></div><nav aria-label="Workspace"><p class="eyebrow nav-label">Workspace</p><a class="nav-item" href="${base}" aria-current="page">${icon('file')} Documents <span class="nav-count">01</span></a></nav><section class="members"><h2 class="eyebrow">Workspace members</h2>${(Object.keys(people) as Role[]).map(memberRole => `<div class="member-line"><span class="avatar ${memberRole}">${people[memberRole].initials}</span><div><p class="member-name">${people[memberRole].name}</p><p class="member-role">${memberRole}</p></div></div>`).join('')}</section><p class="sidebar-note">Good work starts<br>with a shared page.</p><div class="account"><span class="avatar ${role}">${person.initials}</span><div><p class="member-name">${person.name}</p><p class="email">${person.email}</p></div></div></aside>`;
}

function workspaceFrame(id: string, role: Role, nonce: string, document: boolean, content: string, script = ''): string {
  const base = `/w/${encodeURIComponent(id)}`;
  return frame(document ? 'Launch brief' : 'Documents', nonce, `<div class="app">${sidebar(base, role)}<main class="main"><header class="topbar"><div class="breadcrumb"><span>Studio</span><span>/</span><a href="${base}">Documents</a>${document ? '<span>/</span><strong>Launch brief</strong>' : ''}</div><span class="workspace-status"><span class="dot"></span> Private workspace</span></header>${content}</main></div>`, script);
}

export function renderDocumentList(id: string, role: Role, nonce: string): string {
  const base = `/w/${encodeURIComponent(id)}`;
  return workspaceFrame(id, role, nonce, false, `<div class="workspace"><section class="intro"><div><p class="eyebrow">A little space for good thinking</p><h1>Keep everyone<br>on the same page.</h1><p>The notes, plans, and decisions that move your work forward.<br>A considered home for everything you’re making together.</p></div><div class="folio" aria-hidden="true">FN / 01</div></section><div class="list-layout"><section aria-labelledby="documents-label"><div class="section-label"><h2 class="eyebrow" id="documents-label">Team documents</h2><span>01 DOCUMENT</span></div><a class="document-row" href="${base}/documents/launch-brief" data-testid="open-document"><span class="doc-icon">${icon('file')}</span><div><h2>Launch brief</h2><p>Working document · Owned by Mara Vale</p></div><span class="arrow">${icon('arrow')}</span></a><p class="list-footnote">Document contents are available only to people with current access.</p></section>${rules}</div><footer class="workspace-footer"><span>Made for the work in progress.</span><span>Fieldnotes / Team workspace</span></footer></div>`);
}

function sharingDialog(): string {
  return `<dialog class="sharing-dialog" id="sharing-dialog" aria-labelledby="sharing-title"><div class="dialog-heading"><div><p class="eyebrow">Bring the right people in</p><h2 id="sharing-title">Share Launch brief</h2><p>Only the owner can change who has access.</p></div><button class="icon-button" type="button" data-testid="close-sharing" aria-label="Close sharing">${icon('close')}</button></div><div class="sharing-members">${(Object.keys(people) as Role[]).map(role => `<div class="sharing-row"><span class="avatar ${role}">${people[role].initials}</span><div class="sharing-person"><strong>${people[role].name}${role === 'owner' ? ' (you)' : ''}</strong><small>${people[role].email}</small></div>${role === 'editor' ? '<span class="permission" data-testid="permission-editor">No access</span><button class="button primary" type="button" data-testid="grant-editor">Grant access</button><button class="button" type="button" data-testid="revoke-editor" hidden>Remove access</button>' : `<span class="permission">${role === 'owner' ? 'Owner' : 'Viewer'}</span>`}</div>`).join('')}</div><p class="dialog-message save-status" id="sharing-message" role="status" aria-live="polite"></p><div class="dialog-bottom">Access is specific to this document. Removing an editor’s access immediately prevents reading, editing, and exporting.</div></dialog>`;
}

export function renderDocument(id: string, role: Role, nonce: string): string {
  const base = `/w/${encodeURIComponent(id)}`;
  const context = JSON.stringify({ base, role, people }).replace(/</g, '\\u003c');
  return workspaceFrame(id, role, nonce, true, `<div class="workspace document-workspace"><a class="back-link" href="${base}">${icon('back')} All documents</a><header class="document-header"><div><h1 data-testid="document-title">Launch brief</h1><div class="document-meta">${icon('lock')}<span>Private document</span><span>·</span><span>Owned by Mara Vale</span></div></div><div class="actions"><button class="button" type="button" data-testid="export-button">${icon('export')} Export document</button>${role === 'owner' ? `<button class="button primary" type="button" data-testid="share-button" disabled>${icon('share')} Share</button>` : ''}</div></header><div class="notice" id="document-notice" role="alert"></div><div class="document-layout"><div><section class="paper" aria-label="Document editor"><div class="paper-heading"><label class="eyebrow" for="document-content">Fieldnotes / Working document</label>${icon('notebook')}</div><textarea id="document-content" class="document-content" data-testid="document-content" aria-label="Document content" aria-busy="true" placeholder="Opening document…" readonly spellcheck="false"></textarea><footer class="paper-footer"><p class="save-status" id="save-status" role="status" aria-live="polite">Opening the latest revision…</p><button class="button primary" type="button" data-testid="save-button" disabled>Save changes</button></footer></section><section class="export-panel" id="export-panel" aria-label="Export response" hidden><div class="export-heading"><h2>Document export</h2><span class="export-status" id="export-status"></span></div><pre class="export-result" data-testid="export-result" data-status="" role="status" aria-live="polite"></pre><p class="request-id" id="export-request-id"></p></section></div><aside class="document-aside"><section class="details"><h2 class="eyebrow">At a glance</h2><p class="detail-row"><span>Owner</span><strong>Mara Vale</strong></p><p class="detail-row"><span>Your access</span><strong id="access-label">Checking</strong></p><p class="detail-row"><span>Revision</span><strong id="revision-label">—</strong></p></section><section class="details"><h2 class="eyebrow">Activity</h2><ol class="activity-list" data-testid="activity-log" aria-live="polite"><li class="empty">Opening document history…</li></ol></section>${rules}</aside></div></div>${role === 'owner' ? sharingDialog() : ''}<script id="page-context" type="application/json" nonce="${nonce}">${context}</script>`, documentClient);
}

export function renderLogin(id: string, nonce: string, error = ''): string {
  const base = `/w/${encodeURIComponent(id)}`;
  return frame('Welcome back', nonce, `<main class="login-shell"><section class="login-art">${brand(base)}<div><h2>Good work starts<br>with a shared page.</h2><p>A small, thoughtful home for the notes and decisions that bring a team together.</p></div><span class="eyebrow">Fieldnotes / Team workspace</span></section><section class="login-main"><div class="login-card"><p class="eyebrow">Come on in</p><h1>Welcome to the workspace.</h1><p>Choose a synthetic team member to explore Fieldnotes. Each person has their own document permissions.</p>${error ? `<div class="notice" role="alert">${escapeHtml(error)}</div>` : ''}<form class="login-form" action="${base}/login" method="post"><fieldset><legend>Sign in as</legend>${(Object.keys(people) as Role[]).map((role, index) => `<label class="persona"><input type="radio" name="email" value="${people[role].email}" ${index === 0 ? 'checked' : ''} required><span><strong>${people[role].name}</strong><small>${people[role].email}</small></span><span class="permission">${role}</span></label>`).join('')}</fieldset><button class="button primary" type="submit">Enter workspace ${icon('arrow')}</button></form><p class="login-note">Demo accounts only. No personal account or password is needed.</p></div></section></main>`);
}

export function renderError(nonce: string, title: string, message: string, loginPath?: string): string {
  return frame(title, nonce, `<main class="error-shell">${brand(loginPath ?? '#')}<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${loginPath ? `<a class="button primary" href="${escapeHtml(loginPath)}">Sign in to Fieldnotes ${icon('arrow')}</a>` : ''}</main>`);
}
