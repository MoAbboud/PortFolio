// The page: one engine at a time, its gauges laid out from its own figures.
//
// Driven live - keyboard, mouse, touch or a controller - as an automatic or a manual with a
// clutch and an H-pattern stick, with the shift coach; or played from a scripted drive. The
// 0 to 60 run (stage 7): a countdown, the run recorded as its inputs, the perfect run as a
// ghost needle alongside, a score card, this visit's board, and a link that carries the run.

import { ENGINES } from '../engines/index.js';
import { PERFECT } from '../engines/perfect/index.js';
import { initialState, step, DT, SIM_VERSION } from '../sim/step.js';
import { emptyInputs, applyEvent, quantise } from '../sim/inputs.js';
import { crankTorque, airLoad } from '../sim/engine.js';
import { RPM_PER_RAD_S } from '../sim/clock.js';
import { checkScript } from '../sim/replay.js';
import { PRELUDE, COUNTDOWN_STEP, GO_STEP, MAX_STEPS, createWatch } from '../sim/sixty.js';
import { scoreRun } from '../sim/score.js';
import { FORMAT, hashMatches } from '../sim/runlog.js';
import { gaugeLayout, lightsLit } from './layout.js';
import { roles, rgb, PALETTES } from './palette.js';
import { createDevelopment, grow, builtShare } from './development.js';
import { tremble } from './ripple.js';
import { Gauge } from './gauge.js';
import { EngineLines } from './lines.js';
import { Dyno } from './dyno.js';
import { TACH, SPEEDO } from './needle.js';
import { DEMOS } from './demos.js';
import { Controls } from '../input/controls.js';
import { moveLever, POSITIONS } from '../input/lever.js';
import { Stick } from './stick.js';
import { coach } from './coach.js';
import { EngineSound } from './sound.js';
import { linkFor, runFromHash } from './share.js';
import { renderCard, renderBoard, bests } from './card.js';
import { explain, MathsPanel } from './insight.js';

document.documentElement.dataset.sim = String(SIM_VERSION);

const MAX_STEPS_PER_FRAME = 250; // a background tab does not try to catch up a minute at once
const SWEEP_SECONDS = 1.2; // the key-on needle sweep
const HINT_SECONDS = 2.5;
const MPH = 2.23694;
const BOARD_SIZE = 10; // recent runs kept, besides each engine's best
const $ = (id) => document.getElementById(id);

const tach = new Gauge($('tach'), 'tach', TACH);
const speed = new Gauge($('speed'), 'speed', SPEEDO);
const lines = new EngineLines($('lines'));
const dyno = new Dyno($('dyno'));

let index = 0;
let engine;
let layout;
let colours;
const developments = new Map(); // per engine, for as long as the page is open: the dyno strip
let dev;
let player = null;
let state;
let inputs = emptyInputs();
let carry = 0;
let last = performance.now();
let sweepFrom = -1;
let firingPhase = 0;
let lastGear = 0;
let lastCut = false;
let awake = false; // the needles appear with the start key, not before

// Driving live.
let box = 'auto'; // 'auto' or 'manual'
let selector = 'P'; // the automatic's lever
let asked = 0; // the gear the manual's stick is in
let tractionControl = true; // on for the automatic, off for the manual; applies from the next start
let live = { thr: 0, brake: 0, clutch: 0, key: false };
let keyWas = false;
let hintUntil = 0;
let wasRunning = false;
let blownSeen = false;
let shift = null; // { from: slipJ when the clutch went down }
let lastShiftJ = null;

// The 0 to 60 run.
let run = null; // { events, last, watch } while one is being driven
let ghost = null; // the engine's perfect run, stepped alongside: { log, state, inputs, next }

// The maths panel: the last step's starting state and inputs, so it can show that step again.
const maths = new MathsPanel($('maths-panel'));
let lastBefore = null;
let lastUsed = null;
let mathsAt = 0;
const MATHS_EVERY = 0.12; // seconds between refreshes, slow enough to read
const board = []; // this visit's runs, newest first: { card, log, shared }

const controls = new Controls({
  pedals: { thr: $('pedal-thr'), brake: $('pedal-brake'), clutch: $('pedal-clutch') },
  start: $('start'),
  lever: Object.fromEntries(POSITIONS.map((p) => [p, $(`lever-${p}`)])),
  tc: $('tc'),
}, {
  lever: (wanted) => moveTo(wanted),
  gear: (n) => askGear(n, true),
  tc: () => toggleTraction(),
  cycle: (by) => cycle(by),
  box: () => switchBox(),
  sound: () => toggleSound(),
  run: () => startRun(),
  maths: () => toggleMaths(),
});
const sound = new EngineSound();
const stick = new Stick($('stick'), (n) => askGear(n, false));

function hint(text) {
  $('hint').textContent = text;
  hintUntil = performance.now() + HINT_SECONDS * 1000;
}

// A fresh car, engine off - in Park, or in neutral with the stick on the rail - ready for the
// driver.
function freshCar() {
  selector = 'P';
  controls.lever = selector;
  asked = 0;
  controls.gear = 0;
  stick.moveTo(0);
  awake = false;
  blownSeen = false;
  shift = null;
  lastShiftJ = null;
  state = initialState(engine, null, { gearbox: box, tractionControl });
  inputs = { ...emptyInputs(), gear: box === 'auto' ? selector : asked };
  document.body.classList.toggle('manual', box === 'manual');
  $('box').textContent = box === 'auto' ? 'AUTO' : 'MANUAL';
  $('newengine').hidden = true;
}

function switchBox() {
  if (player) return;
  stopRun();
  box = box === 'auto' ? 'manual' : 'auto';
  controls.box = box;
  tractionControl = box === 'auto';
  freshCar();
  hint(box === 'auto' ? 'automatic' : 'manual: C or A is the clutch, 1 to 6 the gears');
}

// The manual's stick asks for a gear; the gearbox decides whether it goes in.
function askGear(n, fromKeys) {
  if (player || box !== 'manual') return;
  asked = n;
  controls.gear = n;
  if (fromKeys) stick.moveTo(n);
}

function loadEngine(i) {
  stopRun();
  index = i;
  engine = ENGINES[i];
  layout = gaugeLayout(engine);
  colours = roles(engine.id);
  if (!developments.has(engine.id)) developments.set(engine.id, createDevelopment(layout, true));
  dev = developments.get(engine.id);
  tach.setEngine(layout.tach, colours, colours.needle);
  speed.setEngine(layout.speed, colours, colours.speed);
  lines.setEngine(engine, colours);
  sound.setEngine(engine);
  // The dyno's scale: the engine's real full-throttle peaks, from the same sums a bench uses.
  let peakTorque = 0;
  let peakKw = 0;
  for (let r = 1000; r <= engine.redlineRpm; r += 100) {
    const t = crankTorque(engine, airLoad(engine, 1, r), r, true);
    peakTorque = Math.max(peakTorque, t);
    peakKw = Math.max(peakKw, (t * r) / RPM_PER_RAD_S / 1000);
  }
  dyno.setEngine(layout.tach, colours, peakTorque, peakKw);
  player = null;
  ghost = null;
  $('playing').textContent = '';
  $('clock').textContent = '';
  freshCar();
  paintChrome();
}

// The page around the gauges takes the engine's colours.
function paintChrome() {
  const root = document.documentElement.style;
  root.setProperty('--top', rgb(colours.top));
  root.setProperty('--bottom', rgb(colours.bottom));
  root.setProperty('--accent', rgb(colours.needle.core));
  root.setProperty('--accent-edge', rgb(colours.needle.edge));
  $('engine').textContent = engine.label;
  $('palette').textContent = PALETTES[engine.id].name;
  const lights = $('lights');
  lights.replaceChildren(...Array.from({ length: layout.lights }, () => document.createElement('i')));
}

function cycle(by) {
  loadEngine((index + by + ENGINES.length) % ENGINES.length);
}

function moveTo(wanted) {
  if (player) return;
  const r = moveLever(selector, wanted, { brake: live.brake, speed: state.v });
  selector = r.gear;
  controls.lever = selector;
  if (r.refused) hint(r.refused);
}

function toggleMaths() {
  const open = maths.toggle();
  $('maths').classList.toggle('on', open);
  mathsAt = 0;
  hint(open ? 'the maths, as it happens' : 'maths hidden');
}

function toggleSound() {
  const on = sound.toggle();
  hint(`sound ${on ? 'on' : 'off'}`);
}

function toggleTraction() {
  if (run) {
    hint('not during a run');
    return;
  }
  tractionControl = !tractionControl;
  if (!state.running) state = { ...state, tractionControl };
  hint(`traction control ${tractionControl ? 'on' : 'off'}${state.running ? ' from the next start' : ''}`);
}

// The engine's perfect run, to be stepped alongside a 0 to 60 run from the same step 0.
function makeGhost() {
  const perfect = PERFECT[engine.id];
  if (!perfect || perfect.engineHash !== engine.hash || perfect.simVersion !== SIM_VERSION) return null;
  return { log: perfect.log, state: initialState(engine, null, { gearbox: 'manual' }), inputs: emptyInputs(), next: 0 };
}

function stepGhost() {
  const g = ghost;
  if (g.state.step >= g.log.steps) return; // past 60 mph it waits there
  const { events } = g.log;
  while (g.next < events.length && events[g.next][0] === g.state.step) {
    const [, channel, value] = events[g.next];
    g.inputs = applyEvent(g.inputs, channel, value);
    g.next += 1;
  }
  g.state = step(engine, null, g.state, g.inputs);
}

function startDemo(script) {
  stopRun();
  player = { script, next: 0 };
  state = initialState(engine, null, { gearbox: script.gearbox, tractionControl: script.tractionControl });
  inputs = emptyInputs();
  ghost = script.mode === 'zero-to-sixty' ? makeGhost() : null;
  sweepFrom = performance.now();
  awake = true;
  $('playing').textContent = script.name;
}

// A demo ends - played out, stopped, or the driver took over - and the car is the driver's
// again: a fresh car, engine off.
function endDemo() {
  player = null;
  ghost = null;
  $('playing').textContent = '';
  freshCar();
}

// The 0 to 60 run. A fresh car; the page turns the key; a two-second countdown in which the
// driver may push the clutch, pick a gear and build revs; then GO. The rules are
// sim/sixty.js's, the same ones the perfect run was solved under.
function startRun() {
  if (player) endDemo();
  freshCar();
  run = { events: [], last: emptyInputs(), watch: createWatch() };
  ghost = makeGhost();
  awake = true;
  sweepFrom = performance.now();
  $('card').hidden = true;
  hint(box === 'manual' ? 'clutch down, first in, revs up: go on GO' : 'brake, D: go on GO');
}

function stopRun() {
  if (!run) return;
  run = null;
  ghost = null;
  $('clock').textContent = '';
  hint('run stopped');
}

// What the simulation is given at step n of a run: the page's own key turn until the
// countdown, the driver from then on.
function runInputs(n) {
  if (n >= COUNTDOWN_STEP) return inputs;
  const key = PRELUDE.reduce((k, [at, , value]) => (at <= n ? value : k), 0);
  return { ...emptyInputs(), gear: box === 'auto' ? 'P' : 0, key };
}

// Only changes are recorded, at the step they take effect: the run log.
function record(used) {
  for (const channel of ['thr', 'brake', 'clutch', 'gear', 'key']) {
    if (used[channel] !== run.last[channel]) run.events.push([state.step, channel, used[channel]]);
  }
  run.last = used;
}

function finishRun() {
  const seen = run.watch.result();
  const log = {
    format: FORMAT, simVersion: SIM_VERSION,
    engine: engine.id, engineHash: engine.hash, gearbox: state.box,
    tractionControl: state.tractionControl, mode: 'zero-to-sixty',
    steps: state.step, events: run.events,
  };
  run = null;
  ghost = null;
  $('clock').textContent = Number.isFinite(seen.time) ? seen.time.toFixed(3) : '';
  // The card is worked out by re-driving the log, as a shared link will be: it must agree with
  // what was just seen live.
  const card = scoreRun(engine, log, PERFECT[engine.id]);
  if (card.time !== seen.time) console.error(`replay gave ${card.time}, the live run ${seen.time}`);
  showEntry(addToBoard({ card, log, shared: false }));
}

function addToBoard(entry) {
  board.unshift(entry);
  // Past the limit the oldest run goes - unless it is its engine's best, which stays.
  const keep = new Set(bests(board).values());
  while (board.length > BOARD_SIZE + keep.size) {
    const i = board.findLastIndex((e) => !keep.has(e));
    board.splice(i, 1);
  }
  drawBoard();
  return entry;
}

function drawBoard() {
  renderBoard($('board'), board, { show: showEntry, watch: watchEntry });
}

function showEntry(entry) {
  renderCard($('card'), entry, { watch: watchEntry, share: shareEntry, again: againEntry });
}

function engineFor(entry) {
  const i = ENGINES.findIndex((e) => e.id === entry.log.engine);
  if (i !== index) loadEngine(i);
}

function watchEntry(entry) {
  engineFor(entry);
  const s = entry.card.time;
  startDemo({ ...entry.log, name: `watching ${engine.label} ${entry.log.gearbox}${Number.isFinite(s) ? `, ${s.toFixed(3)} s` : ''}` });
}

async function shareEntry(entry) {
  const link = await linkFor(entry.log, location.href.split('#')[0]);
  try {
    await navigator.clipboard.writeText(link);
    hint('link copied');
  } catch {
    hint('copy the link below');
  }
  return link;
}

function againEntry(entry) {
  engineFor(entry);
  if (entry.log.gearbox !== box) switchBox();
  startRun();
}

// A link with #run= in it: re-drive the run it carries and show what it earns here.
async function openShared() {
  let log;
  try {
    log = await runFromHash(location.hash);
  } catch {
    hint('that run link is broken');
    return;
  }
  if (!log) return;
  const i = ENGINES.findIndex((e) => e.id === log.engine);
  if (i < 0 || log.simVersion !== SIM_VERSION || !hashMatches(log.engineHash, ENGINES[i].hash)) {
    hint('that run was driven on another version of pedalsim and cannot be re-driven here');
    return;
  }
  try {
    checkScript(log);
  } catch {
    hint('that run link is broken');
    return;
  }
  loadEngine(i);
  log.engineHash = engine.hash;
  const card = scoreRun(engine, log, PERFECT[engine.id]);
  showEntry(addToBoard({ card, log, shared: true }));
}

// This frame's inputs from the controls, rounded once to what the simulation takes.
function liveInputs(dt, now) {
  live = controls.read(dt, Math.abs(state.v) > 2);
  if (live.key && !keyWas && !state.running && !run) {
    // Turning the key: traction control as set, and the needles wake with their sweep.
    state = { ...state, tractionControl };
    awake = true;
    sweepFrom = now;
  }
  keyWas = live.key;
  inputs = {
    thr: quantise(live.thr),
    brake: quantise(live.brake),
    clutch: box === 'manual' ? quantise(live.clutch) : 0,
    gear: box === 'auto' ? selector : asked,
    key: live.key ? 1 : 0,
  };
}

// Run the simulation forward by the real time that has passed, in whole steps.
function simulate(seconds) {
  carry = Math.min(carry + seconds, MAX_STEPS_PER_FRAME * DT);
  while (carry >= DT) {
    if (player) {
      const { events, steps } = player.script;
      while (player.next < events.length && events[player.next][0] === state.step) {
        const [, channel, value] = events[player.next];
        inputs = applyEvent(inputs, channel, value);
        player.next += 1;
      }
      if (state.step >= steps) {
        endDemo();
        continue;
      }
    }
    const used = run ? runInputs(state.step) : inputs;
    if (run) record(used);
    lastBefore = state;
    lastUsed = used;
    state = step(engine, null, state, used);
    if (ghost) stepGhost();
    if (run) {
      run.watch.see(state);
      if (run.watch.done || state.step >= MAX_STEPS) finishRun();
    }
    carry -= DT;
  }
}

// Everything that moves with time but draws nothing: the controls, the simulation, the dyno.
function advance(dt, now) {
  if (player && controls.busy()) endDemo(); // the driver takes over
  if (!player) liveInputs(dt, now);
  simulate(dt);
  const rpm = Math.max(0, state.we * RPM_PER_RAD_S);
  const mph = state.v * MPH;
  const torque = crankTorque(engine, state.load, rpm, state.running && !state.cut);
  if (state.blown && !blownSeen) {
    blownSeen = true;
    $('newengine').hidden = false;
    hint('engine blown');
  }
  grow(dev, layout, { running: state.running, rpm, load: state.load, mph, gear: state.gear, torque }, dt);
  return { rpm, mph, torque };
}

// The countdown and the running time, during a run or while one is watched.
function drawClock() {
  const timed = run || (player && player.script.mode === 'zero-to-sixty');
  if (!timed) return;
  const n = state.step;
  let text;
  if (n < COUNTDOWN_STEP) text = 'READY';
  else if (n < GO_STEP) text = String(Math.ceil((GO_STEP - n) / 1000));
  else if (n < GO_STEP + 400) text = 'GO';
  else text = ((n - GO_STEP) / 1000).toFixed(2);
  $('clock').textContent = text;
}

function frame(now) {
  // A frame's timestamp is when the frame began, which can be before the last time the script
  // read the clock - so the first step can come out negative. Time does not run backwards here.
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
  last = now;
  const { rpm, mph, torque } = advance(dt, now);

  // The needles: the key-on sweep, then the engine - with a tremble from its firing pulses.
  let rpmShown = rpm;
  let mphShown = Math.abs(state.ww * layout.wheelRadius * MPH); // the speedometer reads the wheels
  const since = (now - sweepFrom) / 1000;
  if (sweepFrom >= 0 && since < SWEEP_SECONDS) {
    const up = since < SWEEP_SECONDS / 2;
    rpmShown = up ? layout.tach.max : rpm;
    mphShown = up ? layout.speed.max : mphShown;
  }
  firingPhase += (rpm / 60) * Math.PI * engine.cylinders * dt;
  rpmShown += tremble(engine, rpm, Math.max(0, torque)) * Math.sin(firingPhase);

  const time = now / 1000;
  const marks = layout.tach.shiftMarks.filter((r, i, all) => all.indexOf(r) === i);
  const advice = box === 'manual' && state.running
    ? coach(engine, { gear: state.gear, rpm, v: state.v, thr: live.thr, brake: live.brake, clutch: live.clutch, want: asked })
    : { arrow: null, matchRpm: null };
  const perfectRpm = ghost ? Math.max(0, ghost.state.we * RPM_PER_RAD_S) : null;
  const perfectMph = ghost ? Math.abs(ghost.state.v * MPH) : null;
  tach.draw({ value: rpmShown, dt, bins: dev.tach, mean: builtShare(dev.tach), eventLevel: dev.redline,
    time, marks, needle: awake, ghost: advice.matchRpm, perfect: perfectRpm });
  speed.draw({ value: mphShown, dt, bins: dev.speed, mean: builtShare(dev.speed), time, needle: awake, perfect: perfectMph });

  if (state.gear !== lastGear || (state.cut && !lastCut)) lines.bump();
  lastGear = state.gear;
  lastCut = state.cut;
  lines.draw({ rpm, load: state.load, running: state.running, dt, holes: gaugeHoles() });
  dyno.draw({ dyno: dev.dyno, rpm, torque });
  sound.update({
    rpm,
    load: state.load,
    firing: state.running && !state.cut,
    starter: inputs.key === 1 && !state.running && !state.blown,
    grind: state.grinding,
  });
  drawClock();
  drawControls(now, rpm, advice);
  if (maths.open && lastBefore && now / 1000 - mathsAt >= MATHS_EVERY) {
    mathsAt = now / 1000;
    maths.update(explain(engine, lastBefore, lastUsed));
  }
  requestAnimationFrame(frame);
}

// Clutch down to clutch gripping again: the heat that shift made, in joules.
function watchShift() {
  if (box !== 'manual') return;
  if (!shift && live.clutch > 0.6) shift = { from: state.slipJ };
  else if (shift && live.clutch < 0.1 && state.clutchStuck) {
    lastShiftJ = state.slipJ - shift.from;
    shift = null;
  }
}

// The shift lights, the gear, the pedals pressed by whatever is pressing them, the lever, the
// stick, the coach's arrow, the warning lights.
function drawControls(now, rpm, advice) {
  watchShift();
  if (wasRunning && !state.running && !state.blown && !player) {
    hint(box === 'manual' ? 'stalled - clutch down, then K' : 'stalled');
  }
  wasRunning = state.running;
  if (state.grinding && now > hintUntil - 2000) hint('grind - clutch down, or match the revs');
  const shiftAt = state.gear >= 1 && state.gear <= 5 ? layout.tach.shiftMarks[state.gear - 1] : engine.redlineRpm;
  const lit = lightsLit(layout, rpm, shiftAt);
  const flash = rpm >= shiftAt && Math.floor(now / 80) % 2 === 0;
  $('lights').querySelectorAll('i').forEach((el, i) => {
    el.className = i < lit ? (flash ? 'flash' : 'on') : '';
  });
  $('gear').textContent = gearLabel();
  $('readout').textContent = `${Math.round(rpm)} rpm  ${Math.abs(state.v * MPH).toFixed(0)} mph`;
  $('pedal-thr').style.setProperty('--press', String(inputs.thr / 1023));
  $('pedal-brake').style.setProperty('--press', String(inputs.brake / 1023));
  $('pedal-clutch').style.setProperty('--press', String(inputs.clutch / 1023));
  stick.update(state.box === 'manual' ? state.gear : 0, state.grinding, now);
  $('coach').className = advice.arrow ? `coach ${advice.arrow}` : 'coach';
  $('coach-why').textContent = advice.reason ?? '';
  $('check').hidden = !state.checkEngine;
  $('heat').textContent = lastShiftJ === null ? '' : `last shift ${Math.round(lastShiftJ)} J`;
  const at = typeof inputs.gear === 'string' ? inputs.gear : null;
  for (const p of POSITIONS) $(`lever-${p}`).classList.toggle('on', p === at);
  $('start').classList.toggle('running', state.running);
  $('tc').textContent = `TC ${tractionControl ? 'on' : 'off'}`;
  $('sound').textContent = `SOUND ${sound.on ? 'on' : 'off'}`;
  $('sound').classList.toggle('on', sound.on);
  $('tc').classList.toggle('on', tractionControl);
  $('run').classList.toggle('on', Boolean(run));
  if (now > hintUntil) {
    const start = box === 'manual' ? 'clutch down, then hold K or START' : 'hold K or START to start';
    $('hint').textContent = state.running || state.blown || run ? '' : start;
  }
}

// Where the gauges sit on the lines' canvas, so the lines can keep out of them.
function gaugeHoles() {
  const canvas = $('lines');
  const box = canvas.getBoundingClientRect();
  const scale = canvas.width / (box.width || 1);
  return [$('tach'), $('speed')].map((el) => {
    const r = el.getBoundingClientRect();
    return {
      x: (r.left - box.left + r.width / 2) * scale,
      y: (r.top - box.top + r.height / 2) * scale,
      r: (r.width / 2) * scale,
    };
  });
}

function gearLabel() {
  if (state.box === 'auto') {
    const sel = typeof inputs.gear === 'string' ? inputs.gear : 'P';
    return sel === 'D' ? `D${state.gear}` : sel;
  }
  return state.gear === 0 ? 'N' : state.gear < 0 ? 'R' : String(state.gear);
}

function resize() {
  for (const c of [$('lines'), $('dyno')]) {
    const r = c.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.round(r.width * dpr);
    c.height = Math.round(r.height * dpr);
  }
  tach.resize();
  speed.resize();
}

$('prev').addEventListener('click', () => cycle(-1));
$('next').addEventListener('click', () => cycle(1));
$('run').addEventListener('click', () => startRun());
$('stop').addEventListener('click', () => {
  if (run) stopRun();
  else endDemo();
});
$('box').addEventListener('click', () => switchBox());
$('sound').addEventListener('click', () => toggleSound());
$('maths').addEventListener('click', () => toggleMaths());
// Browsers allow no sound until the visitor presses something; the first press starts it.
for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, () => sound.start());
document.addEventListener('visibilitychange', () => sound.visible(!document.hidden));
$('newengine').addEventListener('click', () => {
  stopRun();
  freshCar();
  hint('a new engine');
});
DEMOS.forEach((make, i) => $(`demo${i}`).addEventListener('click', () => startDemo(make())));
window.addEventListener('resize', resize);
window.addEventListener('hashchange', () => openShared());

// Paint the faces only once the fonts have arrived, or the numerals are drawn in a fallback
// face. A font used only inside a canvas is never fetched unless asked for.
try {
  await Promise.all([document.fonts.load('40px "Boldonse"'), document.fonts.load('italic 40px "Bodoni Moda"')]);
} catch {
  // No font loading API, or the fonts failed: the fallbacks in ui/face.js are used.
}
document.documentElement.dataset.fonts = document.fonts?.check('40px "Boldonse"') ? 'loaded' : 'fallback';

// The address can choose the engine and the gearbox and start a drive: ?engine=v12&box=manual,
// ?engine=v8&demo=1. Handy for sharing a drive, and for screenshots of the page part-way
// through one. #run=... carries a 0 to 60 run.
const params = new URLSearchParams(location.search);
// ?debug exposes the state and inputs, read-only, for checking the page from outside.
if (params.has('debug')) {
  window.pedalsim = {
    state: () => state, inputs: () => inputs, live: () => live,
    sound: () => ({ context: sound.ctx?.state ?? null, node: Boolean(sound.node), failed: sound.failed, on: sound.on }),
    running: () => Boolean(run), ghost: () => ghost?.state ?? null,
    board: () => board.map((e) => ({ card: e.card, log: e.log, shared: e.shared })),
    link: (i = 0) => linkFor(board[i].log, location.href.split('#')[0]),
  };
}
const wanted = ENGINES.findIndex((e) => e.id === params.get('engine'));
loadEngine(wanted >= 0 ? wanted : 0);
resize();
if (params.get('box') === 'manual') switchBox();
const demo = Number(params.get('demo'));
if (params.has('demo') && DEMOS[demo]) startDemo(DEMOS[demo]());
// ?at=12 runs the first 12 seconds at once, at 60 frames a second, before drawing anything.
const at = Math.min(120, Number(params.get('at')) || 0);
for (let t = 0; t < at; t += 1 / 60) advance(1 / 60, performance.now());
if (at) sweepFrom = -1;
await openShared();
last = performance.now();
requestAnimationFrame(frame);
