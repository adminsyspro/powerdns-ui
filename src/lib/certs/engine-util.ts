export function backoffDelayMs(attempt: number, baseMs: number, maxMs: number): number {
  const d = baseMs * 2 ** Math.max(0, attempt - 1);
  return Math.min(d, maxMs);
}

export function groupChallengesByFqdn(items: { fqdn: string; value: string }[]): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const { fqdn, value } of items) {
    const arr = m.get(fqdn) ?? [];
    if (!arr.includes(value)) arr.push(value);
    m.set(fqdn, arr);
  }
  return m;
}

export function classifyError(err: unknown): { errorClass: string; message: string; retryDelayMs: number } {
  const message = err instanceof Error ? err.message : String(err);
  const m = message.toLowerCase();
  if (/rate ?limit|too many|ratelimited/.test(m)) return { errorClass: 'rate-limit', message, retryDelayMs: 3_600_000 };
  if (/dns problem|nxdomain|no txt|propagat|servfail|timed out looking/.test(m)) return { errorClass: 'propagation', message, retryDelayMs: 600_000 };
  if (/patch|rrset|powerdns|x-api-key|zone .* not|dns write/.test(m)) return { errorClass: 'dns-write', message, retryDelayMs: 300_000 };
  if (/account|unauthorized|jws|badnonce|eab|external account/.test(m)) return { errorClass: 'account', message, retryDelayMs: 900_000 };
  if (/identifier|invalid domain|not allowed|rejectedidentifier/.test(m)) return { errorClass: 'invalid-identifier', message, retryDelayMs: 3_600_000 };
  return { errorClass: 'unknown', message, retryDelayMs: 900_000 };
}
