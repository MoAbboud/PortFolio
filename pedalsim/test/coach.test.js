// The shift coach's advice and the H-pattern's geometry.

import test from 'node:test';
import assert from 'node:assert/strict';

import { ENGINES } from '../engines/index.js';
import { coach, rpmInGear } from '../ui/coach.js';
import { project, gearAt, positionOf, sequential, IN_GEAR } from '../input/stick.js';

const v8 = ENGINES.find((e) => e.id === 'v8');
const base = { gear: 3, rpm: 3000, v: 20, thr: 0, brake: 0, clutch: 0, want: 3 };
const ask = (over) => coach(v8, { ...base, ...over });

// The speed at which a gear turns the engine at an rpm, so a test's revs and speed agree.
const speedAt = (rpm, gear) => (20 * rpm) / rpmInGear(v8, 20, gear);

test('up at the shift point when the foot is down', () => {
  const at = v8.coach.upshiftRpm[2];
  assert.equal(ask({ rpm: at, v: speedAt(at, 3), thr: 1 }).arrow, 'up');
  assert.equal(ask({ rpm: at, v: speedAt(at, 3), thr: 1 }).reason, 'shift point');
  // A thousand short, and second would over-rev: nothing to do but keep pulling.
  assert.equal(ask({ rpm: at - 1000, v: speedAt(at - 1000, 3), thr: 1 }).arrow, null);
  assert.equal(ask({ gear: 6, rpm: v8.redlineRpm, v: speedAt(v8.redlineRpm, 6), thr: 1 }).arrow, null, 'no seventh gear');
});

test('up early for economy with a light foot, but not if the next gear would lug', () => {
  assert.equal(ask({ rpm: 3500, thr: 0.2, v: 30 }).reason, 'economy');
  // At a crawl, the next gear would put the engine near idle: stay.
  assert.equal(ask({ rpm: 3500, thr: 0.2, v: 3 }).arrow, null);
});

test('down when lugging, for speed, and when braking in too tall a gear', () => {
  assert.equal(ask({ rpm: 900, thr: 0.6, v: 8 }).reason, 'lugging');
  // Flat out at a speed where the gear below has room to rev.
  assert.equal(ask({ gear: 4, rpm: 3200, thr: 1, v: 25 }).reason, 'for speed');
  assert.equal(ask({ gear: 6, rpm: 1200, brake: 0.5, v: 10, thr: 0 }).reason, 'braking');
  assert.equal(ask({ gear: 1, rpm: 900, thr: 0.6, v: 3 }).arrow, null, 'nothing below first');
});

test('with the clutch down, the revs the chosen gear needs', () => {
  const advice = ask({ clutch: 1, want: 2, v: 20 });
  assert.equal(advice.matchGear, 2);
  assert.ok(Math.abs(advice.matchRpm - rpmInGear(v8, 20, 2)) < 1e-9);
  assert.ok(rpmInGear(v8, 20, 2) > rpmInGear(v8, 20, 3), 'a lower gear needs more revs');
  assert.equal(ask({ clutch: 0, want: 2 }).matchRpm, null, 'clutch up: nothing to match');
  assert.equal(ask({ clutch: 1, want: 2, v: 0.5 }).matchRpm, null, 'standing still: nothing to match');
});

test('the knob only goes where the gates let it', () => {
  // Between two gates, off the rail: pulled onto the nearest line.
  const p = project(1.5, -0.8);
  assert.ok(p.y === 0 || p.x === 1 || p.x === 2, JSON.stringify(p));
  // Below reverse there is no slot.
  assert.equal(project(0, 0.9).y, 0);
  // Off the ends of the rail.
  assert.deepEqual(project(5, 0), { x: 3, y: 0 });
});

test('each gate is the gear it should be, and neutral is the rail', () => {
  assert.equal(gearAt({ x: 0, y: -1 }), -1);
  assert.equal(gearAt({ x: 1, y: -1 }), 1);
  assert.equal(gearAt({ x: 1, y: 1 }), 2);
  assert.equal(gearAt({ x: 3, y: 1 }), 6);
  assert.equal(gearAt({ x: 2, y: 0 }), 0);
  assert.equal(gearAt({ x: 2, y: IN_GEAR - 0.01 }), 0, 'not far enough in to ask');
  for (const g of [-1, 1, 2, 3, 4, 5, 6]) assert.equal(gearAt(positionOf(g)), g);
});

test('sequential shifting goes through neutral and stops at the ends', () => {
  assert.equal(sequential(0, 1), 1);
  assert.equal(sequential(1, -1), 0);
  assert.equal(sequential(0, -1), -1);
  assert.equal(sequential(6, 1), 6);
  assert.equal(sequential(-1, -1), -1);
});
