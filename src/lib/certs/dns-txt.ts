import type { RRSet } from '@/types/powerdns';

const DEFAULT_TXT_TTL = 60;

/** Wrap a TXT value in double quotes unless already quoted. */
export function quoteTxt(value: string): string {
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) return value;
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function unquote(value: string): string {
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return value;
}

/** Union of existing + new TXT values, deduped by unquoted content, order preserved, all quoted. */
export function mergeTxtValues(existing: string[], toAdd: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of [...existing, ...toAdd]) {
    const key = unquote(v);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(quoteTxt(key));
    }
  }
  return out;
}

/** Existing values minus the ones we own (compared unquoted), remainder quoted. */
export function removeTxtValues(existing: string[], toRemove: string[]): string[] {
  const drop = new Set(toRemove.map(unquote));
  return existing.filter((v) => !drop.has(unquote(v))).map((v) => quoteTxt(unquote(v)));
}

/** `_acme-challenge.<base>.` for an ACME identifier value (strips leading `*.`). */
export function challengeFqdn(identifierValue: string): string {
  let base = identifierValue.trim().toLowerCase().replace(/\.$/, '');
  if (base.startsWith('*.')) base = base.slice(2);
  return `_acme-challenge.${base}.`;
}

export function buildTxtRrset(fqdn: string, quotedValues: string[], ttl = DEFAULT_TXT_TTL): RRSet {
  return {
    name: fqdn,
    type: 'TXT',
    ttl,
    changetype: 'REPLACE',
    records: quotedValues.map((content) => ({ content, disabled: false })),
  };
}

export function buildTxtDelete(fqdn: string): RRSet {
  return { name: fqdn, type: 'TXT', ttl: DEFAULT_TXT_TTL, changetype: 'DELETE', records: [] };
}
