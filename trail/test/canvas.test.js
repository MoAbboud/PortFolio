import test from 'node:test';
import assert from 'node:assert/strict';

import { serialise, parse, isRefusal, VERSION, reorder, moved, dropped } from '../lib/canvas.js';

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

// --- version 4: the clock, places, and objects that travel -------------------

test('a step keeps the hour it was set to, and one without stays without', () => {
  // Absent is not midnight. It means the step takes whatever light its weather
  // carries, which is what every canvas did before there was a clock, and a
  // migration that filled it in with a number would change how they all look.
  const written = serialise({
    layout: [],
    route: [
      { framing: { x: 0, z: 0, w: 10, d: 6 }, hold: 4000, weather: 'clear', hour: 18.5 },
      { framing: { x: 0, z: 0, w: 10, d: 6 }, hold: 4000, weather: 'storm' },
    ],
  });
  assert.equal(written.steps[0].hour, 18.5);
  assert.ok(!('hour' in written.steps[1]), 'a step with no hour must not gain one');

  const read = parse(written);
  assert.equal(read.route[0].hour, 18.5);
  assert.equal(read.route[1].hour, undefined);
});

test('an hour off the end of the clock is wrapped, not refused', () => {
  // It is a typo in a hand-edited file, and 25:00 plainly means one in the
  // morning. Refusing the whole canvas over it would be the wrong trade.
  const read = parse({
    trail: 4,
    objects: [],
    steps: [{ framing: { x: 0, z: 0, w: 10, d: 6 }, hold: 1000, hour: 26 }],
  });
  assert.equal(read.route[0].hour, 2);
});

test('a place is kept with its name, and one without a size is dropped', () => {
  const written = serialise({
    layout: [],
    route: [{ framing: { x: 0, z: 0, w: 10, d: 6 }, hold: 1000 }],
    areas: [{ at: [3, -4], size: [12, 8], label: 'the bar', from: 2 }],
  });
  assert.deepEqual(written.areas, [{ at: [3, -4], size: [12, 8], label: 'the bar', from: 2 }]);

  const read = parse({
    trail: 4,
    objects: [],
    steps: [{ framing: { x: 0, z: 0, w: 10, d: 6 }, hold: 1000 }],
    areas: [
      { at: [1, 2], size: [4, 4], label: 'the pool' },
      { at: [1, 2] },
      { size: [4, 4] },
    ],
  });
  assert.equal(read.areas.length, 1, 'a place with no rectangle is not a place');
  assert.equal(read.areas[0].label, 'the pool');
});

test('a canvas with no places reads as having none rather than as broken', () => {
  const read = parse({
    trail: 3,
    objects: [],
    steps: [{ framing: { x: 0, z: 0, w: 10, d: 6 }, hold: 1000 }],
  });
  assert.deepEqual(read.areas, []);
});

test('where an object walks to survives a round trip', () => {
  const written = serialise({
    layout: [{ model: 'person', at: [1, 0, 2], path: { to: [9, -3], step: 4 } }],
    route: [{ framing: { x: 0, z: 0, w: 10, d: 6 }, hold: 1000 }],
  });
  assert.deepEqual(written.objects[0].path, { to: [9, -3], step: 4 });
  assert.deepEqual(parse(written).layout[0].path, { to: [9, -3], step: 4 });
});

test('an object with a half-written path is left standing still', () => {
  const read = parse({
    trail: 4,
    objects: [
      { model: 'a', at: [0, 0, 0], path: { step: 1 } },
      { model: 'b', at: [0, 0, 0], path: { to: [1] } },
      { model: 'c', at: [0, 0, 0] },
    ],
    steps: [{ framing: { x: 0, z: 0, w: 10, d: 6 }, hold: 1000 }],
  });
  for (const object of read.layout) {
    assert.equal(object.path, undefined, `${object.model} should not travel`);
  }
});

test('a version 3 canvas still opens, and gains nothing it did not say', () => {
  const read = parse({
    trail: 3,
    objects: [{ model: 'person', at: [0, 0, 0] }],
    steps: [{ framing: { x: 0, z: 0, w: 10, d: 6 }, hold: 2000, weather: 'dusk' }],
  });
  assert.equal(read.route[0].hour, undefined);
  assert.equal(read.layout[0].path, undefined);
  assert.deepEqual(read.areas, []);
});

test('everything new survives being saved twice', () => {
  // The round trip has to be stable or an autosave rewrites the file every time
  // it runs, which makes a canvas under version control unreadable.
  const build = () => serialise(parse(serialise({
    layout: [{ model: 'person', at: [1, 0, 2], label: 'Marla', path: { to: [4, 5], step: 1 } }],
    route: [{ framing: { x: 0, z: 0, w: 10, d: 6 }, hold: 1000, hour: 7.25 }],
    areas: [{ at: [0, 0], size: [6, 6], label: 'the bar' }],
  })));
  assert.deepEqual(build(), build());
});

// --- rearranging the route ---------------------------------------------------

const THREE = () => ({
  route: [
    { framing: { x: 0, z: 0, w: 10, d: 6 }, hold: 1000, hour: 9 },
    { framing: { x: 1, z: 1, w: 10, d: 6 }, hold: 1000, hour: 13.5 },
    { framing: { x: 2, z: 2, w: 10, d: 6 }, hold: 1000, hour: 18 },
  ],
  layout: [
    { model: 'a', at: [0, 0, 0], from: 0 },
    { model: 'b', at: [0, 0, 0], from: 2, path: { to: [4, 4], step: 2 } },
    { model: 'c', at: [0, 0, 0], from: 1, until: 2 },
  ],
  areas: [{ at: [0, 0], size: [4, 4], label: 'the bar', from: 2 }],
});

test('moving a step takes its own hour and framing with it', () => {
  const out = reorder(THREE(), moved(3, 2, 0));
  assert.deepEqual(out.route.map((s) => s.hour), [18, 9, 13.5]);
});

test('everything pointing at a moved step follows it', () => {
  // The failure this prevents is silent: without it, moving a step re-times the
  // whole video and the only way to find out is to play it and notice somebody
  // arriving in the wrong shot.
  const out = reorder(THREE(), moved(3, 2, 0));
  assert.equal(out.layout[1].from, 0, 'the object that appeared at the last step follows it');
  assert.equal(out.layout[1].path.step, 0, 'and so does the step it walks its line on');
  assert.equal(out.layout[0].from, 1, 'the object that appeared first moved down one');
  assert.equal(out.layout[2].from, 2);
  assert.equal(out.layout[2].until, 0, 'both ends of a range move');
  assert.equal(out.areas[0].from, 0, 'a place is a step reference too');
});

test('a step that is dropped hands its references to the one before it', () => {
  // Rather than to nothing, which would make an object vanish, or to the next
  // one, which would make it arrive early.
  const out = reorder(THREE(), dropped(3, 1));
  assert.equal(out.route.length, 2);
  assert.deepEqual(out.route.map((s) => s.hour), [9, 18]);
  assert.equal(out.layout[2].from, 0, 'it pointed at the step that went, so it falls back');
  assert.equal(out.layout[1].from, 1, 'the last step is now the second');
});

test('dropping the first step leaves its objects at the beginning', () => {
  const out = reorder(THREE(), dropped(3, 0));
  assert.equal(out.layout[0].from, 0, 'there is nothing before it to fall back to');
});

test('a range with no end stays open rather than being pinned to a step', () => {
  // 9999 is "to the end of the route", not a step number. Remapping it would
  // close every open range the first time a step moved.
  const state = {
    route: THREE().route,
    layout: [{ model: 'a', at: [0, 0, 0], from: 0, until: 9999 }],
    areas: [],
  };
  const out = reorder(state, moved(3, 0, 2));
  assert.equal(out.layout[0].until, 9999);
});

test('a reference is never left pointing past the end of a shorter route', () => {
  const out = reorder(THREE(), dropped(3, 2));
  for (const object of out.layout) {
    assert.ok(object.from < out.route.length, `${object.model} points at a step that is not there`);
    if (object.until !== undefined && object.until < 9999) {
      assert.ok(object.until < out.route.length, `${object.model} ends past the end`);
    }
    if (object.path) {
      assert.ok(object.path.step < out.route.length, `${object.model} walks on a step that is gone`);
    }
  }
});

test('rearranging nothing changes nothing', () => {
  const before = THREE();
  const out = reorder(before, [0, 1, 2]);
  assert.deepEqual(out.route, before.route);
  assert.deepEqual(out.layout.map((o) => o.from), [0, 2, 1]);
  assert.deepEqual(out.layout[1].path, { to: [4, 4], step: 2 });
});

test('an order is a list of old positions, and a bad move is refused quietly', () => {
  assert.deepEqual(moved(3, 0, 2), [1, 2, 0]);
  assert.deepEqual(moved(3, 2, 0), [2, 0, 1]);
  assert.deepEqual(moved(3, 0, 5), [0, 1, 2], 'past the end is left alone');
  assert.deepEqual(moved(3, -1, 0), [0, 1, 2]);
  assert.deepEqual(dropped(3, 1), [0, 2]);
});
