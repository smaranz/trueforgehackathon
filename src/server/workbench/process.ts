import { spawn } from 'node:child_process';

export async function command(args: string[], cwd: string, signal: AbortSignal, timeoutMs = 120000): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), { cwd, shell: false, detached: process.platform !== 'win32', env: {
      PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, SystemRoot: process.env.SystemRoot,
      CI: '1', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1',
    }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', failure: string | undefined;
    const kill = () => { try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* already exited */ } };
    const abort = () => { failure = 'Operation cancelled'; kill(); };
    const timer = setTimeout(() => { failure = `Command timed out after ${Math.round(timeoutMs / 1000)}s`; kill(); }, timeoutMs);
    const collect = (data: Buffer) => {
      output += data.toString();
      if (output.length > 2000000) { output = output.slice(-30000); failure = 'Command exceeded its output limit'; kill(); }
    };
    signal.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
    child.on('error', error => { cleanup(); reject(error); });
    child.on('close', code => { cleanup(); if (failure || code !== 0) reject(new Error(`${failure || `${args[0]} exited with code ${code}`}\n${output.slice(-16000)}`)); else resolve(output); });
    if (signal.aborted) abort();
  });
}
