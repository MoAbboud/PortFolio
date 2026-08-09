import test from 'node:test';
import assert from 'node:assert/strict';

import {
  worldOf, xOf, hourOf, spanOf, extentOf, depthFor, rigOf, framingOf,
  revealFraming, fogFor, clockAt, takeDuration, DEFAULT_SPACING, DEFAULT_ORIGIN,
} from '../lib/timeline.js';
import { framingToView } from '../lib/camera.js';

const near = (a, b, tolerance = 1e-6) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} is not near ${b}`);

const WORLD = { spacing: 40, origin: 12 };

// --- the mapping ------------------------------------------------------------

test('the origin hour sits at the middle of the canvas', () => {
  near(xOf(12, WORLD), 0);
  near(hourOf(0, WORLD), 12);
});

test('an hour is a fixed distance, and a wider spacing spreads the story out', () => {
  near(xOf(13, WORLD), 40);
  near(xOf(11, WORLD), -40);
  near(xOf(12.5, WORLD), 20);
  // The same story at half the spacing occupies half the ground. This is the
  // whole point of the control: a nine-hour afternoon has to be able to fit in
  // a room without the times themselves changing.
  near(xOf(13, { spacing: 20, origin: 12 }), 20);
});

test('reading a place back gives the time that put it there', () => {
  for (let hour = 0; hour < 24; hour += 0.25) {
    near(hourOf(xOf(hour, WORLD), WORLD), hour, 1e-9);
  }
});

test('a spacing of zero is refused rather than collapsing the strip', () => {
  // Nought units to the hour maps every moment to the same place, which is a
  // pile rather than a timeline, and makes `hourOf` a division by zero.
  assert.ok(worldOf({ spacing: 0 }).spacing > 0);
  assert.ok(worldOf({ spacing: -5 }).spacing > 0);
  assert.ok(Number.isFinite(hourOf(10, { spacing: 0, origin: 12 })));
});

test('a canvas with nothing set falls back to defaults rather than to NaN', () => {
  const world = worldOf();
  assert.equal(world.spacing, DEFAULT_SPACING);
  assert.equal(world.origin, DEFAULT_ORIGIN);
  near(xOf(undefined, world), 0);
  assert.ok(Number.isFinite(xOf(null, world)));
});

// --- what the story occupies ------------------------------------------------

test('an empty canvas has no span, rather than a span of the whole day', () => {
  // An empty canvas is a valid canvas, so this has to be answerable with "there
  // is no story yet" instead of midnight to midnight.
  assert.equal(spanOf([]), null);
  assert.equal(spanOf([{ weather: 'clear' }]), null);
});

test('the span runs from the earliest moment to the latest, whatever order they are in', () => {
  const span = spanOf([{ hour: 13.5 }, { hour: 9 }, { hour: 18.25 }]);
  assert.deepEqual(span, { from: 9, to: 18.25 });
});

test('the extent takes in the objects as well as the moments', () => {
  // The two disagree in both directions - a thing can be dropped past the last
  // moment, and a moment can be marked before anything is placed at it - and the
  // pull-back has to take in whichever is wider or it cuts off what it is for.
  const moments = [{ hour: 12 }, { hour: 13 }];
  const objects = [{ at: [-90, 0, 2] }, { at: [10, 0, 0] }];
  const extent = extentOf({ moments, objects }, WORLD);
  near(extent.min, -90);
  near(extent.max, 40);
});

test('an area counts to its edges, not to its middle', () => {
  const extent = extentOf({ areas: [{ at: [0, 0], size: [30, 10] }] }, WORLD);
  near(extent.min, -15);
  near(extent.max, 15);
});

test('an extent with nothing to measure is null rather than zero', () => {
  // Zero would read as a strip of no length centred on the origin, and the
  // reveal would dutifully fit the camera to it.
  assert.equal(extentOf({}, WORLD), null);
  assert.equal(extentOf({ objects: [{ at: null }] }, WORLD), null);
});

// --- the camera -------------------------------------------------------------

test('the rectangle exactly fills the frame at any pitch', () => {
  // `framingToView` fits the width and the depth separately and takes whichever
  // needs more distance. If the depth is derived correctly the two agree, which
  // is what stops a tilt leaving part of the frame empty.
  for (const pitch of [1.5, 5, 12, 25, 45, 60, 89]) {
    const width = 26;
    const framing = { x: 0, z: 0, w: width, d: depthFor(width, pitch), pitch, yaw: 0 };
    const { distance } = framingToView(framing);
    const wider = framingToView({ ...framing, w: width * 1.02 });
    const deeper = framingToView({ ...framing, d: framing.d * 1.02 });
    // Growing either axis has to push the camera back, which is only true when
    // neither is already slack.
    assert.ok(wider.distance > distance, `width is slack at pitch ${pitch}`);
    assert.ok(deeper.distance > distance, `depth is slack at pitch ${pitch}`);
  }
});

test('the camera sits on the hour the clock is showing', () => {
  const rig = { yaw: -14, pitch: 22, width: 26, height: 0 };
  const noon = framingOf(rig, 12, WORLD);
  near(noon.x + noon.w / 2, 0);
  const half = framingOf(rig, 12.5, WORLD);
  near(half.x + half.w / 2, 20);
});

test('the strip is centred across its own direction, so an orbit can see all of it', () => {
  const framing = framingOf({ yaw: 0, pitch: 22, width: 26 }, 12, WORLD);
  near(framing.z + framing.d / 2, 0);
});

test('moving through time changes where the camera is and nothing about how it looks', () => {
  // The rule the clock bar was built on, and the one thing the redesign was not
  // allowed to break: scrubbing must never take the composition away.
  const rig = { yaw: -14, pitch: 33, width: 18, height: 4 };
  const before = framingOf(rig, 9, WORLD);
  const after = framingOf(rig, 17, WORLD);
  assert.equal(before.yaw, after.yaw);
  assert.equal(before.pitch, after.pitch);
  assert.equal(before.w, after.w);
  assert.equal(before.d, after.d);
  assert.equal(before.y, after.y);
  // Only the position along the strip moved, and it moved by the hours crossed.
  near(after.x - before.x, 8 * WORLD.spacing);
  near(after.z, before.z);
});

test('a rig with nothing in it is still a usable camera', () => {
  const rig = rigOf();
  assert.ok(rig.width > 0 && rig.pitch > 0);
  const framing = framingOf({}, 12, WORLD);
  for (const key of ['x', 'z', 'w', 'd', 'pitch', 'yaw', 'y']) {
    assert.ok(Number.isFinite(framing[key]), `${key} is not a number`);
  }
  assert.ok(framing.w > 0 && framing.d > 0);
});

test('a pitch outside the world is pulled back into it', () => {
  // Straight down and below the ground are both framings a drag can ask for.
  assert.ok(rigOf({ pitch: 200 }).pitch <= 89);
  assert.ok(rigOf({ pitch: -40 }).pitch >= 1.5);
});

// --- the ending -------------------------------------------------------------

test('the reveal takes in the whole strip', () => {
  const extent = { min: -180, max: 180 };
  const framing = revealFraming({ yaw: 0, pitch: 22, width: 26 }, extent);
  assert.ok(framing.x <= extent.min, 'the near end is off the left of the frame');
  assert.ok(framing.x + framing.w >= extent.max, 'the far end is off the right');
  near(framing.x + framing.w / 2, 0);
});

test('the reveal keeps the yaw it was composed with and lifts the pitch', () => {
  // A timeline read end to end is read from above: at the angle a close shot
  // was composed at, the far end of a long strip is a smear on the horizon.
  const framing = revealFraming({ yaw: -14, pitch: 12, width: 26 }, { min: -100, max: 100 });
  assert.equal(framing.yaw, -14);
  assert.ok(framing.pitch > 12);
});

test('the reveal never closes in on a story shorter than the shot already is', () => {
  const framing = revealFraming({ yaw: 0, pitch: 22, width: 60 }, { min: -2, max: 2 });
  assert.ok(framing.w >= 60, 'pulling back should never be a push in');
});

test('the fog opens up as the camera pulls back, so the ending is not a wall of sky', () => {
  // Fog in fixed world units is what would ruin the reveal: 180 units of it is
  // right for a room and shorter than an afternoon.
  const close = fogFor(26);
  near(close.near, 26);
  near(close.far, 180);

  const strip = { min: -180, max: 180 };
  const reveal = revealFraming({ yaw: 0, pitch: 22, width: 26 }, strip);
  const { far } = fogFor(reveal.w);
  assert.ok(far > strip.max - strip.min,
    `fog reaches ${far} and the strip is ${strip.max - strip.min} long`);
});

// --- playback ---------------------------------------------------------------

test('a take with no moments is nothing to play, rather than a crash', () => {
  assert.equal(clockAt([], 0), null);
  assert.equal(takeDuration([]), 0);
});

test('a take rests at a moment for its hold, then travels to the next', () => {
  const moments = [{ hour: 12, hold: 4000 }, { hour: 13, hold: 2000 }];
  const rate = 0.5;   // half an hour of story a second, so an hour takes two

  const start = clockAt(moments, 0, { rate });
  assert.equal(start.hour, 12);
  assert.ok(start.resting);

  const stillResting = clockAt(moments, 3.9, { rate });
  assert.equal(stillResting.hour, 12);
  assert.ok(stillResting.resting);

  // Four seconds of rest, then two seconds of travel: half way through it is
  // half past twelve.
  const travelling = clockAt(moments, 5, { rate });
  near(travelling.hour, 12.5);
  assert.ok(!travelling.resting);

  const arrived = clockAt(moments, 6.5, { rate });
  assert.equal(arrived.hour, 13);
  assert.ok(arrived.resting);
});

test('a take ends on its last moment and stays there', () => {
  // Rather than wrapping round midnight, which would run the story backwards
  // through itself at exactly the moment it is meant to be over.
  const moments = [{ hour: 12, hold: 1000 }, { hour: 13, hold: 1000 }];
  const end = clockAt(moments, 999, { rate: 0.5 });
  assert.equal(end.hour, 13);
  assert.ok(end.done);
});

test('the take is over exactly when its stated duration says it is', () => {
  const moments = [{ hour: 9, hold: 3000 }, { hour: 12, hold: 1500 }, { hour: 13, hold: 2000 }];
  const rate = 0.75;
  const total = takeDuration(moments, { rate });

  assert.ok(!clockAt(moments, total - 0.01, { rate }).done, 'it ended early');
  assert.ok(clockAt(moments, total, { rate }).done, 'it had not ended on time');
});

test('moments are played in the order they happen, not the order they were added', () => {
  const moments = [{ hour: 18, hold: 0 }, { hour: 9, hold: 0 }];
  const start = clockAt(moments, 0, { rate: 1 });
  assert.equal(start.hour, 9);
  // And the index it hands back points at the moment in the list, not at its
  // place in time - so a caller reading its weather reads the right one.
  assert.equal(start.moment, 1);
});

test('the clock never runs backwards through a take', () => {
  const moments = [{ hour: 9, hold: 1200 }, { hour: 13.5, hold: 800 }, { hour: 18.25, hold: 2000 }];
  const rate = 0.6;
  let previous = -Infinity;
  for (let t = 0; t < takeDuration(moments, { rate }) + 2; t += 0.05) {
    const at = clockAt(moments, t, { rate });
    assert.ok(at.hour >= previous - 1e-9, `the clock went backwards at ${t}s`);
    previous = at.hour;
  }
});

test('a moment with no hold is passed through rather than skipped', () => {
  const moments = [{ hour: 12 }, { hour: 13 }];
  const at = clockAt(moments, 0, { rate: 0.5 });
  assert.equal(at.hour, 12);
  assert.ok(Number.isFinite(takeDuration(moments, { rate: 0.5 })));
});
