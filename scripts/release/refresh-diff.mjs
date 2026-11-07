import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';

export function difference(before, after, identity) {
  const map = rows => {
    const result = new Map(rows.map(row => [identity(row), row]));
    assert.equal(result.size, rows.length, 'Duplicate evidence identity');
    return result;
  };
  const old = map(before);
  const next = map(after);
  return [...new Set([...old.keys(), ...next.keys()])].sort()
    .filter(key => !isDeepStrictEqual(old.get(key), next.get(key)))
    .map(key => ({ before: old.get(key) ?? null, after: next.get(key) ?? null }));
}
