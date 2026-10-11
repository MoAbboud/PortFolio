// The controls' rules, without a browser: how a pedal moves, and what the lever allows.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createPedal, rampPedal, pedalPosition, dragPosition, RATES } from '../input/pedals.js';
import { moveLever, notch } from '../input/lever.js';
import { quantise, PEDAL_MAX } from '../sim/inputs.js';

const near = (a, b, tolerance = 1e-9) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${a} is not within ${tolerance} of ${b}`);

const hold = (pedal, seconds, gentle = false) => {
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) rampPedal(pedal, 1 / 60, gentle);
  return pedal;
};

test('a held key ramps the pedal to the floor; a tap is only a little', () => {
  const p = createPedal('thr');
  p.held = true;
  hold(p, 0.1);
  near(p.key, 0.25, 0.02); // 2.5 a second: a tenth of a second is a quarter of the pedal
  hold(p, 1);
  assert.equal(p.key, 1);
  p.held = false;
  hold(p, 0.1);
  near(p.key, 0.6, 0.02); // released at 4 a second
  hold(p, 1);
  assert.equal(p.key, 0);
});

test('Shift makes the pedals gentler: half the rate both ways', () => {
  const quick = createPedal('thr');
  const gentle = createPedal('thr');
  quick.held = true;
  gentle.held = true;
  hold(quick, 0.2);
  hold(gentle, 0.2, true);
  near(gentle.key, quick.key / 2, 0.01);
});

test('the clutch comes up slowly and goes down fast, so a keyboard can find the bite', () => {
  assert.ok(RATES.clutch.release < RATES.clutch.press);
  assert.ok(RATES.clutch.release < RATES.thr.release);
});

test('whatever presses hardest wins: keyboard, pointer or controller', () => {
  const p = createPedal('brake');
  p.key = 0.2;
  assert.equal(pedalPosition(p), 0.2);
  p.pointer = 0.7;
  assert.equal(pedalPosition(p), 0.7);
  p.pad = 0.9;
  assert.equal(pedalPosition(p), 0.9);
  p.pointer = null;
  p.pad = 0;
  assert.equal(pedalPosition(p), 0.2);
});

test('pressed along a pedal: the top is nothing, the bottom is all of it', () => {
  assert.equal(dragPosition(100, 100, 200), 0);
  assert.equal(dragPosition(100, 200, 200), 0.5);
  assert.equal(dragPosition(100, 300, 200), 1);
  assert.equal(dragPosition(100, 350, 200), 1);
  assert.equal(dragPosition(100, 50, 200), 0);
});

test('what the simulation sees is the pedal rounded once to a whole number', () => {
  const p = createPedal('thr');
  p.pointer = 0.333;
  assert.equal(quantise(pedalPosition(p)), Math.round(0.333 * PEDAL_MAX));
});

test('leaving Park needs the brake', () => {
  assert.deepEqual(moveLever('P', 'D', { brake: 0, speed: 0 }).gear, 'P');
  assert.match(moveLever('P', 'D', { brake: 0, speed: 0 }).refused, /brake/);
  assert.equal(moveLever('P', 'D', { brake: 0.5, speed: 0 }).gear, 'D');
  // Within the other positions the brake is not needed.
  assert.equal(moveLever('D', 'N', { brake: 0, speed: 10 }).gear, 'N');
  assert.equal(moveLever('N', 'D', { brake: 0, speed: 10 }).gear, 'D');
});

test('Park and Reverse wait until the car has all but stopped', () => {
  assert.equal(moveLever('D', 'P', { brake: 1, speed: 8 }).gear, 'D');
  assert.match(moveLever('D', 'P', { brake: 1, speed: 8 }).refused, /stop before Park/);
  assert.equal(moveLever('D', 'R', { brake: 1, speed: -8 }).gear, 'D');
  assert.equal(moveLever('D', 'P', { brake: 1, speed: 0.5 }).gear, 'P');
  assert.equal(moveLever('D', 'R', { brake: 0, speed: 0 }).gear, 'R');
});

test('the lever moves a notch at a time and stops at its ends', () => {
  assert.equal(notch('P', 1), 'R');
  assert.equal(notch('N', 1), 'D');
  assert.equal(notch('D', 1), 'D');
  assert.equal(notch('P', -1), 'P');
  assert.equal(moveLever('D', 'X', { brake: 0, speed: 0 }).gear, 'D');
});
