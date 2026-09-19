import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { command } from '../src/server/workbench/process.js';
import { dataDir } from '../src/server/config.js';
import type { RepairProposal, WorkbenchJob } from '../src/shared/workbench.js';

test('repairs verify in isolation, apply only passing reviewed patches, and reject stale/dirty source', async t => {
  await mkdir(dataDir, { recursive: true });
  const root = await mkdtemp(join(dataDir, 'repair-fixture-'));
  process.env.PROBE_SOURCE_ROOT = root;
  const { allowedSourceFile, applyEdits, buildRepair, hash } = await import('../src/server/workbench/repair.js');
  const signal = new AbortController().signal;
  const original = "export const label = '';\n", fixed = "export const label = 'Save';\n";
  const git = (...args: string[]) => command(['git', ...args], root, signal);
  const makeJob = (): WorkbenchJob => ({ id: randomUUID(), targetUrl: 'http://localhost:3000/signup', kind: 'build', status: 'running', startedAt: new Date().toISOString(), stage: '', findings: [], notes: [] });
  try {
    await writeFile(join(root, 'main.ts'), original);
    await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { build: 'node verify.cjs', test: 'node verify.cjs' } }));
    await writeFile(join(root, 'verify.cjs'), `const assert=require('node:assert/strict'); const fs=require('node:fs'); assert.match(fs.readFileSync('main.ts','utf8'), /label = 'Save'/); console.log('Verified accessible label');`);
    await git('init'); await git('add', '.');
    await git('-c', 'user.name=Probe test', '-c', 'user.email=probe-test@example.invalid', 'commit', '-m', 'Test fixture');
    const commit = (await git('rev-parse', 'HEAD')).trim();
    await writeFile(join(root, 'main.ts'), fixed);
    const diff = await git('diff', '--no-ext-diff', '--no-color', '--');
    await writeFile(join(root, 'main.ts'), original);
    const proposal: RepairProposal = { findingId: randomUUID(), summary: 'Add the missing label', baseCommit: commit, createdAt: new Date().toISOString(), diff, files: [{ path: 'main.ts', beforeHash: hash(original), content: fixed }] };

    await t.test('source edits reject traversal, credential files, ambiguous anchors and invalid syntax', () => {
      for (const path of ['../main.ts', '/tmp/main.ts', '.env.js', 'node_modules/lib.js', 'src/credentials.ts', 'src\\main.ts']) assert.equal(allowedSourceFile(path), false);
      const files = new Map([['main.ts', original]]);
      assert.throws(() => applyEdits(files, [{ path: '../main.ts', find: original, replace: fixed }]));
      assert.throws(() => applyEdits(files, [{ path: 'main.ts', find: 'not here', replace: fixed }]));
      assert.throws(() => applyEdits(new Map([['main.ts', 'x x']]), [{ path: 'main.ts', find: 'x', replace: 'y' }]));
      assert.throws(() => applyEdits(files, [{ path: 'main.ts', find: original, replace: 'export const = ;' }]));
      assert.equal(applyEdits(files, [{ path: 'main.ts', find: original, replace: fixed }]).get('main.ts'), fixed);
    });
    await t.test('failed build preserves original source and removes the worktree', async () => {
      const bad = { ...proposal, files: [{ ...proposal.files[0], content: "export const label = 'Wrong';\n" }] };
      const run = makeJob(); await assert.rejects(buildRepair(run, bad, signal), /exited with code/);
      assert.equal(await readFile(join(root, 'main.ts'), 'utf8'), original);
      assert.equal(run.build?.applied, false);
      assert.equal((await git('worktree', 'list', '--porcelain')).match(/^worktree /gm)?.length, 1);
    });
    await t.test('passing build applies exact reviewed source without committing', async () => {
      const run = makeJob(); await buildRepair(run, proposal, signal);
      assert.equal(await readFile(join(root, 'main.ts'), 'utf8'), fixed);
      assert.equal(run.build?.applied, true); assert.match(run.build!.log, /Verified accessible label/);
      assert.match(run.build!.verification, /build and tests passed/);
      assert.equal((await git('rev-parse', 'HEAD')).trim(), commit);
      assert.equal(await git('diff', '--no-ext-diff', '--no-color', '--'), diff);
    });
    await t.test('dirty source and stale proposals never overwrite user edits', async () => {
      await assert.rejects(buildRepair(makeJob(), proposal, signal), /uncommitted changes/);
      await writeFile(join(root, 'main.ts'), original);
      await assert.rejects(buildRepair(makeJob(), { ...proposal, files: [{ ...proposal.files[0], beforeHash: 'outdated' }] }, signal), /Source changed/);
      assert.equal(await readFile(join(root, 'main.ts'), 'utf8'), original);
    });
    await t.test('already cancelled builds do not touch source', async () => {
      const controller = new AbortController(); controller.abort();
      await assert.rejects(buildRepair(makeJob(), proposal, controller.signal));
      assert.equal(await readFile(join(root, 'main.ts'), 'utf8'), original);
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});
