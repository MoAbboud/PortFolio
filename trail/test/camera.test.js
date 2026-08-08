import test from 'node:test';
import assert from 'node:assert/strict';

import {
  framingToView, viewProjection, lerpFraming, drift,
  routeAt, routeDuration, easeInOut, ASPECT, autoMove, axesOf,
} from '../lib/camera.js';

const near = (a, b, tolerance = 1e-6) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} is not near ${b}`);

const F = (over = {}) => ({ x: 0, z: 0, w: 10, d: 8, pitch: 25, yaw: 0, ...over });

test('the camera looks at the centre of the rectangle', () => {
  const { target } = framingToView({ x: 4, z: -6, w: 10, d: 8, pitch: 30 });
  assert.deepEqual(target, [9, 0, -2]);
});

test('a steeper pitch puts the camera higher', () => {
  const low = framingToView(F({ pitch: 10 }));
  const high = framingToView(F({ pitch: 70 }));
  assert.ok(high.eye[1] > low.eye[1], 'a higher pitch should raise the eye');
});

test('looking straight down puts the camera directly above', () => {
  const { eye, target } = framingToView(F({ pitch: 90 }));
  near(eye[0], target[0], 1e-9);
  near(eye[2], target[2], 1e-9);
  assert.ok(eye[1] > 0);
});

test('a wider rectangle pushes the camera further away', () => {
  const tight = framingToView(F({ w: 4, d: 4 }));
  const wide = framingToView(F({ w: 40, d: 40 }));
  assert.ok(wide.distance > tight.distance * 5, 'distance should scale with the frame');
});

test('the frame is fitted on whichever axis needs more room', () => {
  // Both axes must be able to drive the distance, so hold one and grow the
  // other. A wider frame and a deeper frame each have to push the camera back.
  const small = framingToView(F({ w: 6, d: 6, pitch: 30 }));
  const wide = framingToView(F({ w: 60, d: 6, pitch: 30 }));
  const deep = framingToView(F({ w: 6, d: 60, pitch: 30 }));
  assert.ok(wide.distance > small.distance * 5, 'width should drive the distance');
  assert.ok(deep.distance > small.distance * 5, 'depth should drive it too');
});

test('a shallower pitch needs less distance for the same depth', () => {
  // Depth is foreshortened by the pitch, so a low camera fits more of it.
  const steep = framingToView(F({ w: 4, d: 60, pitch: 80 }));
  const shallow = framingToView(F({ w: 4, d: 60, pitch: 10 }));
  assert.ok(steep.distance > shallow.distance);
});

test('the aspect ratio is 16:9 and nothing else', () => {
  assert.equal(ASPECT, 16 / 9);
});

test('a view projection is a usable 16-float matrix', () => {
  const { matrix, eye } = viewProjection(F());
  assert.equal(matrix.length, 16);
  assert.ok(matrix.every(Number.isFinite), 'matrix contains a non-finite value');
  assert.ok(eye.every(Number.isFinite));
});

test('easing starts at nothing and ends at everything', () => {
  near(easeInOut(0), 0);
  near(easeInOut(1), 1);
  near(easeInOut(0.5), 0.5, 1e-9);
});

test('a flight begins and ends exactly on its framings', () => {
  const a = F({ x: 0, z: 0, w: 10, d: 8, pitch: 20, y: 0 });
  const b = F({ x: 40, z: 30, w: 6, d: 5, pitch: 50, y: 9 });
  for (const [t, expected] of [[0, a], [1, b]]) {
    const got = lerpFraming(a, b, t);
    for (const key of ['x', 'z', 'w', 'd', 'pitch', 'y']) near(got[key], expected[key], 1e-6);
  }
});

test('a flight climbs between two heights', () => {
  const a = F({ y: 0 });
  const b = F({ x: 30, y: 12 });
  const middle = lerpFraming(a, b, 0.5);
  assert.ok(middle.y > 0 && middle.y < 12, `height did not interpolate: ${middle.y}`);
});

test('drift leaves the height alone', () => {
  const base = F({ y: 7 });
  for (let t = 0; t < 20; t += 1.3) assert.equal(drift(base, t).y, 7);
});

test('a flight arcs outward in the middle, so it lifts over the ground', () => {
  const a = F({ x: 0, z: 0, w: 6, d: 5 });
  const b = F({ x: 30, z: 0, w: 6, d: 5 });
  const middle = lerpFraming(a, b, 0.5);
  assert.ok(middle.w > a.w, 'the mid-flight frame should be wider than either end');
  assert.ok(framingToView(middle).eye[1] > framingToView(a).eye[1], 'and therefore higher');
});

test('a flight keeps its centre on the path between the two shots', () => {
  const a = F({ x: 0, z: 0, w: 10, d: 10 });
  const b = F({ x: 20, z: 0, w: 10, d: 10 });
  const middle = lerpFraming(a, b, 0.5);
  near(middle.x + middle.w / 2, 15, 1e-9); // centres are 5 and 25
});

test('drift moves the shot without moving what it is looking at', () => {
  const base = F({ x: 0, z: 0, w: 10, d: 8 });
  const moved = drift(base, 3.7);
  near(moved.x + moved.w / 2, base.x + base.w / 2, 1e-9);
  near(moved.z + moved.d / 2, base.z + base.d / 2, 1e-9);
  assert.notEqual(moved.yaw, base.yaw, 'drift should actually move something');
});

test('drift stays small enough to be felt rather than noticed', () => {
  const base = F();
  for (let t = 0; t < 60; t += 0.37) {
    const moved = drift(base, t);
    assert.ok(Math.abs(moved.yaw) <= 1.0, `yaw drifted to ${moved.yaw}`);
    assert.ok(Math.abs(moved.w / base.w - 1) < 0.02, 'zoom drift too large');
  }
});

const ROUTE = [
  { framing: F({ x: 0 }), hold: 4000 },
  { framing: F({ x: 20 }), hold: 3000, approachTime: 2000 },
  { framing: F({ x: 40 }), hold: 5000, approachTime: 1000 },
];

test('a route lasts as long as its holds and its flights', () => {
  assert.equal(routeDuration(ROUTE), 4000 + 2000 + 3000 + 1000 + 5000);
});

test('a route holds, then flies, then holds', () => {
  assert.equal(routeAt(ROUTE, 0).phase, 'hold');
  assert.equal(routeAt(ROUTE, 0).step, 0);
  assert.equal(routeAt(ROUTE, 5).phase, 'fly');
  assert.equal(routeAt(ROUTE, 7).phase, 'hold');
  assert.equal(routeAt(ROUTE, 7).step, 1);
});

test('a route reports how far into each phase it is', () => {
  // The weather cross-fade and the canvas solidifying are both driven by this,
  // which is what makes them land together rather than one after the other.
  assert.equal(routeAt(ROUTE, 0).into, 0);
  near(routeAt(ROUTE, 2).into, 0.5, 1e-9);      // halfway through a 4s hold
  near(routeAt(ROUTE, 5).into, 0.5, 1e-9);      // halfway through a 2s flight
  assert.equal(routeAt(ROUTE, 999).into, 1);
});

test('progress through a phase never leaves 0..1', () => {
  const total = routeDuration(ROUTE) / 1000;
  for (let t = 0; t <= total + 2; t += 0.05) {
    const { into } = routeAt(ROUTE, t);
    assert.ok(into >= 0 && into <= 1, `into was ${into} at t=${t}`);
  }
});

test('a route rests on its final framing rather than looping or breaking', () => {
  const end = routeAt(ROUTE, 999);
  assert.equal(end.phase, 'end');
  assert.equal(end.step, ROUTE.length - 1);
  assert.equal(end.framing.x, 40);
});

test('every moment of a route yields a usable camera', () => {
  const total = routeDuration(ROUTE) / 1000;
  for (let t = 0; t <= total; t += 0.05) {
    const { framing } = routeAt(ROUTE, t);
    const { eye, target } = framingToView(framing);
    assert.ok(eye.every(Number.isFinite), `eye went bad at t=${t}`);
    assert.ok(eye[1] > 0, `camera went underground at t=${t}`);
    assert.ok(target.every(Number.isFinite));
  }
});

// --- a move the camera makes on its own --------------------------------------

test('a camera left alone does not move on its own', () => {
  const framing = { x: -5, z: -5, w: 10, d: 10, pitch: 30, yaw: 0 };
  assert.equal(autoMove(framing, 12), framing, 'no move asked for, nothing returned but the same object');
  assert.equal(autoMove(framing, 12, { orbit: 0, push: 0 }), framing);
});

test('orbiting sways either side of where it started rather than drifting off', () => {
  // A camera that orbits all the way round shows the back of everything, and
  // the back of a low-poly model is not what it was made for.
  const framing = { x: -5, z: -5, w: 10, d: 10, pitch: 30, yaw: 40 };
  let lowest = Infinity;
  let highest = -Infinity;
  for (let t = 0; t < 200; t += 0.25) {
    const yaw = autoMove(framing, t, { orbit: 1 }).yaw;
    lowest = Math.min(lowest, yaw);
    highest = Math.max(highest, yaw);
  }
  assert.ok(lowest < 40 && highest > 40, 'it should go both ways from where it started');
  assert.ok(highest - lowest < 40, `it swept ${(highest - lowest).toFixed(0)} degrees, which is a circuit`);
});

test('orbiting turns the framing, so it can never end up underground', () => {
  // The whole reason moves are expressed in the camera language rather than in
  // eye positions: every intermediate state is a framing somebody could draw.
  const framing = { x: -5, z: -5, w: 10, d: 10, pitch: 8, yaw: 0 };
  for (let t = 0; t < 60; t += 0.5) {
    const moved = autoMove(framing, t, { orbit: 1 });
    assert.equal(moved.pitch, 8, 'orbiting must not tilt the camera');
    assert.equal(moved.w, 10, 'nor change what fills the frame');
    const { eye } = framingToView(moved);
    assert.ok(eye[1] > 0, 'the camera went under the ground');
  }
});

test('pushing in closes on the same point rather than sliding off it', () => {
  const framing = { x: 10, z: -4, w: 20, d: 12, pitch: 30, yaw: 0 };
  const centre = [framing.x + framing.w / 2, framing.z + framing.d / 2];
  for (const t of [0, 5, 30, 120]) {
    const moved = autoMove(framing, t, { push: 1 });
    assert.ok(Math.abs(moved.x + moved.w / 2 - centre[0]) < 1e-9, 'it drifted sideways');
    assert.ok(Math.abs(moved.z + moved.d / 2 - centre[1]) < 1e-9, 'it drifted forward');
    assert.ok(moved.w / moved.d - framing.w / framing.d < 1e-9, 'the shape of the frame changed');
  }
});

test('pushing in gets closer over time and then stops, so a long take is safe', () => {
  const framing = { x: 0, z: 0, w: 20, d: 12, pitch: 30, yaw: 0 };
  const widths = [0, 10, 30, 60, 600].map((t) => autoMove(framing, t, { push: 1 }).w);
  for (let i = 1; i < widths.length; i++) {
    assert.ok(widths[i] <= widths[i - 1], 'it should never open back out');
  }
  assert.ok(widths[3] < widths[0], 'and it should actually get closer');
  assert.ok(widths[4] > framing.w * 0.3, 'but never end up inside whatever it is looking at');
});

test('a move is measured from the start of its shot, so a take plays the same twice', () => {
  const framing = { x: 0, z: 0, w: 20, d: 12, pitch: 30, yaw: 0 };
  assert.deepEqual(autoMove(framing, 7, { orbit: 1, push: 1 }),
    autoMove(framing, 7, { orbit: 1, push: 1 }));
});

// --- the camera's own axes ---------------------------------------------------

test('the axes are three perpendicular unit vectors', () => {
  // The sky turns a pixel into a direction with these. A basis that is not
  // square puts the sun somewhere that is not where the sun is.
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  for (const framing of [
    { x: -5, z: -5, w: 10, d: 10, pitch: 25, yaw: 0 },
    { x: 0, z: 0, w: 3, d: 2, pitch: 70, yaw: 130 },
    { x: -60, z: -60, w: 120, d: 120, pitch: 89.9, yaw: -40 },
  ]) {
    const { eye, target } = framingToView(framing);
    const [forward, right, up] = axesOf(eye, target);
    for (const [name, v] of [['forward', forward], ['right', right], ['up', up]]) {
      assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-6, `${name} is not a unit vector`);
    }
    assert.ok(Math.abs(dot(forward, right)) < 1e-6, 'forward and right are not square');
    assert.ok(Math.abs(dot(forward, up)) < 1e-6, 'forward and up are not square');
    assert.ok(Math.abs(dot(right, up)) < 1e-6, 'right and up are not square');
  }
});

test('looking straight down still has a right and an up', () => {
  // Where the view direction and the world's up are the same line there is no
  // side to cross with, and the answer has to be constructed rather than found.
  const [forward, right, up] = axesOf([0, 10, 0], [0, 0, 0]);
  assert.ok(forward[1] < -0.99, 'it should be looking down');
  assert.ok(Math.hypot(...right) > 0.99, 'right collapsed to nothing');
  assert.ok(Math.hypot(...up) > 0.99, 'up collapsed to nothing');
});

test('the axes point where the camera actually looks', () => {
  const { eye, target } = framingToView({ x: -5, z: -5, w: 10, d: 10, pitch: 30, yaw: 0 });
  const [forward] = axesOf(eye, target);
  const straight = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
  const length = Math.hypot(...straight);
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(forward[i] - straight[i] / length) < 1e-9);
  }
});
