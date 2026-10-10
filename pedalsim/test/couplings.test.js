// The stick-or-slip chain on its own, with numbers small enough to check by hand.

import test from 'node:test';
import assert from 'node:assert/strict';

import { advance } from '../sim/couplings.js';

const near = (a, b, tolerance = 1e-9) =>
  assert.ok(Math.abs(a - b) <= tolerance, `${a} is not within ${tolerance} of ${b}`);

const ROAD = { inertia: Infinity, vel: 0, force: 0 };

test('two bodies that grip move as one, and the joint carries what that takes', () => {
  // 10 N on a 1 kg body joined to a 4 kg body: both accelerate at 2 m/s^2, and the joint
  // passes 8 N to the second - within its 20 N grip, so it holds.
  const out = advance(
    [{ inertia: 1, vel: 0, force: 10 }, { inertia: 4, vel: 0, force: 0 }],
    [{ k: 1, static: 20, kinetic: 20, stuck: true }],
    0.001,
  );
  assert.equal(out.stuck[0], true);
  near(out.acc[0], 2);
  near(out.acc[1], 2);
  near(out.lambda[0], 8);
});

test('asked for more than it can hold, a joint slips and passes only its sliding force', () => {
  // The same push, but the joint holds only 5 N. It lets go: the second body gets 4 N
  // (1 m/s^2), the first keeps 10 - 4 = 6 N (6 m/s^2).
  const out = advance(
    [{ inertia: 1, vel: 0, force: 10 }, { inertia: 4, vel: 0, force: 0 }],
    [{ k: 1, static: 5, kinetic: 4, stuck: true }],
    0.001,
  );
  assert.equal(out.stuck[0], false);
  near(out.acc[0], 6);
  near(out.acc[1], 1);
});

test('a ratio between the bodies works like a gear', () => {
  // Body 0 turns 3 times as fast as body 1. Sticking, their speeds stay in that ratio.
  let bodies = [{ inertia: 0.2, vel: 30, force: 5 }, { inertia: 2, vel: 10, force: 0 }];
  for (let i = 0; i < 1000; i++) {
    const out = advance(bodies, [{ k: 3, static: 1000, kinetic: 1000, stuck: true }], 0.001);
    bodies = bodies.map((b, j) => ({ ...b, vel: out.vel[j] }));
  }
  near(bodies[0].vel, 3 * bodies[1].vel, 1e-9);
  // Effective inertia at body 1: 2 + 0.2 * 3^2 = 3.8; torque there 3 * 5 = 15; one second.
  near(bodies[1].vel, 10 + 15 / 3.8, 1e-6);
});

test('slipping sides that pass each other lock, keeping their momentum', () => {
  // A fast light body dragged by friction against a slow heavy one. When their speeds meet
  // they lock at the speed that conserves momentum - not chattering across each other.
  let bodies = [{ inertia: 1, vel: 10, force: 0 }, { inertia: 9, vel: 0, force: 0 }];
  const momentum = 10;
  let stuck = false;
  for (let i = 0; i < 5000 && !stuck; i++) {
    const out = advance(bodies, [{ k: 1, static: 50, kinetic: 50, stuck }], 0.001);
    bodies = bodies.map((b, j) => ({ ...b, vel: out.vel[j] }));
    stuck = out.stuck[0];
  }
  assert.equal(stuck, true);
  near(bodies[0].vel, bodies[1].vel, 1e-12);
  near(bodies[0].vel * 1 + bodies[1].vel * 9, momentum, 1e-9);
  near(bodies[0].vel, 1, 1e-9);
});

test('a body held to the road by brakes stays put while the push is within the brakes', () => {
  const out = advance(
    [{ inertia: 1000, vel: 0, force: 300 }, ROAD],
    [{ k: 1, static: 500, kinetic: 500, stuck: true }],
    0.001,
  );
  assert.equal(out.stuck[0], true);
  assert.equal(out.vel[0], 0);
  near(out.lambda[0], 300);
});

test('a joint with no grip never sticks and passes nothing', () => {
  const out = advance(
    [{ inertia: 1, vel: 0, force: 10 }, { inertia: 1, vel: 0, force: 0 }],
    [{ k: 0, static: 0, kinetic: 0, stuck: true }],
    0.001,
  );
  assert.equal(out.stuck[0], false);
  near(out.acc[0], 10);
  near(out.acc[1], 0);
});

test('the full chain: an overloaded middle joint lets go while the others hold', () => {
  // engine - clutch - wheel - tyre - car - brake - road, with the tyre too weak for the push.
  const bodies = [
    { inertia: 0.3, vel: 0, force: 500 },
    { inertia: 2, vel: 0, force: 0 },
    { inertia: 1500, vel: 0, force: 0 },
    ROAD,
  ];
  const joints = [
    { k: 10, static: 1e6, kinetic: 1e6, stuck: true },
    { k: 1 / 0.33, static: 100, kinetic: 80, stuck: true },
    { k: 1, static: 0, kinetic: 0, stuck: false },
  ];
  const out = advance(bodies, joints, 0.001);
  assert.deepEqual(out.stuck, [true, false, false]);
  assert.ok(out.acc[1] > 0 && out.acc[2] > 0);
  // The car is pushed by the tyre's sliding grip alone: 80 Nm over 0.33 m on 1500 kg.
  near(out.acc[2], 80 / 0.33 / 1500, 1e-9);
});
