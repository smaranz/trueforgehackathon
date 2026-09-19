import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

// Official API reference: https://elevenlabs.io/docs/api-reference/flows/image/create
// Credentials are read only by this build-time script and never reach the frontend.
const key = process.env.ELEVENLABS_API_KEY || (process.env.ELEVENLABS_KEY_FILE ? (await readFile(process.env.ELEVENLABS_KEY_FILE, 'utf8')).trim() : '');
if (!key) throw new Error('Set ELEVENLABS_API_KEY or ELEVENLABS_KEY_FILE before generating a logo.');
const prompt = `Design a single exceptional minimalist brand symbol for Probe, an engineering product whose AI agents test software together across separate user accounts. Only the symbol: no text, no wordmark, no letters other than the abstract form itself. Create a confident geometric lowercase p monogram using TWO distinct interlocking curved paths that meet in one circular counter: the idea of two independent perspectives probing a shared state. The paths should form one unmistakable simple, compact, visually balanced logo, not a tangled knot. One solid color only: muted deep forest green #3F6549. Crisp flat vector-style curves, rounded terminals, consistent substantial line weight, beautiful deliberate negative space. The mark should be recognizable at 24px, feel like a premium developer tool and look carefully drawn on a Swiss typographic grid. No gradients, no 3D, no shadows, no hairlines, no radar rings, no magnifying-glass cliché, no decorative sparkles, no mockup, no stationery, no background shape. Center the single isolated icon on a genuinely transparent square canvas with modest even padding. Only one logo, no alternate versions.`;
const request = { model_id: 'gpt-image-1.5', prompt, aspect_ratio: '1:1', background: 'transparent', quality: 'high' };
const endpoint = 'https://api.elevenlabs.io/v1/flows/image';
const directory = new URL('../.data/branding/', import.meta.url);
await mkdir(directory, { recursive: true });
const manifestUrl = new URL('elevenlabs-generation.json', directory);
const clean = value => String(value).replaceAll(key, '[redacted]').replace(/sk[_-][A-Za-z0-9_*.-]+/g, '[redacted]');
async function api(url, init) {
  const response = await fetch(url, { ...init, redirect: 'error', headers: { 'xi-api-key': key, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000) });
  const data = await response.json();
  if (!response.ok) {
    const failure = { provider: 'ElevenLabs', httpStatus: response.status, detail: clean(JSON.stringify(data)), timestamp: new Date().toISOString() };
    await writeFile(new URL('elevenlabs-error.json', directory), JSON.stringify(failure, null, 2));
    throw new Error(`ElevenLabs HTTP ${response.status}: ${failure.detail}`);
  }
  return data;
}
let generation;
if (process.argv.includes('--resume')) generation = JSON.parse(await readFile(manifestUrl, 'utf8'));
else {
  // Never automatically retry a paid creation after an ambiguous response.
  const created = await api(endpoint, { method: 'POST', body: JSON.stringify(request) });
  generation = { id: created.id, provider: 'ElevenLabs', model: request.model_id, status: created.status, createdAt: new Date().toISOString(), prompt };
  await writeFile(manifestUrl, JSON.stringify(generation, null, 2));
}
console.log(`ElevenLabs generation ${generation.id}: ${generation.status}`);
const deadline = Date.now() + 240000;
let interval = 2500;
while (Date.now() < deadline) {
  await delay(interval);
  const result = await api(`${endpoint}/${encodeURIComponent(generation.id)}`);
  if (result.status === 'failed') throw new Error(`Generation failed: ${clean(result.failure_reason)} — ${clean(result.error_message)}`);
  if (result.status === 'completed') {
    if (result.content_mime_type !== 'image/png') throw new Error(`Expected PNG, received ${result.content_mime_type}`);
    const image = await fetch(result.content_url, { signal: AbortSignal.timeout(30000) });
    if (!image.ok) throw new Error(`Asset download failed: ${image.status}`);
    const bytes = Buffer.from(await image.arrayBuffer());
    if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Downloaded asset is not a PNG.');
    await mkdir(new URL('../public/brand/', import.meta.url), { recursive: true });
    await writeFile(new URL('../public/brand/probe-mark-source.png', import.meta.url), bytes);
    await writeFile(manifestUrl, JSON.stringify({ ...generation, status: 'completed', completedAt: new Date().toISOString(), mimeType: result.content_mime_type, bytes: bytes.length, output: 'public/brand/probe-mark-source.png' }, null, 2));
    console.log(`Saved public/brand/probe-mark-source.png (${bytes.length} bytes).`);
    process.exit(0);
  }
  console.log(`Generation status: ${result.status}`);
  interval = Math.min(Math.round(interval * 1.5), 20000);
}
throw new Error('Generation is still pending. Use --resume to continue without creating another paid request.');
