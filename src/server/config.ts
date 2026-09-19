import 'dotenv/config';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const port = Number(process.env.PORT || 4310);
export const demoPort = Number(process.env.DEMO_PORT || 4311);
export const origin = `http://127.0.0.1:${port}`;
export const demoOrigin = `http://127.0.0.1:${demoPort}`;
export const dataDir = process.env.CZ_DATA_DIR || `${root}.data`;
export const artifactDir = `${dataDir}/artifacts`;
export const forgeUrl = process.env.TRUEFORGE_BASE_URL || 'http://127.0.0.1:8790';
export const forgeModel = process.env.TRUEFORGE_MODEL || 'openai/gpt-4.1-mini';
export const runDeadlineMs = Math.min(1_800_000, Math.max(30_000, Number(process.env.RUN_DEADLINE_MS || 600_000)));

export function validateTarget(value: string): void {
  const url = new URL(value);
  if (url.origin !== demoOrigin || url.username || url.password || url.search || url.hash ||
    !(/^\/$/.test(url.pathname) || /^\/w\/[a-f0-9-]+(?:\/login)?\/?$/.test(url.pathname))) {
    throw new Error('This MVP only accepts the isolated, local Fieldnotes demo workspace. Use Load demo workspace.');
  }
}

export const productRules = `Fieldnotes product rules v1 (docs/product-rules.md):
Owners manage document access. Editors may read, edit and export only while authorized.
Viewers can read but cannot edit. A revoked user cannot fetch or export protected content.
Revocation applies immediately to NEW server requests, including from an already-open tab.
Content already rendered before revocation is not evidence of fresh unauthorized access.
Stale saves must not silently overwrite newer revisions.`;
