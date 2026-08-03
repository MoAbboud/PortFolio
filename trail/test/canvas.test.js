import test from 'node:test';
import assert from 'node:assert/strict';

import { serialise, parse, isRefusal, VERSION } from '../lib/canvas.js';

const LAYOUT = [
  { model: 'house', at: [-6, 0, -4], rot: 14, from: 0 },
  { model: 'car', at: [2.4, 0, 3.2], rot: -24, from: 1, label: 'the car' },
  { model: 'tree', at: [7, 0, -5], scale: 1.25, from: 2, until: 4 },
  { model: 'person', at: [1, 0, 1], from: 0, label: 'Marla',
    tints: { primary: '#e08a3c', hair: '#2b2118' } },
];

const ROUTE = [
  { framing: { x: -11, z: -8.5, w: 11, d: 8.5, pitch: 19, yaw: -6, y: 0 },
    hold: 5000, weather: 'clear' },
  { framing: { x: -1.2, z: 0.6, w: 8, d: 6, pitch: 13, yaw: 16, y: 2 },
    hold: 5000, approachTime: 3200, weather: 'storm' },
];

const LOOK = { surface: 'mesh', roundness: 0.3, smoothing: 0, cubeScale: 1.2 };

test('a canvas survives being written out and read back', () => {
  const back = parse(serialise({ layout: LAYOUT, route: ROUTE, look: LOOK, title: 'the fallout' }));
  assert.equal(back.title, 'the fallout');
  assert.equal(back.layout.length, LAYOUT.length);
  assert.equal(back.route.length, ROUTE.length);
  back.layout.forEach((o, i) => {
    assert.equal(o.model, LAYOUT[i].model);
    assert.deepEqual(o.at, LAYOUT[i].at);
    assert.equal(o.rot, LAYOUT[i].rot ?? 0);
    assert.equal(o.from, LAYOUT[i].from);
  });
  assert.equal(back.layout[1].label, 'the car');
  // A character's colours are part of who they are, so they travel with them.
  assert.deepEqual(back.layout[3].tints, { primary: '#e08a3c', hair: '#2b2118' });
  assert.equal(back.layout[2].until, 4);
  assert.deepEqual(back.look, LOOK);
});

test('a canvas survives a trip through actual text', () => {
  const text = JSON.stringify(serialise({ layout: LAYOUT, route: ROUTE, look: LOOK }));
  const back = parse(text);
  assert.deepEqual(back.route[1].framing, ROUTE[1].framing);
  assert.equal(back.route[1].approachTime, 3200);
  assert.equal(back.route[1].weather, 'storm');
});

test('what is written is readable by a person', () => {
  const file = serialise({ layout: LAYOUT, route: ROUTE, look: LOOK });
  const text = JSON.stringify(file, null, 2);
  assert.match(text, /"model": "house"/);
  assert.match(text, /"weather": "storm"/);
  assert.ok(!text.includes('e-'), 'no exponent notation in a file meant to be edited');
  assert.ok(!/\d\.\d{6}/.test(text), 'numbers should be rounded, not full precision');
});

test('defaults are filled in rather than left missing', () => {
  const back = parse({
    trail: VERSION,
    objects: [{ model: 'tree', at: [0, 0, 0] }],
    steps: [{ framing: { x: 0, z: 0, w: 10, d: 8 }, hold: 3000 }],
  });
  assert.equal(back.layout[0].rot, 0);
  assert.equal(back.layout[0].scale, 1);
  assert.equal(back.layout[0].from, 0);
  assert.equal(back.route[0].framing.pitch, 25);
  assert.equal(back.route[0].framing.y, 0);
  assert.equal(back.route[0].weather, 'clear');
  assert.equal(back.route[0].approachTime, 2500);
});

// --- refusals ---------------------------------------------------------------
// A canvas that partly applied would be worse than one that did not load.

const refuses = (input, pattern) => {
  assert.throws(() => parse(input), (error) => {
    assert.ok(isRefusal(error), `expected a refusal, got ${error.constructor.name}`);
    assert.match(error.message, pattern);
    return true;
  });
};

test('a file that is not JSON is refused by name', () => {
  refuses('{ this is not json', /not a canvas file/);
});

test('a file that is not a canvas is refused', () => {
  refuses('{"hello":"world"}', /not a Trail canvas/);
  refuses('null', /empty/);
});

test('a canvas from a newer Trail is refused rather than half-read', () => {
  refuses({ trail: VERSION + 5, objects: [], steps: [] }, /newer Trail/);
});

test('an object with no model or no position is refused, and says which', () => {
  refuses(
    { trail: VERSION, objects: [{ at: [0, 0, 0] }], steps: [{ framing: { x: 0, z: 0, w: 1, d: 1 }, hold: 1 }] },
    /object 1 does not say what it is/,
  );
  refuses(
    { trail: VERSION, objects: [{ model: 'tree' }], steps: [{ framing: { x: 0, z: 0, w: 1, d: 1 }, hold: 1 }] },
    /object 1 \("tree"\) has no position/,
  );
});

test('a step with a broken framing is refused, and says which', () => {
  refuses(
    { trail: VERSION, objects: [], steps: [{ framing: { x: 0, z: 0, d: 1 }, hold: 1 }] },
    /step 1 has no w in its framing/,
  );
  refuses(
    { trail: VERSION, objects: [], steps: [{ framing: { x: 0, z: 0, w: 0, d: 1 }, hold: 1 }] },
    /step 1 has a frame with no size/,
  );
  refuses(
    { trail: VERSION, objects: [], steps: [{ framing: { x: 0, z: 0, w: 1, d: 1 } }] },
    /step 1 has no hold/,
  );
});

test('a canvas with no steps is refused', () => {
  refuses({ trail: VERSION, objects: [], steps: [] }, /at least one step/);
});

// --- migration --------------------------------------------------------------

test('a version 1 canvas still opens', () => {
  const old = {
    trail: 1,
    objects: [{ model: 'house', at: [0, 0, 0] }],
    steps: [{ framing: { x: -5, z: -5, w: 10, d: 10 }, hold: 4000 }],
  };
  const back = parse(old);
  assert.equal(back.layout[0].from, 0, 'version 1 had no step ranges');
  assert.equal(back.look.surface, 'cubes', 'version 1 and 2 always drew cubes');
});

test('a version 2 canvas still opens, and keeps what it did say', () => {
  const old = {
    trail: 2,
    objects: [{ model: 'car', at: [1, 0, 2], from: 3 }],
    steps: [{ framing: { x: 0, z: 0, w: 8, d: 6 }, hold: 2000 }],
  };
  const back = parse(old);
  assert.equal(back.layout[0].from, 3);
  assert.equal(back.look.surface, 'cubes');
});

test('migration never rewrites what a newer file already says', () => {
  const back = parse(serialise({ layout: LAYOUT, route: ROUTE, look: LOOK }));
  assert.equal(back.look.surface, 'mesh', 'a current file must keep its own look');
});

test('the look is clamped rather than trusted', () => {
  const back = parse({
    trail: VERSION,
    look: { surface: 'nonsense', roundness: 40, smoothing: -3, cubeScale: 900 },
    objects: [],
    steps: [{ framing: { x: 0, z: 0, w: 1, d: 1 }, hold: 1 }],
  });
  assert.equal(back.look.surface, 'mesh');
  assert.equal(back.look.roundness, 1);
  assert.equal(back.look.smoothing, 0);
  assert.equal(back.look.cubeScale, 4);
});

test('a round trip is stable, so saving twice changes nothing', () => {
  const once = serialise({ layout: LAYOUT, route: ROUTE, look: LOOK, title: 'x' });
  const twice = serialise({ ...parse(once), title: 'x' });
  assert.deepEqual(twice, once);
});
