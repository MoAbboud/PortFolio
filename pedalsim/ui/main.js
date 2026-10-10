// The page: one engine at a time, its gauges built by running it.
//
// Stage 3: the page plays scripted drives through the simulation in real time. Driving it
// yourself - keyboard, pointer, the pedals and the stick - is stage 4.

import { ENGINES } from '../engines/index.js';
import { initialState, step, DT, SIM_VERSION } from '../sim/step.js';
import { emptyInputs, applyEvent } from '../sim/inputs.js';
import { crankTorque, airLoad } from '../sim/engine.js';
import { RPM_PER_RAD_S } from '../sim/clock.js';
import { gaugeLayout, lightsLit } from './layout.js';
import { roles, rgb, PALETTES } from './palette.js';
import { createDevelopment, grow, settle, builtShare } from './development.js';
import { tremble } from './ripple.js';
import { Gauge } from './gauge.js';
import { EngineLines } from './lines.js';
import { Dyno } from './dyno.js';
import { TACH, SPEEDO } from './needle.js';
import { DEMOS } from './demos.js';

document.documentElement.dataset.sim = String(SIM_VERSION);

const MAX_STEPS_PER_FRAME = 250; // a background tab does not try to catch up a minute at once
const SWEEP_SECONDS = 1.2; // the key-on needle sweep
const MPH = 2.23694;
const $ = (id) => document.getElementById(id);

const tach = new Gauge($('tach'), 'tach', TACH);
const speed = new Gauge($('speed'), 'speed', SPEEDO);
const lines = new EngineLines($('lines'));
const dyno = new Dyno($('dyno'));
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

let index = 0;
let engine;
let layout;
let colours;
const developments = new Map(); // per engine, for as long as the page is open
let dev;
let mode = 'normal'; // 'normal', 'dissolving' (to the next engine), 'building' (build it all)
let pendingIndex = null;
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

function loadEngine(i) {
  index = i;
  engine = ENGINES[i];
  layout = gaugeLayout(engine);
  colours = roles(engine.id);
  if (!developments.has(engine.id)) developments.set(engine.id, createDevelopment(layout));
  dev = developments.get(engine.id);
  tach.setEngine(layout.tach, colours, colours.needle);
  speed.setEngine(layout.speed, colours, colours.speed);
  lines.setEngine(engine, colours);
  // The dyno's scale: the engine's real full-throttle peaks, from the same sums a bench uses.
  let peakTorque = 0;
  let peakKw = 0;
  for (let r = 1000; r <= engine.redlineRpm; r += 100) {
    const t = crankTorque(engine, airLoad(engine, 1, r), r, true);
    peakTorque = Math.max(peakTorque, t);
    peakKw = Math.max(peakKw, (t * r) / RPM_PER_RAD_S / 1000);
  }
  dyno.setEngine(layout.tach, colours, peakTorque, peakKw);
  stopDemo();
  awake = false;
  state = initialState(engine, null);
  paintChrome();
  if (reduceMotion) mode = 'building';
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
  if (mode === 'dissolving') return;
  pendingIndex = (index + by + ENGINES.length) % ENGINES.length;
  mode = 'dissolving';
  stopDemo();
}

function startDemo(make) {
  const script = make();
  player = { script, next: 0 };
  state = initialState(engine, null, { gearbox: script.gearbox });
  inputs = emptyInputs();
  sweepFrom = performance.now();
  awake = true;
  $('playing').textContent = script.name;
}

function stopDemo() {
  player = null;
  inputs = emptyInputs();
  $('playing').textContent = '';
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
      if (state.step >= steps) stopDemo();
    }
    state = step(engine, null, state, inputs);
    carry -= DT;
  }
}

// Everything that moves with time but draws nothing: the simulation, and the build-up.
function advance(dt) {
  simulate(dt);
  const rpm = Math.max(0, state.we * RPM_PER_RAD_S);
  const mph = state.v * MPH;
  const torque = crankTorque(engine, state.load, rpm, state.running && !state.cut);
  if (mode === 'dissolving') {
    if (settle(dev, 0, dt)) {
      loadEngine(pendingIndex);
      pendingIndex = null;
      mode = 'normal';
    }
  } else if (mode === 'building') {
    if (settle(dev, 1, dt)) mode = 'normal';
  } else {
    grow(dev, layout, { running: state.running, rpm, load: state.load, mph, gear: state.gear, torque }, dt);
  }
  return { rpm, mph, torque };
}

function frame(now) {
  // A frame's timestamp is when the frame began, which can be before the last time the script
  // read the clock - so the first step can come out negative. Time does not run backwards here.
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
  last = now;
  const { rpm, mph, torque } = advance(dt);

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
  const marks = layout.tach.shiftMarks.filter((_, g) => dev.shiftSeen[g])
    .filter((r, i, all) => all.indexOf(r) === i);
  tach.draw({ value: rpmShown, dt, bins: dev.tach, mean: builtShare(dev.tach), eventLevel: dev.redline,
    time, marks, needle: awake });
  speed.draw({ value: mphShown, dt, bins: dev.speed, mean: builtShare(dev.speed), time, needle: awake });

  if (state.gear !== lastGear || (state.cut && !lastCut)) lines.bump();
  lastGear = state.gear;
  lastCut = state.cut;
  lines.draw({ rpm, load: state.load, running: state.running, dt, holes: gaugeHoles() });
  dyno.draw({ dyno: dev.dyno, rpm, torque });

  const shiftAt = state.gear >= 1 && state.gear <= 5 ? layout.tach.shiftMarks[state.gear - 1] : engine.redlineRpm;
  const lit = lightsLit(layout, rpm, shiftAt);
  const flash = rpm >= shiftAt && Math.floor(now / 80) % 2 === 0;
  $('lights').querySelectorAll('i').forEach((el, i) => {
    el.className = i < lit ? (flash ? 'flash' : 'on') : '';
  });
  $('gear').textContent = gearLabel();
  $('readout').textContent = `${Math.round(rpm)} rpm  ${Math.abs(mph).toFixed(0)} mph`;
  requestAnimationFrame(frame);
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
$('build').addEventListener('click', () => { if (mode === 'normal') mode = 'building'; });
$('stop').addEventListener('click', () => {
  stopDemo();
  awake = false;
  state = initialState(engine, null);
});
DEMOS.forEach((make, i) => $(`demo${i}`).addEventListener('click', () => startDemo(make)));
window.addEventListener('keydown', (e) => {
  if (e.key === ']') cycle(1);
  if (e.key === '[') cycle(-1);
});
window.addEventListener('resize', resize);

// Paint the faces only once the fonts have arrived, or the numerals are drawn in a fallback
// face. A font used only inside a canvas is never fetched unless asked for.
try {
  await Promise.all([document.fonts.load('40px "Boldonse"'), document.fonts.load('italic 40px "Bodoni Moda"')]);
} catch {
  // No font loading API, or the fonts failed: the fallbacks in ui/face.js are used.
}
document.documentElement.dataset.fonts = document.fonts?.check('40px "Boldonse"') ? 'loaded' : 'fallback';

// The address can choose the engine and start a drive: ?engine=v12&demo=1. Handy for sharing
// a drive, and for screenshots of the page part-way through one.
const params = new URLSearchParams(location.search);
const wanted = ENGINES.findIndex((e) => e.id === params.get('engine'));
loadEngine(wanted >= 0 ? wanted : 0);
resize();
const demo = Number(params.get('demo'));
if (params.has('demo') && DEMOS[demo]) startDemo(DEMOS[demo]);
if (params.get('build') === '1') mode = 'building';
// ?at=12 runs the first 12 seconds at once, at 60 frames a second, before drawing anything.
const at = Math.min(120, Number(params.get('at')) || 0);
for (let t = 0; t < at; t += 1 / 60) advance(1 / 60);
if (at) sweepFrom = -1;
last = performance.now();
requestAnimationFrame(frame);
