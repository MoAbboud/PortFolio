// The car as a whole: pulling away, stalling, wheelspin, engine braking, brakes, top speed
// and the automatic. Each test drives the simulation the way a person would.

import test from 'node:test';
import assert from 'node:assert/strict';

import { ENGINES } from '../engines/index.js';
import { drive, autoZeroToSixty, MPH_60 } from '../tools/measure.js';
import { initialState } from '../sim/step.js';
import { PEDAL_MAX } from '../sim/inputs.js';
import { CHASSIS } from '../sim/chassis.js';
import { overallRatio } from '../sim/gearbox.js';
import { RPM_PER_RAD_S } from '../sim/clock.js';
import { converterTorque } from '../sim/converter.js';
import { airLoad, crankTorque } from '../sim/engine.js';

const byId = (id) => ENGINES.find((e) => e.id === id);
const rpm = (s) => s.we * RPM_PER_RAD_S;
const mph = (s) => s.v * 2.23694;
const r = CHASSIS.wheelRadius;

// Started and settled at idle in neutral, clutch down, so a test can begin from there.
function idling(engine, gearbox = 'manual') {
  const states = drive(engine, {
    gearbox,
    seconds: 4,
    policy: () => (gearbox === 'auto' ? { gear: 'P' } : { clutch: PEDAL_MAX }),
  });
  return states.at(-1);
}

// Rolling in a gear with the clutch gripping, engine running at the matching speed.
function rolling(engine, gear, v, gearbox = 'manual') {
  const G = overallRatio(engine.gearing, gear);
  return {
    ...initialState(engine, null, { gearbox }),
    running: true, load: 0.5, v, ww: v / r, we: (v / r) * G, G, gear, autoGear: gear,
    clutchStuck: true, tyreStuck: true,
  };
}

test('gearing: six ratios, each shorter than the last, top gear at peak power at top speed', () => {
  for (const e of ENGINES) {
    const { ratios, topSpeed, finalDrive } = e.gearing;
    assert.equal(ratios.length, 6);
    for (let i = 1; i < 6; i++) assert.ok(ratios[i] < ratios[i - 1], `${e.label} gear ${i + 1}`);
    // The steps close up toward the top.
    assert.ok(ratios[0] / ratios[1] > ratios[4] / ratios[5], `${e.label} steps should close up`);
    // First gear runs out at about a quarter of top speed.
    const firstAtRedline = (e.redlineRpm / RPM_PER_RAD_S / (ratios[0] * finalDrive)) * r;
    assert.ok(Math.abs(firstAtRedline / topSpeed - 0.25) < 0.01, `${e.label} first gear`);
    for (const up of e.coach.upshiftRpm) assert.ok(up <= e.redlineRpm && up > e.redlineRpm * 0.6);
  }
});

for (const id of ['v4', 'v12']) {
  const engine = byId(id);

  test(`${engine.label}: easing the clutch out with a little throttle pulls away`, () => {
    const states = drive(engine, {
      from: idling(engine),
      seconds: 6,
      policy: (s, t) => ({
        gear: 1,
        thr: 160,
        clutch: Math.round(PEDAL_MAX * Math.max(0, 1 - t / 2)),
      }),
    });
    const end = states.at(-1);
    assert.equal(end.running, true, 'stalled');
    assert.ok(end.v > 2, `only ${end.v} m/s`);
    assert.equal(end.clutchStuck, true, 'clutch still slipping');
    assert.ok(Math.min(...states.map(rpm)) > engine.stallRpm, 'nearly stalled');
  });

  test(`${engine.label}: dropping the clutch at idle stalls it`, () => {
    const states = drive(engine, {
      from: idling(engine),
      seconds: 3,
      policy: () => ({ gear: 1, clutch: 0 }),
    });
    assert.equal(states.at(-1).running, false);
    // Friction fades out over the last few rpm, so a stalled engine still joined to a car that
    // lurched forward comes to rest in a long tail rather than on the dot.
    assert.ok(rpm(states.at(-1)) < 1, `still turning at ${rpm(states.at(-1))} rpm`);
  });

  test(`${engine.label}: stopping in gear without the clutch stalls it`, () => {
    const states = drive(engine, {
      from: rolling(engine, 2, 8),
      seconds: 6,
      policy: () => ({ gear: 2, brake: 600 }),
    });
    assert.equal(states.at(-1).v, 0);
    assert.equal(states.at(-1).running, false);
  });
}

test('wheelspin is slower than grip: a dumped clutch at high revs loses to a fed-in launch', () => {
  const engine = byId('v8');
  const timeTo = (states, v) => states.findIndex((s) => s.v >= v) / 1000;
  const prepare = drive(engine, { from: idling(engine), seconds: 2, policy: () => ({ clutch: PEDAL_MAX, thr: 700 }) });

  const dumped = drive(engine, {
    from: prepare.at(-1), seconds: 5, policy: () => ({ gear: 1, clutch: 0, thr: PEDAL_MAX }),
  });
  // A careful driver: feeds the clutch in and backs off the throttle when the tyres spin.
  const careful = drive(engine, {
    from: prepare.at(-1),
    seconds: 5,
    policy: (s, t) => {
      const spin = s.ww * r - s.v;
      return { gear: 1, clutch: Math.round(PEDAL_MAX * Math.max(0, 0.6 - t)), thr: spin > 0.8 ? 250 : PEDAL_MAX };
    },
  });

  const spun = dumped.filter((s) => !s.tyreStuck).length / 1000;
  assert.ok(spun > 0.5, `only ${spun} s of wheelspin`);
  assert.ok(timeTo(careful, 15) < timeTo(dumped, 15),
    `careful ${timeTo(careful, 15)} s, dumped ${timeTo(dumped, 15)} s`);
});

test('engine braking slows the car in gear and not in neutral', () => {
  const engine = byId('v8');
  const lift = (gear) => drive(engine, {
    from: rolling(engine, 4, 25), seconds: 3, policy: () => ({ gear }),
  }).at(-1).v;
  const inGear = lift(4);
  const inNeutral = lift(0);
  assert.ok(inGear < inNeutral - 1, `in gear ${inGear}, in neutral ${inNeutral}`);
});

test('a braked car stays exactly where it is, in neutral and against the automatic\'s creep', () => {
  for (const gearbox of ['manual', 'auto']) {
    const engine = byId('v8');
    const states = drive(engine, {
      from: idling(engine, gearbox),
      seconds: 5,
      policy: () => (gearbox === 'auto' ? { gear: 'D', brake: 300 } : { gear: 0, brake: 300 }),
    });
    assert.ok(states.every((s) => s.v === 0), `${gearbox} moved`);
    assert.equal(states.at(-1).running, true);
  }
});

test('top speed is where peak power meets drag, within 1 percent', () => {
  for (const id of ['v4', 'v12']) {
    const engine = byId(id);
    const start = engine.gearing.topSpeed * 0.97;
    const states = drive(engine, {
      from: rolling(engine, 6, start), seconds: 120, policy: () => ({ gear: 6, thr: PEDAL_MAX }),
    });
    const v = states.at(-1).v;
    assert.ok(Math.abs(v / engine.gearing.topSpeed - 1) < 0.01,
      `${engine.label} reached ${v} m/s against ${engine.gearing.topSpeed}`);
  }
});

test('the automatic creeps in Drive at walking pace and holds it', () => {
  for (const e of ENGINES) {
    const states = drive(e, { from: idling(e, 'auto'), seconds: 12, policy: () => ({ gear: 'D' }) });
    const end = mph(states.at(-1));
    assert.ok(end > 1.5 && end < 8, `${e.label} creeps at ${end} mph`);
    assert.ok(Math.abs(mph(states.at(-1)) - mph(states.at(-2000))) < 0.2, `${e.label} still gathering speed`);
  }
});

test('the automatic does not hunt between gears at a steady throttle', () => {
  const engine = byId('v8');
  const states = drive(engine, { from: idling(engine, 'auto'), seconds: 40, policy: () => ({ gear: 'D', thr: 200 }) });
  const last = states.slice(-15000);
  const shifts = last.filter((s, i) => i > 0 && s.gear !== last[i - 1].gear).length;
  assert.equal(shifts, 0);
});

test('the automatic kicks down two gears or more when floored at cruise', () => {
  const engine = byId('v8');
  const cruising = rolling(engine, 5, 25, 'auto');
  const states = drive(engine, {
    from: cruising, seconds: 1, policy: () => ({ gear: 'D', thr: PEDAL_MAX }),
  });
  assert.ok(states.at(-1).gear <= 3, `still in ${states.at(-1).gear}`);
});

test('the converter\'s stall speed: with the turbine held, what it takes equals what the engine makes', () => {
  for (const e of ENGINES) {
    const takes = converterTorque(e.auto.converter, e.auto.stallRpm, 0).pump;
    const makes = crankTorque(e, airLoad(e, 1, e.auto.stallRpm), e.auto.stallRpm, true);
    assert.ok(Math.abs(takes / makes - 1) < 0.01, `${e.label}: takes ${takes}, makes ${makes}`);
    // Below the stall speed the engine wins and revs up; above it the converter wins.
    const below = e.auto.stallRpm * 0.9;
    assert.ok(converterTorque(e.auto.converter, below, 0).pump < crankTorque(e, airLoad(e, 1, below), below, true));
  }
});

test('flat out against the brakes: the car stays put, and traction control reins in the spin', () => {
  // The brakes hold the car body, as the front brakes hold a real one. With this much torque
  // multiplied through first gear the rear tyres spin in place - a brake stand - and traction
  // control holds the spin near the point where the tyres still grip.
  for (const e of ENGINES) {
    const states = drive(e, {
      from: idling(e, 'auto'), seconds: 4, policy: () => ({ gear: 'D', brake: PEDAL_MAX, thr: PEDAL_MAX }),
    });
    assert.ok(states.every((s) => s.v === 0), `${e.label} moved`);
    const spin = states.slice(-1000).map((s) => s.ww * r);
    const mean = spin.reduce((a, b) => a + b, 0) / spin.length;
    assert.ok(mean > 0.3 && mean < 2, `${e.label} spins at ${mean} m/s`);
    assert.equal(states.at(-1).running, true);
  }
});

test('reverse goes backwards, and Park holds but will not engage at speed', () => {
  const engine = byId('v8');
  const back = drive(engine, { from: idling(engine, 'auto'), seconds: 4, policy: () => ({ gear: 'R', thr: 150 }) });
  assert.ok(back.at(-1).v < -1);

  const parked = drive(engine, { from: idling(engine, 'auto'), seconds: 3, policy: () => ({ gear: 'P', thr: 400 }) });
  assert.ok(parked.every((s) => s.v === 0));

  const moving = rolling(engine, 2, 10, 'auto');
  const tooFast = drive(engine, { from: moving, seconds: 0.5, policy: () => ({ gear: 'P' }) });
  assert.ok(tooFast.at(-1).v > 8, 'the parking pawl engaged at speed');
});

test('0 to 60 in the automatic is quicker the more power there is to put down', () => {
  const times = ENGINES.map(autoZeroToSixty);
  for (const t of times) assert.ok(t > 3 && t < 8, `${t} s`);
  // The V4 is power-limited; the others are mostly grip-limited, so they bunch together.
  assert.ok(times[0] > Math.max(...times.slice(1)) + 0.5);
  assert.ok(MPH_60 > 26.8 && MPH_60 < 26.83);
});

test('with the engine off and nothing pressed, a rolling car only ever loses energy', () => {
  const engine = byId('v8');
  const states = drive(engine, {
    from: { ...initialState(engine, null), v: 20, ww: 20 / r, tyreStuck: true }, seconds: 20, policy: () => ({}),
  });
  for (let i = 1; i < states.length; i++) assert.ok(states[i].v <= states[i - 1].v);
  assert.ok(states.at(-1).v > 0 && states.at(-1).v < 20);
});
