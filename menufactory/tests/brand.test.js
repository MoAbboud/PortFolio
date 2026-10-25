// The product name is a working name. It may be spelled out in brand.js and nowhere else that
// is published, so a rename is one edit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brand } from '../brand.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLISHED = ['looks', 'shared', 'library', 'admin', 'venues'];
const TEXT = new Set(['.js', '.mjs', '.css', '.html', '.json', '.svg', '.txt', '.md']);

function* files(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile() && TEXT.has(path.extname(entry.name).toLowerCase())) yield path.join(entry.parentPath, entry.name);
  }
}

test('the brand name is set', () => {
  assert.ok(brand.name.length > 0);
});

test('the brand name appears only in brand.js', () => {
  const name = brand.name.toLowerCase();
  const squashed = name.replace(/\s+/g, '');
  const offenders = [];
  for (const top of PUBLISHED) {
    for (const file of files(path.join(ROOT, top))) {
      const text = fs.readFileSync(file, 'utf8').toLowerCase();
      if (text.includes(name) || text.includes(squashed)) offenders.push(path.relative(ROOT, file));
    }
  }
  assert.deepEqual(offenders, [], `the name is spelled out in: ${offenders.join(', ')} - import it from brand.js`);
});
