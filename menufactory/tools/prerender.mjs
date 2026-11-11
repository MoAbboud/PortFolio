// Writes each venue's content into its own index.html (P41, P42), so search engines and AI
// assistants - most of which read the HTML without running its JavaScript - can read the
// menu, the hours and the address, and so the page still says something with JavaScript off.
//
//   npm run prerender            every venue
//
// Two parts, each between markers in index.html:
//   head: the title, the description, noindex on previews, and structured data (schema.org
//         JSON-LD): the venue, its address and phone, weekly and holiday hours, and the menu.
//   body: a plain copy of the name, call button, address, hours, menu, weekly events and about.
// The look draws over it; render.js removes the plain copy once the look has drawn.
//
// The output depends only on venue.json - never on today's date - so tests/prerender.test.js
// can fail on any page that is out of step with its file. One-off events and notices are
// left out for the same reason: the live page shows those, by date.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { weeklyRows, formatTime, toMinutes } from '../shared/hours.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const DIETS = { vegan: 'https://schema.org/VeganDiet', vegetarian: 'https://schema.org/VegetarianDiet', 'gluten-free': 'https://schema.org/GlutenFreeDiet' };
const TAGS = { vegetarian: 'vegetarian', vegan: 'vegan', 'gluten-free': 'gluten-free', 'dairy-free': 'dairy-free', 'nut-free': 'nut-free', spicy: 'spicy', 'zero-proof': 'zero-proof', new: 'new', 'house-favourite': 'house favourite', seasonal: 'seasonal' };

export const MARKS = {
  headStart: '<!-- prerender:head:start -->',
  headEnd: '<!-- prerender:head:end -->',
  bodyStart: '<!-- prerender:start -->',
  bodyEnd: '<!-- prerender:end -->',
};

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const tel = (phone) => `tel:${phone.replace(/[^\d+]/g, '')}`;

function money(venue, amount) {
  return new Intl.NumberFormat(venue.language ?? 'en-US', { style: 'currency', currency: venue.currency ?? 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount);
}

function priceText(venue, item) {
  if (!item.prices || item.prices.length === 0) return 'market price';
  return item.prices.map((p) => (p.label ? `${p.label} ${money(venue, p.amount)}` : money(venue, p.amount))).join(' / ');
}

function description(venue) {
  return venue.tagline || (venue.about ?? '').split(/(?<=\.)\s/)[0] || venue.name;
}

/** schema.org structured data for a venue (P42). */
export function structuredData(venue) {
  const place = venue.locations[0];
  const opening = [];
  for (const [day, ranges] of Object.entries(place.hours ?? {})) {
    for (const r of ranges) {
      const same = opening.find((o) => o.opens === r.opens && o.closes === r.closes);
      if (same) same.dayOfWeek.push(DAY_NAMES[day]);
      else opening.push({ '@type': 'OpeningHoursSpecification', dayOfWeek: [DAY_NAMES[day]], opens: r.opens, closes: r.closes });
    }
  }
  const special = (place.exceptions ?? []).flatMap((e) => (e.closed
    ? [{ '@type': 'OpeningHoursSpecification', validFrom: e.from, validThrough: e.to ?? e.from, opens: '00:00', closes: '00:00' }]
    : e.hours.map((r) => ({ '@type': 'OpeningHoursSpecification', validFrom: e.from, validThrough: e.to ?? e.from, opens: r.opens, closes: r.closes }))));
  const item = (i) => {
    const out = { '@type': 'MenuItem', name: i.name };
    const text = [i.description, i.ingredients?.length ? `Made with ${i.ingredients.join(', ')}.` : null].filter(Boolean).join(' ');
    if (text) out.description = text;
    if (i.prices?.length) out.offers = i.prices.map((p) => ({ '@type': 'Offer', price: p.amount, priceCurrency: venue.currency, ...(p.label ? { name: p.label } : {}) }));
    const diets = (i.tags ?? []).map((t) => DIETS[t]).filter(Boolean);
    if (diets.length) out.suitableForDiet = diets;
    return out;
  };
  const data = {
    '@context': 'https://schema.org',
    '@type': venue.kind === 'restaurant' ? 'Restaurant' : 'BarOrPub',
    name: venue.name,
    description: description(venue),
    address: {
      '@type': 'PostalAddress',
      streetAddress: place.street,
      addressLocality: place.city,
      ...(place.region ? { addressRegion: place.region } : {}),
      ...(place.postal_code ? { postalCode: place.postal_code } : {}),
      addressCountry: place.country,
    },
    ...(place.phone ? { telephone: place.phone.replace(/[^\d+]/g, '') } : {}),
    ...(place.lat != null && place.lng != null ? { geo: { '@type': 'GeoCoordinates', latitude: place.lat, longitude: place.lng } } : {}),
    ...(venue.price_range ? { priceRange: '$'.repeat(venue.price_range) } : {}),
    ...(venue.cuisine ? { servesCuisine: venue.cuisine } : {}),
    openingHoursSpecification: opening,
    ...(special.length ? { specialOpeningHoursSpecification: special } : {}),
    acceptsReservations: venue.reserve_url ?? false,
    hasMenu: {
      '@type': 'Menu',
      name: `${venue.name} menu`,
      hasMenuSection: venue.menus.map((m) => ({
        '@type': 'MenuSection',
        name: m.name,
        ...(m.served ? { description: m.served } : {}),
        hasMenuSection: m.sections.map((s) => ({ '@type': 'MenuSection', name: s.name, hasMenuItem: s.items.map(item) })),
      })),
    },
  };
  return data;
}

/** The head part: title, description, noindex for previews, structured data. */
export function headHtml(venue) {
  const json = JSON.stringify(structuredData(venue), null, 2).replace(/</g, '\\u003c');
  return [
    `<title>${esc(venue.name)}</title>`,
    `<meta name="description" content="${esc(description(venue))}">`,
    venue.mode === 'preview' ? '<meta name="robots" content="noindex, nofollow">' : null,
    `<script type="application/ld+json">\n${json}\n</script>`,
  ].filter(Boolean).join('\n');
}

/** The body part: everything a guest needs, as plain HTML. */
export function bodyHtml(venue) {
  const place = venue.locations[0];
  const lines = [];
  lines.push('<div class="venue-text" data-prerendered>');
  lines.push(`<header><h1>${esc(venue.name)}</h1>${venue.tagline ? `<p>${esc(venue.tagline)}</p>` : ''}</header>`);
  const actions = [
    place.phone ? `<a href="${tel(place.phone)}">${venue.phone_orders ? 'Call to order' : 'Call'}: ${esc(place.phone)}</a>` : null,
    venue.order_url ? `<a href="${esc(venue.order_url)}">Order online</a>` : null,
    venue.reserve_url ? `<a href="${esc(venue.reserve_url)}">Request a table</a>` : null,
  ].filter(Boolean);
  if (actions.length) lines.push(`<p>${actions.join(' | ')}</p>`);
  const address = [place.street, [place.city, [place.region, place.postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean);
  lines.push(`<address>${address.map(esc).join('<br>')}</address>`);

  lines.push('<section><h2>Hours</h2><table><tbody>');
  for (const row of weeklyRows(place)) lines.push(`<tr><th scope="row">${row.day}</th><td>${esc(row.text)}</td></tr>`);
  lines.push('</tbody></table>');
  const hh = Object.entries(place.happy_hour ?? {}).filter(([, w]) => w.length);
  if (hh.length) {
    const text = hh.map(([day, windows]) => `${DAY_NAMES[day]} ${windows.map((w) => `${formatTime(toMinutes(w.starts))} - ${formatTime(toMinutes(w.ends))}`).join(', ')}`).join('; ');
    lines.push(`<p>Happy hour: ${esc(text)}</p>`);
  }
  lines.push('</section>');

  lines.push('<section><h2>Menu</h2>');
  for (const menu of venue.menus) {
    lines.push(`<h3>${esc(menu.name)}${menu.served ? ` (${esc(menu.served)})` : ''}</h3>`);
    for (const section of menu.sections) {
      lines.push(`<h4>${esc(section.name)}</h4>${section.note ? `<p>${esc(section.note)}</p>` : ''}<ul>`);
      for (const item of section.items) {
        const extra = [
          item.ingredients?.length ? item.ingredients.join(', ') : null,
          item.description || null,
          item.happy_hour_price != null ? `happy hour ${money(venue, item.happy_hour_price)}` : null,
          ...(item.tags ?? []).map((t) => TAGS[t]),
          item.sold_out ? 'sold out' : null,
        ].filter(Boolean);
        lines.push(`<li><strong>${esc(item.name)}</strong> - ${esc(priceText(venue, item))}${extra.length ? `. ${esc(extra.join('; '))}` : ''}</li>`);
      }
      lines.push('</ul>');
    }
  }
  lines.push('</section>');

  const weekly = (venue.events ?? []).filter((e) => e.repeats);
  if (weekly.length) {
    lines.push('<section><h2>Regular nights</h2><ul>');
    for (const e of weekly) {
      const [y, m, d] = e.date.split('-').map(Number);
      const day = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
      const when = e.repeats === 'weekly' ? `every ${day}` : `monthly, on the ${d}${[, 'st', 'nd', 'rd'][d % 10 < 4 && Math.floor(d / 10) !== 1 ? d % 10 : 0] || 'th'}`;
      lines.push(`<li><strong>${esc(e.title)}</strong> - ${esc(when)}${e.starts ? `, ${formatTime(toMinutes(e.starts))}` : ''}${e.description ? `. ${esc(e.description)}` : ''}</li>`);
    }
    lines.push('</ul></section>');
  }
  if (venue.private_events) lines.push(`<section><h2>Private events</h2><p>${esc(venue.private_events.note ?? '')} <a href="mailto:${esc(venue.private_events.email)}">${esc(venue.private_events.email)}</a></p></section>`);
  if (venue.about) lines.push(`<section><h2>About</h2><p>${esc(venue.about)}</p></section>`);
  lines.push('</div>');
  return lines.join('\n');
}

function between(html, start, end, content) {
  const a = html.indexOf(start);
  const b = html.indexOf(end);
  if (a === -1 || b === -1 || b < a) throw new Error(`markers ${start} / ${end} not found`);
  return `${html.slice(0, a + start.length)}\n${content}\n${html.slice(b)}`;
}

/** index.html with both parts brought up to date. */
export function prerenderPage(html, venue) {
  return between(between(html, MARKS.headStart, MARKS.headEnd, headHtml(venue)), MARKS.bodyStart, MARKS.bodyEnd, bodyHtml(venue));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = path.join(ROOT, 'venues');
  for (const slug of fs.readdirSync(dir)) {
    const file = path.join(dir, slug, 'index.html');
    const venue = JSON.parse(fs.readFileSync(path.join(dir, slug, 'venue.json'), 'utf8'));
    const before = fs.readFileSync(file, 'utf8');
    const after = prerenderPage(before, venue);
    fs.writeFileSync(file, after);
    console.log(`  ${slug}: ${before === after ? 'already up to date' : 'written'}`);
  }
}
