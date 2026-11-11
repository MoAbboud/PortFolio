import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inquiryLink } from '../shared/inquiry.js';

const venue = { name: 'Test Bar', private_events: { email: 'events@test-bar.example' } };

test('the inquiry opens an email to the venue with everything filled in', () => {
  const link = inquiryLink(venue, { date: '2026-12-12', guests: '24', budget: '$1,500', name: 'Sam', contact: '816 555 0100', details: 'A retirement party.' });
  assert.ok(link.startsWith('mailto:events@test-bar.example?subject='));
  const url = new URL(link);
  assert.equal(url.searchParams.get('subject'), 'Private event on 2026-12-12 for 24');
  const body = url.searchParams.get('body');
  for (const part of ['Hello Test Bar,', 'Date: 2026-12-12', 'Guests: 24', 'Budget: $1,500', 'A retirement party.', 'Sam', 'Reach me at: 816 555 0100']) assert.ok(body.includes(part), part);
});

test('a guest who has not decided everything can still ask', () => {
  const url = new URL(inquiryLink(venue, {}));
  assert.equal(url.searchParams.get('subject'), 'Private event');
  assert.match(url.searchParams.get('body'), /Date: not decided yet/);
});
