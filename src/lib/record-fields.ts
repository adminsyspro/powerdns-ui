export interface FieldDefinition {
  name: string;
  label: string;
  type: 'number' | 'string' | 'select';
  placeholder: string;
  helperText?: string;
  min?: number;
  max?: number;
  selectOptions?: { value: string; label: string }[];
  width: 'half' | 'full';
}

export interface RecordFieldConfig {
  fields: FieldDefinition[];
  parse: (content: string) => Record<string, string>;
  build: (fields: Record<string, string>) => string;
}

/** Canonical RRSet key used by change history. Raw `${name}::${type}` — must
 *  match the format stored by the pending-changes store; do NOT normalize. */
export function makeRrsetKey(name: string, type: string): string {
  return `${name}::${type}`;
}

const RECORD_FIELD_CONFIGS: Record<string, RecordFieldConfig> = {
  MX: {
    fields: [
      {
        name: 'priority',
        label: 'Priority',
        type: 'number',
        placeholder: '10',
        helperText: 'Lower value = higher priority',
        min: 0,
        max: 65535,
        width: 'half',
      },
      {
        name: 'server',
        label: 'Mail Server',
        type: 'string',
        placeholder: 'mail.example.com',
        helperText: 'Trailing dot added automatically',
        width: 'half',
      },
    ],
    parse: (content: string) => {
      const parts = content.trim().split(/\s+/);
      return { priority: parts[0] || '0', server: parts[1] || '' };
    },
    build: (fields) => `${fields.priority || '0'} ${fields.server || ''}`.trim(),
  },

  SRV: {
    fields: [
      {
        name: 'priority',
        label: 'Priority',
        type: 'number',
        placeholder: '10',
        min: 0,
        max: 65535,
        width: 'half',
      },
      {
        name: 'weight',
        label: 'Weight',
        type: 'number',
        placeholder: '5',
        min: 0,
        max: 65535,
        width: 'half',
      },
      {
        name: 'port',
        label: 'Port',
        type: 'number',
        placeholder: '5060',
        min: 0,
        max: 65535,
        width: 'half',
      },
      {
        name: 'target',
        label: 'Target',
        type: 'string',
        placeholder: 'sipserver.example.com',
        helperText: 'Trailing dot added automatically',
        width: 'half',
      },
    ],
    parse: (content: string) => {
      const parts = content.trim().split(/\s+/);
      return {
        priority: parts[0] || '0',
        weight: parts[1] || '0',
        port: parts[2] || '0',
        target: parts[3] || '',
      };
    },
    build: (fields) =>
      `${fields.priority || '0'} ${fields.weight || '0'} ${fields.port || '0'} ${fields.target || ''}`.trim(),
  },

  CAA: {
    fields: [
      {
        name: 'flags',
        label: 'Flags',
        type: 'number',
        placeholder: '0',
        helperText: '0 = non-critical, 128 = critical',
        min: 0,
        max: 255,
        width: 'half',
      },
      {
        name: 'tag',
        label: 'Tag',
        type: 'select',
        placeholder: 'issue',
        selectOptions: [
          { value: 'issue', label: 'issue' },
          { value: 'issuewild', label: 'issuewild' },
          { value: 'iodef', label: 'iodef' },
        ],
        width: 'half',
      },
      {
        name: 'value',
        label: 'Value',
        type: 'string',
        placeholder: 'letsencrypt.org',
        helperText: 'CA domain or reporting URL',
        width: 'full',
      },
    ],
    parse: (content: string) => {
      // (?=\S) pins the value to the first non-space char so \s+ and [^"]*
      // never compete for the same spaces (avoids polynomial backtracking).
      const match = content.trim().match(/^(\d+)\s+(\S+)\s+(?=\S)"?([^"]*)"?$/);
      if (match) {
        return { flags: match[1], tag: match[2], value: match[3] };
      }
      const parts = content.trim().split(/\s+/);
      return { flags: parts[0] || '0', tag: parts[1] || 'issue', value: parts.slice(2).join(' ').replace(/^"|"$/g, '') };
    },
    build: (fields) =>
      `${fields.flags || '0'} ${fields.tag || 'issue'} "${fields.value || ''}"`,
  },

  NAPTR: {
    fields: [
      {
        name: 'order',
        label: 'Order',
        type: 'number',
        placeholder: '100',
        min: 0,
        max: 65535,
        width: 'half',
      },
      {
        name: 'preference',
        label: 'Preference',
        type: 'number',
        placeholder: '10',
        min: 0,
        max: 65535,
        width: 'half',
      },
      {
        name: 'flags',
        label: 'Flags',
        type: 'string',
        placeholder: 'S',
        helperText: 'e.g., S, A, U, P',
        width: 'half',
      },
      {
        name: 'service',
        label: 'Service',
        type: 'string',
        placeholder: 'SIP+D2U',
        width: 'half',
      },
      {
        name: 'regexp',
        label: 'Regexp',
        type: 'string',
        placeholder: '',
        helperText: 'Leave empty if unused',
        width: 'full',
      },
      {
        name: 'replacement',
        label: 'Replacement',
        type: 'string',
        placeholder: '_sip._udp.example.com.',
        helperText: 'Must end with a dot, or use . for empty',
        width: 'full',
      },
    ],
    parse: (content: string) => {
      // NAPTR format: order preference "flags" "service" "regexp" replacement
      const match = content.trim().match(
        /^(\d+)\s+(\d+)\s+"([^"]*)"\s+"([^"]*)"\s+"([^"]*)"\s+(\S+)$/
      );
      if (match) {
        return {
          order: match[1],
          preference: match[2],
          flags: match[3],
          service: match[4],
          regexp: match[5],
          replacement: match[6],
        };
      }
      const parts = content.trim().split(/\s+/);
      return {
        order: parts[0] || '0',
        preference: parts[1] || '0',
        flags: (parts[2] || '').replace(/"/g, ''),
        service: (parts[3] || '').replace(/"/g, ''),
        regexp: (parts[4] || '').replace(/"/g, ''),
        replacement: parts[5] || '.',
      };
    },
    build: (fields) =>
      `${fields.order || '0'} ${fields.preference || '0'} "${fields.flags || ''}" "${fields.service || ''}" "${fields.regexp || ''}" ${fields.replacement || '.'}`,
  },

  SSHFP: {
    fields: [
      {
        name: 'algorithm',
        label: 'Algorithm',
        type: 'select',
        placeholder: '1',
        selectOptions: [
          { value: '1', label: '1 - RSA' },
          { value: '2', label: '2 - DSA' },
          { value: '3', label: '3 - ECDSA' },
          { value: '4', label: '4 - Ed25519' },
        ],
        width: 'half',
      },
      {
        name: 'fpType',
        label: 'Fingerprint Type',
        type: 'select',
        placeholder: '1',
        selectOptions: [
          { value: '1', label: '1 - SHA-1' },
          { value: '2', label: '2 - SHA-256' },
        ],
        width: 'half',
      },
      {
        name: 'fingerprint',
        label: 'Fingerprint',
        type: 'string',
        placeholder: 'abc123...',
        helperText: 'Hex-encoded fingerprint',
        width: 'full',
      },
    ],
    parse: (content: string) => {
      const parts = content.trim().split(/\s+/);
      return {
        algorithm: parts[0] || '1',
        fpType: parts[1] || '1',
        fingerprint: parts.slice(2).join('') || '',
      };
    },
    build: (fields) =>
      `${fields.algorithm || '1'} ${fields.fpType || '1'} ${fields.fingerprint || ''}`.trim(),
  },

  TLSA: {
    fields: [
      {
        name: 'usage',
        label: 'Certificate Usage',
        type: 'select',
        placeholder: '3',
        selectOptions: [
          { value: '0', label: '0 - CA constraint' },
          { value: '1', label: '1 - Service certificate constraint' },
          { value: '2', label: '2 - Trust anchor assertion' },
          { value: '3', label: '3 - Domain-issued certificate' },
        ],
        width: 'half',
      },
      {
        name: 'selector',
        label: 'Selector',
        type: 'select',
        placeholder: '1',
        selectOptions: [
          { value: '0', label: '0 - Full certificate' },
          { value: '1', label: '1 - SubjectPublicKeyInfo' },
        ],
        width: 'half',
      },
      {
        name: 'matchingType',
        label: 'Matching Type',
        type: 'select',
        placeholder: '1',
        selectOptions: [
          { value: '0', label: '0 - Exact match' },
          { value: '1', label: '1 - SHA-256' },
          { value: '2', label: '2 - SHA-512' },
        ],
        width: 'half',
      },
      {
        name: 'certificateData',
        label: 'Certificate Data',
        type: 'string',
        placeholder: 'abc123...',
        helperText: 'Hex-encoded certificate data',
        width: 'full',
      },
    ],
    parse: (content: string) => {
      const parts = content.trim().split(/\s+/);
      return {
        usage: parts[0] || '3',
        selector: parts[1] || '1',
        matchingType: parts[2] || '1',
        certificateData: parts.slice(3).join('') || '',
      };
    },
    build: (fields) =>
      `${fields.usage || '3'} ${fields.selector || '1'} ${fields.matchingType || '1'} ${fields.certificateData || ''}`.trim(),
  },

  DS: {
    fields: [
      {
        name: 'keytag',
        label: 'Key Tag',
        type: 'number',
        placeholder: '12345',
        min: 0,
        max: 65535,
        width: 'half',
      },
      {
        name: 'algorithm',
        label: 'Algorithm',
        type: 'select',
        placeholder: '13',
        selectOptions: [
          { value: '5', label: '5 - RSA/SHA-1' },
          { value: '7', label: '7 - RSASHA1-NSEC3-SHA1' },
          { value: '8', label: '8 - RSA/SHA-256' },
          { value: '10', label: '10 - RSA/SHA-512' },
          { value: '13', label: '13 - ECDSA/SHA-256' },
          { value: '14', label: '14 - ECDSA/SHA-384' },
          { value: '15', label: '15 - Ed25519' },
          { value: '16', label: '16 - Ed448' },
        ],
        width: 'half',
      },
      {
        name: 'digestType',
        label: 'Digest Type',
        type: 'select',
        placeholder: '2',
        selectOptions: [
          { value: '1', label: '1 - SHA-1' },
          { value: '2', label: '2 - SHA-256' },
          { value: '4', label: '4 - SHA-384' },
        ],
        width: 'half',
      },
      {
        name: 'digest',
        label: 'Digest',
        type: 'string',
        placeholder: 'abc123...',
        helperText: 'Hex-encoded digest',
        width: 'full',
      },
    ],
    parse: (content: string) => {
      const parts = content.trim().split(/\s+/);
      return {
        keytag: parts[0] || '0',
        algorithm: parts[1] || '13',
        digestType: parts[2] || '2',
        digest: parts.slice(3).join('') || '',
      };
    },
    build: (fields) =>
      `${fields.keytag || '0'} ${fields.algorithm || '13'} ${fields.digestType || '2'} ${fields.digest || ''}`.trim(),
  },

  URI: {
    fields: [
      {
        name: 'priority',
        label: 'Priority',
        type: 'number',
        placeholder: '10',
        min: 0,
        max: 65535,
        width: 'half',
      },
      {
        name: 'weight',
        label: 'Weight',
        type: 'number',
        placeholder: '1',
        min: 0,
        max: 65535,
        width: 'half',
      },
      {
        name: 'target',
        label: 'Target URI',
        type: 'string',
        placeholder: 'https://example.com/path',
        helperText: 'URI target (will be quoted)',
        width: 'full',
      },
    ],
    parse: (content: string) => {
      // (?=\S) pins the target to the first non-space char so \s+ and [^"]*
      // never compete for the same spaces (avoids polynomial backtracking).
      const match = content.trim().match(/^(\d+)\s+(\d+)\s+(?=\S)"?([^"]*)"?$/);
      if (match) {
        return { priority: match[1], weight: match[2], target: match[3] };
      }
      const parts = content.trim().split(/\s+/);
      return {
        priority: parts[0] || '0',
        weight: parts[1] || '0',
        target: parts.slice(2).join(' ').replace(/^"|"$/g, ''),
      };
    },
    build: (fields) =>
      `${fields.priority || '0'} ${fields.weight || '0'} "${fields.target || ''}"`,
  },
};

export function getRecordFieldConfig(type: string): RecordFieldConfig | null {
  return RECORD_FIELD_CONFIGS[type] || null;
}

export function hasStructuredFields(type: string): boolean {
  return type in RECORD_FIELD_CONFIGS;
}

// Record types whose whole content is a single hostname that PowerDNS expects
// to be fully-qualified (trailing dot).
const HOSTNAME_TYPES = new Set(['CNAME', 'NS', 'PTR', 'DNAME', 'ALIAS']);
// Record types where the hostname is the last whitespace-separated token.
const HOSTNAME_TAIL_TYPES = new Set(['MX', 'SRV']);

function ensureTrailingDot(host: string): string {
  // Never dot an empty token, the root label ".", or a bare number — but
  // numeric-only multi-label names like `123.456` are valid DNS names and do
  // get the trailing dot.
  if (!host || host === '.' || /^\d+$/.test(host)) return host;
  return host.endsWith('.') ? host : `${host}.`;
}

function normalizeTxtContent(content: string): string {
  // Already wrapped (single "..." or multi-string "..." "...") — trust the user.
  if (content.startsWith('"') && content.endsWith('"') && content.length >= 2) {
    return content;
  }
  // Escape backslashes and quotes, then wrap the whole value in quotes.
  const escaped = content.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Normalize record content so the user doesn't have to type DNS boilerplate:
 * - TXT values are auto-quoted (and inner quotes/backslashes escaped).
 * - Hostname targets (CNAME/NS/PTR/DNAME/ALIAS, and the MX/SRV target) get the
 *   required trailing dot added automatically.
 * Idempotent: re-normalizing already-correct content is a no-op.
 */
export function normalizeRecordContent(type: string, content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return trimmed;

  if (type === 'TXT') {
    return normalizeTxtContent(trimmed);
  }

  if (HOSTNAME_TYPES.has(type)) {
    return ensureTrailingDot(trimmed);
  }

  if (HOSTNAME_TAIL_TYPES.has(type)) {
    const parts = trimmed.split(/\s+/);
    parts[parts.length - 1] = ensureTrailingDot(parts[parts.length - 1]);
    return parts.join(' ');
  }

  return trimmed;
}
