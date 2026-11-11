// The pre-rendered content (P41) and structured data (P42): every venue's index.html is in
// step with its venue.json, and the structured data says what search engines need.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prerenderPage, structuredData, MARKS } from '../tools/prerender.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const venues = fs.readdirSync(path.join(ROOT, 'venues'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

for (const slug of venues) {
  const html = fs.readFileSync(path.join(ROOT, 'venues', slug, 'index.html'), 'utf8');
  const venue = JSON.parse(fs.readFileSync(path.join(ROOT, 'venues', slug, 'venue.json'), 'utf8'));

  test(`${slug}: index.html is in step with venue.json - run npm run prerender if not`, () => {
    for (const mark of Object.values(MARKS)) assert.ok(html.includes(mark), mark);
    assert.equal(html, prerenderPage(html, venue));
  });

  test(`${slug}: the page itself carries the menu, hours and address as text`, () => {
    const body = html.slice(html.indexOf(MARKS.bodyStart), html.indexOf(MARKS.bodyEnd));
    assert.ok(body.includes(`<h1>${venue.name}</h1>`));
    assert.ok(body.includes(venue.locations[0].street));
    assert.ok(body.includes('Monday'));
    for (const menu of venue.menus) for (const section of menu.sections) for (const item of section.items) {
      assert.ok(body.includes(item.name.replace(/&/g, '&amp;')), item.name);
    }
  });

  test(`${slug}: structured data names the place, its address, hours and every item with a price`, () => {
    const block = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(block, 'no JSON-LD block');
    const data = JSON.parse(block[1]);
    assert.deepEqual(data, structuredData(venue));
    assert.equal(data['@context'], 'https://schema.org');
    assert.ok(['BarOrPub', 'Restaurant'].includes(data['@type']));
    assert.equal(data.address['@type'], 'PostalAddress');
    assert.ok(data.openingHoursSpecification.length > 0);
    const items = data.hasMenu.hasMenuSection.flatMap((m) => m.hasMenuSection.flatMap((s) => s.hasMenuItem));
    const expected = venue.menus.flatMap((m) => m.sections.flatMap((s) => s.items));
    assert.equal(items.length, expected.length);
    for (const [i, item] of items.entries()) {
      if (expected[i].prices?.length) assert.ok(item.offers.every((o) => o.priceCurrency === venue.currency && o.price > 0), item.name);
    }
  });
}

test('holiday hours become special opening hours; a closed day opens and closes at midnight', () => {
  const venue = JSON.parse(fs.readFileSync(path.join(ROOT, 'venues', venues[0], 'venue.json'), 'utf8'));
  venue.locations[0].exceptions = [{ from: '2026-11-26', closed: true }, { from: '2026-12-24', hours: [{ opens: '15:00', closes: '20:00' }] }];
  const data = structuredData(venue);
  assert.deepEqual(data.specialOpeningHoursSpecification, [
    { '@type': 'OpeningHoursSpecification', validFrom: '2026-11-26', validThrough: '2026-11-26', opens: '00:00', closes: '00:00' },
    { '@type': 'OpeningHoursSpecification', validFrom: '2026-12-24', validThrough: '2026-12-24', opens: '15:00', closes: '20:00' },
  ]);
});

test('a preview carries noindex in the page itself', () => {
  const venue = JSON.parse(fs.readFileSync(path.join(ROOT, 'venues', venues[0], 'venue.json'), 'utf8'));
  venue.mode = 'preview';
  const html = fs.readFileSync(path.join(ROOT, 'venues', venues[0], 'index.html'), 'utf8');
  assert.match(prerenderPage(html, venue), /<meta name="robots" content="noindex/);
});
