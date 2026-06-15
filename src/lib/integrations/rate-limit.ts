// Process-wide spacing for outgoing Cloudflare API requests. Cloudflare's
// global limit is ~1200 req / 5 min (≈ 4 req/s); we default below that for
// headroom. NOTE: per-process only — a multi-process deployment would each get
// its own limiter (single-process is assumed; see the design doc).
const MAX_RPS = Math.max(1, Number(process.env.CF_MAX_RPS) || 3);
const MIN_INTERVAL_MS = 1000 / MAX_RPS;

let nextSlotAt = 0;

/** Resolves when the caller may issue its next Cloudflare request. */
export function acquireCfSlot(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlotAt);
  nextSlotAt = slot + MIN_INTERVAL_MS;
  const wait = slot - now;
  return wait <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, wait));
}
