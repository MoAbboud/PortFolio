// The hours logic: the one piece where a bug is visible to every guest.
// Instants are UTC; the venue is in America/Chicago (UTC-5 in daylight time, UTC-6 in
// standard time).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  openStatus, happyHourStatus, describeOpen, describeHappyHour, isShowing, upcomingEvents, formatTime, localNow, weeklyRows,
} from '../shared/hours.js';

const bar = {
  time_zone: 'America/Chicago',
  hours: {
    mon: [],
    tue: [{ opens: '17:00', closes: '00:00' }],
    wed: [{ opens: '11:00', closes: '14:00' }, { opens: '17:00', closes: '22:00' }],
    thu: [{ opens: '17:00', closes: '01:00' }],
    fri: [{ opens: '16:00', closes: '02:00' }],
    sat: [{ opens: '16:00', closes: '02:00' }],
    sun: [{ opens: '15:00', closes: '22:00' }],
  },
  exceptions: [
    { from: '2026-11-26', closed: true, note: 'Thanksgiving' },
    { from: '2026-12-24', hours: [{ opens: '15:00', closes: '20:00' }], note: 'Christmas Eve' },
    { from: '2027-01-04', to: '2027-01-10', closed: true, note: 'Renovation' },
  ],
  happy_hour: {
    fri: [{ starts: '16:00', ends: '18:00' }],
    sat: [{ starts: '23:00', ends: '01:00' }],
  },
};

const at = (iso) => new Date(iso);

test('the local clock is the venue time zone, not the machine', () => {
  // 2026-10-30 is a Friday. 03:30 UTC is 22:30 the evening before in Chicago (CDT).
  assert.deepEqual(localNow(at('2026-10-31T03:30:00Z'), 'America/Chicago'), { date: '2026-10-30', minutes: 22 * 60 + 30 });
});

const cases = [
  // [what, instant (UTC), open?, line]
  ['Friday evening, open', '2026-10-30T23:00:00Z', true, 'Open now - closes at 2am'],
  ['past midnight still belongs to Friday', '2026-10-31T06:15:00Z', true, 'Open now - closes at 2am'],
  ['the last 30 minutes are closing soon', '2026-10-31T06:40:00Z', true, 'Closing soon - open until 2am'],
  ['the minute it closes, it is closed', '2026-10-31T07:00:00Z', false, 'Closed - opens today at 4pm'],
  ['Monday is closed all day, next is Tuesday', '2026-11-02T18:00:00Z', false, 'Closed - opens tomorrow at 5pm'],
  ['a range ending at midnight closes at 12am', '2026-11-04T05:30:00Z', true, 'Closing soon - open until 12am'],
  ['split day: lunch', '2026-11-04T18:00:00Z', true, 'Open now - closes at 2pm'],
  ['split day: between lunch and dinner', '2026-11-04T21:00:00Z', false, 'Closed - opens today at 5pm'],
  ['split day: dinner', '2026-11-05T00:00:00Z', true, 'Open now - closes at 10pm'],
  ['a closed exception beats the weekly hours', '2026-11-27T00:00:00Z', false, 'Closed (Thanksgiving) - opens tomorrow at 4pm'],
  // 01:00 UTC on Dec 25 is 7pm on Christmas Eve in Chicago.
  ['an exception with its own hours', '2026-12-25T01:00:00Z', true, 'Open now - closes at 8pm'],
  ['closing soon counts from the exception hours', '2026-12-25T01:40:00Z', true, 'Closing soon - open until 8pm'],
  ['after short exception hours, the day is still named', '2026-12-25T03:00:00Z', false, 'Closed (Christmas Eve) - opens tomorrow at 4pm'],
  ['a next opening within the week is named by its day', '2026-11-02T04:30:00Z', false, 'Closed - opens Tuesday at 5pm'],
  // The renovation ends on Sunday the 10th and Mondays are closed, so Tuesday the 12th.
  ['a next opening a week or more away is given as a date', '2027-01-06T00:00:00Z', false, 'Closed (Renovation) - opens Jan 12 at 5pm'],
  // Daylight saving ends 2026-11-01 at 2am CDT -> 1am CST. Saturday night runs to 2am CST.
  ['clocks go back: the repeated 1:30am is still open', '2026-11-01T07:30:00Z', true, 'Closing soon - open until 2am'],
  ['clocks go back: 2:15am standard time is closed', '2026-11-01T08:15:00Z', false, 'Closed - opens today at 3pm'],
  // Daylight saving starts 2027-03-14 at 2am CST -> 3am CDT. Saturday night closes at 2am.
  ['clocks go forward: 3:30am is closed', '2027-03-14T08:30:00Z', false, 'Closed - opens today at 3pm'],
];

for (const [what, instant, open, line] of cases) {
  test(`open status: ${what}`, () => {
    const status = openStatus(bar, at(instant));
    assert.equal(status.open, open);
    assert.equal(describeOpen(status), line);
  });
}

test('a venue with no opening hours at all says closed and no next time', () => {
  const status = openStatus({ time_zone: 'America/Chicago', hours: {} }, at('2026-10-30T23:00:00Z'));
  assert.deepEqual(status, { open: false, next: null, exception: null });
  assert.equal(describeOpen(status), 'Closed');
});

test('happy hour is live only inside its window', () => {
  assert.equal(describeHappyHour(happyHourStatus(bar, at('2026-10-30T22:00:00Z'))), 'Happy hour until 6pm');
  assert.equal(happyHourStatus(bar, at('2026-10-30T23:30:00Z')).on, false);
});

test('happy hour later today is announced before it starts', () => {
  assert.equal(describeHappyHour(happyHourStatus(bar, at('2026-10-30T20:00:00Z'))), 'Happy hour today 4pm to 6pm');
});

test('happy hour can run past midnight like the hours do', () => {
  // Saturday 23:00 - Sunday 01:00. 00:30 Sunday CDT is 05:30 UTC.
  assert.deepEqual(happyHourStatus(bar, at('2026-10-25T05:30:00Z')), { on: true, endsAt: 60 });
});

test('happy hour is never live while the venue is closed', () => {
  const closedEarly = { ...bar, hours: { ...bar.hours, fri: [{ opens: '17:00', closes: '23:00' }] } };
  assert.equal(happyHourStatus(closedEarly, at('2026-10-30T21:30:00Z')).on, false);
});

test('a venue without happy hour has nothing to say about it', () => {
  assert.equal(describeHappyHour(happyHourStatus({ time_zone: 'America/Chicago', hours: {} }, at('2026-10-30T22:00:00Z'))), '');
});

test('notices show only between their dates, inclusive', () => {
  const notice = { text: 'x', starts: '2026-11-16', ends: '2026-11-26' };
  assert.equal(isShowing(notice, '2026-11-15'), false);
  assert.equal(isShowing(notice, '2026-11-16'), true);
  assert.equal(isShowing(notice, '2026-11-26'), true);
  assert.equal(isShowing(notice, '2026-11-27'), false);
  assert.equal(isShowing({ text: 'always' }, '2030-01-01'), true);
});

test('past one-off events drop off; weekly and monthly ones roll forward', () => {
  const events = [
    { title: 'Past', date: '2026-10-01' },
    { title: 'Masquerade', date: '2026-10-31' },
    { title: 'Jazz', date: '2026-10-01', repeats: 'weekly' },
    { title: 'Tasting', date: '2026-09-05', repeats: 'monthly' },
    { title: 'Later weekly', date: '2026-12-03', repeats: 'weekly' },
  ];
  // 2026-10-25 is a Sunday; 2026-10-01 was a Thursday.
  const upcoming = upcomingEvents(events, '2026-10-25');
  assert.deepEqual(upcoming.map((e) => [e.title, e.next]), [
    ['Jazz', '2026-10-29'],
    ['Masquerade', '2026-10-31'],
    ['Tasting', '2026-11-05'],
    ['Later weekly', '2026-12-03'],
  ]);
});

test('a weekly event on today is listed for today', () => {
  assert.equal(upcomingEvents([{ title: 'Jazz', date: '2026-10-01', repeats: 'weekly' }], '2026-10-29')[0].next, '2026-10-29');
});

test('times read the way a menu card writes them', () => {
  assert.equal(formatTime(0), '12am');
  assert.equal(formatTime(12 * 60), '12pm');
  assert.equal(formatTime(16 * 60), '4pm');
  assert.equal(formatTime(23 * 60 + 30), '11:30pm');
});

test('the weekly table starts on Monday and says closed for empty days', () => {
  const rows = weeklyRows(bar);
  assert.equal(rows[0].day, 'Monday');
  assert.equal(rows[0].text, 'Closed');
  assert.equal(rows[2].text, '11am - 2pm, 5pm - 10pm');
  assert.equal(rows[6].day, 'Sunday');
});
