// The perfect run: for each engine, the fastest clean 0 to 60 the simulation allows with the
// manual gearbox, driven by hands and feet no quicker than the page's own keyboard.
//
//   node tools/solve.js                 solve every engine, write engines/perfect/
//   node tools/solve.js --engine v8     just one
//   node tools/solve.js --check         write nothing; exit 1 if a stored run is stale
//
// What it writes is committed: the page replays each stored log as the ghost needle, and the
// score card measures a driver against its time. test/perfect.test.js replays every stored log
// and fails if it no longer gives the stored time, so a change to the simulation cannot quietly
// move the reference.
//
// The perfect driver is a handful of numbers - launch throttle, how fast the clutch comes up,
// when to floor it, per gear how deep the throttle goes and how much wheelspin it allows before
// easing off, and for each change the revs, how much to lift, when the throttle goes back on
// and how fast the clutch comes up - turned into inputs step by step by createDriver() below.
// The search runs the simulation with those numbers and moves them one at a time: a coarse
// scan across the range, then golden-section refinement around the best point, round after
// round with the range halving, from twelve starting points. No randomness: the same
// simulation always gives the same perfect run. The run must leave in first (sim/sixty.js).
//
// The human limits. A perfect driver who could move a pedal instantly, or change inputs every
// millisecond, would set a time nobody can match for a silly reason. So this one:
//   - changes its inputs at most every 10 ms (TICK), about a fast screen's frame;
//   - moves every pedal at the keyboard's own rates (input/pedals.js RATES), including the
//     slow clutch from a standstill and the quicker one once rolling;
//   - shifts only through the clutch, and moves the stick the moment the clutch is down, as
//     the number keys do;
//   - feels the rear wheels spin only REACTION (0.15 s) late.
// A keyboard driver can, in principle, press exactly what it pressed.

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ENGINES } from '../engines/index.js';
import { ENGINES as PARAMS } from '../engines/params.js';
import { parametersHash, serialise } from './build-engines.js';
import { peaks } from './measure.js';
import { initialState, step, SIM_VERSION } from '../sim/step.js';
import { emptyInputs, PEDAL_MAX, quantise } from '../sim/inputs.js';
import { clutchCapacity } from '../sim/gearbox.js';
import { RPM_PER_RAD_S, STEPS_PER_SECOND } from '../sim/clock.js';
import { PRELUDE, COUNTDOWN_STEP, GO_STEP, MAX_STEPS, MPH_60, START_GEAR, createWatch } from '../sim/sixty.js';
import { RATES } from '../input/pedals.js';

export const TICK = 10; // steps between input changes
const TICK_S = TICK / STEPS_PER_SECOND;
// How late the driver feels the rear wheels spin and reacts: a quick person's reaction time.
export const REACTION = 0.15; // seconds
const REACTION_TICKS = Math.round(REACTION / TICK_S);
// Past its wheelspin limit the driver's foot eases off, all the way by this much more spin.
const SPIN_BAND = 2; // m/s
// The page lets the clutch key up at shift speed once the car rolls faster than this.
const MOVING = 2; // m/s, as ui/main.js
const DIR = fileURLToPath(new URL('../engines/perfect/', import.meta.url));

// The lowest clutch pedal position at which the clutch carries nothing: as far as a driver
// needs to push it to shift, and where to hold it waiting for GO.
export function clutchFree(engine) {
  for (let c = 0; c <= PEDAL_MAX; c++) if (clutchCapacity(engine.gearing, c) === 0) return c;
  return PEDAL_MAX;
}

// The highest gear a run to 60 mph can use: the first gear that reaches 60 mph at the limiter,
// and one more in case changing into the next gear early is quicker.
export function topGear(engine) {
  const { ratios, finalDrive, wheelRadius } = engine.gearing;
  for (let g = 1; g <= ratios.length; g++) {
    const top = (engine.limiterRpm / RPM_PER_RAD_S / (ratios[g - 1] * finalDrive)) * wheelRadius;
    if (top > MPH_60) return Math.min(g + 1, ratios.length);
  }
  return ratios.length;
}

// The numbers the search moves, with their ranges, for a launch in launchGear. Per gear g the
// run uses: how far down the throttle goes (1 the floor), how much wheelspin (m/s) the driver
// lets the tyres have before lifting, and for the
// change from g to g + 1 the revs it is made at, the throttle held through it (0 a full lift,
// 1 flat), how long after the stick goes in the throttle goes back down, and how fast the
// clutch comes up (per second).
export function parameterSpace(engine, launchGear = START_GEAR) {
  const space = [
    { name: 'launchThr', lo: 0.05, hi: 1 }, // throttle held through the countdown and the launch
    { name: 'launchClutchRate', lo: 0.2, hi: RATES.clutch.releaseMoving },
    { name: 'floorAt', lo: 0, hi: 1.5 }, // seconds after GO when the throttle goes to the floor
  ];
  const last = topGear(engine);
  for (let g = launchGear; g <= last; g++) {
    space.push({ name: `foot${g}`, lo: 0.3, hi: 1 }, { name: `spin${g}`, lo: 0.2, hi: 12 });
  }
  for (let g = launchGear; g < last; g++) {
    space.push(
      { name: `shiftRpm${g}`, lo: engine.redlineRpm * 0.6, hi: engine.limiterRpm - 1 },
      { name: `lift${g}`, lo: 0, hi: 1 },
      { name: `reapply${g}`, lo: 0, hi: 0.5 },
      { name: `clutchRate${g}`, lo: 0.5, hi: RATES.clutch.releaseMoving },
    );
  }
  return space;
}

function movePedal(name, p, target, rateCap, moving) {
  const r = RATES[name];
  if (target > p) return Math.min(target, p + r.press * TICK_S);
  const release = moving && r.releaseMoving ? r.releaseMoving : r.release;
  const rate = rateCap && rateCap < release ? rateCap : release;
  return Math.max(target, p - rate * TICK_S);
}

// The perfect driver: given the numbers x, what it presses at each step.
//
//   countdown  clutch down to where it carries nothing, the launch gear in, launch throttle
//   GO         clutch up at launchClutchRate; throttle to the floor floorAt seconds later
//   in gear g  throttle at foot<g>, lifting while the tyres spin past spin<g>; at
//              shiftRpm<g>, change up
//   a change   throttle to lift<g> and clutch down together; the stick moves the moment the
//              clutch is down; clutch up at clutchRate<g>, throttle back reapply<g> after
function createDriver(engine, x) {
  const free = clutchFree(engine);
  const freeP = free / PEDAL_MAX;
  const last = topGear(engine);
  const d = { thr: 0, clutch: 0, gear: 0, key: 0, phase: 'prelude', gateAt: -Infinity, felt: [], inputs: emptyInputs() };
  const prelude = (n) => PRELUDE.reduce((key, [at, , value]) => (at <= n ? value : key), 0);

  d.inputsFor = (state) => {
    const n = state.step;
    if (n % TICK !== 0) return d.inputs;
    const moving = Math.abs(state.v) > MOVING;
    const rpm = state.we * RPM_PER_RAD_S;
    const clutchNow = quantise(d.clutch);
    d.felt.push(state.ww * engine.gearing.wheelRadius - state.v);
    if (d.felt.length > REACTION_TICKS) d.felt.shift();
    let thrTarget = 0;
    let clutchTarget = 0;
    let clutchCap = 0;

    if (n < COUNTDOWN_STEP) {
      d.key = prelude(n);
    } else if (n < GO_STEP) {
      d.phase = 'countdown';
      d.key = 0;
      clutchTarget = freeP;
      thrTarget = x.launchThr;
      if (clutchNow >= free) d.gear = x.launchGear;
    } else {
      if (d.phase === 'countdown') d.phase = 'launch';
      const from = d.gear - 1; // the change that brought the car into this gear, if any
      const changed = d.gateAt > -Infinity;
      const floored = changed
        ? n >= d.gateAt + x[`reapply${from}`] * STEPS_PER_SECOND
        : n >= GO_STEP + x.floorAt * STEPS_PER_SECOND;
      // As far down as this gear's foot, easing off in proportion as the rear tyres spin past
      // this gear's limit, all the way off SPIN_BAND past it. Without traction control a tyre
      // that has broken loose keeps spinning while the push is more than its sliding grip, so
      // a driver who never lifts spins through the gears. The driver feels the spin only
      // REACTION late.
      const spinFelt = d.felt.length ? d.felt[0] : 0;
      const over = (spinFelt - x[`spin${d.gear}`]) / SPIN_BAND;
      const full = x[`foot${d.gear}`] * (over <= 0 ? 1 : over >= 1 ? 0 : 1 - over);
      thrTarget = floored ? full : changed ? x[`lift${from}`] : x.launchThr;

      if (d.phase === 'launch') {
        clutchCap = x.launchClutchRate;
        if (clutchNow === 0) d.phase = 'drive';
      }
      if (d.phase === 'drive' && d.gear < last && state.gear === d.gear && rpm >= x[`shiftRpm${d.gear}`]) {
        d.phase = 'out';
      }
      if (d.phase === 'out') {
        thrTarget = x[`lift${d.gear}`];
        clutchTarget = freeP;
        if (clutchNow >= free) {
          d.gear += 1;
          d.gateAt = n;
          d.phase = 'in';
        }
      }
      if (d.phase === 'in') {
        clutchCap = x[`clutchRate${d.gear - 1}`];
        if (clutchNow === 0) d.phase = 'drive';
      }
    }

    d.thr = movePedal('thr', d.thr, thrTarget, 0, moving);
    d.clutch = movePedal('clutch', d.clutch, clutchTarget, clutchCap, moving);
    d.inputs = { thr: quantise(d.thr), brake: 0, clutch: quantise(d.clutch), gear: d.gear, key: d.key };
    return d.inputs;
  };
  return d;
}

// The prelude is the same for every driver, so the state it ends in is worked out once per
// engine and every search run starts from there.
const preludeCache = new Map();
function afterPrelude(engine) {
  if (!preludeCache.has(engine.id)) {
    const driver = createDriver(engine, {});
    let state = initialState(engine, null, { gearbox: 'manual' });
    while (state.step < COUNTDOWN_STEP) state = step(engine, null, state, driver.inputsFor(state));
    preludeCache.set(engine.id, state);
  }
  return preludeCache.get(engine.id);
}

// One run with the numbers x. With record, it also returns the run log and the shifts, and
// starts from cold rather than from the cached prelude.
export function driveRun(engine, x, { record = false } = {}) {
  const driver = createDriver(engine, x);
  const watch = createWatch();
  let state = record ? initialState(engine, null, { gearbox: 'manual' }) : afterPrelude(engine);
  const events = [];
  const shifts = [];
  let prev = emptyInputs();
  while (!watch.done && state.step < MAX_STEPS) {
    const inputs = driver.inputsFor(state);
    if (record) {
      for (const ch of ['thr', 'brake', 'clutch', 'gear', 'key']) {
        if (inputs[ch] !== prev[ch]) events.push([state.step, ch, inputs[ch]]);
      }
      if (inputs.gear !== prev.gear && state.step >= GO_STEP) {
        shifts.push({ to: inputs.gear, rpm: Math.round(state.we * RPM_PER_RAD_S), mph: +(state.v * 2.23694).toFixed(1) });
      }
      prev = inputs;
    }
    state = step(engine, null, state, inputs);
    watch.see(state);
  }
  const result = watch.result();
  if (!record) return result;
  return { ...result, shifts, log: { steps: state.step, gearbox: 'manual', events } };
}

// The objective: seconds to 60 mph, or Infinity for a run that is not clean.
function cost(engine, x) {
  const r = driveRun(engine, x);
  return r.clean ? r.time : Infinity;
}

// The launch throttle whose revs at GO sit nearest peak torque: where the search starts.
function launchAtPeakTorque(engine) {
  const target = peaks(engine).peakTorqueRpm;
  const revsAtGo = (thr) => {
    const driver = createDriver(engine, { launchThr: thr, launchGear: 1 });
    let state = afterPrelude(engine);
    while (state.step < GO_STEP) state = step(engine, null, state, driver.inputsFor(state));
    return state.we * RPM_PER_RAD_S;
  };
  let lo = 0.05;
  let hi = 1;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (revsAtGo(mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// The plan's starting point: launch at peak torque, change up where the coach says, a full
// lift and the clutch up as fast as the key allows; lift once the tyres spin past 2 m/s, about
// where a spinning tyre's grip starts to fade.
export function startingPoint(engine, launchGear = START_GEAR) {
  const x = { launchGear, launchThr: launchAtPeakTorque(engine), launchClutchRate: RATES.clutch.release, floorAt: 0 };
  const last = topGear(engine);
  for (let g = launchGear; g <= last; g++) {
    x[`foot${g}`] = 1;
    x[`spin${g}`] = 2;
  }
  for (let g = launchGear; g < last; g++) {
    x[`shiftRpm${g}`] = Math.min(engine.coach.upshiftRpm[g - 1], engine.limiterRpm - 1);
    x[`lift${g}`] = 0;
    x[`reapply${g}`] = 0;
    x[`clutchRate${g}`] = RATES.clutch.releaseMoving;
  }
  return x;
}

const PHI = (Math.sqrt(5) - 1) / 2;

// Golden-section search for the lowest f on [a, b]. f may be flat in places (pedals are whole
// numbers, inputs change every 10 ms), so it ends on the best point it actually evaluated.
function golden(f, a, b, iterations) {
  let best = { x: a, f: Infinity };
  const look = (x) => {
    const y = f(x);
    if (y < best.f) best = { x, f: y };
    return y;
  };
  let c = b - PHI * (b - a);
  let d = a + PHI * (b - a);
  let fc = look(c);
  let fd = look(d);
  for (let i = 0; i < iterations; i++) {
    if (fc <= fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - PHI * (b - a);
      fc = look(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + PHI * (b - a);
      fd = look(d);
    }
  }
  return best;
}

// The places the search sets off from: the plan's starting point, and variations on how the
// launch and the foot begin, because the numbers that matter most pull on each other - a
// launch off high revs spins the tyres, a timid foot wastes grip - and a search that moves one
// number at a time can settle in whichever of those it starts nearest.
export function startingPoints(engine) {
  const plan = startingPoint(engine);
  const last = topGear(engine);
  const starts = [];
  for (const launchThr of [plan.launchThr, 0.06, 0.25]) {
    for (const foot of [1, 0.6]) {
      for (const spin of [2, 4]) {
        const x = { ...plan, launchThr };
        for (let g = START_GEAR; g <= last; g++) {
          x[`foot${g}`] = foot;
          x[`spin${g}`] = spin;
        }
        starts.push(x);
      }
    }
  }
  return starts;
}

// Every start gets two rounds; the best of them is carried on until it stops improving.
export function solve(engine, { log = () => {} } = {}) {
  const screened = startingPoints(engine)
    .map((x) => descend(engine, x, { rounds: 2 }))
    .sort((a, b) => a.time - b.time);
  log(`  ${screened.length} starts: best ${screened[0].time.toFixed(4)} s, worst ${screened.at(-1).time.toFixed(4)} s`);
  return descend(engine, screened[0].x, { firstRound: 2, log });
}

// Coordinate descent: each parameter in turn, a scan of GRID points across its window, then
// golden-section between the best point's neighbours. The window starts as the whole range
// and halves each round.
function descend(engine, start, { firstRound = 0, rounds = 7, grid = 9, refine = 12, log = () => {} } = {}) {
  const space = parameterSpace(engine, START_GEAR);
  const x = { ...start };
  let best = cost(engine, x);
  for (let round = firstRound; round < rounds; round++) {
    const share = 1 / (1 << round);
    const before = best;
    for (const p of space) {
      const width = (p.hi - p.lo) * share;
      const lo = Math.max(p.lo, x[p.name] - width / 2);
      const hi = Math.min(p.hi, x[p.name] + width / 2);
      const at = (v) => cost(engine, { ...x, [p.name]: v });
      const points = Array.from({ length: grid }, (_, i) => lo + ((hi - lo) * i) / (grid - 1));
      const values = points.map(at);
      let j = 0;
      for (let i = 1; i < grid; i++) if (values[i] < values[j]) j = i;
      let found = { x: points[j], f: values[j] };
      if (Number.isFinite(found.f)) {
        const g = golden(at, points[Math.max(0, j - 1)], points[Math.min(grid - 1, j + 1)], refine);
        if (g.f < found.f) found = g;
      }
      if (found.f < best) {
        best = found.f;
        x[p.name] = found.x;
      }
    }
    log(`  round ${round + 1}: ${best.toFixed(4)} s`);
    if (round > firstRound + 1 && before - best < 1e-5) break;
  }
  return { x, time: best };
}

const round6 = (v) => Math.round(v * 1e6) / 1e6;

export function perfectFile(engine, solved) {
  const run = driveRun(engine, solved.x, { record: true });
  if (!run.clean || run.time !== solved.time) {
    throw new Error(`${engine.id}: the recorded run (${run.time}) does not match the search (${solved.time})`);
  }
  const params = PARAMS.find((p) => p.id === engine.id);
  const head = {
    engine: engine.id,
    engineHash: parametersHash(params),
    simVersion: SIM_VERSION,
    gearbox: 'manual',
    tractionControl: false,
    time: run.time,
    slipJ: round6(run.slipJ),
    shifts: run.shifts,
    params: Object.fromEntries(Object.entries(solved.x).map(([k, v]) => [k, round6(v)])),
  };
  // One event per line would be thousands of lines; wrap them like the engine tables.
  const lines = [];
  let line = '';
  for (const e of run.log.events) {
    const item = `${JSON.stringify(e)}, `;
    if (line.length + item.length > 92) {
      lines.push(line.trimEnd());
      line = '';
    }
    line += item;
  }
  if (line) lines.push(line.trimEnd());
  const body = serialise(head).replace(/\n}$/, '');
  return [
    '// Generated by tools/solve.js: the fastest clean 0 to 60 this simulation allows for this',
    '// engine with the manual gearbox, driven no quicker than the keyboard. Do not edit: run',
    '// `node tools/solve.js`. test/perfect.test.js replays the log and checks the time.',
    '',
    `export default ${body}`,
    `  log: {`,
    `    steps: ${run.log.steps},`,
    `    gearbox: "manual",`,
    `    events: [`,
    ...lines.map((l) => `      ${l}`),
    `    ],`,
    `  },`,
    `};`,
    '',
  ].join('\n');
}

export function indexFile(ids) {
  return [
    '// Generated by tools/solve.js. Each engine\'s perfect 0 to 60, by engine id.',
    '',
    ...ids.map((id) => `import ${id} from './${id}.js';`),
    '',
    `export const PERFECT = { ${ids.join(', ')} };`,
    '',
  ].join('\n');
}

// A stored run is stale when the simulation or the engine has changed since it was solved.
export function stale(engine, stored) {
  const params = PARAMS.find((p) => p.id === engine.id);
  if (stored.simVersion !== SIM_VERSION) return `SIM_VERSION is ${SIM_VERSION}, the run was solved at ${stored.simVersion}`;
  if (stored.engineHash !== parametersHash(params)) return 'the engine has been rebuilt since';
  return null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const only = args.includes('--engine') ? args[args.indexOf('--engine') + 1] : null;
  if (args.includes('--check')) {
    const { PERFECT } = await import('../engines/perfect/index.js');
    let bad = 0;
    for (const engine of ENGINES) {
      const why = PERFECT[engine.id] ? stale(engine, PERFECT[engine.id]) : 'no stored run';
      if (why) {
        bad += 1;
        console.error(`${engine.id}: ${why}`);
      }
    }
    if (!bad) console.error('every perfect run is current');
    process.exit(bad ? 1 : 0);
  }
  mkdirSync(DIR, { recursive: true });
  for (const engine of ENGINES) {
    if (only && engine.id !== only) continue;
    const started = process.hrtime.bigint();
    console.error(`${engine.label}`);
    const solved = solve(engine, { log: (m) => console.error(m) });
    writeFileSync(DIR + `${engine.id}.js`, perfectFile(engine, solved), 'utf8');
    const secs = Number(process.hrtime.bigint() - started) / 1e9;
    console.error(`  wrote engines/perfect/${engine.id}.js: ${solved.time.toFixed(4)} s (solved in ${secs.toFixed(0)} s)`);
  }
  const existing = ENGINES.map((e) => e.id).filter((id) => existsSync(DIR + `${id}.js`));
  writeFileSync(DIR + 'index.js', indexFile(existing), 'utf8');
}
