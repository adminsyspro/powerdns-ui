// src/lib/bind/rdata-validators.ts
import type { RecordType } from '@/types/powerdns';

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6_RE = /^[0-9a-fA-F:]+$/;
const FQDN_LABEL_RE = /^(?=.{1,63}$)[a-zA-Z0-9_]([a-zA-Z0-9_-]*[a-zA-Z0-9_])?$/;
const FULL_FQDN_RE = /^(\*\.)?([a-zA-Z0-9_]([a-zA-Z0-9_-]*[a-zA-Z0-9_])?\.)+$/;

export function isValidIPv4(value: string): boolean {
  const m = IPV4_RE.exec(value);
  if (!m) return false;
  return [m[1], m[2], m[3], m[4]].every((s) => {
    const n = Number(s);
    return n >= 0 && n <= 255 && String(n) === s;
  });
}

export function isValidIPv6(value: string): boolean {
  if (!IPV6_RE.test(value)) return false;
  if (!value.includes(':')) return false;
  const doubleColonCount = (value.match(/::/g) || []).length;
  if (doubleColonCount > 1) return false;
  return true;
}

export function isValidFqdn(value: string): boolean {
  if (value.length > 255) return false;
  if (!value.endsWith('.')) return false;
  if (value === '.') return true;
  return FULL_FQDN_RE.test(value);
}

export interface ValidationResult {
  ok: boolean;
  message?: string;
}

export function validateRdata(type: RecordType, rdata: string): ValidationResult {
  const trimmed = rdata.trim();
  if (!trimmed) return { ok: false, message: 'empty rdata' };

  switch (type) {
    case 'A':
      return isValidIPv4(trimmed) ? { ok: true } : { ok: false, message: `invalid IPv4: ${trimmed}` };
    case 'AAAA':
      return isValidIPv6(trimmed) ? { ok: true } : { ok: false, message: `invalid IPv6: ${trimmed}` };
    case 'CNAME':
    case 'NS':
    case 'PTR':
    case 'DNAME':
    case 'ALIAS':
      return isValidFqdn(trimmed)
        ? { ok: true }
        : { ok: false, message: `invalid target FQDN: ${trimmed}` };
    case 'MX': {
      const parts = trimmed.split(/\s+/);
      if (parts.length !== 2) return { ok: false, message: 'MX expects "<priority> <target>"' };
      if (!/^\d+$/.test(parts[0])) return { ok: false, message: `MX priority not numeric: ${parts[0]}` };
      if (!isValidFqdn(parts[1])) return { ok: false, message: `MX target invalid: ${parts[1]}` };
      return { ok: true };
    }
    case 'SRV': {
      const parts = trimmed.split(/\s+/);
      if (parts.length !== 4) return { ok: false, message: 'SRV expects "<prio> <weight> <port> <target>"' };
      if (!parts.slice(0, 3).every((p) => /^\d+$/.test(p))) {
        return { ok: false, message: 'SRV priority/weight/port not numeric' };
      }
      if (!isValidFqdn(parts[3])) return { ok: false, message: `SRV target invalid: ${parts[3]}` };
      return { ok: true };
    }
    case 'CAA': {
      const parts = trimmed.split(/\s+/);
      if (parts.length < 3) return { ok: false, message: 'CAA expects "<flags> <tag> <value>"' };
      if (!/^\d+$/.test(parts[0])) return { ok: false, message: 'CAA flags not numeric' };
      return { ok: true };
    }
    case 'SOA': {
      const parts = trimmed.split(/\s+/);
      if (parts.length !== 7) return { ok: false, message: 'SOA expects 7 fields (mname rname serial refresh retry expire minimum)' };
      if (!isValidFqdn(parts[0])) return { ok: false, message: `SOA mname invalid: ${parts[0]}` };
      if (!isValidFqdn(parts[1])) return { ok: false, message: `SOA rname invalid: ${parts[1]}` };
      if (!parts.slice(2).every((p) => /^\d+$/.test(p))) {
        return { ok: false, message: 'SOA numeric fields invalid' };
      }
      return { ok: true };
    }
    case 'TXT':
    case 'SPF':
      return { ok: true };
    default:
      return { ok: true };
  }
}

export function validateOwner(owner: string): ValidationResult {
  if (!owner) return { ok: false, message: 'empty owner name' };
  if (!owner.endsWith('.')) return { ok: false, message: `owner not absolute: ${owner}` };
  if (owner.length > 255) return { ok: false, message: `owner exceeds 255 bytes: ${owner}` };
  if (owner === '.') return { ok: true };
  const labels = owner.replace(/\.$/, '').split('.');
  for (const label of labels) {
    if (label === '*') continue;
    if (!FQDN_LABEL_RE.test(label)) {
      return { ok: false, message: `invalid label "${label}" in owner "${owner}"` };
    }
  }
  return { ok: true };
}
