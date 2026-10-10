// The display maths that can be checked without a browser: the layout worked out from each
// engine, the build-up, the needle springs and the firing pulses.

import test from 'node:test';
import assert from 'node:assert/strict';

import { ENGINES } from '../engines/index.js';
import { niceScale, gaugeLayout, angleOf, lightsLit, START_ANGLE, SWEEP } from '../ui/layout.js';
import { createDevelopment, grow, settle, builtShare } from '../ui/development.js';
import { createNeedle, chase, TACH } from '../ui/needle.js';
import { pulses, roughness, tremble } from '../ui/ripple.js';
import { PALETTES, roles, FIXED } from '../ui/palette.js';
import { DEMOS } from '../ui/demos.js';
import { checkScript, replay } from '../sim/replay.js';

const near = (a, b, tolerance) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${a} is not within ${tolerance} of ${b}`);

test('a tidy scale: steps of 1, 2, 2.5 or 5 times a power of ten, six to ten of them', () => {
  assert.deepEqual(niceScale(9300), { max: 10000, step: 1000, minor: 200 });
  assert.deepEqual(niceScale(10200), { max: 12000, step: 2000, minor: 500 });
  // 216: steps of 20 give 11, of 50 give 5 - only 25 fits.
  assert.equal(niceScale(216).step, 25);
  for (const limit of [7, 63, 155, 999, 8300, 12345]) {
    const s = niceScale(limit);
    const majors = s.max / s.step;
    assert.ok(majors >= 6 && majors <= 10 && s.max >= limit, `${limit}: ${JSON.stringify(s)}`);
  }
});

test('every engine gets its own gauges, laid out from its own figures', () => {
  const layouts = ENGINES.map(gaugeLayout);
  for (const [i, l] of layouts.entries()) {
    const e = ENGINES[i];
    assert.ok(l.tach.max >= e.overRevRpm, `${e.label} tach stops short of its over-rev`);
    assert.ok(l.speed.max >= e.gearing.topSpeed * 2.23694, `${e.label} speedo stops short`);
    assert.equal(l.lights, e.cylinders);
    assert.equal(l.tach.redline, e.redlineRpm);
  }
  // A V4's dial and a V12's are not the same dial.
  assert.notDeepEqual([layouts[0].tach.max, layouts[0].tach.step], [layouts[4].tach.max, layouts[4].tach.step]);
  assert.notEqual(layouts[0].speed.max, layouts[4].speed.max);
});

test('the dial runs 270 degrees from half past seven, and clamps at its ends', () => {
  const scale = { max: 8000 };
  near(angleOf(scale, 0), START_ANGLE, 1e-12);
  near(angleOf(scale, 8000), START_ANGLE + SWEEP, 1e-12);
  near(angleOf(scale, 4000), START_ANGLE + SWEEP / 2, 1e-12);
  near(angleOf(scale, 9000), START_ANGLE + SWEEP, 1e-12);
  near(angleOf(scale, -50), START_ANGLE, 1e-12);
});

test('the shift lights fill over the last 1500 rpm, one per cylinder', () => {
  const l = { lights: 8 };
  assert.equal(lightsLit(l, 5000, 7000), 0);
  assert.equal(lightsLit(l, 6250, 7000), 4);
  assert.equal(lightsLit(l, 7000, 7000), 8);
});

test('the faces start empty and build where the engine has been, faster under load', () => {
  const l = gaugeLayout(ENGINES[2]);
  const idle = createDevelopment(l);
  assert.equal(builtShare(idle.tach), 0);
  const sample = { running: true, rpm: 3000, load: 0.2, mph: 0, gear: 0, torque: 50 };
  for (let i = 0; i < 3; i++) grow(idle, l, sample, 1 / 60);
  assert.ok(idle.tach[30] > 0, 'the bin it sat in has started');
  assert.ok(idle.tach[29] > 0 && idle.tach[29] < idle.tach[30], 'a little spills to the neighbours');
  assert.equal(idle.tach[60], 0, 'nowhere near the revs it was at');

  const loaded = createDevelopment(l);
  for (let i = 0; i < 3; i++) grow(loaded, l, { ...sample, load: 1 }, 1 / 60);
  assert.ok(loaded.tach[30] > idle.tach[30], 'load builds faster');

  for (let i = 0; i < 60; i++) grow(idle, l, sample, 1 / 60);
  assert.equal(idle.tach[30], 1, 'a second at the same revs finishes that part');
});

test('the redline appears only once reached, and the dyno only records full throttle', () => {
  const e = ENGINES[2];
  const l = gaugeLayout(e);
  const dev = createDevelopment(l);
  grow(dev, l, { running: true, rpm: e.redlineRpm - 100, load: 1, mph: 0, gear: 0, torque: 400 }, 0.1);
  assert.equal(dev.redlineSeen, false);
  grow(dev, l, { running: true, rpm: e.redlineRpm + 50, load: 1, mph: 0, gear: 0, torque: 400 }, 0.1);
  assert.equal(dev.redlineSeen, true);
  assert.ok(dev.redline > 0 && dev.redline < 1, 'and pixelates in over a moment, not at once');

  const bin = Math.round(3000 / l.tach.binSize);
  grow(dev, l, { running: true, rpm: 3000, load: 0.5, mph: 0, gear: 0, torque: 300 }, 0.1);
  assert.equal(dev.dyno[bin], 0, 'part throttle is not a dyno pull');
  grow(dev, l, { running: true, rpm: 3000, load: 0.99, mph: 0, gear: 0, torque: 480 }, 0.1);
  assert.equal(dev.dyno[bin], 480);
});

test('building it all and dissolving reach their ends; the build never goes below nothing', () => {
  const l = gaugeLayout(ENGINES[0]);
  const dev = createDevelopment(l);
  let done = false;
  for (let i = 0; i < 200 && !done; i++) done = settle(dev, 1, 1 / 60);
  assert.ok(done);
  assert.equal(builtShare(dev.tach), 1);
  assert.equal(dev.redline, 1);
  for (let i = 0; i < 200 && !settle(dev, 0, 1 / 60); i++);
  assert.equal(builtShare(dev.speed), 0);
  // A negative time step - a frame stamped before the last clock read - must not un-build.
  grow(dev, l, { running: true, rpm: 3000, load: 0.5, mph: 0, gear: 0, torque: 50 }, -0.5);
  assert.ok(dev.tach.every((d) => d >= 0));
});

test('a needle chases its value, overshoots a hair when underdamped, and settles', () => {
  const n = createNeedle(TACH, 0);
  let peak = 0;
  for (let i = 0; i < 120; i++) peak = Math.max(peak, chase(n, 1, 1 / 60));
  assert.ok(peak > 1 && peak < 1.2, `peak ${peak}`);
  near(n.angle, 1, 1e-3);
  // A long frame is split into small pieces, so it cannot blow up.
  const m = createNeedle(TACH, 0);
  chase(m, 1, 0.5);
  assert.ok(Math.abs(m.angle) < 2);
});

test('more cylinders, smoother: the summed pulses flatten from V4 to V12', () => {
  const r = ENGINES.map((e) => roughness(e.cylinders));
  for (let i = 1; i < r.length; i++) assert.ok(r[i] < r[i - 1], `${ENGINES[i].label} rougher than ${ENGINES[i - 1].label}`);
  const { a, b, sum } = pulses(8, 360);
  let mean = 0;
  for (let i = 0; i < 360; i++) {
    near(sum[i], a[i] + b[i], 1e-6);
    mean += sum[i];
  }
  near(mean / 360, 1, 1e-6);
});

test('the idle tremble is big on a V4, all but gone on a V12, and smaller at speed', () => {
  const v4 = ENGINES[0];
  const v12 = ENGINES[4];
  assert.ok(tremble(v4, v4.idleRpm, 30) > 20);
  assert.ok(tremble(v12, v12.idleRpm, 30) < 3);
  assert.ok(tremble(v4, 4000, 30) < tremble(v4, v4.idleRpm, 30));
  assert.equal(tremble(v4, 0, 30), 0);
});

test('every engine has a palette; the redline and the type never change colour', () => {
  for (const e of ENGINES) {
    assert.ok(PALETTES[e.id], e.id);
    assert.deepEqual(roles(e.id).red, FIXED.red);
    assert.deepEqual(roles(e.id).type, FIXED.type);
  }
  assert.deepEqual(Object.keys(PALETTES).map((k) => PALETTES[k].name),
    ['Cool', 'Neon', 'Warm', 'Cyberpunk', 'Monochrome']);
});

test('the demo drives are valid run logs and end with the engine idling and the car stopped', () => {
  for (const make of DEMOS) {
    const script = make();
    checkScript(script);
    for (const e of [ENGINES[0], ENGINES[4]]) {
      const end = replay(e, null, script);
      assert.equal(end.running, true, `${script.name} on the ${e.label}`);
      assert.ok(Math.abs(end.v) < 0.1, `${script.name} on the ${e.label} still moving`);
    }
  }
});
