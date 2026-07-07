// src/lib/bind/parser.ts
import type { RecordType } from '@/types/powerdns';
import {
  SUPPORTED_RECORD_TYPES,
  type ImportPreview,
  type ParsedRRSet,
  type BindWarning,
  type BindError,
} from './types';
import { validateRdata, validateOwner } from './rdata-validators';

interface ParsedRecord {
  line: number;
  owner: string;
  ttl: number;
  type: RecordType;
  rdata: string;
}

interface ParserState {
  origin: string | null;
  defaultTtl: number | null;
  lastOwner: string | null;
  warnings: BindWarning[];
  errors: BindError[];
}

const TTL_UNIT_SECONDS: Record<string, number> = {
  s: 1, S: 1,
  m: 60, M: 60,
  h: 3600, H: 3600,
  d: 86400, D: 86400,
  w: 604800, W: 604800,
};

function parseTtl(token: string): number | null {
  if (/^\d+$/.test(token)) return Number(token);
  // Sticky flag: each match must start where the previous one ended, so the
  // engine never rescans the token from every offset (avoids polynomial
  // backtracking). Full coverage is still enforced by the length check below.
  const re = /(\d+)([smhdwSMHDW])/y;
  let total = 0;
  let matched = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(token)) !== null) {
    total += Number(m[1]) * TTL_UNIT_SECONDS[m[2]];
    matched += m[0].length;
  }
  if (matched === token.length && matched > 0) return total;
  return null;
}

function stripComments(line: string): string {
  let result = '';
  let inQuote = false;
  let escape = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (escape) {
      result += ch;
      escape = false;
      continue;
    }
    if (ch === '\\') {
      result += ch;
      escape = true;
      continue;
    }
    if (ch === '"') {
      inQuote = !inQuote;
      result += ch;
      continue;
    }
    if (ch === ';' && !inQuote) break;
    result += ch;
  }
  return result;
}

function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let inQuote = false;
  let escape = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (escape) {
      cur += ch;
      escape = false;
      continue;
    }
    if (ch === '\\') {
      cur += ch;
      escape = true;
      continue;
    }
    if (ch === '"') {
      cur += ch;
      inQuote = !inQuote;
      continue;
    }
    if (/\s/.test(ch) && !inQuote) {
      if (cur) {
        tokens.push(cur);
        cur = '';
      }
      continue;
    }
    cur += ch;
  }
  if (cur) tokens.push(cur);
  return tokens;
}

function canonicalizeRdataNames(type: RecordType, rdata: string, origin: string | null): string {
  const fix = (n: string): string => {
    if (n === '@' && origin) return origin;
    if (n.endsWith('.')) return n.toLowerCase();
    if (origin) return `${n}.${origin}`.toLowerCase();
    return n;
  };

  switch (type) {
    case 'CNAME':
    case 'NS':
    case 'PTR':
    case 'DNAME':
    case 'ALIAS':
      return fix(rdata.trim());
    case 'MX': {
      const [prio, ...rest] = rdata.trim().split(/\s+/);
      return `${prio} ${fix(rest.join(' '))}`;
    }
    case 'SRV': {
      const parts = rdata.trim().split(/\s+/);
      if (parts.length !== 4) return rdata;
      return `${parts[0]} ${parts[1]} ${parts[2]} ${fix(parts[3])}`;
    }
    case 'SOA': {
      const parts = rdata.trim().split(/\s+/);
      if (parts.length !== 7) return rdata;
      return `${fix(parts[0])} ${fix(parts[1])} ${parts.slice(2).join(' ')}`;
    }
    default:
      return rdata;
  }
}

function parseLine(
  tokens: string[],
  startsWithWhitespace: boolean,
  state: ParserState,
  lineNum: number,
  rawLine: string,
): ParsedRecord | null {
  if (tokens.length === 0) return null;

  if (tokens[0].toUpperCase() === '$ORIGIN') {
    if (tokens[1] && tokens[1].endsWith('.')) {
      state.origin = tokens[1].toLowerCase();
    } else if (tokens[1]) {
      state.errors.push({ line: lineNum, message: '$ORIGIN must be absolute (end with ".")', rawLine });
    } else {
      state.errors.push({ line: lineNum, message: '$ORIGIN missing argument', rawLine });
    }
    return null;
  }
  if (tokens[0].toUpperCase() === '$TTL') {
    const ttl = parseTtl(tokens[1] || '');
    if (ttl == null) {
      state.errors.push({ line: lineNum, message: `$TTL invalid: ${tokens[1]}`, rawLine });
    } else {
      state.defaultTtl = ttl;
    }
    return null;
  }
  if (tokens[0].toUpperCase() === '$INCLUDE') {
    state.warnings.push({ line: lineNum, message: '$INCLUDE ignored (not supported)' });
    return null;
  }
  if (tokens[0].toUpperCase() === '$GENERATE') {
    state.warnings.push({ line: lineNum, message: '$GENERATE ignored (not supported)' });
    return null;
  }

  let owner: string;
  let idx: number;
  if (startsWithWhitespace) {
    if (!state.lastOwner) {
      state.errors.push({ line: lineNum, message: 'blank owner with no previous record', rawLine });
      return null;
    }
    owner = state.lastOwner;
    idx = 0;
  } else {
    owner = tokens[0];
    idx = 1;
  }

  let ttl: number | null = null;
  while (idx < tokens.length) {
    const t = tokens[idx];
    const candidateTtl = parseTtl(t);
    if (candidateTtl != null) {
      if (ttl != null) break;
      ttl = candidateTtl;
      idx++;
      continue;
    }
    const upper = t.toUpperCase();
    if (upper === 'IN') {
      idx++;
      continue;
    }
    if (upper === 'CH' || upper === 'HS' || upper === 'ANY') {
      state.warnings.push({ line: lineNum, message: `class ${upper} not supported, line skipped` });
      return null;
    }
    break;
  }

  if (idx >= tokens.length) {
    state.errors.push({ line: lineNum, message: 'missing record type', rawLine });
    return null;
  }
  const typeToken = tokens[idx].toUpperCase() as RecordType;
  idx++;

  if (!SUPPORTED_RECORD_TYPES.has(typeToken)) {
    state.errors.push({ line: lineNum, message: `unsupported record type: ${typeToken}`, rawLine });
    return null;
  }

  if (ttl == null) {
    if (state.defaultTtl != null) {
      ttl = state.defaultTtl;
    } else {
      ttl = 3600;
      state.warnings.push({ line: lineNum, message: 'TTL missing, defaulted to 3600', owner, type: typeToken });
    }
  }

  const origin = state.origin;

  let canonicalOwner: string;
  if (owner === '@') {
    if (!origin) {
      state.errors.push({ line: lineNum, message: "'@' used before $ORIGIN/SOA", rawLine });
      return null;
    }
    canonicalOwner = origin;
  } else if (owner.endsWith('.')) {
    canonicalOwner = owner.toLowerCase();
  } else {
    if (!origin) {
      state.errors.push({ line: lineNum, message: `relative name "${owner}" before $ORIGIN/SOA`, rawLine });
      return null;
    }
    canonicalOwner = `${owner}.${origin}`.toLowerCase();
  }

  state.lastOwner = canonicalOwner;

  const rdataTokens = tokens.slice(idx);
  if (rdataTokens.length === 0) {
    state.errors.push({ line: lineNum, message: 'missing rdata', rawLine });
    return null;
  }

  let rdata = rdataTokens.join(' ');
  rdata = canonicalizeRdataNames(typeToken, rdata, origin);

  if (typeToken === 'SOA' && !state.origin) {
    state.origin = canonicalOwner;
  }

  const ownerCheck = validateOwner(canonicalOwner);
  if (!ownerCheck.ok) {
    state.errors.push({ line: lineNum, message: ownerCheck.message || 'invalid owner', rawLine });
    return null;
  }

  const rdataCheck = validateRdata(typeToken, rdata);
  if (!rdataCheck.ok) {
    state.errors.push({ line: lineNum, message: rdataCheck.message || 'invalid rdata', rawLine });
    return null;
  }

  return { line: lineNum, owner: canonicalOwner, ttl, type: typeToken, rdata };
}

function groupIntoRRSets(records: ParsedRecord[], state: ParserState): ParsedRRSet[] {
  const map = new Map<string, ParsedRRSet>();
  for (const rec of records) {
    const key = `${rec.owner}::${rec.type}`;
    const existing = map.get(key);
    if (existing) {
      if (rec.type === 'CNAME') {
        state.errors.push({ line: rec.line, message: `CNAME RRSet "${rec.owner}" has multiple records (only one allowed)` });
        continue;
      }
      existing.records.push({ content: rec.rdata, disabled: false });
      if (rec.ttl < existing.ttl) existing.ttl = rec.ttl;
    } else {
      map.set(key, {
        name: rec.owner,
        type: rec.type,
        ttl: rec.ttl,
        records: [{ content: rec.rdata, disabled: false }],
        comments: [],
      });
    }
  }
  return Array.from(map.values());
}

function dedupeSoa(rrsets: ParsedRRSet[], state: ParserState): ParsedRRSet[] {
  let firstSeen = false;
  const out: ParsedRRSet[] = [];
  for (const rs of rrsets) {
    if (rs.type === 'SOA') {
      if (firstSeen) {
        state.warnings.push({ line: 0, message: `additional SOA at "${rs.name}" ignored (only the first SOA is kept)` });
        continue;
      }
      firstSeen = true;
    }
    out.push(rs);
  }
  return out;
}

export function parseBind(content: string, originHint?: string): ImportPreview {
  const state: ParserState = {
    origin: originHint
      ? (originHint.endsWith('.') ? originHint.toLowerCase() : `${originHint.toLowerCase()}.`)
      : null,
    defaultTtl: null,
    lastOwner: null,
    warnings: [],
    errors: [],
  };

  const rawLines = content.replace(/^﻿/, '').split(/\r\n|\r|\n/);

  const flattened: { text: string; lineNum: number; startsWithWs: boolean }[] = [];
  let buffer = '';
  let bufferStartLine = 0;
  let bufferStartsWithWs = false;
  let inParen = false;

  rawLines.forEach((raw, i) => {
    const lineNum = i + 1;
    const startsWithWs = /^\s/.test(raw);
    const stripped = stripComments(raw);
    if (inParen) {
      buffer += ' ' + stripped.trim();
      if (stripped.includes(')')) {
        inParen = false;
        flattened.push({
          text: buffer.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim(),
          lineNum: bufferStartLine,
          startsWithWs: bufferStartsWithWs,
        });
        buffer = '';
      }
      return;
    }
    const trimmed = stripped.trim();
    if (!trimmed) return;
    if (trimmed.includes('(') && !trimmed.includes(')')) {
      inParen = true;
      buffer = stripped;
      bufferStartLine = lineNum;
      bufferStartsWithWs = startsWithWs;
      return;
    }
    if (trimmed.includes('(') && trimmed.includes(')')) {
      flattened.push({
        text: trimmed.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim(),
        lineNum,
        startsWithWs,
      });
      return;
    }
    flattened.push({ text: trimmed, lineNum, startsWithWs });
  });

  if (buffer) {
    state.errors.push({ line: bufferStartLine, message: 'unterminated parenthesis' });
  }

  const records: ParsedRecord[] = [];
  for (const fl of flattened) {
    const tokens = tokenize(fl.text);
    const parsed = parseLine(tokens, fl.startsWithWs, state, fl.lineNum, fl.text);
    if (parsed) records.push(parsed);
  }

  if (records.length === 0 && state.errors.length === 0) {
    state.errors.push({ line: 0, message: 'no records found' });
  }

  if (originHint && state.origin) {
    const hintCanon = originHint.endsWith('.')
      ? originHint.toLowerCase()
      : `${originHint.toLowerCase()}.`;
    if (state.origin !== hintCanon) {
      state.warnings.push({
        line: 0,
        message: `file $ORIGIN "${state.origin}" differs from target zone "${hintCanon}"`,
      });
    }
  }

  let rrsets = groupIntoRRSets(records, state);
  rrsets = dedupeSoa(rrsets, state);

  const typeStats: Record<string, number> = {};
  for (const rs of rrsets) {
    typeStats[rs.type] = (typeStats[rs.type] || 0) + 1;
  }

  return {
    rrsets,
    warnings: state.warnings,
    errors: state.errors,
    detectedOrigin: state.origin,
    typeStats,
  };
}
