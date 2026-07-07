import assert from 'node:assert';
import { getRecordFieldConfig } from '../src/lib/record-fields';

// Regression tests for the CAA and URI content parsers. Their regexes gained
// a (?=\S) lookahead so \s+ and [^"]* no longer compete for the same spaces
// (polynomial backtracking). Results must be identical to the old patterns:
// same accepted inputs, same captured groups, same fallback behavior.

const caa = getRecordFieldConfig('CAA');
const uri = getRecordFieldConfig('URI');
assert.ok(caa && uri);

// CAA: regex path (quoted, unquoted, extra spaces, unbalanced quotes).
assert.deepEqual(caa.parse('0 issue "letsencrypt.org"'), { flags: '0', tag: 'issue', value: 'letsencrypt.org' });
assert.deepEqual(caa.parse('128 iodef "mailto:sec@example.com"'), { flags: '128', tag: 'iodef', value: 'mailto:sec@example.com' });
assert.deepEqual(caa.parse('0 issue letsencrypt.org'), { flags: '0', tag: 'issue', value: 'letsencrypt.org' });
assert.deepEqual(caa.parse('0 issue    spaced.example.com'), { flags: '0', tag: 'issue', value: 'spaced.example.com' });
assert.deepEqual(caa.parse('0 issue "value with spaces"'), { flags: '0', tag: 'issue', value: 'value with spaces' });
assert.deepEqual(caa.parse('0 issue "half'), { flags: '0', tag: 'issue', value: 'half' });
assert.deepEqual(caa.parse('0 issue half"'), { flags: '0', tag: 'issue', value: 'half' });
assert.deepEqual(caa.parse('0 issue "'), { flags: '0', tag: 'issue', value: '' });
assert.deepEqual(caa.parse('  0 issue "v"  '), { flags: '0', tag: 'issue', value: 'v' });

// CAA: inputs the regex must NOT match (internal quote, non-numeric flags,
// missing value) fall back to the loose whitespace split.
assert.deepEqual(caa.parse('0 issue "a"b"'), { flags: '0', tag: 'issue', value: 'a"b' });
assert.deepEqual(caa.parse('x issue v'), { flags: 'x', tag: 'issue', value: 'v' });
assert.deepEqual(caa.parse('0 issue'), { flags: '0', tag: 'issue', value: '' });

// URI: regex path.
assert.deepEqual(uri.parse('10 1 "https://example.com/path"'), { priority: '10', weight: '1', target: 'https://example.com/path' });
assert.deepEqual(uri.parse('10 1 https://example.com/path'), { priority: '10', weight: '1', target: 'https://example.com/path' });
assert.deepEqual(uri.parse('10 1 "https://example.com/a b"'), { priority: '10', weight: '1', target: 'https://example.com/a b' });

// URI: fallback path (non-numeric weight, internal quote, missing target).
assert.deepEqual(uri.parse('10 one "x"'), { priority: '10', weight: 'one', target: 'x' });
assert.deepEqual(uri.parse('1 2 "a"b'), { priority: '1', weight: '2', target: 'a"b' });
assert.deepEqual(uri.parse('10 1'), { priority: '10', weight: '1', target: '' });

// Pathological input for the old patterns (many spaces before a value that
// forces a late failure) must be handled quickly and via the fallback.
{
  const nasty = `0 issue${' '.repeat(20000)}"a"b"`;
  const start = Date.now();
  assert.deepEqual(caa.parse(nasty), { flags: '0', tag: 'issue', value: 'a"b' });
  assert.ok(Date.now() - start < 2000, 'CAA parse should run in linear time');
}

console.log('record-fields-parse: ALL PASSED');
