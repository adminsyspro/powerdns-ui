import assert from 'node:assert';
import { getCertsUid, getCertsGid } from '../../src/lib/certs/config';

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k]!;
  }
  try { fn(); } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k]!;
    }
  }
}

function captureWarn(fn: () => void): string[] {
  const msgs: string[] = [];
  const orig = console.warn;
  console.warn = (...a: unknown[]) => { msgs.push(a.map(String).join(' ')); };
  try { fn(); } finally { console.warn = orig; }
  return msgs;
}

// unset → null, no warning
withEnv({ CERTS_GID: undefined, CERTS_UID: undefined }, () => {
  const warns = captureWarn(() => {
    assert.equal(getCertsGid(), null, 'unset GID → null');
    assert.equal(getCertsUid(), null, 'unset UID → null');
  });
  assert.equal(warns.length, 0, 'no warning when unset');
});

// valid numeric → number, no warning; leading/trailing space trimmed
withEnv({ CERTS_GID: '6000', CERTS_UID: ' 1001 ' }, () => {
  const warns = captureWarn(() => {
    assert.equal(getCertsGid(), 6000, 'valid GID parsed');
    assert.equal(getCertsUid(), 1001, 'valid UID trimmed+parsed');
  });
  assert.equal(warns.length, 0, 'no warning when valid');
});

// zero is a valid gid (root group)
withEnv({ CERTS_GID: '0' }, () => { assert.equal(getCertsGid(), 0, '0 is a valid gid'); });

// present-but-invalid → null + exactly one warning naming the var (deduped)
withEnv({ CERTS_GID: 'abc' }, () => {
  const warns = captureWarn(() => {
    assert.equal(getCertsGid(), null, 'non-numeric GID → null');
    getCertsGid(); // second call must NOT warn again (deduped)
  });
  assert.equal(warns.length, 1, 'invalid GID warns once');
  assert.match(warns[0], /CERTS_GID/, 'warning names the var');
});

// negative / -1 rejected (different var so dedup does not swallow the warning)
withEnv({ CERTS_UID: '-1' }, () => {
  const warns = captureWarn(() => { assert.equal(getCertsUid(), null, '-1 rejected'); });
  assert.equal(warns.length, 1, 'invalid UID warns once');
});

console.log('certs/config-ids: ALL PASSED');
