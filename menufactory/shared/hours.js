// Open now, happy hour, and what is current - worked out from a venue's own hours in the
// venue's own time zone, never the guest's. Pure functions: the same file runs in the browser
// and in the tests.
//
// Times are wall-clock "HH:MM". A range that closes at or before it opens runs past midnight
// and belongs to the day it opened: { opens: "16:00", closes: "02:00" } on Friday is open
// until 2am Saturday. Dates are the venue's local "YYYY-MM-DD".
//
// Known limit: on the night the clocks go back, minutes are counted on the wall clock, so
// "closes soon" can appear an hour early during the repeated hour. Open or closed is right.

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const CLOSING_SOON_MINUTES = 30;

export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** The venue's local date and minutes past midnight at a given instant. */
export function localNow(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type) => parts.find((p) => p.type === type).value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

function parseDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(date, n) {
  const d = parseDate(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekday(date) {
  return DAYS[parseDate(date).getUTCDay()];
}

/** Ranges as minute intervals; one that ends at or before it starts runs past midnight. */
function toIntervals(ranges, startKey, endKey) {
  return (ranges ?? []).map((r) => {
    const start = toMinutes(r[startKey]);
    let end = toMinutes(r[endKey]);
    if (end <= start) end += 1440;
    return { start, end };
  });
}

function exceptionFor(location, date) {
  return (location.exceptions ?? []).find((e) => e.from <= date && date <= (e.to ?? e.from));
}

/** Opening intervals that start on a given local date. Exceptions beat the weekly hours. */
export function openingsOn(location, date) {
  const exception = exceptionFor(location, date);
  const ranges = exception ? (exception.closed ? [] : exception.hours) : location.hours?.[weekday(date)];
  return toIntervals(ranges, 'opens', 'closes').sort((a, b) => a.start - b.start);
}

/** Intervals covering a local date: its own, plus the previous day's spill past midnight. */
function covering(intervalsOn, date) {
  const today = intervalsOn(date);
  const spill = intervalsOn(addDays(date, -1))
    .filter((i) => i.end > 1440)
    .map((i) => ({ start: i.start - 1440, end: i.end - 1440 }));
  return [...spill, ...today];
}

/**
 * Whether the venue is open at an instant.
 *   { open: true, closesAt, minutesLeft, closingSoon }
 *   { open: false, next: { date, daysAhead, at } | null, exception }
 * closesAt and at are minutes past midnight on the wall clock (0 to 1439).
 */
export function openStatus(location, instant) {
  const { date, minutes } = localNow(instant, location.time_zone);
  const current = covering((d) => openingsOn(location, d), date).find((i) => i.start <= minutes && minutes < i.end);
  if (current) {
    const minutesLeft = current.end - minutes;
    return { open: true, closesAt: current.end % 1440, minutesLeft, closingSoon: minutesLeft <= CLOSING_SOON_MINUTES };
  }
  for (let daysAhead = 0; daysAhead < 15; daysAhead += 1) {
    const day = addDays(date, daysAhead);
    const next = openingsOn(location, day).find((i) => daysAhead > 0 || i.start > minutes);
    if (next) return { open: false, next: { date: day, daysAhead, at: next.start % 1440 }, exception: exceptionFor(location, date) ?? null };
  }
  return { open: false, next: null, exception: exceptionFor(location, date) ?? null };
}

/**
 * Happy hour at an instant. Only ever "on" while the venue is also open.
 *   { on: true, endsAt } | { on: false, laterToday: { starts, ends } | null }
 */
export function happyHourStatus(location, instant) {
  if (!location.happy_hour) return { on: false, laterToday: null };
  const { date, minutes } = localNow(instant, location.time_zone);
  const windowsOn = (d) => (exceptionFor(location, d) ? [] : toIntervals(location.happy_hour[weekday(d)], 'starts', 'ends'));
  const isOpen = openStatus(location, instant).open;
  const current = covering(windowsOn, date).find((i) => i.start <= minutes && minutes < i.end);
  if (current && isOpen) return { on: true, endsAt: current.end % 1440 };
  const later = windowsOn(date).find((i) => i.start > minutes);
  return { on: false, laterToday: later ? { starts: later.start % 1440, ends: later.end % 1440 } : null };
}

/** True when a notice is current on a local date. */
export function isShowing(notice, date) {
  return (!notice.starts || notice.starts <= date) && (!notice.ends || date <= notice.ends);
}

/**
 * Events from a local date onwards, each with the date it next happens.
 * One-off events past their date are dropped. Weekly ones repeat on their weekday, monthly
 * ones on their day of the month.
 */
export function upcomingEvents(events, date, limit = 8) {
  const out = [];
  for (const event of events ?? []) {
    let next = null;
    if (!event.repeats) {
      if (event.date >= date) next = event.date;
    } else if (event.repeats === 'weekly') {
      const target = DAYS.indexOf(weekday(event.date));
      const today = DAYS.indexOf(weekday(date));
      next = event.date > date ? event.date : addDays(date, (target - today + 7) % 7);
    } else if (event.repeats === 'monthly') {
      const dayOfMonth = Number(event.date.slice(8, 10));
      let candidate = date.slice(0, 8) + String(dayOfMonth).padStart(2, '0');
      if (candidate < date) {
        const d = parseDate(date.slice(0, 8) + '01');
        d.setUTCMonth(d.getUTCMonth() + 1);
        candidate = d.toISOString().slice(0, 8) + String(dayOfMonth).padStart(2, '0');
      }
      next = event.date > candidate ? event.date : candidate;
    }
    if (next) out.push({ ...event, next });
  }
  return out.sort((a, b) => (a.next + (a.starts ?? '')).localeCompare(b.next + (b.starts ?? ''))).slice(0, limit);
}

/** "4pm", "11:30pm", "12am". */
export function formatTime(minutes) {
  const h24 = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  const suffix = h24 < 12 ? 'am' : 'pm';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, '0')}${suffix}`;
}

function dayPhrase(next) {
  if (next.daysAhead === 0) return 'today';
  if (next.daysAhead === 1) return 'tomorrow';
  if (next.daysAhead < 7) return DAY_NAMES[parseDate(next.date).getUTCDay()];
  return parseDate(next.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** The one line a guest reads first. */
export function describeOpen(status) {
  if (status.open) {
    return status.closingSoon ? `Closing soon - open until ${formatTime(status.closesAt)}` : `Open now - closes at ${formatTime(status.closesAt)}`;
  }
  const note = status.exception?.note ? ` (${status.exception.note})` : '';
  if (!status.next) return `Closed${note}`;
  return `Closed${note} - opens ${dayPhrase(status.next)} at ${formatTime(status.next.at)}`;
}

export function describeHappyHour(status) {
  if (status.on) return `Happy hour until ${formatTime(status.endsAt)}`;
  if (status.laterToday) return `Happy hour today ${formatTime(status.laterToday.starts)} to ${formatTime(status.laterToday.ends)}`;
  return '';
}

/** The weekly hours as display rows, Monday first. */
export function weeklyRows(location) {
  return [1, 2, 3, 4, 5, 6, 0].map((i) => {
    const ranges = location.hours?.[DAYS[i]] ?? [];
    const text = ranges.length ? ranges.map((r) => `${formatTime(toMinutes(r.opens))} - ${formatTime(toMinutes(r.closes))}`).join(', ') : 'Closed';
    return { day: DAY_NAMES[i], text };
  });
}
