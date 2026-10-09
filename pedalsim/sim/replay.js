// Drive the simulation from a list of input changes.
//
// A script is the same shape as a run log: how many steps to run, which gearbox ('manual',
// the default, or 'auto'), and the events - each a step number, a channel and a value - in
// step order. Events at step n are applied before
// step n is taken. tools/drive.js uses this today; the ghost needle, the perfect-run
// solver and opening a share link will all use it later, which is why it lives in sim/.

import { initialState, step } from './step.js';
import { emptyInputs, applyEvent } from './inputs.js';

export function checkScript(script) {
  if (!script || typeof script !== 'object') throw new Error('a script is an object');
  const { steps, events } = script;
  if (!Number.isInteger(steps) || steps < 0) throw new Error('steps must be a whole number');
  if (!Array.isArray(events)) throw new Error('events must be a list');
  let last = 0;
  events.forEach((event, i) => {
    if (!Array.isArray(event) || event.length !== 3) {
      throw new Error(`event ${i} is not [step, channel, value]`);
    }
    const [at] = event;
    // An event at or after the last step could never take effect.
    if (!Number.isInteger(at) || at < 0 || at >= steps) {
      throw new Error(`event ${i} is at step ${at}, outside 0 to ${steps - 1}`);
    }
    // Out of order would still replay, but a log that is out of order was not written by
    // the recorder, and it is better to find that out than to guess what was meant.
    if (at < last) throw new Error(`event ${i} at step ${at} comes after step ${last}`);
    last = at;
  });
}

// Runs the script and returns the final state. onStep, if given, is called after every
// step with (state, inputs) - for tracing, or for a ghost that is drawn as it goes.
export function replay(engine, chassis, script, onStep) {
  checkScript(script);
  let state = initialState(engine, chassis, { gearbox: script.gearbox });
  let inputs = emptyInputs();
  let next = 0;
  const { events, steps } = script;

  for (let n = 0; n < steps; n++) {
    while (next < events.length && events[next][0] === n) {
      const [, channel, value] = events[next];
      inputs = applyEvent(inputs, channel, value);
      next += 1;
    }
    state = step(engine, chassis, state, inputs);
    if (onStep) onStep(state, inputs);
  }
  return state;
}
