/** Real HTTP/browser/build integration with a deterministic TrueForge protocol fixture. No provider calls. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { chromium, expect } from '@playwright/test';
import { command } from '../src/server/workbench/process.js';
import type { WorkbenchJob } from '../src/shared/workbench.js';

const base = resolve('.data/verification'); await mkdir(base, { recursive: true });
const directory = await mkdtemp(join(base, 'workbench-'));
const source = join(directory, 'app'); await mkdir(source);
const original = '<!doctype html><html lang="en"><head><title>Local fixture</title></head><body><h1>Local test app</h1><form><input id="email"><button>Save</button></form></body></html>\n';
await writeFile(join(source, 'index.html'), original);
await writeFile(join(source, 'package.json'), JSON.stringify({ scripts: { build: 'node verify.cjs', test: 'node verify.cjs' } }));
await writeFile(join(source, 'verify.cjs'), `const fs=require('node:fs');require('node:assert/strict').match(fs.readFileSync('index.html','utf8'), /aria-label="Email"/);console.log('PASS: form field has an accessible name');`);
const signal = new AbortController().signal;
await command(['git', 'init'], source, signal); await command(['git', 'add', '.'], source, signal);
await command(['git', '-c', 'user.name=Probe integration', '-c', 'user.email=probe-test@example.invalid', 'commit', '-m', 'Integration fixture'], source, signal);

let stressRequests = 0;
const target = createServer(async (req, res) => {
  if (req.url === '/limited') { stressRequests++; res.writeHead(stressRequests >= 3 ? 429 : 200); res.end('rate-limit fixture'); return; }
  res.setHeader('Content-Type', 'text/html'); res.end(await readFile(join(source, 'index.html')));
});
target.listen(0, '127.0.0.1'); await once(target, 'listening');
const targetUrl = `http://127.0.0.1:${(target.address() as { port: number }).port}`;
const requests: { prompt?: string; selectedElement?: { selector: string }; files?: Record<string, string> }[] = [];
const model = express(); model.use(express.json({ limit: '1mb' }));
model.post('/api/v1/sessions', (_req, res) => res.json({ data: { id: randomUUID() } }));
model.post('/api/v1/sessions/:id/cancel', (_req, res) => res.json({ data: {} }));
model.post('/api/v1/sessions/:id/turns', (req, res) => {
  const input = JSON.parse(req.body.input[0].content); requests.push(input);
  const output = input.files ? { summary: 'Give the email field an accessible name.', edits: [{ path: 'index.html', find: '<input id="email">', replace: '<input id="email" aria-label="Email">' }] }
    : { summary: 'The pinpointed email field is missing its accessible name, reproduced in the fresh DOM inspection.', findings: [] };
  res.type('text/event-stream');
  for (const event of [{ type: 'model.message', content: JSON.stringify(output) }, { type: 'turn.done', state: { status: 'done', completed_at: new Date().toISOString(), output: null, required_actions: [] } }]) res.write(`data: ${JSON.stringify({ ...event, id: randomUUID(), created_at: new Date().toISOString(), thread_id: 'test' })}\n\n`);
  res.end();
});
const modelServer = model.listen(0, '127.0.0.1'); await once(modelServer, 'listening');
async function freePort() { const server = createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = (server.address() as { port: number }).port; await new Promise<void>(resolve => server.close(() => resolve())); return port; }
const port = await freePort(), demoPort = await freePort();
const url = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts'], { env: { ...process.env, PORT: String(port), DEMO_PORT: String(demoPort), CZ_DATA_DIR: join(directory, 'data'), PROBE_TARGET_URL: targetUrl, PROBE_TARGET_ORIGINS: targetUrl, PROBE_SOURCE_ROOT: source, TRUEFORGE_BASE_URL: `http://127.0.0.1:${(modelServer.address() as { port: number }).port}`, TRUEFORGE_MODEL: 'fixture/model' }, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', value => { logs = (logs + value).slice(-30000); }); child.stderr.on('data', value => { logs = (logs + value).slice(-30000); });
const browser = await chromium.launch({ headless: true });
try {
  await expect.poll(async () => { try { return (await fetch(`${url}/api/workbench/config`)).status; } catch { return 0; } }, { timeout: 20000 }).toBe(200);
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const browserErrors: string[] = []; page.on('pageerror', error => browserErrors.push(error.message));
  async function result(kind: WorkbenchJob['kind'], previous?: string) {
    let current: WorkbenchJob | undefined;
    await expect.poll(async () => {
      const id = page.url().split('#dashboard/')[1]; if (!id || id === previous) return 'waiting';
      current = await (await fetch(`${url}/api/workbench/jobs/${id}`)).json() as WorkbenchJob;
      return current.kind === kind ? current.status : 'waiting';
    }, { timeout: 60000, intervals: [250, 500] }).not.toMatch(/^(waiting|running)$/);
    assert.equal(current!.status, 'completed', JSON.stringify(current));
    await expect(page.locator('.wb-progress')).toHaveCount(0, { timeout: 10000 });
    return current!;
  }
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'A better build starts here.' })).toBeVisible();
  await page.getByRole('button', { name: 'Scan page', exact: true }).click();
  const scan = await result('scan');
  assert(scan.findings.some(item => item.rule === 'field-label'));
  await expect(page.getByRole('heading', { name: 'Form field is missing a label' })).toBeVisible();
  await page.screenshot({ path: join(directory, 'dashboard-desktop.png'), fullPage: true });
  const field = scan.elements!.find(item => item.selector === '#email')!;
  const canvas = page.locator('.wb-pin-canvas'); const bounds = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: (field.rect.x + field.rect.width / 2) / 1280 * bounds.width, y: (field.rect.y + field.rect.height / 2) / 800 * bounds.height } });
  await expect(page.locator('.wb-pin-label')).toContainText('#email');
  await page.getByLabel('Describe the suspected problem').fill('There may be an accessibility problem with this email field. Please look deeper.');
  await page.getByRole('button', { name: 'Investigate deeper', exact: true }).click();
  const deep = await result('investigate', scan.id);
  assert.equal(requests[0].selectedElement?.selector, '#email');
  assert(deep.findings.some(item => item.rule === 'field-label' && item.status === 'Confirmed'));
  await page.getByLabel('Reason for feedback').fill('This is an intentionally unlabelled test fixture.');
  await page.getByRole('button', { name: 'False positive', exact: true }).click();
  await expect(page.getByText('Marked false positive by you')).toBeVisible();
  await page.reload(); await expect(page.getByText('Marked false positive by you')).toBeVisible();
  await page.getByLabel('Reason for feedback').fill('We now want to fix this fixture and add the missing label.');
  await page.getByRole('button', { name: 'Real issue', exact: true }).click();
  await expect(page.getByText('Accepted by you')).toBeVisible();
  await page.getByRole('button', { name: 'Propose source fix', exact: true }).click();
  const proposal = await result('propose', deep.id);
  assert.match(proposal.proposal!.diff, /aria-label="Email"/);
  await page.getByRole('button', { name: 'Build fix', exact: true }).click();
  const build = await result('build', proposal.id);
  assert(build.build?.applied); assert.match(build.build.log, /PASS: form field/);
  assert.match(await readFile(join(source, 'index.html'), 'utf8'), /aria-label="Email"/);
  await page.getByRole('button', { name: 'Rescan live page', exact: true }).click();
  const after = await result('scan', build.id);
  assert(!after.findings.some(item => item.rule === 'field-label'));
  await page.getByRole('button', { name: 'Stress testing', exact: true }).click();
  await page.getByLabel('LOCAL TARGET').fill(`${targetUrl}/limited`);
  await page.getByLabel('Total requests').fill('15');
  await page.getByLabel('Requests per second').fill('10');
  await page.getByRole('button', { name: 'Run stress test', exact: true }).click();
  const stress = await result('stress', after.id); assert(stress.stress!.rateLimited > 0); assert(stress.stress!.stoppedEarly);
  await page.getByRole('button', { name: 'Personal agent', exact: true }).click();
  await expect(page.getByText('We now want to fix this fixture and add the missing label.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Forget', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your agent is ready to learn.' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: join(directory, 'dashboard-mobile.png'), fullPage: true });
  assert.deepEqual(browserErrors, []);
  const report = { passed: true, model: 'deterministic protocol fixture (no live provider call)', checks: ['browser scan', 'screenshot-to-DOM pinpoint', 'deep investigation and independent observation', 'feedback persistence', 'source proposal', 'isolated build and tests', 'atomic source apply', 'live rescan removes defect', 'stress rate-limit boundary', 'forget memory', 'mobile layout'], jobs: [scan.id, deep.id, proposal.id, build.id, after.id, stress.id] };
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`PASS: local dashboard integration. Report and screenshots: ${directory}`);
} catch (error) { console.error(logs); throw error; }
finally {
  await browser.close(); child.kill('SIGTERM');
  await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 10000))]);
  if (child.exitCode === null) child.kill('SIGKILL');
  target.closeAllConnections(); modelServer.closeAllConnections();
  await Promise.all([new Promise<void>(resolve => target.close(() => resolve())), new Promise<void>(resolve => modelServer.close(() => resolve()))]);
}
