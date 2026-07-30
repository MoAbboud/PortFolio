import test from 'node:test';
import assert from 'node:assert/strict';

import {
  framingToView, viewProjection, lerpFraming, drift,
  routeAt, routeDuration, easeInOut, ASPECT,
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
