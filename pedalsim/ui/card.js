// The score card and the board: plain DOM, drawn from what sim/score.js works out.

import { lostInMs } from '../sim/score.js';

const LABELS = { v4: 'V4', v6: 'V6', v8: 'V8', v10: 'V10', v12: 'V12' };

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== undefined) node.append(c);
  return node;
}

const secs = (t) => (Number.isFinite(t) ? `${t.toFixed(3)} s` : '-');
const signed = (ms) => `${ms > 0 ? '+' : ms < 0 ? '-' : ''}${(Math.abs(ms) / 1000).toFixed(3)}`;

// What a phase was about, in a few words.
export function phaseNote(p) {
  const bits = [];
  if (p.kind === 'shift') {
    bits.push(`at ${Math.round(p.rpm)} rpm`);
    if (p.perfectRpm) bits.push(`perfect ${Math.round(p.perfectRpm)}`);
    bits.push(`clutch in ${p.seconds.toFixed(2)} s`);
  }
  if (p.spin >= 0.01) bits.push(`wheelspin ${p.spin.toFixed(2)} s`);
  if (p.limiter >= 0.01) bits.push(`limiter ${p.limiter.toFixed(2)} s`);
  if (p.heat >= 500) bits.push(`clutch ${(p.heat / 1000).toFixed(1)} kJ`);
  return bits.join(', ');
}

// The marks beside the time: clean or why not, traction control, the automatic.
export function marks(card) {
  const out = [];
  if (card.why) out.push(card.why);
  else if (!card.gentle) out.push(`hot clutch, ${(card.heat / 1000).toFixed(0)} kJ`);
  else if (card.clean) out.push('clean');
  if (card.tractionControl) out.push('traction control on');
  if (card.gearbox === 'auto') out.push('automatic: timed, not scored');
  return out;
}

// entry: { card, log, shared }. on: { watch, share, again }.
export function renderCard(host, entry, on) {
  const { card } = entry;
  const head = el('div', { class: 'card-head' },
    el('b', { class: 'card-time' }, secs(card.time)),
    el('span', {}, `perfect ${secs(card.perfectTime)}`),
    card.score !== null ? el('b', { class: 'card-score' }, String(card.score)) : null,
    el('span', { class: 'card-marks' }, marks(card).join(' - ')));

  let table = null;
  if (card.phases.length) {
    const ms = lostInMs(card);
    const total = ms.reduce((a, b) => a + b, 0);
    table = el('table', {},
      el('tr', {}, el('th', {}, ''), el('th', {}, 'took'), el('th', {}, 'lost'), el('th', {}, '')),
      ...card.phases.map((p, i) => el('tr', {},
        el('td', {}, p.phase),
        el('td', {}, p.seconds.toFixed(3)),
        el('td', { class: ms[i] > 0 ? 'lost' : '' }, signed(ms[i])),
        el('td', { class: 'note' }, phaseNote(p)))),
      el('tr', { class: 'total' }, el('td', {}, 'gap'), el('td', {}, ''), el('td', {}, signed(total)), el('td', {}, '')));
  }

  const link = el('input', { class: 'card-link', readonly: '', 'aria-label': 'Link to this run' });
  link.hidden = true;
  const buttons = el('div', { class: 'card-buttons' },
    el('button', { onclick: () => on.watch(entry) }, 'WATCH'),
    el('button', { onclick: async () => {
      link.value = await on.share(entry);
      link.hidden = false;
      link.select();
    } }, 'SHARE'),
    el('button', { onclick: () => on.again(entry) }, entry.shared ? 'BEAT IT' : 'AGAIN'));

  const note = entry.shared
    ? el('p', { class: 'card-proof' }, 'A shared run, re-driven here from its inputs: the time and the score are this page\'s own. It proves the run is possible in this simulation, not that a person drove it.')
    : null;
  const parts = [el('div', { class: 'card-title' }, `${LABELS[card.engine] ?? card.engine} ${card.gearbox}, 0 to 60`), head, table, buttons, link, note];
  host.replaceChildren(...parts.filter(Boolean));
  host.hidden = false;
}

// Each engine's best scored run among the entries, by engine id.
export function bests(entries) {
  const best = new Map();
  for (const e of entries) {
    const c = e.card;
    if (!c.scored) continue;
    const held = best.get(c.engine);
    if (!held || c.score > held.card.score) best.set(c.engine, e);
  }
  return best;
}

// The board: this visit's runs, newest first, each engine's best marked. Nothing is kept past a
// refresh.
export function renderBoard(host, entries, on) {
  if (!entries.length) {
    host.hidden = true;
    return;
  }
  const best = bests(entries);
  host.replaceChildren(
    el('div', { class: 'card-title' }, 'this visit - gone on a refresh'),
    el('table', {}, ...entries.map((e) => el('tr', { class: best.get(e.card.engine) === e ? 'best' : '' },
      el('td', {}, `${LABELS[e.card.engine] ?? e.card.engine} ${e.card.gearbox}${e.shared ? ' (link)' : ''}`),
      el('td', {}, secs(e.card.time)),
      el('td', {}, e.card.score !== null ? String(e.card.score) : ''),
      el('td', { class: 'note' }, marks(e.card).join(' - ')),
      el('td', {}, el('button', { onclick: () => on.show(e) }, 'CARD'), ' ', el('button', { onclick: () => on.watch(e) }, 'WATCH'))))));
  host.hidden = false;
}
