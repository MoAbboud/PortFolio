// Every venue file is valid, names a look that exists, and previews are never indexable.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schema', 'venue.schema.json'), 'utf8'));
const validate = new Ajv({ allErrors: true }).compile(schema);

const venues = fs.readdirSync(path.join(ROOT, 'venues'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

test('there is at least one sample venue', () => {
  assert.ok(venues.length > 0);
});

for (const slug of venues) {
  const dir = path.join(ROOT, 'venues', slug);
  const venue = JSON.parse(fs.readFileSync(path.join(dir, 'venue.json'), 'utf8'));

  test(`${slug}: venue.json matches the schema`, () => {
    const ok = validate(venue);
    assert.ok(ok, JSON.stringify(validate.errors, null, 2));
  });

  test(`${slug}: the folder name is the slug`, () => {
    assert.equal(venue.slug, slug);
  });

  test(`${slug}: the look it names exists`, () => {
    assert.ok(fs.existsSync(path.join(ROOT, 'looks', venue.style.look, 'look.js')), `looks/${venue.style.look}/look.js`);
  });

  test(`${slug}: every photo it names is there`, () => {
    for (const photo of [...(venue.photos ?? []).map((p) => p.file), venue.style.logo, venue.style.logo_light].filter(Boolean)) {
      assert.ok(fs.existsSync(path.join(dir, photo)), photo);
    }
  });

  test(`${slug}: index.html mounts the venue`, () => {
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    assert.match(html, /import \{ mount \} from '\.\.\/\.\.\/shared\/render\.js'/);
    assert.match(html, /<meta name="viewport"/);
  });

  test(`${slug}: a preview can never be indexed`, () => {
    const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
    const noindex = /<meta name="robots" content="noindex/.test(html);
    if (venue.mode === 'preview') assert.ok(noindex, 'a preview needs <meta name="robots" content="noindex"> in index.html itself');
  });
}

test('the schema refuses a closed day written as an exception with no hours', () => {
  const bad = structuredClone(JSON.parse(fs.readFileSync(path.join(ROOT, 'venues', venues[0], 'venue.json'), 'utf8')));
  bad.locations[0].exceptions = [{ from: '2026-12-25' }];
  assert.equal(validate(bad), false);
});

test('the schema refuses a photo without a description', () => {
  const bad = structuredClone(JSON.parse(fs.readFileSync(path.join(ROOT, 'venues', venues[0], 'venue.json'), 'utf8')));
  bad.photos = [{ file: 'x.jpg', alt: '', use: 'hero' }];
  assert.equal(validate(bad), false);
});

test('the schema refuses an order, delivery or reservation link', () => {
  const bad = structuredClone(JSON.parse(fs.readFileSync(path.join(ROOT, 'venues', venues[0], 'venue.json'), 'utf8')));
  bad.social = [{ kind: 'order', url: 'https://example.com' }];
  assert.equal(validate(bad), false);
});
