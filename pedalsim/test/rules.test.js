// The rules every file in sim/ lives by, checked by reading the source.
//
// A shared run link is replayed on someone else's machine, in someone else's browser, and
// has to give the same time to the millisecond. ECMAScript lets Math.sin, exp, pow, log and
// the ** operator differ in the last bit between engines, so none of them may appear in the
// simulation; curves are tables, and Math.sqrt - correctly rounded by IEEE 754 - is allowed.
// No clock and no randomness, or two runs of one log differ. Nothing from the browser, or
// the solver and the tests cannot run it in Node.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const SIM = new URL('../sim/', import.meta.url);

const FORBIDDEN = [
  [/\bMath\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|exp|expm1|log|log2|log10|log1p|pow|cbrt|hypot|fround|random)\b/,
    'a Math function engines may disagree on, or random'],
  [/\*\*/, 'the ** operator, which is Math.pow'],
  [/\bDate\b/, 'the clock'],
  [/\bperformance\b/, 'the clock'],
  [/\b(window|document|globalThis|navigator|localStorage)\b/, 'the browser'],
];

// Comments are allowed to talk about the rules, so they are removed before checking. Strings
// are kept: a forbidden name in a string is still something worth looking at.
function code(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const files = readdirSync(SIM, { recursive: true }).filter((f) => f.endsWith('.js'));

test('sim/ has files to check', () => {
  assert.ok(files.length > 0);
});

for (const file of files) {
  test(`sim/${file} keeps the determinism rules`, () => {
    const lines = code(readFileSync(new URL(file, SIM), 'utf8')).split('\n');
    const broken = [];
    lines.forEach((line, i) => {
      for (const [pattern, why] of FORBIDDEN) {
        if (pattern.test(line)) broken.push(`line ${i + 1}: ${why}: ${line.trim()}`);
      }
    });
    assert.deepEqual(broken, []);
  });

  test(`sim/${file} imports only from inside sim/`, () => {
    const source = code(readFileSync(new URL(file, SIM), 'utf8'));
    const imports = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const from of imports) {
      assert.ok(from.startsWith('./'), `sim/${file} imports ${from}`);
    }
  });
}

test('the rules catch what they are meant to', () => {
  // A checker that never fails proves nothing, so feed it the things it must refuse.
  const caught = (src) => FORBIDDEN.some(([p]) => code(src).split('\n').some((l) => p.test(l)));
  assert.ok(caught('const x = Math.sin(a);'));
  assert.ok(caught('const x = a ** 2;'));
  assert.ok(caught('const t = Date.now();'));
  assert.ok(caught('const t = performance.now();'));
  assert.ok(caught('const r = Math.random();'));
  assert.ok(caught('window.foo = 1;'));
  assert.ok(!caught('const x = Math.sqrt(a) * Math.round(b);'));
  assert.ok(!caught('// Math.sin is forbidden here'));
  assert.ok(!caught('/* no Date, no performance */ const y = 1;'));
});
