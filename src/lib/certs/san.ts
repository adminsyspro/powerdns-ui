export const MAX_SANS = 100;

/**
 * Normalize + validate a list of DNS SANs.
 * - lowercases, trims, strips one trailing dot
 * - converts IDN labels to punycode via the URL parser
 * - allows a leading `*.` wildcard only as the left-most label
 * - de-duplicates preserving first-seen order
 * Throws on invalid input.
 */
export function canonicalizeSans(input: string[]): string[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('at least one SAN is required');
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const name = normalizeOne(raw);
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  if (out.length > MAX_SANS) throw new Error(`too many SANs (max ${MAX_SANS})`);
  return out;
}

function normalizeOne(raw: string): string {
  if (typeof raw !== 'string') throw new Error('invalid SAN: not a string');
  let name = raw.trim().toLowerCase().replace(/\.$/, '');
  if (name === '') throw new Error('invalid SAN: empty');

  let wildcard = false;
  if (name.startsWith('*.')) {
    wildcard = true;
    name = name.slice(2);
  }
  if (name.includes('*')) throw new Error('invalid SAN: wildcard only allowed as left-most label');

  // Use the URL parser to validate the host and get punycode/ASCII form.
  let host: string;
  try {
    host = new URL(`https://${name}`).hostname;
  } catch {
    throw new Error(`invalid SAN: ${raw}`);
  }
  if (!/^[a-z0-9.-]+$/.test(host) || host.startsWith('-') || host.startsWith('.') || host.endsWith('.') || host.includes('..')) {
    throw new Error(`invalid SAN: ${raw}`);
  }
  return wildcard ? `*.${host}` : host;
}
