import test from 'node:test';
import assert from 'node:assert/strict';

import {
  orbit, zoom, panScreen, walk, rise, fit, tidy, centreOf, withCentre, wrapYaw,
  PITCH_MIN, PITCH_MAX, WIDTH_MIN, WIDTH_MAX, HEIGHT_MIN, HEIGHT_MAX,
} from '../lib/orbit.js';
import { framingToView } from '../lib/camera.js';

const near = (a, b, tolerance = 1e-6) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} is not near ${b}`);

const F = (over = {}) => ({ x: -5, z: -4, w: 10, d: 8, pitch: 25, yaw: 0, ...over });

test('the centre of a framing is the middle of its rectangle', () => {
  assert.deepEqual(centreOf(F()), [0, 0]);
  assert.deepEqual(centreOf(F({ x: 10, z: 20 })), [15, 24]);
});

test('setting a centre keeps the frame the same size', () => {
  const moved = withCentre(F(), 7, -3);
  assert.deepEqual(centreOf(moved), [7, -3]);
  assert.equal(moved.w, 10);
  assert.equal(moved.d, 8);
});

test('yaw wraps rather than growing without bound', () => {
  assert.equal(wrapYaw(0), 0);
  assert.equal(wrapYaw(190), -170);
  assert.equal(wrapYaw(-190), 170);
  assert.equal(wrapYaw(720), 0);
  let framing = F();
  for (let i = 0; i < 100; i++) framing = orbit(framing, 37, 0);
  assert.ok(Math.abs(framing.yaw) <= 180, `yaw ran away to ${framing.yaw}`);
});

test('orbiting swings the eye without moving what it looks at', () => {
  const before = framingToView(F());
  const after = framingToView(orbit(F(), 90, 0));
  assert.deepEqual(after.target, before.target);
  assert.ok(Math.abs(after.eye[0] - before.eye[0]) > 1, 'the eye should have moved');
  near(after.distance, before.distance, 1e-9);
});

test('pitch cannot go under the ground or past straight down', () => {
  assert.equal(orbit(F(), 0, -1000).pitch, PITCH_MIN);
  assert.equal(orbit(F(), 0, 1000).pitch, PITCH_MAX);
  assert.ok(framingToView(orbit(F(), 0, -1000)).eye[1] > 0, 'camera went underground');
});

test('zooming keeps the same point in the middle', () => {
  const zoomed = zoom(F({ x: 20, z: 30 }), 0.5);
  assert.deepEqual(centreOf(zoomed), centreOf(F({ x: 20, z: 30 })));
});

test('zooming preserves the shape of the frame', () => {
  const before = F({ w: 12, d: 6 });
  const after = zoom(before, 2.5);
  near(after.d / after.w, before.d / before.w, 1e-9);
});

test('zoom stops rather than inverting or vanishing', () => {
  let framing = F();
  for (let i = 0; i < 200; i++) framing = zoom(framing, 0.7);
  assert.equal(framing.w, WIDTH_MIN);
  assert.ok(framing.d > 0);
  for (let i = 0; i < 400; i++) framing = zoom(framing, 1.4);
  assert.equal(framing.w, WIDTH_MAX);
});

test('panning back and forth returns to where it started', () => {
  const start = F({ yaw: 37, pitch: 40 });
  const there = panScreen(start, 120, -60, 1920);
  const back = panScreen(there, -120, 60, 1920);
  near(centreOf(back)[0], centreOf(start)[0], 1e-9);
  near(centreOf(back)[1], centreOf(start)[1], 1e-9);
});

test('panning with no movement changes nothing', () => {
  assert.deepEqual(panScreen(F(), 0, 0, 1920), F());
});

test('panning moves along the ground, never up or down', () => {
  const panned = panScreen(F({ yaw: 55 }), 200, 140, 1920);
  assert.equal(panned.w, F().w);
  assert.equal(panned.pitch, F().pitch);
  assert.equal(panned.yaw, 55);
  assert.equal(framingToView(panned).target[1], 0);
});

test('dragging right moves the scene right, so the camera goes left', () => {
  const panned = panScreen(F({ yaw: 0 }), 100, 0, 1920);
  assert.ok(centreOf(panned)[0] < centreOf(F())[0], 'drag right should pull the view left');
});

test('panning scales with how far out you are', () => {
  const close = panScreen(F({ w: 5, d: 4 }), 100, 0, 1920);
  const far = panScreen(F({ w: 200, d: 160 }), 100, 0, 1920);
  const moved = (a, b) => Math.abs(centreOf(a)[0] - centreOf(b)[0]);
  assert.ok(moved(far, F({ w: 200, d: 160 })) > moved(close, F({ w: 5, d: 4 })) * 10,
    'a wide shot should pan further per pixel than a close one');
});

test('a very shallow camera can still be panned', () => {
  const flat = F({ pitch: PITCH_MIN });
  const panned = panScreen(flat, 0, 100, 1920);
  const distance = Math.hypot(...centreOf(panned).map((v, i) => v - centreOf(flat)[i]));
  assert.ok(Number.isFinite(distance) && distance > 0, 'a flat camera must not seize up');
  assert.ok(distance < 200, `a flat camera panned absurdly far: ${distance}`);
});

test('walking goes the way the camera faces', () => {
  const north = walk(F({ yaw: 0 }), 1, 0);
  assert.ok(centreOf(north)[1] < 0, 'forward at yaw 0 should head toward -z');
  const east = walk(F({ yaw: 0 }), 0, 1);
  assert.ok(centreOf(east)[0] > 0, 'right at yaw 0 should head toward +x');
});

test('walking a smaller fraction covers proportionally less ground', () => {
  const far = walk(F(), 1, 0, 0.10);
  const near_ = walk(F(), 1, 0, 0.05);
  const travelled = (f) => Math.abs(centreOf(f)[1] - centreOf(F())[1]);
  near(travelled(far), travelled(near_) * 2, 1e-9);
});

test('walking is proportional to the frame, so it feels the same at any distance', () => {
  const close = walk(F({ w: 6, d: 5 }), 1, 0, 0.1);
  const wide = walk(F({ w: 60, d: 50 }), 1, 0, 0.1);
  const travelled = (after, before) => Math.abs(centreOf(after)[1] - centreOf(before)[1]);
  near(travelled(wide, F({ w: 60, d: 50 })), travelled(close, F({ w: 6, d: 5 })) * 10, 1e-6);
});

test('walking turns with the camera', () => {
  const turned = walk(F({ yaw: 90 }), 1, 0);
  assert.ok(Math.abs(centreOf(turned)[0]) > Math.abs(centreOf(turned)[1]),
    'facing 90 degrees, forward should be mostly along x');
});

test('rising lifts the camera off the ground', () => {
  const ground = F();
  const up = rise(ground, 0.5);
  assert.ok(up.y > 0, 'height should increase');
  assert.ok(framingToView(up).eye[1] > framingToView(ground).eye[1], 'the eye should rise');
});

test('rising keeps the angle rather than tilting further down', () => {
  // This is the whole point of lifting the look-at rather than the eye: going
  // up must not turn into looking down.
  const up = rise(F({ pitch: 20 }), 0.8);
  assert.equal(up.pitch, 20);
  assert.equal(up.yaw, F().yaw);
});

test('rising keeps the camera over the same spot', () => {
  const before = F({ x: 12, z: -8 });
  const after = rise(before, 0.6);
  assert.deepEqual(centreOf(after), centreOf(before));
  const { target } = framingToView(after);
  assert.equal(target[0], centreOf(before)[0]);
  assert.equal(target[2], centreOf(before)[1]);
});

test('descending stops at the ground and never goes under it', () => {
  let framing = F();
  for (let i = 0; i < 50; i++) framing = rise(framing, -0.4);
  assert.equal(framing.y, HEIGHT_MIN);
  assert.ok(framingToView(framing).eye[1] > 0);
});

test('climbing stops rather than running away', () => {
  let framing = F();
  for (let i = 0; i < 500; i++) framing = rise(framing, 0.4);
  assert.equal(framing.y, HEIGHT_MAX);
  assert.ok(framingToView(framing).eye.every(Number.isFinite));
});

test('climbing is proportional to the frame, like walking', () => {
  const close = rise(F({ w: 6, d: 5 }), 0.2);
  const wide = rise(F({ w: 60, d: 50 }), 0.2);
  assert.ok(Math.abs(wide.y - close.y * 10) < 1e-9,
    'a wide shot should climb ten times as fast as one ten times closer');
});

test('height survives being saved as a step', () => {
  const framing = rise(F({ x: 1.234, z: 5.678 }), 0.37);
  const saved = tidy(framing);
  assert.ok('y' in saved, 'a saved framing must carry its height');
  assert.ok(Math.abs(saved.y - framing.y) < 0.01);
});

test('a framing with no height behaves exactly as it did before', () => {
  const { eye, target } = framingToView({ x: -5, z: -4, w: 10, d: 8, pitch: 25, yaw: 0 });
  assert.equal(target[1], 0);
  assert.ok(eye[1] > 0);
});

test('fit takes in everything that was placed', () => {
  const bounds = { min: [-14.9, 0, -7.3], max: [10.4, 5.3, 6.3] };
  const framing = fit(bounds);
  assert.ok(framing.x <= bounds.min[0], 'left edge is inside the bounds');
  assert.ok(framing.x + framing.w >= bounds.max[0], 'right edge is inside the bounds');
  assert.ok(framing.z <= bounds.min[2]);
  assert.ok(framing.z + framing.d >= bounds.max[2]);
});

test('fit copes with a single object', () => {
  const framing = fit({ min: [3, 0, 3], max: [3, 1, 3] });
  assert.ok(framing.w >= WIDTH_MIN && framing.d >= WIDTH_MIN);
  assert.ok(framingToView(framing).eye.every(Number.isFinite));
});

test('a roamed framing is an ordinary framing, usable as a step', () => {
  let framing = F();
  framing = orbit(framing, 143, 21);
  framing = zoom(framing, 0.62);
  framing = panScreen(framing, 88, -140, 1920);
  framing = walk(framing, 1, -1);
  framing = rise(framing, 0.4);

  const { eye, target } = framingToView(framing);
  assert.ok(eye.every(Number.isFinite) && target.every(Number.isFinite));
  assert.ok(eye[1] > 0, 'camera ended up underground');

  // The full shape of a framing. If this list changes, every place that writes
  // or reads a step needs to change with it.
  const saved = tidy(framing);
  assert.deepEqual(Object.keys(saved).sort(), ['d', 'pitch', 'w', 'x', 'y', 'yaw', 'z']);
  assert.ok(Object.values(saved).every(Number.isFinite));
});

test('tidy rounds without changing the shot', () => {
  const framing = F({ x: 1.23456789, w: 9.87654321 });
  const saved = tidy(framing);
  assert.equal(saved.x, 1.23);
  assert.equal(saved.w, 9.88);
  near(centreOf(saved)[0], centreOf(framing)[0], 0.02);
});

test('no amount of roaming can put the camera underground', () => {
  let framing = F();
  for (let i = 0; i < 500; i++) {
    framing = orbit(framing, (i * 13) % 90 - 45, (i * 7) % 60 - 30);
    framing = zoom(framing, i % 3 === 0 ? 0.85 : 1.15);
    framing = panScreen(framing, (i % 11) * 30 - 150, (i % 7) * 40 - 120, 1920);
    const { eye } = framingToView(framing);
    assert.ok(eye[1] > 0, `camera dipped below the ground on iteration ${i}`);
    assert.ok(eye.every(Number.isFinite), `camera went non-finite on iteration ${i}`);
  }
});
