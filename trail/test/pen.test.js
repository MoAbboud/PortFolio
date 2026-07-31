import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COLOURS, WIDTH, MIN_STEP, start, extend, undo, isDrawable, draw, toFrame, inFrame,
} from '../lib/pen.js';

/** A 2D context that records what it was asked to do. */
function recorder() {
  const calls = [];
  const ctx = new Proxy({ calls }, {
    get(target, name) {
      if (name === 'calls') return calls;
      return (...args) => calls.push([name, ...args]);
    },
    set(target, name, value) {
      calls.push([`set:${name}`, value]);
      return true;
    },
  });
  return ctx;
}

const did = (ctx, name) => ctx.calls.filter((c) => c[0] === name);

test('the palette is usable colours, and one of them shows on a pale sky', () => {
  assert.ok(COLOURS.length >= 4, 'a pointer needs a few colours to be useful');
  for (const colour of COLOURS) assert.match(colour, /^#[0-9a-f]{6}$/i);
  assert.ok(new Set(COLOURS).size === COLOURS.length, 'the palette repeats itself');
  assert.ok(COLOURS.some((c) => c.toLowerCase() < '#444444'), 'nothing dark enough for a bright shot');
});

test('a stroke starts empty and takes the colour it was given', () => {
  const stroke = start('#ff0000', 4);
  assert.equal(stroke.colour, '#ff0000');
  assert.equal(stroke.width, 4);
  assert.deepEqual(stroke.points, []);
  assert.equal(isDrawable(stroke), false);
});

test('points are kept, and points on top of each other are not', () => {
  const stroke = start(COLOURS[0], 3);
  assert.equal(extend(stroke, 0.5, 0.5), true);
  assert.equal(extend(stroke, 0.5 + MIN_STEP / 4, 0.5), false, 'a jitter is not a point');
  assert.equal(extend(stroke, 0.6, 0.5), true);
  assert.equal(stroke.points.length, 2);
});

test('a pointer reporting hundreds of times makes a stroke of reasonable size', () => {
  const stroke = start(COLOURS[0], 3);
  // A slow drag across the frame, sampled far more often than it moves.
  for (let i = 0; i < 2000; i++) extend(stroke, i / 2000, 0.5);
  assert.ok(stroke.points.length < 700, `kept ${stroke.points.length} points for one line`);
  assert.ok(stroke.points.length > 100, 'the line should not be thrown away either');
});

test('undo takes the last stroke, and stops at nothing', () => {
  const strokes = [start(COLOURS[0], 3), start(COLOURS[1], 3)];
  assert.equal(undo(strokes), true);
  assert.equal(strokes.length, 1);
  assert.equal(undo(strokes), true);
  assert.equal(undo(strokes), false, 'undo on an empty page should say so rather than throw');
});

test('drawing clears first, so a cleared page is actually clear', () => {
  const ctx = recorder();
  draw(ctx, [], 1600, 900);
  assert.equal(did(ctx, 'clearRect').length, 1);
  assert.deepEqual(did(ctx, 'clearRect')[0], ['clearRect', 0, 0, 1600, 900]);
  assert.equal(did(ctx, 'stroke').length, 0, 'nothing to draw, nothing drawn');
});

test('a stroke is drawn in its own colour and width', () => {
  const stroke = start('#54a8ff', 7);
  for (const x of [0.1, 0.2, 0.3, 0.4]) extend(stroke, x, 0.5);
  const ctx = recorder();
  draw(ctx, [stroke], 1600, 900);
  assert.ok(ctx.calls.some((c) => c[0] === 'set:strokeStyle' && c[1] === '#54a8ff'));
  assert.ok(ctx.calls.some((c) => c[0] === 'set:lineWidth' && c[1] === 7));
  assert.equal(did(ctx, 'stroke').length, 1);
});

test('points become frame pixels, not fractions', () => {
  const stroke = start(COLOURS[0], 3);
  extend(stroke, 0.25, 0.5);
  extend(stroke, 0.75, 0.5);
  const ctx = recorder();
  draw(ctx, [stroke], 1600, 900);
  const move = did(ctx, 'moveTo')[0];
  assert.deepEqual(move, ['moveTo', 400, 450]);
});

test('the same marks land in the same place at any frame size', () => {
  // The reason points are fractions: a mark drawn on the car has to stay on the
  // car when the window resizes or the page goes fullscreen.
  const stroke = start(COLOURS[0], 3);
  extend(stroke, 0.5, 0.25);
  const small = recorder(); draw(small, [stroke], 800, 450);
  const large = recorder(); draw(large, [stroke], 1600, 900);
  const at = (ctx) => did(ctx, 'arc')[0];
  assert.deepEqual(at(small).slice(1, 3), [400, 112.5]);
  assert.deepEqual(at(large).slice(1, 3), [800, 225]);
});

test('a single tap draws a dot rather than nothing', () => {
  const stroke = start(COLOURS[0], 6);
  extend(stroke, 0.5, 0.5);
  const ctx = recorder();
  draw(ctx, [stroke], 1000, 1000);
  assert.equal(did(ctx, 'arc').length, 1, 'a tap should leave a mark');
  assert.equal(did(ctx, 'fill').length, 1);
});

test('several strokes are all drawn', () => {
  const strokes = COLOURS.slice(0, 3).map((colour) => {
    const stroke = start(colour, 3);
    extend(stroke, 0.1, 0.1);
    extend(stroke, 0.9, 0.9);
    return stroke;
  });
  const ctx = recorder();
  draw(ctx, strokes, 1600, 900);
  assert.equal(did(ctx, 'stroke').length, 3);
});

test('a pointer position becomes a place on the frame', () => {
  const rect = { x: 100, y: 50, w: 1600, h: 900 };
  assert.deepEqual(toFrame(100, 50, rect), [0, 0]);
  assert.deepEqual(toFrame(1700, 950, rect), [1, 1]);
  assert.deepEqual(toFrame(900, 500, rect), [0.5, 0.5]);
});

test('the letterbox is not part of the frame', () => {
  const rect = { x: 200, y: 0, w: 1200, h: 900 };
  assert.equal(inFrame(toFrame(700, 450, rect)), true);
  assert.equal(inFrame(toFrame(50, 450, rect)), false, 'the left bar is not drawable');
  assert.equal(inFrame(toFrame(1550, 450, rect)), false, 'nor the right');
});

test('a frame with no size does not produce infinities', () => {
  const [x, y] = toFrame(10, 10, { x: 0, y: 0, w: 0, h: 0 });
  assert.ok(Number.isFinite(x) && Number.isFinite(y));
});

test('the default width sits inside its own range', () => {
  assert.ok(WIDTH.default >= WIDTH.min && WIDTH.default <= WIDTH.max);
});
