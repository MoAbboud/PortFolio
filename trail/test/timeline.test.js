import test from 'node:test';
import assert from 'node:assert/strict';

import {
  geometryOf, pitchOf, pieceX, placeInPiece, stripExtent,
  xAt, atOfX, clampAt, pieceAt, hourAt, toMinute, fromMinute, clockOfPiece,
  spliceOut, insertPiece,
  depthFor, rigOf, framingOf, revealFraming, veilFor,
  runAt, runDuration, DEFAULT_PIECE,
  groundedRig, distanceFor, PITCH_MIN,
} from '../lib/timeline.js';
import { framingToView } from '../lib/camera.js';
import { orbit, zoom, rise } from '../lib/orbit.js';

const near = (a, b, tolerance = 1e-6) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} is not near ${b}`);

const GEO = { width: 30, depth: 20, gap: 2 };

// A three-piece strip: noon, half past, one o'clock. The example the whole
// redesign was described with.
const STRIP = [
  { hour: 12, weather: 'clear', hold: 4000 },
  { hour: 12.5, weather: 'overcast', hold: 3000 },
  { hour: 13, weather: 'storm', hold: 5000 },
];

// --- the strip is made of pieces --------------------------------------------

test('pieces butt together at a fixed distance, whatever times they carry', () => {
  // The point of the film strip: only the minutes you author take up room, so
  // two pieces half an hour apart and two a minute apart are the same distance.
  near(pitchOf(GEO), 32);
  near(pieceX(0, GEO), 0);
  near(pieceX(1, GEO), 32);
  near(pieceX(2, GEO), 64);
});

test('the distance between pieces does not depend on the gap in time', () => {
  const tight = [{ hour: 12 }, { hour: 12.0167 }];
  const wide = [{ hour: 12 }, { hour: 19 }];
  // Both are one join apart, because a piece of film is a piece of film.
  near(xAt(1, GEO) - xAt(0, GEO), xAt(1, GEO) - xAt(0, GEO));
  near(pieceAt(tight, 1).index, pieceAt(wide, 1).index);
});

test('an object is stored against its own piece and placed against the strip', () => {
  // Storing positions absolutely is what would make cutting a piece out into a
  // rewrite of everything after it.
  const local = [-4, 0, 2];
  assert.deepEqual(placeInPiece(local, 0, GEO), [-4, 0, 2]);
  assert.deepEqual(placeInPiece(local, 2, GEO), [60, 0, 2]);
  // The across-strip and vertical axes are untouched: a piece only moves things
  // along the film.
  assert.equal(placeInPiece(local, 5, GEO)[1], 0);
  assert.equal(placeInPiece(local, 5, GEO)[2], 2);
});

test('an object with no position still lands somewhere real', () => {
  assert.deepEqual(placeInPiece(undefined, 1, GEO), [32, 0, 0]);
  assert.deepEqual(placeInPiece([], 0, GEO), [0, 0, 0]);
});

test('an empty strip has no extent, rather than an extent of nothing', () => {
  // An empty canvas is a valid canvas, and the reveal has to be able to say
  // "there is no film yet" rather than fitting the camera to a point.
  assert.equal(stripExtent(0, GEO), null);
  assert.equal(stripExtent(undefined, GEO), null);
});

test('the extent runs from the outer edge of the first piece to the last', () => {
  const extent = stripExtent(3, GEO);
  near(extent.min, -15);
  near(extent.max, 79);
});

test('a place on the ground reads back as a place on the film', () => {
  for (let at = 0; at < 4; at += 0.125) near(atOfX(xAt(at, GEO), GEO), at, 1e-9);
});

test('geometry with nothing set falls back to a usable piece', () => {
  const geometry = geometryOf();
  assert.equal(geometry.width, DEFAULT_PIECE.width);
  assert.ok(geometry.width > 0 && geometry.depth > 0 && geometry.gap >= 0);
  // A piece of no width would put every piece in the same place.
  assert.ok(geometryOf({ width: 0 }).width > 0);
  assert.ok(geometryOf({ gap: -10 }).gap >= 0);
});

// --- moving along it --------------------------------------------------------

test('the strip says which piece is in front of the camera and how far between', () => {
  assert.deepEqual(pieceAt(STRIP, 0), { index: 0, next: 1, into: 0 });
  const between = pieceAt(STRIP, 1.25);
  assert.equal(between.index, 1);
  assert.equal(between.next, 2);
  near(between.into, 0.25);
});

test('you cannot run off either end of the film', () => {
  assert.equal(pieceAt(STRIP, -5).index, 0);
  assert.equal(pieceAt(STRIP, 99).index, 2);
  assert.equal(clampAt(99, 3), 2);
  assert.equal(clampAt(-1, 3), 0);
});

test('the last piece has nothing to cross into', () => {
  // Its `next` is itself, so a caller cross-fading the weather holds on the
  // last one rather than blending it with a piece that is not there.
  const end = pieceAt(STRIP, 2);
  assert.equal(end.index, 2);
  assert.equal(end.next, 2);
  assert.equal(end.into, 0);
});

test('an empty strip is nothing to stand on, rather than a crash', () => {
  assert.equal(pieceAt([], 0), null);
  assert.equal(hourAt([], 0), null);
  assert.equal(runAt([], 0), null);
});

test('crossing a join moves the time from one piece to the next', () => {
  // Where the compression of time actually shows: one step across a join can be
  // a step across half an hour, and the sun has to follow.
  near(hourAt(STRIP, 0), 12);
  near(hourAt(STRIP, 0.5), 12.25);
  near(hourAt(STRIP, 1), 12.5);
  near(hourAt(STRIP, 2), 13);
});

test('a piece with no time takes the time of the piece beside it', () => {
  // Rather than reading as midnight, which is the mistake the clock already
  // made once: absent is not midnight.
  near(hourAt([{ }, { hour: 9 }], 0), 9);
  near(hourAt([{ hour: 9 }, { }], 1), 9);
});

test('a piece is timed to the minute, and reads as a clock', () => {
  assert.equal(toMinute(12.5), 750);
  assert.equal(clockOfPiece({ hour: 12.5 }), '12:30');
  assert.equal(clockOfPiece({ hour: 9 }), '09:00');
  // 12:07 has to survive the round trip, because minutes are the resolution.
  const minute = toMinute(12 + 7 / 60);
  assert.equal(minute, 727);
  assert.equal(clockOfPiece({ hour: fromMinute(minute) }), '12:07');
});

test('a time outside the day wraps rather than being refused', () => {
  // A hand-edited file saying 25:00 plainly means one in the morning.
  assert.equal(clockOfPiece({ hour: 25 }), '01:00');
  assert.equal(clockOfPiece({ hour: -1 }), '23:00');
});

// --- cutting the film -------------------------------------------------------

test('cutting a piece out lets the strip close up', () => {
  const cut = spliceOut(STRIP, 1, 1);
  assert.equal(cut.length, 2);
  assert.deepEqual(cut.map((p) => p.hour), [12, 13]);
  // And the piece that was third is now second, so it is drawn one place
  // nearer. Nothing had to be rewritten to make that true.
  near(pieceX(1, GEO), 32);
});

test('a whole section can be cut, not only one piece', () => {
  const strip = [0, 1, 2, 3, 4, 5].map((hour) => ({ hour }));
  assert.deepEqual(spliceOut(strip, 1, 3).map((p) => p.hour), [0, 4, 5]);
});

test('a cut that runs off the end takes what is there and no more', () => {
  assert.deepEqual(spliceOut(STRIP, 2, 99).map((p) => p.hour), [12, 12.5]);
  assert.deepEqual(spliceOut(STRIP, 99, 1).map((p) => p.hour), [12, 12.5, 13]);
  assert.equal(spliceOut(STRIP, 0, 0).length, 3);
});

test('cutting never changes the pieces it keeps', () => {
  // The whole argument for piece-relative positions: a splice must not be able
  // to re-time or move anything that survived it.
  const cut = spliceOut(STRIP, 0, 1);
  assert.equal(cut[0], STRIP[1]);
  assert.equal(cut[1], STRIP[2]);
  assert.equal(STRIP.length, 3, 'the original strip was modified');
});

test('a new piece lands in the order its time runs', () => {
  const grown = insertPiece(STRIP, { hour: 12.75, weather: 'clear' });
  assert.deepEqual(grown.map((p) => p.hour), [12, 12.5, 12.75, 13]);
  assert.deepEqual(insertPiece(STRIP, { hour: 6 }).map((p) => p.hour), [6, 12, 12.5, 13]);
});

test('a piece with no time goes on the end rather than at midnight', () => {
  const grown = insertPiece(STRIP, { weather: 'clear' });
  assert.equal(grown.length, 4);
  assert.equal(grown[3].hour, undefined);
});

// --- the camera -------------------------------------------------------------

test('the rectangle exactly fills the frame at any pitch', () => {
  // `framingToView` fits the width and the depth separately and takes whichever
  // needs more distance. If the depth is derived correctly the two agree, which
  // is what stops a tilt leaving a band of the frame doing nothing.
  for (const pitch of [1.5, 5, 12, 25, 45, 60, 89]) {
    const width = 30;
    const framing = { x: 0, z: 0, w: width, d: depthFor(width, pitch), pitch, yaw: 0 };
    const { distance } = framingToView(framing);
    const wider = framingToView({ ...framing, w: width * 1.02 });
    const deeper = framingToView({ ...framing, d: framing.d * 1.02 });
    assert.ok(wider.distance > distance, `width is slack at pitch ${pitch}`);
    assert.ok(deeper.distance > distance, `depth is slack at pitch ${pitch}`);
  }
});

test('the camera sits on the piece the strip is showing', () => {
  const rig = { yaw: -14, pitch: 22, width: 34, height: 0 };
  near(framingOf(rig, 0, GEO).x + 17, 0);
  near(framingOf(rig, 2, GEO).x + 17, 64);
});

test('the strip is centred across its own direction, so an orbit sees all of it', () => {
  const framing = framingOf({ yaw: 0, pitch: 22, width: 34 }, 1, GEO);
  near(framing.z + framing.d / 2, 0);
});

test('moving along the film changes where the camera is and nothing about how it looks', () => {
  // The rule the clock bar was built on, and the one thing neither redesign was
  // allowed to break: scrubbing must never take the composition away.
  const rig = { yaw: -14, pitch: 33, width: 18, height: 4 };
  const before = framingOf(rig, 0, GEO);
  const after = framingOf(rig, 3, GEO);
  assert.equal(before.yaw, after.yaw);
  assert.equal(before.pitch, after.pitch);
  assert.equal(before.w, after.w);
  assert.equal(before.d, after.d);
  assert.equal(before.y, after.y);
  near(after.x - before.x, 3 * pitchOf(GEO));
  near(after.z, before.z);
});

test('a rig with nothing in it is still a usable camera', () => {
  const framing = framingOf({}, 0, GEO);
  for (const key of ['x', 'z', 'w', 'd', 'pitch', 'yaw', 'y']) {
    assert.ok(Number.isFinite(framing[key]), `${key} is not a number`);
  }
  assert.ok(framing.w > 0 && framing.d > 0);
  // Straight down and past looking up are both framings a drag can ask for, and
  // both are held at the limit rather than refused.
  assert.ok(rigOf({ pitch: 200 }).pitch <= 89);
  assert.ok(rigOf({ pitch: -400 }).pitch >= PITCH_MIN);
  // Looking up is allowed now. The floor that used to sit at 1.5 degrees is
  // what stopped the camera ever being below its subject.
  assert.ok(rigOf({ pitch: -30 }).pitch < 0, 'the camera cannot tilt up');
});

// --- the ending -------------------------------------------------------------

test('the reveal takes in every piece of the film', () => {
  const framing = revealFraming({ yaw: 0, pitch: 22, width: 34 }, 8, GEO);
  const extent = stripExtent(8, GEO);
  assert.ok(framing.x <= extent.min, 'the first piece is off the left of the frame');
  assert.ok(framing.x + framing.w >= extent.max, 'the last piece is off the right');
});

test('the reveal keeps the yaw it was composed with and lifts the pitch', () => {
  const framing = revealFraming({ yaw: -14, pitch: 12, width: 34 }, 8, GEO);
  assert.equal(framing.yaw, -14);
  assert.ok(framing.pitch > 12);
});

test('the reveal never closes in on a strip shorter than the shot already is', () => {
  const framing = revealFraming({ yaw: 0, pitch: 22, width: 90 }, 1, GEO);
  assert.ok(framing.w >= 90, 'pulling back should never be a push in');
});

test('there is still an ending when there is no film', () => {
  const framing = revealFraming({ yaw: 0, pitch: 22, width: 34 }, 0, GEO);
  assert.ok(Number.isFinite(framing.x) && framing.w > 0);
});

test('the veil clears the piece it is on and closes before the next one', () => {
  // The whole job: one moment of the film clear, everything either side of it
  // washed into the sky. Measured against the piece and its join rather than in
  // metres, so it holds whatever size the pieces are.
  //
  // **It only works because the join is wide enough to fade across.** At the
  // original spacing - 34 wide with 3 between - the next piece began 20 units
  // from the middle of this one, which is inside it, and no veil centred on a
  // piece could have separated them. Widening the join is what made this
  // possible, and the version 6 migration is what carries old canvases over.
  const geometry = DEFAULT_PIECE;
  const { near: from, far: to } = veilFor(geometry.width, geometry);
  const half = geometry.width / 2;
  const nextPiece = pitchOf(geometry) - half;   // where the neighbour begins

  assert.ok(from > half,
    `the veil starts at ${from} and the piece reaches ${half}, so its own scene fades`);
  assert.ok(to < nextPiece,
    `the veil is not closed until ${to} and the next piece starts at ${nextPiece}`);
});

test('the veil opens up as the camera pulls back, so the ending is not a wall of sky', () => {
  // A veil in fixed units is what would ruin the reveal: it is sized for one
  // piece, and the overview draws every piece at once. Pulling back has to lift
  // it rather than cut a hole in the middle of the film.
  const pieces = 12;
  const geometry = DEFAULT_PIECE;
  const extent = stripExtent(pieces, geometry);
  const reveal = revealFraming({ yaw: 0, pitch: 22, width: 34 }, pieces, geometry);
  const { far } = veilFor(reveal.w, geometry);
  assert.ok(far > extent.max - extent.min,
    `the veil closes at ${far.toFixed(0)} and the strip is ${(extent.max - extent.min).toFixed(0)} long`);
});

// --- looking up -------------------------------------------------------------

test('the camera can be put below what it is looking at', () => {
  // **Reported by the user:** "i can move it top down but i cant see anything
  // bottom top... i cant look any higher from the angle that i am in."
  //
  // The eye sits sin(pitch) * distance above the point being looked at, and the
  // pitch could not go below 1.5 degrees - so the camera was always above its
  // subject and could only ever look down at it.
  const up = framingOf({ yaw: 0, pitch: -30, width: 34 }, 0, GEO);
  const { eye, target } = framingToView(up);
  assert.ok(eye[1] < target[1],
    `the eye is at ${eye[1].toFixed(2)} and the target at ${target[1].toFixed(2)}`);
});

test('looking up never puts the camera underground', () => {
  // The look-at point is lifted instead, which is how a low shot is actually
  // taken: the camera on the pavement, aimed at something above it.
  for (let pitch = PITCH_MIN; pitch <= 89; pitch += 1) {
    for (const width of [6, 20, 34, 90]) {
      const framing = framingOf({ yaw: 0, pitch, width }, 0, GEO);
      const { eye } = framingToView(framing);
      assert.ok(eye[1] > 0,
        `at pitch ${pitch} and width ${width} the eye is at ${eye[1].toFixed(2)}`);
    }
  }
});

test('no amount of handling can put the camera underground', () => {
  // The property `orbit.test.js` used to own, moved here with the rule it
  // depends on. Five hundred turns, zooms and climbs, each one grounded the way
  // the app grounds it.
  let rig = { yaw: 0, pitch: 25, width: 34, height: 0 };
  for (let i = 0; i < 500; i++) {
    const turned = orbit(framingOf(rig, i % 4, GEO), (i * 13) % 90 - 45, (i * 7) % 60 - 30);
    const closer = zoom(turned, i % 3 === 0 ? 0.85 : 1.15);
    const lifted = rise(closer, ((i % 5) - 2) * 0.1);
    rig = { yaw: lifted.yaw, pitch: lifted.pitch, width: lifted.w, height: lifted.y };

    const { eye } = framingToView(framingOf(rig, i % 4, GEO));
    assert.ok(eye[1] > 0, `camera dipped below the ground on iteration ${i}`);
    assert.ok(eye.every(Number.isFinite), `camera went non-finite on iteration ${i}`);
  }
});

test('a shot that was already above the ground is left where it was put', () => {
  // The lift is a floor, not a rule about where the camera goes: tilting down
  // must not drag a high shot back to the ground.
  const high = groundedRig({ yaw: 0, pitch: 40, width: 34, height: 25 });
  assert.equal(high.height, 25);
});

test('how far back the camera stands does not depend on the tilt', () => {
  // Which is what makes the lift solvable in one line rather than by searching
  // for a fixed point, and it holds because the depth is derived from the width.
  const at = (pitch) => framingToView(framingOf({ yaw: 0, pitch, width: 34 }, 0, GEO)).distance;
  near(at(10), distanceFor(34), 1e-9);
  near(at(70), distanceFor(34), 1e-9);
  near(at(-20), distanceFor(34), 1e-9);
});

// --- playback ---------------------------------------------------------------

test('the film runs at a steady rate, because every piece is the same width', () => {
  const strip = [{ hour: 12, hold: 2000 }, { hour: 12.5, hold: 1000 }];
  const rate = { secondsPerPiece: 2 };

  const start = runAt(strip, 0, rate);
  assert.equal(start.at, 0);
  assert.ok(start.resting);

  const stillResting = runAt(strip, 1.9, rate);
  assert.equal(stillResting.at, 0);
  assert.ok(stillResting.resting);

  // Two seconds of rest, then two seconds of travel: halfway across the join.
  const crossing = runAt(strip, 3, rate);
  near(crossing.at, 0.5);
  assert.ok(!crossing.resting);

  const arrived = runAt(strip, 4, rate);
  assert.equal(arrived.at, 1);
  assert.ok(arrived.resting);
});

test('a take ends on its last piece and stays there', () => {
  const end = runAt(STRIP, 999, { secondsPerPiece: 2 });
  assert.equal(end.at, 2);
  assert.ok(end.done);
});

test('the take is over exactly when its stated duration says it is', () => {
  const rate = { secondsPerPiece: 3 };
  const total = runDuration(STRIP, rate);
  // 12 seconds of holds plus two joins at three seconds each.
  near(total, 18);
  assert.ok(!runAt(STRIP, total - 0.01, rate).done, 'it ended early');
  assert.ok(runAt(STRIP, total, rate).done, 'it had not ended on time');
});

test('a one-piece film is a still, and has no joins to cross', () => {
  const one = [{ hour: 12, hold: 5000 }];
  near(runDuration(one, { secondsPerPiece: 2 }), 5);
  assert.ok(runAt(one, 6, { secondsPerPiece: 2 }).done);
});

test('the film never runs backwards', () => {
  const rate = { secondsPerPiece: 1.5 };
  let previous = -Infinity;
  for (let t = 0; t < runDuration(STRIP, rate) + 2; t += 0.05) {
    const at = runAt(STRIP, t, rate);
    assert.ok(at.at >= previous - 1e-9, `the film went backwards at ${t}s`);
    previous = at.at;
  }
});

test('a piece with no hold is crossed rather than skipped', () => {
  const strip = [{ hour: 12 }, { hour: 13 }];
  assert.equal(runAt(strip, 0, { secondsPerPiece: 2 }).at, 0);
  near(runDuration(strip, { secondsPerPiece: 2 }), 2);
});
