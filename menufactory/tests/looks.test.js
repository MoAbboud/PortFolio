// Every published look is complete and within its weight budget, and the libraries in
// shared/lib/ are the versions package.json pins.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOOKS = path.join(ROOT, 'looks');
const LIB = path.join(ROOT, 'shared', 'lib');
const CATEGORIES = ['cocktail-bar', 'bar', 'restaurant'];

// What each name in a look's "uses" costs on first load.
const LIB_FILES = {
  gsap: ['gsap.min.js'],
  scrolltrigger: ['ScrollTrigger.min.js'],
  three: ['three/three.module.js', 'three/three.core.js'],
};

const looks = fs.existsSync(LOOKS)
  ? fs.readdirSync(LOOKS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  : [];

function folderBytes(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && entry.name !== 'look.json') total += fs.statSync(path.join(entry.parentPath, entry.name)).size;
  }
  return total;
}

test('there is at least one look', () => {
  assert.ok(looks.length > 0);
});

for (const name of looks) {
  const dir = path.join(LOOKS, name);

  test(`${name}: has look.json, look.js and look.css`, () => {
    for (const file of ['look.json', 'look.js', 'look.css']) assert.ok(fs.existsSync(path.join(dir, file)), file);
  });

  test(`${name}: look.json says what the library needs`, () => {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'look.json'), 'utf8'));
    assert.equal(typeof meta.name, 'string');
    assert.ok(CATEGORIES.includes(meta.category), `category must be one of ${CATEGORIES.join(', ')}`);
    assert.ok(Array.isArray(meta.pages) && meta.pages.length > 0);
    assert.equal(typeof meta.accepts_venue_colours, 'boolean');
    assert.ok(Number.isFinite(meta.budget_kb) && meta.budget_kb > 0, 'budget_kb');
    for (const use of meta.uses ?? []) assert.ok(LIB_FILES[use], `unknown library "${use}"`);
  });

  test(`${name}: first load is within its weight budget`, () => {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'look.json'), 'utf8'));
    let bytes = folderBytes(dir);
    for (const use of meta.uses ?? []) for (const file of LIB_FILES[use]) bytes += fs.statSync(path.join(LIB, file)).size;
    const kb = bytes / 1024;
    assert.ok(kb <= meta.budget_kb, `${kb.toFixed(1)} KB is over the budget of ${meta.budget_kb} KB`);
  });

  test(`${name}: the published script is the obfuscated copy, not readable source`, () => {
    const js = fs.readFileSync(path.join(dir, 'look.js'), 'utf8');
    assert.ok(!/^\s*\/\//m.test(js), 'comments survive only in readable source; run npm run publish-looks');
  });
}

test('every look in looks-src/ has been published', { skip: !fs.existsSync(path.join(ROOT, 'looks-src')) && 'no looks-src/ on this machine' }, () => {
  const sources = fs.readdirSync(path.join(ROOT, 'looks-src'), { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name)
    .filter((name) => fs.existsSync(path.join(ROOT, 'looks-src', name, 'look.json')));
  for (const name of sources) assert.ok(looks.includes(name), `looks-src/${name} has no published copy; run npm run publish-looks`);
});

test('shared/lib holds the pinned versions', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const pinned = JSON.parse(fs.readFileSync(path.join(LIB, 'versions.json'), 'utf8'));
  assert.equal(pinned.gsap, pkg.devDependencies.gsap);
  assert.equal(pinned.three, pkg.devDependencies.three);
  assert.match(fs.readFileSync(path.join(LIB, 'gsap.min.js'), 'utf8').slice(0, 200), new RegExp(`GSAP ${pinned.gsap.replace(/\./g, '\\.')}`));
  const revision = pinned.three.split('.')[1];
  assert.match(fs.readFileSync(path.join(LIB, 'three', 'three.core.js'), 'utf8').slice(0, 4000), new RegExp(`REVISION = '${revision}'`));
});
