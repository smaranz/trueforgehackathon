// Kept inline in the returned HTML: the workspace has no bundler, CDN, or asset dependencies.
export const documentClient = String.raw`
(() => {
  'use strict';
  const context = JSON.parse(document.getElementById('page-context').textContent);
  const test = name => document.querySelector('[data-testid="' + name + '"]');
  const content = test('document-content');
  const save = test('save-button');
  const share = test('share-button');
  const dialog = document.getElementById('sharing-dialog');
  const notice = document.getElementById('document-notice');
  const saveStatus = document.getElementById('save-status');
  const sharingMessage = document.getElementById('sharing-message');
  const exportButton = test('export-button');
  let current = null;
  let originalContent = '';
  let saving = false;

  async function request(path, options = {}) {
    const response = await fetch(context.base + '/api/' + path, {
      ...options,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json', ...options.headers },
    });
    const body = await response.json();
    if (!response.ok) {
      const error = new Error(body.error || 'The request could not be completed.');
      error.status = response.status;
      throw error;
    }
    return body;
  }

  function renderActivity(activity) {
    const log = test('activity-log');
    log.replaceChildren();
    const descriptions = {
      'document.created': 'created the document',
      'document.saved': 'saved a new revision',
      'document.exported': 'exported the document',
      'editor.granted': 'gave Ellis editing access',
      'editor.revoked': 'removed Ellis’s access',
    };
    for (const entry of activity.slice(-8).reverse()) {
      const item = document.createElement('li');
      const actor = document.createElement('strong');
      actor.textContent = context.people[entry.actor].name;
      const time = document.createElement('time');
      time.dateTime = entry.timestamp;
      time.textContent = new Date(entry.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      item.append(actor, document.createTextNode(' ' + (descriptions[entry.action] || entry.action) + '.'), time);
      log.append(item);
    }
    if (!activity.length) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = 'The next chapter starts here.';
      log.append(empty);
    }
  }

  function refreshSave() {
    save.disabled = saving || !current || !current.canEdit || content.value === originalContent;
    if (current && current.canEdit && !saving) {
      saveStatus.textContent = content.value === originalContent ? 'All changes saved · Revision ' + current.revision : 'Unsaved changes · Revision ' + current.revision;
    }
  }

  function renderState(state, replaceContent) {
    current = state;
    if (replaceContent) {
      content.value = state.content;
      originalContent = state.content;
    }
    content.readOnly = !state.canEdit;
    content.removeAttribute('aria-busy');
    document.getElementById('access-label').textContent = state.canEdit ? 'Can edit' : 'Read only';
    document.getElementById('revision-label').textContent = String(state.revision).padStart(2, '0');
    if (share) share.disabled = false;
    if (test('permission-editor')) {
      const granted = state.grants.editor === 'editor';
      test('permission-editor').textContent = granted ? 'Editor' : 'No access';
      test('grant-editor').hidden = granted;
      test('revoke-editor').hidden = !granted;
    }
    renderActivity(state.activity);
    saveStatus.textContent = state.canEdit ? 'All changes saved · Revision ' + state.revision : 'Read-only access · Revision ' + state.revision;
    refreshSave();
  }

  function handleError(error) {
    notice.textContent = error.message;
    if (error.status === 401 || (error.status === 403 && context.role !== 'viewer')) {
      current = null;
      content.value = '';
      content.placeholder = 'This document is no longer available to your account.';
      content.readOnly = true;
      save.disabled = true;
      if (share) share.disabled = true;
      document.getElementById('access-label').textContent = 'No access';
      test('activity-log').replaceChildren();
    }
  }

  content.addEventListener('input', refreshSave);
  save.addEventListener('click', async () => {
    if (!current || saving) return;
    saving = true;
    content.readOnly = true;
    refreshSave();
    save.textContent = 'Saving…';
    notice.textContent = '';
    try {
      const state = await request('document', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content.value, revision: current.revision }),
      });
      renderState(state, true);
    } catch (error) {
      handleError(error);
      saveStatus.textContent = error.status === 409 ? 'Not saved · Reload to review the latest revision' : 'Changes were not saved';
    } finally {
      saving = false;
      content.readOnly = !current || !current.canEdit;
      save.textContent = 'Save changes';
      refreshSave();
    }
  });

  if (share && dialog) {
    share.addEventListener('click', () => { sharingMessage.textContent = ''; dialog.showModal(); });
    test('close-sharing').addEventListener('click', () => dialog.close());
    async function changeSharing(granted) {
      const grantButton = test('grant-editor');
      const revokeButton = test('revoke-editor');
      grantButton.disabled = true;
      revokeButton.disabled = true;
      sharingMessage.textContent = '';
      try {
        const state = await request(granted ? 'share' : 'revoke', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'editor' }),
        });
        renderState(state, false);
        sharingMessage.textContent = granted ? 'Ellis can now open, edit, and export this document.' : 'Ellis’s document access has been removed.';
      } catch (error) {
        sharingMessage.textContent = error.message;
      } finally {
        grantButton.disabled = false;
        revokeButton.disabled = false;
      }
    }
    test('grant-editor').addEventListener('click', () => changeSharing(true));
    test('revoke-editor').addEventListener('click', () => changeSharing(false));
  }

  exportButton.addEventListener('click', async () => {
    const result = test('export-result');
    const status = document.getElementById('export-status');
    document.getElementById('export-panel').hidden = false;
    result.dataset.status = 'pending';
    result.textContent = 'Requesting a fresh export…';
    status.textContent = 'Requesting';
    document.getElementById('export-request-id').textContent = '';
    exportButton.disabled = true;
    try {
      const response = await fetch(context.base + '/api/export', { cache: 'no-store', credentials: 'same-origin' });
      const body = await response.text();
      result.textContent = body;
      result.dataset.status = String(response.status);
      status.textContent = 'HTTP ' + response.status;
      document.getElementById('export-request-id').textContent = 'Request ' + (response.headers.get('x-request-id') || 'unavailable') + ' · Revision ' + (response.headers.get('x-document-revision') || 'unavailable');
    } catch (error) {
      result.textContent = 'The export request could not reach Fieldnotes. Please try again.';
      result.dataset.status = '0';
      status.textContent = 'Network error';
    } finally {
      exportButton.disabled = false;
    }
  });

  request('document').then(state => renderState(state, true)).catch(error => {
    content.removeAttribute('aria-busy');
    content.placeholder = 'You do not currently have access to this document.';
    saveStatus.textContent = 'Document unavailable';
    handleError(error);
  });
})();
`;
