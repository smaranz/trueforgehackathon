import { setTimeout as delay } from 'node:timers/promises';

export function providerRateLimitDelay(message: string, attempt: number): number | undefined {
  if (!/\b429\b|rate limit|too many requests/i.test(message)) return;
  const milliseconds = message.match(/try again in\s*([\d.]+)\s*ms/i);
  const seconds = message.match(/try again in\s*([\d.]+)\s*s(?:ec(?:onds?)?)?/i);
  const reported = milliseconds ? Number(milliseconds[1]) : seconds ? Number(seconds[1]) * 1000 : 0;
  return Math.min(90000, Math.max(reported + 1000, 10000 * 2 ** Math.min(attempt, 3)));
}

/** Shared provider cooldown. This is error-driven backoff, not browser phase synchronization. */
export class ProviderCooldown {
  private until = 0;
  defer(milliseconds: number) { this.until = Math.max(this.until, Date.now() + milliseconds); }
  async wait(signal: AbortSignal) {
    while (Date.now() < this.until) {
      signal.throwIfAborted();
      await delay(Math.min(this.until - Date.now(), 1000), undefined, { signal });
    }
    signal.throwIfAborted();
  }
}
