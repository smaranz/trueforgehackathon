import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { createEnvironment, getEnvironmentState } from '../demo/app.js';
import type { Finding, NewRunInput, Phase, Role, Run } from '../shared/types.js';
import { demoOrigin, productRules, runDeadlineMs, validateTarget } from './config.js';
import { artifact, event, getRun, saveRun } from './store.js';
import { BrowserFleet, safeError, type BrowserInput, type NetworkRecord } from './browser.js';
import { ForgeInvestigation, forgeHealth } from './forge.js';
import { generateRegression, verifyRegression } from './regression.js';

interface Execution { controller: AbortController; fleet?: BrowserFleet; investigation?: ForgeInvestigation; task?: Promise<void>; }
const active = new Map<string, Execution>();
export function hasActiveRuns(): boolean { return active.size > 0; }

export function createRun(input: NewRunInput): Run {
  validateTarget(input.targetUrl);
  if (hasActiveRuns()) throw new Error('A run is already active. Finish or cancel it before starting another.');
  const id = randomUUID();
  const run: Run = { id, name: 'When access is taken away', goal: input.goal, targetUrl: input.targetUrl,
    mode: input.mode, variant: input.variant, scenario: input.scenario, status: 'queued', phase: 'preconditions', startedAt: new Date().toISOString(),
    actors: [
      { id: `${id}-owner`, role: 'owner', name: 'Mara Vale', email: 'owner@fieldnotes.test', status: 'waiting' },
      { id: `${id}-editor`, role: 'editor', name: 'Ellis Park', email: 'editor@fieldnotes.test', status: 'waiting' },
    ], events: [], artifacts: [], findings: [], verifications: [], cost: null };
  saveRun(run);
  const execution: Execution = { controller: new AbortController() };
  active.set(id, execution);
  execution.task = runInvestigation(run, execution);
  return run;
}

async function runInvestigation(run: Run, execution: Execution): Promise<void> {
  const timeout = setTimeout(() => execution.controller.abort(new Error('Run deadline exceeded')), runDeadlineMs);
  const signal = execution.controller.signal;
  const closeOnAbort = () => { void execution.fleet?.close(); void execution.investigation?.cancel(); };
  signal.addEventListener('abort', closeOnAbort, { once: true });
  try {
    if (run.mode === 'trueforge') {
      const health = await forgeHealth();
      if (!health.ready) {
        run.status = 'blocked'; run.error = health.reason;
        event(run, 'prerequisite.missing', health.reason!);
        return;
      }
    }
    signal.throwIfAborted();
    run.status = 'running';
    event(run, 'run.started', run.mode === 'trueforge' ? 'TrueForge agent investigation started' : 'Deterministic browser proof started — scripted actions, no agent reasoning');
    const first = await executeScenario(run, execution, false);
    if (!first.unauthorized) {
      event(run, 'assessment.healthy', 'Fresh export returned HTTP 403 without protected content. No failure was observed.', { artifactIds: first.evidenceIds });
      run.status = 'completed'; run.phase = 'complete';
      return;
    }
    const finding = createFinding(run, first.exportRecord, first.evidenceIds);
    run.findings.push(finding);
    run.phase = 'assess';
    event(run, 'finding.suspected', finding.title, { artifactIds: finding.evidenceIds });
    finding.status = 'Reproducing'; run.status = 'reproducing'; run.phase = 'reproduce';
    event(run, 'finding.reproducing', 'Starting an independent check with a new seed, fresh contexts and new account sessions.');
    const reproduced = await executeScenario(run, execution, true);
    finding.evidenceIds.push(...reproduced.evidenceIds);
    if (reproduced.unauthorized) {
      finding.status = 'Confirmed';
      event(run, 'finding.confirmed', 'Confirmed by a second fresh unauthorized response after acknowledged revocation in a clean workspace.', { artifactIds: reproduced.evidenceIds });
    } else {
      finding.status = 'Not reproduced';
      event(run, 'finding.not-reproduced', 'Independent attempt denied the fresh export. The original observation remains recorded.');
    }
    const testPath = generateRegression(run);
    run.phase = 'verify';
    const result = await verifyRegression(run, run.variant!, testPath, signal);
    if (result.status === 'error') throw new Error('Regression runner could not produce an assertion result. Inspect the process artifacts.');
    run.status = 'completed'; run.phase = 'complete';
    event(run, 'run.completed', `Investigation completed. Finding: ${finding.status}. Regression: ${result.status}.`);
  } catch (error) {
    run.status = signal.aborted ? (String(signal.reason).includes('deadline') ? 'inconclusive' : 'cancelled') : 'inconclusive';
    run.error = signal.aborted ? String(signal.reason || 'Cancelled by operator') : safeError(error);
    run.findings.forEach(finding => { if (['Suspected', 'Reproducing'].includes(finding.status)) finding.status = 'Inconclusive'; });
    event(run, `run.${run.status}`, run.error);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', closeOnAbort);
    if (signal.aborted) await execution.investigation?.cancel();
    await execution.fleet?.close();
    run.finishedAt = new Date().toISOString();
    run.actors.forEach(actor => { actor.status = run.status === 'completed' ? 'complete' : 'stopped'; });
    saveRun(run);
    active.delete(run.id);
    try { await execution.investigation?.archive(); }
    catch (error) { event(run, 'session.handoff.warning', `Browser cleanup completed; archive handoff configuration could not be saved: ${safeError(error)}`); }
  }
}

async function executeScenario(run: Run, execution: Execution, reproduction: boolean) {
  const signal = execution.controller.signal;
  assert(run.variant, 'Demo authorization variant is required');
  const fixture = createEnvironment(run.variant);
  const fleet = new BrowserFleet(run, fixture.id, signal);
  execution.fleet = fleet;
  if (!reproduction) run.targetUrl = `${demoOrigin}/w/${fixture.id}`;
  await fleet.start();
  let investigation: ForgeInvestigation | undefined;
  // Clean reproduction is deterministic and independent of the model's claim.
  if (run.mode === 'trueforge' && !reproduction) {
    investigation = new ForgeInvestigation(run, fleet, signal);
    execution.investigation = investigation;
    await investigation.initialize();
  }
  const phase = async (name: Phase, role: Role, objective: string, steps: BrowserInput[]) => {
    signal.throwIfAborted();
    if (!reproduction) run.phase = name;
    fleet.setPhase(name, role);
    event(run, reproduction ? 'reproduction.phase' : 'phase.started', objective, { actor: role, details: { phase: name, driver: investigation ? 'TrueForge agent' : 'deterministic browser procedure', cleanEnvironment: fixture.id } });
    if (investigation) await investigation.turn(role, objective);
    else for (const step of steps) {
      signal.throwIfAborted();
      const result = await fleet.execute(role, step) as { error?: string };
      if (result.error) throw new Error(result.error);
    }
    await fleet.drain();
  };
  const requireRecord = (role: Role, path: string, after = 0) => {
    const record = fleet.latest(role, path, after);
    assert(record, `No fresh ${role} ${path} network evidence was captured; phase is inconclusive.`);
    return record;
  };
  try {
    const initial = getEnvironmentState(fixture.id);
    assert(!initial.grants.editor, 'Editor must begin without access');
    const initialShotIds = run.actors.map(a => a.screenshotId!).filter(Boolean);
    event(run, 'preconditions.established', 'Distinct browser contexts and server sessions established. Editor starts without document access.', { artifactIds: initialShotIds });
    await phase('share', 'owner', 'Give Ellis Park (editor) access to the Launch brief document using the sharing dialog. Establish whether the grant actually completed.', [
      { action: 'click', testId: 'open-document' }, { action: 'click', testId: 'share-button' }, { action: 'click', testId: 'grant-editor' }, { action: 'click', testId: 'close-sharing' },
    ]);
    const shared = requireRecord('owner', 'share');
    assert.equal(shared.status, 200, 'Grant must succeed');
    assert.equal(JSON.parse(shared.body).grants.editor, 'editor', 'Grant response must include editor');
    assert.equal(getEnvironmentState(fixture.id).grants.editor, 'editor');
    await phase('open', 'editor', 'Open the shared Launch brief and establish that your account can read its content. Keep the document open for the next phase.', [{ action: 'click', testId: 'open-document' }]);
    const opened = requireRecord('editor', 'document', shared.sequence);
    assert.equal(opened.status, 200);
    assert(opened.body.includes(fixture.fixtureMarker), 'Editor must actually have read the protected fixture');
    await phase('revoke', 'owner', 'Remove Ellis Park’s document access. Inspect the resulting sharing state and establish whether revocation actually completed.', [
      { action: 'click', testId: 'share-button' }, { action: 'click', testId: 'revoke-editor' }, { action: 'click', testId: 'close-sharing' },
    ]);
    const revoked = requireRecord('owner', 'revoke', opened.sequence);
    assert.equal(revoked.status, 200);
    assert.equal(JSON.parse(revoked.body).grants.editor, undefined);
    const state = getEnvironmentState(fixture.id);
    assert.equal(state.grants.editor, undefined, 'Server-side grant must actually be absent');
    assert(state.activity.some(entry => entry.action === 'editor.revoked'), 'Committed revocation audit entry required');
    event(run, 'assertion.revocation', 'Revocation verified: HTTP 200, grant absent in response and committed server state.', { artifactIds: [revoked.artifactId] });
    await phase('check', 'editor', 'The owner has completed access revocation. Investigate whether a NEW export from your already-open document is correctly denied. Use fresh network evidence, distinguish it from cached document text, and report the observed outcome.', [{ action: 'click', testId: 'export-button' }]);
    const exported = requireRecord('editor', 'export', revoked.sequence);
    const result = assessExport(revoked, exported, fixture.fixtureMarker, state.revision);
    const assertion = artifact(run, 'assertion', reproduction ? 'Independent clean reproduction assertions' : 'Fresh-response authorization assertions', JSON.stringify({
      ...result, environmentId: fixture.id, documentId: fixture.documentId, expectedRule: productRules, revocationRequestId: revoked.requestId,
      exportRequestId: exported.requestId, exportRequestedAt: exported.requestedAt, revocationCompletedAt: revoked.completedAt,
      revocationSequence: revoked.sequence, exportSequence: exported.sequence,
      revokedServerGrantAbsent: true, exportStatus: exported.status, protectedFixturePresent: exported.body.includes(fixture.fixtureMarker),
      fromServiceWorker: exported.fromServiceWorker, cacheControl: exported.cacheControl, cleanReproduction: reproduction,
    }, null, 2), 'json');
    const revocationShot = run.artifacts.filter(a => a.kind === 'screenshot' && a.actor === 'owner' && a.label.includes('revoke-editor')).at(-1);
    return { unauthorized: result.unauthorized, exportRecord: exported, evidenceIds: [shared.artifactId, opened.artifactId, revoked.artifactId, exported.artifactId, assertion.id, ...(revocationShot ? [revocationShot.id] : []), ...run.actors.map(a => a.screenshotId!).filter(Boolean)] };
  } finally {
    await fleet.close();
  }
}

export function assessExport(revoked: NetworkRecord, exported: NetworkRecord, marker: string, revision: number): { unauthorized: boolean } {
  assert.equal(revoked.status, 200, 'Revocation was not acknowledged');
  assert.equal(JSON.parse(revoked.body).grants.editor, undefined, 'Revocation response still grants access');
  assert(exported.sequence > revoked.sequence, 'Export must be a new request after revocation');
  assert(new Date(exported.requestedAt).getTime() >= new Date(revoked.completedAt).getTime(), 'Export request predates revocation completion');
  assert(exported.requestId && exported.requestId !== revoked.requestId, 'Distinct server request IDs required');
  assert.equal(exported.revision, String(revision), 'Export response must reflect post-revocation revision');
  assert.equal(exported.fromServiceWorker, false, 'Service worker response is not sufficient proof');
  assert(exported.cacheControl.includes('no-store'), 'Server response must disable caching');
  if (exported.status === 200 && exported.body.includes(marker)) return { unauthorized: true };
  if (exported.status === 403 && !exported.body.includes(marker)) return { unauthorized: false };
  throw new Error(`Export returned HTTP ${exported.status} with unexpected content. Outcome is inconclusive.`);
}

function createFinding(run: Run, exported: NetworkRecord, evidenceIds: string[]): Finding {
  return { id: randomUUID(), runId: run.id, title: 'Revoked editor can still export the document', scenario: 'Revoked access remains usable',
    expected: 'After the owner revokes access, a fresh editor export must return HTTP 403 without protected document content.', expectationSource: 'Fieldnotes product rules v1 · docs/product-rules.md',
    actual: `A new editor export request returned HTTP ${exported.status} with the protected fixture after server-confirmed revocation. This is a fresh server response, not text cached in the open editor.`,
    actors: ['owner', 'editor'], preconditions: ['Fresh isolated workspace with synthetic protected content', 'Separate owner and editor server sessions and browser contexts', 'Owner grants editor access; editor opens document while authorized'],
    steps: ['Owner opens Launch brief and grants Ellis editor access.', 'Editor opens Launch brief and reads the protected document.', 'Owner revokes editor access and receives an acknowledged grant removal.', 'Editor clicks Export in the already-open tab, issuing a new network request.', 'Inspect response status, request ID, revision and protected fixture content.'],
    evidenceIds, status: 'Suspected', severity: 'High', rationale: 'The export endpoint discloses protected document content to an authenticated user whose permission was removed. No wider impact is inferred.' };
}

export async function cancelRun(id: string): Promise<Run> {
  const run = getRun(id);
  if (!run) throw new Error('Run not found');
  const execution = active.get(id);
  if (execution) {
    execution.controller.abort(new Error('Cancelled by operator'));
    await execution.task;
  }
  return run;
}

export function startPreparedFixVerification(id: string): Run {
  const run = getRun(id);
  if (!run) throw new Error('Run not found');
  if (hasActiveRuns()) throw new Error('Wait for the active run to finish.');
  const baseline = run.verifications.find(result => result.variant === 'broken' && result.status === 'failed');
  if (!baseline) throw new Error('A captured failing regression against the broken variant is required first.');
  if (run.verifications.some(result => result.variant === 'corrected' && result.status === 'passed')) throw new Error('Prepared fix already verified; see the preserved comparison.');
  const execution: Execution = { controller: new AbortController() };
  active.set(id, execution);
  run.status = 'running'; run.phase = 'verify'; run.error = undefined; run.finishedAt = undefined;
  event(run, 'prepared-fix.applied', 'Operator selected the prepared corrected authorization implementation in a new isolated fixture. The regression source will remain unchanged.');
  execution.task = (async () => {
    try {
      const result = await verifyRegression(run, 'corrected', baseline.testPath, execution.controller.signal);
      assert.equal(result.testHash, baseline.testHash, 'Regression source changed between before and after runs');
      run.status = result.status === 'error' ? 'inconclusive' : 'completed';
      if (result.status !== 'passed') run.error = 'The prepared correction did not pass verification. Inspect the preserved results.';
      run.phase = 'complete';
    } catch (error) {
      run.status = execution.controller.signal.aborted ? 'cancelled' : 'inconclusive'; run.error = safeError(error);
    } finally {
      run.finishedAt = new Date().toISOString(); saveRun(run); active.delete(id);
    }
  })();
  return run;
}

export async function shutdown(): Promise<void> { await Promise.all([...active.keys()].map(cancelRun)); }
