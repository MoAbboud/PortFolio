// The content check (P49): what the research found stale on real sites - "$0" items,
// template placeholders, last season's menu, a copyright year typed by hand - fails here
// before it can reach a guest.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentProblems } from '../tools/content-check.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const venues = fs.readdirSync(path.join(ROOT, 'venues'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

for (const slug of venues) {
  test(`${slug}: no stale or placeholder content`, () => {
    const venue = JSON.parse(fs.readFileSync(path.join(ROOT, 'venues', slug, 'venue.json'), 'utf8'));
    assert.deepEqual(contentProblems(venue), []);
  });
}

const base = () => ({
  name: 'Test Bar',
  locations: [{ time_zone: 'America/Chicago' }],
  menus: [{ name: 'Drinks', sections: [{ name: 'All', items: [{ name: 'Gimlet', prices: [{ amount: 12 }] }] }] }],
});

test('a zero price is refused', () => {
  const v = base();
  v.menus[0].sections[0].items[0].prices = [{ amount: 0 }];
  assert.match(contentProblems(v).join(), /Gimlet.*\$0/);
});

test('a zero happy hour price is refused', () => {
  const v = base();
  v.menus[0].sections[0].items[0].happy_hour_price = 0;
  assert.match(contentProblems(v).join(), /happy hour/);
});

for (const placeholder of ['Lorem ipsum dolor', 'Write your caption here', 'Menu Item', '[About the bar: two sentences]', 'TBD', 'Your text here']) {
  test(`placeholder text is refused: "${placeholder}"`, () => {
    const v = base();
    v.about = placeholder;
    assert.ok(contentProblems(v).some((p) => p.includes('placeholder')), contentProblems(v).join());
  });
}

test('ordinary words that contain a placeholder word are fine', () => {
  const v = base();
  v.about = 'Our menu itemises every pour; the bartender is never to be determined.';
  v.tagline = 'Lorem-free since 2019.';
  assert.deepEqual(contentProblems(v).filter((p) => !p.includes('Lorem')), []);
});

test('a seasonal menu past its last day is flagged', () => {
  const v = base();
  v.menus.push({ name: 'Spring | Summer', until: '2026-08-31', sections: v.menus[0].sections });
  assert.match(contentProblems(v, '2026-10-26').join(), /Spring \| Summer.*ended 2026-08-31/);
  assert.deepEqual(contentProblems(v, '2026-08-31'), []);
});

test('a copyright line typed into the content is flagged', () => {
  const v = base();
  v.about = 'All of it. (c) 2023 Test Bar';
  assert.match(contentProblems(v).join(), /copyright/);
  v.about = 'All of it. \u00a9 2035 By BaroQue';
  assert.match(contentProblems(v).join(), /copyright/);
});
