// The score card: a 0 to 60 run measured against the engine's perfect run.
//
// Time lost, phase by phase. A run is cut into phases - the launch, each gear, each shift -
// by what the driver did. Each phase covered a range of speed: from the highest speed the car
// had reached when it began to the highest when it ended (the highest so far, so a dip during
// a shift is not counted twice). The perfect run took some time to cover that same range of
// speed. What the phase lost is the difference:
//
//   lost = your time in the phase - the perfect run's time over the same speeds
//
// The phases' speed ranges join end to end from standing to 60 mph, so the perfect run's
// times join end to end from 0 to its own time, and the losses add up to your time less the
// perfect time - exactly, whatever the phases are. The cut into phases only names where the
// time went.
//
// One number for the board: 1000 * perfect time / your time, so 1000 is the perfect run. Only
// a finished manual run gets one; the automatic is timed, not scored. Clean: no grind, no
// check engine, no blown engine, and the clutch no hotter than GENTLE allows.
//
// Run in the page after a run, on a shared link, and in Node by the tests - so in sim/, by its
// rules.

import { replay } from './replay.js';
import { createWatch, GO_STEP, MPH_60, START_GEAR } from './sixty.js';
import { RPM_PER_RAD_S, STEPS_PER_SECOND } from './clock.js';

// Wheelspin faster than this (m/s) counts as spinning on the card.
const SPIN = 1;
// Gentle on the clutch: no more than twice the heat the perfect run made, and never less than
// GENTLE_FLOOR joules allowed. A brisk launch makes 20 to 60 kJ and a quick keyboard shift 30
// or so, so the floor only catches abuse - a clutch dumped off the limiter, slipped for seconds.
const GENTLE_TIMES = 2;
const GENTLE_FLOOR = 150000;

// The run from GO on, one row a step, and how it went.
export function trace(engine, log) {
  const watch = createWatch();
  const rows = [];
  const r = engine.gearing.wheelRadius;
  let top = 0;
  replay(engine, null, log, (state, inputs) => {
    if (watch.done) return;
    watch.see(state);
    if (state.step < GO_STEP) return;
    if (state.v > top) top = state.v;
    rows.push({
      step: state.step,
      top,
      gear: state.gear,
      clutch: inputs.clutch,
      gripping: state.clutchStuck,
      spin: state.ww * r - state.v,
      cut: state.cut,
      slipJ: state.slipJ,
      rpm: state.we * RPM_PER_RAD_S,
    });
  });
  return { result: watch.result(), rows };
}

const seconds = (row) => (row.step - GO_STEP) / STEPS_PER_SECOND;

// Where the driver's phases begin and end, as row numbers. The launch lasts until the clutch
// is fully up and gripping in a gear; a gear lasts until the clutch pedal moves or the gear
// changes; a shift lasts until the clutch grips again in a gear.
export function cut(rows) {
  const phases = [];
  let now = { kind: 'launch', start: 0, gear: 0 };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const engaged = row.gripping && row.clutch === 0 && row.gear !== 0;
    if (now.kind !== 'gear' && engaged) {
      if (now.kind === 'shift') now.to = row.gear;
      phases.push({ ...now, end: i });
      now = { kind: 'gear', start: i, gear: row.gear };
    } else if (now.kind === 'gear' && (row.clutch > 0 || row.gear !== now.gear)) {
      phases.push({ ...now, end: i });
      now = { kind: 'shift', start: i, from: now.gear, to: null };
    }
  }
  phases.push({ ...now, end: rows.length });
  return phases.filter((p) => p.end > p.start || p.kind === 'launch');
}

// The perfect run's time to reach a speed, from its rows: interpolated inside the step it got
// there, nought at a standstill, and its own time at 60 mph.
export function timeToSpeed(rows, perfectTime) {
  return (v) => {
    if (v <= 0) return 0;
    if (v >= MPH_60) return perfectTime;
    let lo = 0;
    let hi = rows.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rows[mid].top >= v) hi = mid;
      else lo = mid + 1;
    }
    if (lo === 0) return 0;
    const a = rows[lo - 1];
    const b = rows[lo];
    return seconds(a) + (v - a.top) / (b.top - a.top) / STEPS_PER_SECOND;
  };
}

function label(p) {
  if (p.kind === 'launch') return 'launch';
  if (p.kind === 'gear') return `in ${p.gear === -1 ? 'R' : p.gear === 0 ? 'N' : p.gear}`;
  return p.to ? `${p.from}-${p.to} shift` : `${p.from}- shift`;
}

// What each phase took, against the perfect run. endTime: when the run ended (its time).
function measure(rows, phases, endTime, perfectAt) {
  return phases.map((p, i) => {
    const last = i === phases.length - 1;
    const from = i === 0 ? 0 : seconds(rows[p.start]);
    const to = last ? endTime : seconds(rows[p.end]);
    const vFrom = i === 0 ? 0 : rows[p.start].top;
    const vTo = last ? MPH_60 : rows[p.end].top;
    let spin = 0;
    let limiter = 0;
    for (let k = p.start; k < p.end; k++) {
      if (rows[k].spin > SPIN) spin += 1;
      if (rows[k].cut) limiter += 1;
    }
    const heatEnd = rows[Math.min(p.end, rows.length - 1)].slipJ;
    const yours = to - from;
    const perfect = perfectAt(vTo) - perfectAt(vFrom);
    return {
      phase: label(p),
      kind: p.kind,
      from: p.from,
      to: p.to,
      gear: p.gear,
      seconds: yours,
      perfect,
      lost: yours - perfect,
      mphFrom: vFrom * 2.23694,
      mphTo: vTo * 2.23694,
      rpm: rows[Math.min(p.start, rows.length - 1)].rpm, // revs when the phase began: a shift's revs
      spin: spin / STEPS_PER_SECOND,
      limiter: limiter / STEPS_PER_SECOND,
      heat: heatEnd - (rows[p.start]?.slipJ ?? heatEnd),
    };
  });
}

// The perfect run's own trace and phases, worked out once per engine.
const perfectCache = new Map();
function perfectTrace(engine, perfect) {
  const key = `${engine.id} ${perfect.time}`;
  if (!perfectCache.has(key)) {
    const t = trace(engine, perfect.log);
    const phases = measure(t.rows, cut(t.rows), perfect.time, () => 0);
    perfectCache.set(key, { ...t, phases, at: timeToSpeed(t.rows, perfect.time) });
  }
  return perfectCache.get(key);
}

export function gentleLimit(perfect) {
  const twice = GENTLE_TIMES * perfect.slipJ;
  return twice > GENTLE_FLOOR ? twice : GENTLE_FLOOR;
}

// The score card for a run log, against the engine's stored perfect run.
export function scoreRun(engine, log, perfect) {
  const yours = trace(engine, log);
  const r = yours.result;
  const best = perfectTrace(engine, perfect);
  const card = {
    engine: engine.id,
    gearbox: log.gearbox,
    tractionControl: Boolean(log.tractionControl),
    finished: r.finished,
    time: r.time,
    perfectTime: perfect.time,
    gap: r.finished ? r.time - perfect.time : Infinity,
    heat: r.slipJ,
    gentle: r.slipJ <= gentleLimit(perfect),
    why: whyNot(r),
    scored: r.finished && log.gearbox === 'manual',
    score: null,
    clean: false,
    phases: [],
  };
  card.clean = r.clean && card.gentle;
  if (!card.scored) return card;
  card.score = Math.round((1000 * perfect.time) / r.time);
  card.phases = measure(yours.rows, cut(yours.rows), r.time, best.at).map((p) => {
    if (p.kind !== 'shift') return p;
    const match = best.phases.find((q) => q.kind === 'shift' && q.from === p.from);
    return { ...p, perfectRpm: match ? match.rpm : null };
  });
  return card;
}

// Why a run did not finish or was not clean, in a word or two, or null.
function whyNot(r) {
  if (r.falseStart) return 'false start';
  if (r.startGear !== 0 && r.startGear !== START_GEAR) return 'left in a gear other than first';
  if (r.blown) return 'engine blown';
  if (r.stalled) return 'stalled';
  if (!r.finished) return 'did not reach 60';
  if (r.grind) return 'ground a gear';
  if (r.checkEngine) return 'over-revved';
  return null;
}

// Rounds the phases' losses to whole milliseconds so that, as printed, they add up to the gap
// as printed: largest remainders get the spare milliseconds.
export function lostInMs(card) {
  const target = Math.round(card.time * 1000) - Math.round(card.perfectTime * 1000);
  const exact = card.phases.map((p) => p.lost * 1000);
  const floors = exact.map((x) => Math.floor(x));
  let spare = target - floors.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => [x - floors[i], i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; spare > 0 && k < order.length; k++, spare--) floors[order[k][1]] += 1;
  for (let k = order.length - 1; spare < 0 && k >= 0; k--, spare++) floors[order[k][1]] -= 1;
  return floors;
}
