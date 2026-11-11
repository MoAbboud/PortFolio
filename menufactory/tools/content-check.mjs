// The content check (P49): finds the kinds of stale or unfinished content the October 2026
// check of Kansas City sites found - "$0" items, template placeholders, a seasonal menu still
// up months after its season, a copyright year typed by hand. Used by the tests, and by the
// owner admin before it saves.

import { localNow } from '../shared/hours.js';

// Whole phrases only, so ordinary words that contain them ("itemises") pass.
const PLACEHOLDERS = [
  /\blorem\b/i,
  /\bipsum\b/i,
  /write your (caption|text|title)/i,
  /your (text|title|caption|description) here/i,
  /^menu item$/i,
  /\bmenu item\s*[-:]?\s*\$?0\b/i,
  /\[[^\]]{3,}\]/, // "[About the bar: ...]"
  /^(tbd|tbc|todo|xxx+|placeholder)$/i,
  /\b(tbd|tbc|todo)\b/,
];
const COPYRIGHT = /(\u00a9|\(c\)|copyright)\s*\d{4}/i;

function* strings(value, where) {
  if (typeof value === 'string') yield [where, value];
  else if (Array.isArray(value)) for (const [i, v] of value.entries()) yield* strings(v, `${where}[${i}]`);
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) yield* strings(v, where ? `${where}.${k}` : k);
}

/** Problems with a venue's content, as plain sentences. Empty when it is fit to publish. */
export function contentProblems(venue, today = localNow(new Date(), venue.locations[0].time_zone).date) {
  const problems = [];
  for (const [where, text] of strings(venue, '')) {
    if (/(^|\.)(url|file|logo|logo_light|photo|time_zone|look|palette|slug)$/.test(where)) continue;
    if (PLACEHOLDERS.some((re) => re.test(text.trim()))) problems.push(`${where}: placeholder text "${text.slice(0, 50)}"`);
    if (COPYRIGHT.test(text)) problems.push(`${where}: a copyright line typed into the content - the page sets the year itself`);
  }
  for (const menu of venue.menus ?? []) {
    if (menu.until && menu.until < today) problems.push(`menu "${menu.name}" ended ${menu.until} - update it or take it down`);
    for (const section of menu.sections ?? []) {
      for (const item of section.items ?? []) {
        for (const p of item.prices ?? []) if (p.amount === 0) problems.push(`"${item.name}" is priced at $0`);
        if (item.happy_hour_price === 0) problems.push(`"${item.name}" has a happy hour price of $0`);
      }
    }
  }
  return problems;
}
