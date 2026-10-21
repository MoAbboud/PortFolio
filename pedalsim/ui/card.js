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

// The time it took the run to first reach a speed, along a curve of [seconds, mph] whose speed
// never falls (it is the highest speed so far).
function timeAt(curve, mph) {
  if (mph <= curve[0][1]) return curve[0][0];
  for (let i = 1; i < curve.length; i++) {
    const [t1, v1] = curve[i];
    if (v1 >= mph) {
      const [t0, v0] = curve[i - 1];
      return v1 === v0 ? t1 : t0 + ((mph - v0) / (v1 - v0)) * (t1 - t0);
    }
  }
  return curve.at(-1)[0];
}

// The curve between two speeds, with its ends at exactly those speeds.
function between(curve, lo, hi) {
  const inside = curve.filter(([, v]) => v > lo && v < hi);
  return [[timeAt(curve, lo), lo], ...inside, [timeAt(curve, hi), hi]];
}

const cssColour = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

// Speed against time, your run over the perfect run. Each phase's band of speed is shaded
// between the two curves: its width at any speed is how far behind (or ahead) you were getting
// there, and it is labelled with what the phase lost - the numbers in the table below.
export function drawRace(canvas, card, ms) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const { yours, perfect } = card.curves;
  const pad = { l: 34, r: 58, t: 22, b: 22 };
  const tMax = Math.ceil(Math.max(yours.at(-1)[0], perfect.at(-1)[0]));
  const X = (t) => pad.l + (t / tMax) * (w - pad.l - pad.r);
  const Y = (v) => h - pad.b - (v / 60) * (h - pad.t - pad.b);
  const accent = cssColour('--accent', 'rgb(255 200 0)');
  const type = cssColour('--type', 'rgb(224 224 224)');

  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = type;
  ctx.strokeStyle = 'rgb(255 255 255 / 0.12)';
  ctx.lineWidth = 1;
  for (let t = 0; t <= tMax; t++) {
    ctx.beginPath(); ctx.moveTo(X(t), Y(0)); ctx.lineTo(X(t), Y(60)); ctx.stroke();
    ctx.globalAlpha = 0.6; ctx.textAlign = 'center'; ctx.fillText(`${t} s`, X(t), h - 6); ctx.globalAlpha = 1;
  }
  for (const v of [0, 20, 40, 60]) {
    ctx.beginPath(); ctx.moveTo(X(0), Y(v)); ctx.lineTo(X(tMax), Y(v)); ctx.stroke();
    ctx.globalAlpha = 0.6; ctx.textAlign = 'right'; ctx.fillText(String(v), pad.l - 6, Y(v) + 4); ctx.globalAlpha = 1;
  }

  // The phases' bands.
  card.phases.forEach((p, i) => {
    const lo = p.mphFrom;
    const hi = Math.min(60, p.mphTo);
    if (hi - lo < 0.05) return;
    const a = between(perfect, lo, hi);
    const b = between(yours, lo, hi).reverse();
    ctx.beginPath();
    [...a, ...b].forEach(([t, v], k) => (k ? ctx.lineTo(X(t), Y(v)) : ctx.moveTo(X(t), Y(v))));
    ctx.closePath();
    ctx.fillStyle = p.lost >= 0 ? `rgb(255 150 50 / ${i % 2 ? 0.16 : 0.32})` : `rgb(120 220 140 / ${i % 2 ? 0.16 : 0.32})`;
    ctx.fill();
    const mid = (lo + hi) / 2;
    if (Y(lo) - Y(hi) >= 11 && Math.abs(ms[i]) >= 5) {
      ctx.fillStyle = type;
      ctx.globalAlpha = 0.85;
      ctx.textAlign = 'left';
      const x = X(Math.max(timeAt(yours, mid), timeAt(perfect, mid))) + 6;
      ctx.fillText(`${p.phase} ${ms[i] > 0 ? '+' : ''}${(ms[i] / 1000).toFixed(3)}`, Math.min(x, w - pad.r + 2), Y(mid) + 4);
      ctx.globalAlpha = 1;
    }
  });

  const line = (curve, colour, width) => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.beginPath();
    curve.forEach(([t, v], k) => (k ? ctx.lineTo(X(t), Y(v)) : ctx.moveTo(X(t), Y(v))));
    ctx.stroke();
  };
  ctx.globalAlpha = 0.7;
  line(perfect, type, 1.5);
  ctx.globalAlpha = 1;
  line(yours, accent, 2);

  ctx.textAlign = 'left';
  ctx.fillStyle = accent;
  ctx.fillText('you', pad.l + 6, pad.t - 4);
  ctx.fillStyle = type;
  ctx.globalAlpha = 0.7;
  ctx.fillText('perfect run      mph against seconds from GO', pad.l + 40, pad.t - 4);
  ctx.globalAlpha = 1;
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
  const ms = card.phases.length ? lostInMs(card) : [];
  if (card.phases.length) {
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
  const chart = card.curves ? el('canvas', { class: 'card-chart', 'aria-label': 'Speed against time: your run and the perfect run, the time lost in each phase shaded' }) : null;
  const parts = [el('div', { class: 'card-title' }, `${LABELS[card.engine] ?? card.engine} ${card.gearbox}, 0 to 60`), head, chart, table, buttons, link, note];
  host.replaceChildren(...parts.filter(Boolean));
  host.hidden = false;
  if (chart) drawRace(chart, card, ms);
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
