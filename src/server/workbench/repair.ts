import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { transformSync } from 'esbuild';
import { z } from 'zod';
import { dataDir } from '../config.js';
import type { Diagnostic, RepairProposal, WorkbenchJob } from '../../shared/workbench.js';
import { askModel } from './model.js';
import { command } from './process.js';
import { listMemory, saveJob } from './store.js';

export const sourceRoot = process.env.PROBE_SOURCE_ROOT ? resolve(process.env.PROBE_SOURCE_ROOT) : undefined;
export const sourceLabel = sourceRoot && basename(sourceRoot);
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const patchSchema = z.object({ summary: z.string().min(10).max(3000), edits: z.array(z.object({ path: z.string().max(300), find: z.string().min(1).max(30000), replace: z.string().max(40000) }).strict()).min(1).max(10) }).strict();

export function allowedSourceFile(path: string): boolean {
  return !path.split('/').some(part => !part || part === '..' || part.startsWith('.') || ['node_modules', 'dist', 'build', 'vendor', 'coverage'].includes(part))
    && !/[\\\x00-\x1f]/.test(path) && !/(?:secret|credential|private[-_]?key|password|token|\.min\.)/i.test(path)
    && /\.(?:[cm]?[jt]sx?|css|scss|html)$/.test(path);
}
export function applyEdits(files: Map<string, string>, edits: z.infer<typeof patchSchema>['edits']) {
  const result = new Map<string, string>();
  for (const edit of edits) {
    if (!allowedSourceFile(edit.path) || !files.has(edit.path)) throw new Error(`Proposal references an unavailable source file: ${edit.path}`);
    const content = result.get(edit.path) ?? files.get(edit.path)!;
    const index = content.indexOf(edit.find);
    if (index < 0 || content.indexOf(edit.find, index + 1) !== -1) throw new Error(`The proposed edit in ${edit.path} must match exactly once.`);
    result.set(edit.path, content.slice(0, index) + edit.replace + content.slice(index + edit.find.length));
  }
  for (const [path, content] of result) {
    if (content === files.get(path)) result.delete(path);
    if (content.length > 120000) throw new Error('Proposed file is too large.');
    if (/\.[cm]?[jt]sx?$/.test(path)) {
      try { transformSync(content, { sourcefile: path, loader: /\.tsx$/.test(path) ? 'tsx' : /\.[cm]?ts$/.test(path) ? 'ts' : 'jsx', logLevel: 'silent' }); }
      catch { throw new Error(`Invalid syntax in proposed source: ${path}`); }
    }
  }
  if (!result.size) throw new Error('The model proposed no source changes.');
  return result;
}
async function checkedRoot(signal: AbortSignal): Promise<string> {
  if (!sourceRoot) throw new Error('Set PROBE_SOURCE_ROOT to your local app’s Git repository and restart Probe to enable repairs.');
  const root = await realpath(sourceRoot);
  const gitRoot = (await command(['git', 'rev-parse', '--show-toplevel'], root, signal)).trim();
  if (await realpath(gitRoot) !== root) throw new Error('PROBE_SOURCE_ROOT must be the Git repository root.');
  if ((await command(['git', 'status', '--porcelain'], root, signal)).trim()) throw new Error('The connected source has uncommitted changes. Commit or stash them before generating or building a repair.');
  return root;
}
async function safeRead(root: string, path: string): Promise<string> {
  if (!allowedSourceFile(path)) throw new Error('Source path is not allowed.');
  const full = resolve(root, path);
  if (!full.startsWith(`${root}${sep}`) || (await realpath(full)) !== full || !(await lstat(full)).isFile()) throw new Error('Symlinks and paths outside the connected source are excluded.');
  if ((await lstat(full)).size > 120000) throw new Error('Source file is too large.');
  return readFile(full, 'utf8');
}
async function sourceContext(root: string, finding: Diagnostic, signal: AbortSignal) {
  const names = (await command(['git', 'ls-files', '-z'], root, signal)).split('\0').filter(allowedSourceFile);
  const words = `${finding.url} ${finding.selector || ''} ${finding.actual}`.toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) || [];
  const score = (path: string) => words.reduce((n, word) => n + (path.toLowerCase().includes(word) ? 10 : 0), 0) + (/app|index|layout|page|server/i.test(path) ? 2 : 0);
  names.sort((a, b) => score(b) - score(a));
  const files = new Map<string, string>(); let bytes = 0;
  for (const path of names.slice(0, 250)) {
    let content: string;
    try { content = await safeRead(root, path); } catch { continue; }
    // Exclude files with credential-like literals, rather than corrupting source offsets with redaction.
    if (/-----BEGIN .*PRIVATE KEY|\bsk-[a-zA-Z0-9_-]{12,}|\bgh[pousr]_[a-zA-Z0-9]{20,}|(?:password|api[_-]?key|secret)\s*[:=]\s*["'][^"']{12,}["']/i.test(content)) continue;
    if (bytes + content.length > 140000) continue;
    files.set(path, content); bytes += content.length;
    if (files.size >= 35) break;
  }
  if (!files.size) throw new Error('No eligible source files were found in the connected repository.');
  return files;
}
async function inWorktree<T>(root: string, id: string, commit: string, signal: AbortSignal, run: (dir: string) => Promise<T>): Promise<T> {
  const directory = resolve(dataDir, 'repairs', id);
  await mkdir(resolve(dataDir, 'repairs'), { recursive: true });
  try {
    await command(['git', 'worktree', 'add', '--detach', directory, commit], root, signal);
    return await run(directory);
  }
  finally {
    const cleanup = new AbortController().signal;
    await command(['git', 'worktree', 'remove', '--force', directory], root, cleanup, 15000).catch(async () => {
      await rm(directory, { recursive: true, force: true });
      await command(['git', 'worktree', 'prune'], root, cleanup, 15000).catch(() => {});
    });
  }
}
export async function proposeRepair(job: WorkbenchJob, finding: Diagnostic, signal: AbortSignal) {
  const root = await checkedRoot(signal);
  const commit = (await command(['git', 'rev-parse', 'HEAD'], root, signal)).trim();
  const files = await sourceContext(root, finding, signal);
  job.stage = `Reviewing ${files.size} source files with the agent`; saveJob(job);
  const answer = await askModel(`Propose the smallest actual source fix for the supplied finding. Output {"summary":string,"edits":[{"path":string,"find":string,"replace":string}]}. Each find must match exactly once in one supplied file. Only edit supplied files. Preserve unrelated behavior. Include a meaningful regression test when an existing test file is available. Do not weaken checks, disable security, change test expectations to conceal bugs, or add commands/dependencies. If evidence is insufficient, return no edits; the caller will report that no repair was proposed.`, {
    finding, files: Object.fromEntries(files), feedback: listMemory().filter(item => item.origin === new URL(finding.url).origin),
  }, patchSchema, signal);
  const changed = applyEdits(files, answer.edits);
  const diff = await inWorktree(root, job.id, commit, signal, async directory => {
    for (const [path, content] of changed) await writeFile(join(directory, path), content);
    await command(['git', 'diff', '--check'], directory, signal);
    return command(['git', 'diff', '--no-ext-diff', '--no-color', '--'], directory, signal);
  });
  job.proposal = { findingId: finding.id, summary: answer.summary, files: [...changed].map(([path, content]) => ({ path, content, beforeHash: hash(files.get(path)!) })), diff, baseCommit: commit, createdAt: new Date().toISOString() };
  job.stage = 'Fix proposed — review the diff, then Build fix';
}
function configuredCommand(name: string, fallback?: string[]): string[] | undefined {
  if (!process.env[name]) return fallback;
  try { return z.array(z.string().min(1).max(500)).min(1).max(20).parse(JSON.parse(process.env[name]!)); }
  catch { throw new Error(`${name} must be a JSON array of command arguments, for example ["npm","run","build"].`); }
}
export async function buildRepair(job: WorkbenchJob, proposal: RepairProposal, signal: AbortSignal) {
  const root = await checkedRoot(signal);
  async function checkFresh() {
    if ((await command(['git', 'rev-parse', 'HEAD'], root, signal)).trim() !== proposal.baseCommit) throw new Error('Source commit changed. Generate a fresh proposal.');
    for (const file of proposal.files) if (hash(await safeRead(root, file.path)) !== file.beforeHash) throw new Error(`Source changed since this proposal: ${file.path}. Generate a fresh proposal.`);
  }
  await checkFresh();
  const packageJson = existsSync(join(root, 'package.json')) ? JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) : undefined;
  const build = configuredCommand('PROBE_BUILD_COMMAND', packageJson?.scripts?.build ? ['npm', 'run', 'build'] : undefined);
  const test = configuredCommand('PROBE_TEST_COMMAND', packageJson?.scripts?.test ? ['npm', 'test'] : undefined);
  if (!build) throw new Error('Set PROBE_BUILD_COMMAND to a verification command before applying fixes. No changes were applied.');
  job.build = { applied: false, log: '', changedFiles: proposal.files.map(file => file.path), verification: 'pending' };
  await inWorktree(root, job.id, proposal.baseCommit, signal, async directory => {
    for (const file of proposal.files) {
      await safeRead(directory, file.path);
      await writeFile(join(directory, file.path), file.content);
    }
    if (existsSync(join(root, 'node_modules'))) await symlink(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir');
    await command(['git', 'diff', '--check'], directory, signal);
    job.stage = 'Building the fix in an isolated Git worktree'; saveJob(job);
    for (const args of [build, ...(test ? [test] : [])]) {
      const output = await command(args, directory, signal, 180000);
      job.build!.log = `${job.build!.log}\n$ ${args.join(' ')}\n${output}`.slice(-30000); saveJob(job);
    }
    // Only the reviewed source replacements are applied, never files modified by build scripts.
    const generated = await command(['git', 'diff', '--no-ext-diff', '--no-color', '--'], directory, signal);
    if (generated !== proposal.diff) throw new Error('Verification modified tracked source. The reviewed patch was not applied.');
    await checkedRoot(signal); await checkFresh(); signal.throwIfAborted();
    const patchPath = join(directory, '.probe-reviewed.patch');
    await writeFile(patchPath, proposal.diff, { mode: 0o600 });
    await command(['git', 'apply', '--check', patchPath], root, signal);
    job.stage = 'Applying the verified patch'; saveJob(job);
    // git apply is atomic across the patch. Once started, finish the short apply before reporting cancellation.
    await command(['git', 'apply', patchPath], root, new AbortController().signal, 15000);
    job.build!.applied = true;
    job.build!.verification = test ? 'Project build and tests passed before applying.' : 'Project build passed. No test command is configured.';
    job.stage = 'Fix applied to local source';
    job.notes.push('Source edits are uncommitted. Restart/reload your target and run a fresh scan to verify live behavior.');
    saveJob(job);
  });
}
