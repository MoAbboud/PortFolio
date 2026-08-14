import test from 'node:test';
import assert from 'node:assert/strict';

import {
  serialise, parse, isRefusal, VERSION, reorder, moved, dropped, byTime, copyPiece, pieceOf,
} from '../lib/canvas.js';
import { pitchOf, DEFAULT_PIECE } from '../lib/timeline.js';

const near = (a, b, tolerance = 1e-6) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} is not near ${b}`);

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
  // **A step with no hold is no longer refused.** Nothing plays, so there is
  // nothing for a duration to pace, and a canvas cannot be turned away for
  // leaving out a field that nothing reads.
  const held = parse(
    { trail: VERSION, objects: [], steps: [{ framing: { x: 0, z: 0, w: 1, d: 1 } }] },
  );
  assert.equal(held.route.length, 1, 'a step without a hold should open');
});

test('a canvas with no steps is a canvas, not a broken one', () => {
  // It used to be refused. A canvas with no steps is a place at a time of day
  // with nothing laid over it yet, which is where every canvas starts and what
  // is left when the last step is removed - and refusing it made removing that
  // step impossible for no reason anybody could name.
  const read = parse({ trail: VERSION, objects: [], steps: [] });
  assert.deepEqual(read.route, []);
  assert.deepEqual(read.layout, []);
  // And it survives a round trip, so an empty day can be saved and reopened.
  assert.deepEqual(parse(serialise(read)).route, []);
});

test('a canvas that is not one is still refused', () => {
  // Relaxing the step rule must not relax the rest: the point of refusing is
  // that a half-loaded canvas is worse than one that did not load.
  refuses({ trail: VERSION, objects: [] }, /no steps list/);
  refuses({ trail: VERSION, steps: [] }, /no objects list/);
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

// --- opening an older canvas onto the strip ----------------------------------

test('a version 4 canvas is spread along the strip rather than piled on one piece', () => {
  // **Reported by the user:** after the strip landed, cycling to a later step
  // "shows an empty canvas". Their saved canvas was version 4, where every step
  // framed the same ground and the whole story sat in one heap around the
  // origin - so pieces two and three were bare.
  //
  // `from` already says which piece an object belongs to, so it is read one
  // last time and turned into a position.
  const old = {
    trail: 4,
    objects: [
      { model: 'house', at: [-6, 0, -4], from: 0 },
      { model: 'car', at: [2, 0, 3], from: 1 },
      { model: 'tree', at: [1, 0, 1], from: 2 },
    ],
    areas: [{ at: [0, 0], size: [4, 4], label: 'the bar', from: 1 }],
    steps: [
      { framing: { x: 0, z: 0, w: 10, d: 6 }, hold: 1000, hour: 9 },
      { framing: { x: 0, z: 0, w: 10, d: 6 }, hold: 1000, hour: 12 },
      { framing: { x: 0, z: 0, w: 10, d: 6 }, hold: 1000, hour: 15 },
    ],
  };

  const out = parse(old);
  const [house, car, tree] = out.layout;

  assert.equal(house.at[0], -6, 'the first piece stays where it was');
  assert.ok(car.at[0] > 20, `the second piece was left at ${car.at[0]}`);
  assert.ok(tree.at[0] > car.at[0], 'the third piece is further along than the second');
  assert.ok(out.areas[0].at[0] > 20, 'a named place belongs to a piece too');

  // Across and up are untouched: a piece only moves things along the film.
  assert.equal(car.at[2], 3);
  assert.equal(tree.at[1], 0);
});

test('widening the join carries an old canvas across instead of scattering it', () => {
  // The join between pieces was widened so the veil had room to fade across.
  // Objects have to keep their place *on* their piece while the pieces move
  // apart - otherwise everything built before the change ends up strewn between
  // them, which is worse than where it started.
  const before = parse({
    trail: 5,
    objects: [
      { model: 'house', at: [-6, 0, -4], from: 0 },
      { model: 'car', at: [37 + 2.4, 0, 3], from: 1 },
      { model: 'tree', at: [74 - 6, 0, 1], from: 2 },
    ],
    steps: [{ framing: { x: 0, z: 0, w: 10, d: 6 }, hold: 1000 }],
  });

  const pitch = pitchOf(DEFAULT_PIECE);
  const [house, car, tree] = before.layout;
  // Each one keeps the offset it had within its own piece.
  near(house.at[0] - 0 * pitch, -6);
  near(car.at[0] - 1 * pitch, 2.4);
  near(tree.at[0] - 2 * pitch, -6);
});

test('a canvas already on the strip is never pushed along it twice', () => {
  // Saving and opening repeatedly must not walk the story off down the strip.
  const once = parse({
    trail: 4,
    objects: [{ model: 'car', at: [2, 0, 3], from: 2 }],
    steps: [{ framing: { x: 0, z: 0, w: 10, d: 6 }, hold: 1000 }],
  });
  const twice = parse(serialise(once));
  assert.equal(twice.layout[0].at[0], once.layout[0].at[0]);
  assert.equal(serialise(once).trail, VERSION);
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

test('adding a step leaves the objects already placed where they were', () => {
  // **Reported by the user, and it made the app unusable:** clear every step,
  // add one at eight in the morning, place an object, then add a second step -
  // and the object was silently reassigned to the new step, ghosted blue at the
  // step it had been placed on.
  //
  // Adding a step splices a **copy** of the step it follows in after it, so the
  // order handed to `reorder` names the same old step twice. A duplicate has to
  // resolve to the *earliest* copy: a reference means "from this moment on", and
  // the moment is where the original still is.
  const state = {
    route: [{ framing: { x: 0, z: 0, w: 10, d: 6 }, hold: 5000, hour: 8 }],
    layout: [{ model: 'tree', at: [0, 0, 0], from: 0 }],
    areas: [],
  };
  // What the add-step handler has by the time it calls `reorder`: the route has
  // already been spliced, so step 0 appears at both positions.
  const spliced = { ...state, route: [state.route[0], { ...state.route[0], hour: 11 }] };
  const out = reorder(spliced, [0, 0]);

  assert.equal(out.layout[0].from, 0,
    'the object was reassigned to the step that was just added');
});

test('a duplicated step keeps its references on the original, at any position', () => {
  // The same rule further along a route, so it is the rule being tested rather
  // than the one-step case.
  const out = reorder(THREE(), [0, 1, 1, 2]);
  assert.equal(out.layout[0].from, 0, 'an object before the insertion is untouched');
  assert.equal(out.layout[2].from, 1, 'an object on the duplicated step stays on the original');
  assert.equal(out.layout[1].from, 3, 'an object after it moves down one');
  assert.equal(out.layout[1].path.step, 3, 'and so does the step it walks its line on');
  assert.equal(out.areas[0].from, 3, 'a place is a step reference too');
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

test('the route can be put in the order it happens', () => {
  // The route is walked in array order and read in time order, so the two have
  // to agree: a step dragged earlier on the clock has to move in the route as
  // well, or it shows earlier on the bar and still plays in its old place.
  const route = [
    { framing: { x: 0, z: 0, w: 1, d: 1 }, hold: 0, hour: 18 },
    { framing: { x: 0, z: 0, w: 1, d: 1 }, hold: 0, hour: 9 },
    { framing: { x: 0, z: 0, w: 1, d: 1 }, hold: 0, hour: 13 },
  ];
  assert.deepEqual(byTime(route), [1, 2, 0]);
  const out = reorder({ route, layout: [], areas: [] }, byTime(route));
  assert.deepEqual(out.route.map((s) => s.hour), [9, 13, 18]);
});

test('a step with no hour is not on the clock, so it keeps its place at the end', () => {
  const route = [
    { framing: { x: 0, z: 0, w: 1, d: 1 }, hold: 0 },
    { framing: { x: 0, z: 0, w: 1, d: 1 }, hold: 0, hour: 9 },
    { framing: { x: 0, z: 0, w: 1, d: 1 }, hold: 0 },
  ];
  assert.deepEqual(byTime(route), [1, 0, 2], 'the untimed ones keep their own order');
});

test('a camera move is no longer something a step carries', () => {
  // They became switches on the camera: anything a step does to the camera
  // takes the view away from whoever is composing the shot.
  const written = serialise({
    layout: [],
    route: [{ framing: { x: 0, z: 0, w: 10, d: 6 }, hold: 1000, orbit: 1, push: 1 }],
  });
  assert.ok(!('orbit' in written.steps[0]), 'a step should not save a camera move');
  assert.ok(!('push' in written.steps[0]));
  const read = parse({
    trail: 4,
    objects: [],
    steps: [{ framing: { x: 0, z: 0, w: 10, d: 6 }, hold: 1000, orbit: 1 }],
  });
  assert.equal(read.route[0].orbit, undefined, 'an older file with one is read without it');
});

/**
 * Carrying a piece forward.
 *
 * The only genuinely tedious thing in this app: `examples/the-corner.json` is
 * 59 objects across three pieces of one street corner, and the street never
 * changed. Adding a piece now starts from the one before it, so the job is
 * "delete the car" rather than "rebuild the world".
 */
test('what stands on a piece can be carried onto another', () => {
  const pitch = pitchOf(DEFAULT_PIECE);
  const layout = [
    { model: 'street', at: [1, 0, 2], rot: 90, from: 0 },
    { model: 'person', at: [-3, 0, 4], from: 0, label: 'the walker' },
    { model: 'car', at: [pitch + 5, 0, 1], from: 1 },
  ];
  const areas = [{ name: 'the kerb', at: [2, 3], half: [4, 2], from: 0 }];

  const out = copyPiece({ layout, areas }, 0, 2, pitch);

  assert.equal(out.layout.length, 5, 'the two things on the first piece were not both copied');
  const copies = out.layout.slice(3);
  assert.deepEqual(copies.map((o) => o.model), ['street', 'person']);
  for (const copy of copies) {
    assert.equal(pieceOf(copy.at[0], pitch), 2, 'a copy did not land on the piece it was sent to');
    assert.equal(copy.from, 2);
  }
  // The same spot on the new piece, which is what makes a carried world read as
  // the same place a minute later rather than as a jump cut.
  near(copies[0].at[0] - 2 * pitch, layout[0].at[0]);
  near(copies[1].at[2], layout[1].at[2]);
  assert.equal(copies[0].rot, 90, 'a copy lost its turn');
  assert.equal(copies[1].label, 'the walker', 'a copy lost its name');

  assert.equal(out.areas.length, 2, 'a place on the ground was not carried');
  assert.equal(pieceOf(out.areas[1].at[0], pitch), 2);

  // The originals are untouched: this appends, and a copy is independent the
  // moment it exists.
  assert.deepEqual(out.layout.slice(0, 3), layout);
});

test('a carried object walks its line on the piece it was carried to', () => {
  // A path names the step it is walked on, and a copy that kept the original's
  // would move on somebody else's minute.
  const pitch = pitchOf(DEFAULT_PIECE);
  const layout = [
    { model: 'person', at: [2, 0, 0], from: 0, path: { to: [6, 3], step: 0 } },
  ];
  const out = copyPiece({ layout }, 0, 1, pitch);
  const copy = out.layout[1];
  assert.equal(copy.path.step, 1, 'the copy walks its line on the original piece');
  // Where it walks to moves with it, or a carried figure walks back across the join.
  near(copy.path.to[0], 6 + pitch);
  near(copy.path.to[1], 3);
});

test('carrying a piece onto itself changes nothing', () => {
  const pitch = pitchOf(DEFAULT_PIECE);
  const layout = [{ model: 'tree', at: [1, 0, 1], from: 0 }];
  const out = copyPiece({ layout }, 0, 0, pitch);
  assert.deepEqual(out.layout, layout, 'a piece copied onto itself doubled its contents');
});

test('version 7 drops what a take needed, and an old canvas still opens', () => {
  /**
   * **Version 6 was a film that played; version 7 is a drawing board.**
   *
   * A step carried `hold` - how long a take rested on it - and `approachTime` -
   * how long the camera took to fly to it. Nothing runs on its own any more, so
   * neither has anything to pace. They are absences rather than changes, which
   * is why an old canvas opens looking identical.
   */
  const old = {
    trail: 6,
    objects: [{ model: 'tree', at: [1, 0, 2] }],
    steps: [
      { framing: { x: 0, z: 0, w: 10, d: 8 }, hold: 4000, approachTime: 3000, weather: 'storm', hour: 9 },
    ],
  };
  const back = parse(old);
  assert.equal(back.route.length, 1, 'a version 6 canvas no longer opens');
  assert.equal(back.route[0].weather, 'storm', 'it lost something that still means what it did');
  assert.equal(back.route[0].hour, 9);
  assert.equal(back.layout[0].model, 'tree');
  assert.equal(back.route[0].hold, undefined, 'a hold survived into a Trail that cannot use it');
  assert.equal(back.route[0].approachTime, undefined);

  // And nothing writes them back out, so a canvas cannot pick them up again.
  const written = serialise(back);
  assert.equal(written.trail, VERSION);
  assert.ok(!('hold' in written.steps[0]), 'a step was written with a hold on it');
  assert.ok(!('approachTime' in written.steps[0]));
});
