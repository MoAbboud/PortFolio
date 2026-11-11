// The stored perfect runs: each still replays to its stored time, is clean, is current with the
// simulation and the engine, and was driven within the human limits tools/solve.js promises.
//
// If one fails after an intended change to the simulation or an engine, re-solve:
//   node tools/solve.js

import test from 'node:test';
import assert from 'node:assert/strict';

import { ENGINES } from '../engines/index.js';
import { PERFECT } from '../engines/perfect/index.js';
import { replay } from '../sim/replay.js';
import { createWatch, GO_STEP, START_GEAR } from '../sim/sixty.js';
import { PEDAL_MAX } from '../sim/inputs.js';
import { RATES } from '../input/pedals.js';
import { TICK, clutchFree, driveRun, stale, startingPoint } from '../tools/solve.js';

const RESOLVE = 'run node tools/solve.js';

for (const engine of ENGINES) {
  const perfect = PERFECT[engine.id];

  test(`${engine.label}: a perfect run is stored, for this simulation and this engine`, () => {
    assert.ok(perfect, `no perfect run for ${engine.id}: ${RESOLVE}`);
    assert.equal(stale(engine, perfect), null, `${engine.id}'s perfect run is stale: ${RESOLVE}`);
    assert.equal(perfect.gearbox, 'manual');
    assert.equal(perfect.tractionControl, false);
  });

  test(`${engine.label}: the perfect run replays to its stored time, clean, from first`, () => {
    const watch = createWatch();
    const end = replay(engine, null, perfect.log, (state) => watch.see(state));
    const r = watch.result();
    assert.equal(r.time, perfect.time, `${engine.id} replays to ${r.time}, stored ${perfect.time}: ${RESOLVE}`);
    assert.equal(r.clean, true);
    assert.equal(r.startGear, START_GEAR);
    // The log stops on the step the car passes 60 mph.
    assert.equal(watch.done, true);
    assert.equal(end.step, perfect.log.steps);
  });

  test(`${engine.label}: the perfect driver is no quicker than the keyboard`, () => {
    const free = clutchFree(engine);
    // Pedals move by whole numbers, rounded once per change: allow one count for the rounding.
    const most = (rate) => Math.ceil((rate * TICK * PEDAL_MAX) / 1000) + 1;
    let before = null; // the state the inputs were chosen from
    let last = null; // the inputs the tick before
    const broken = [];
    replay(engine, null, perfect.log, (state, inputs) => {
      const n = state.step - 1; // the step these inputs were applied at
      if (last && (inputs.thr !== last.thr || inputs.clutch !== last.clutch || inputs.gear !== last.gear)) {
        if (n % TICK !== 0) broken.push(`step ${n}: inputs changed between ticks`);
        const moving = Math.abs(before.v) > 2;
        const dThr = inputs.thr - last.thr;
        const dClutch = inputs.clutch - last.clutch;
        if (dThr > most(RATES.thr.press) || -dThr > most(RATES.thr.release)) broken.push(`step ${n}: throttle by ${dThr}`);
        const clutchUp = moving ? RATES.clutch.releaseMoving : RATES.clutch.release;
        if (dClutch > most(RATES.clutch.press) || -dClutch > most(clutchUp)) broken.push(`step ${n}: clutch by ${dClutch}`);
        if (inputs.gear !== last.gear && n >= GO_STEP && inputs.clutch < free) broken.push(`step ${n}: stick moved without the clutch`);
      }
      if (!last || n % TICK === 0) last = inputs;
      before = state;
    });
    assert.deepEqual(broken, []);
  });

  test(`${engine.label}: the search did no worse than where it started`, () => {
    const start = driveRun(engine, startingPoint(engine));
    assert.ok(perfect.time <= start.time, `${perfect.time} against ${start.time}`);
  });
}

test('the search\'s quick runs and its recorded runs agree', () => {
  // The search starts every run from a cached prelude; the stored log is recorded from cold.
  const engine = ENGINES[0];
  const x = startingPoint(engine);
  assert.equal(driveRun(engine, x).time, driveRun(engine, x, { record: true }).time);
});
