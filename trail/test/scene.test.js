import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { voxelise, hollow, count } from '../lib/voxel.js';
import { place, assemble, bounds, contactShadows } from '../lib/scene.js';

const model = (name) => JSON.parse(
  readFileSync(fileURLToPath(new URL(`../models/${name}.json`, import.meta.url)), 'utf8')
);

const near = (a, b, tolerance = 1e-4) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} is not near ${b}`);

const unitCube = () => voxelise({
  id: 'one', unit: 1, anchor: 'base',
  parts: [{ solid: 'box', at: [0, 0.5, 0], size: [1, 1, 1], color: '#ff8800' }],
});

test('a placed object emits one instance per drawn cube', () => {
  const grid = hollow(voxelise(model('car')));
  const placed = place(grid, { at: [0, 0, 0] });
  assert.equal(placed.count, count(grid));
  assert.equal(placed.positions.length, placed.count * 3);
  assert.equal(placed.seeds.length, placed.count);
});

test('a base-anchored object stands on the ground where it is put', () => {
  const placed = place(unitCube(), { at: [5, 0, -3] });
  near(placed.positions[0], 5);
  near(placed.positions[1], 0.5); // the cube's centre, half a unit up
  near(placed.positions[2], -3);
});

test('rotation turns the object about its own anchor', () => {
  const grid = voxelise({
    id: 'pointer', unit: 1, anchor: 'base',
    parts: [{ solid: 'box', at: [2, 0.5, 0], size: [1, 1, 1], color: '#ffffff' }],
  });
  const straight = place(grid, { at: [0, 0, 0] });
  const turned = place(grid, { at: [0, 0, 0], rot: 90 });
  // The grid is cropped to the single cube, so its anchor is its own centre;
  // rotating it must not move it away from the anchor point.
  near(Math.hypot(straight.positions[0], straight.positions[2]),
    Math.hypot(turned.positions[0], turned.positions[2]));
});

test('scale changes the size of the cubes, not just the spread', () => {
  const small = place(unitCube(), { at: [0, 0, 0], scale: 1 });
  const big = place(unitCube(), { at: [0, 0, 0], scale: 3 });
  near(big.unit, small.unit * 3);
  near(big.positions[1], 1.5);
});

test('colours come out of the palette as unit floats', () => {
  const placed = place(unitCube(), {});
  near(placed.colours[0], 1);          // ff
  near(placed.colours[1], 0x88 / 255); // 88
  near(placed.colours[2], 0);          // 00
});

test('a tint slot is filled in per placement', () => {
  const grid = voxelise({
    id: 'tinted', unit: 1, anchor: 'base',
    parts: [{ solid: 'box', at: [0, 0.5, 0], size: [1, 1, 1], color: '#primary' }],
  });
  const marla = place(grid, { tints: { primary: '#ff0000' } });
  const devon = place(grid, { tints: { primary: '#0000ff' } });
  near(marla.colours[0], 1);
  near(devon.colours[2], 1);
  assert.notEqual(marla.colours[0], devon.colours[0]);
});

test('an untinted slot falls back rather than throwing', () => {
  const grid = voxelise({
    id: 'untinted', unit: 1, anchor: 'base',
    parts: [{ solid: 'box', at: [0, 0.5, 0], size: [1, 1, 1], color: '#primary' }],
  });
  const placed = place(grid, {});
  assert.ok(placed.colours.every(Number.isFinite));
});

test('a placement with no tint takes the model\'s own colours', () => {
  const grid = voxelise({
    id: 'figure', unit: 1, anchor: 'base',
    tints: { primary: '#ff0000' },
    parts: [{ solid: 'box', at: [0, 0.5, 0], size: [1, 1, 1], color: '#primary' }],
  });
  near(place(grid, {}).colours[0], 1, 1e-4);
  // And a placement that does ask still wins.
  near(place(grid, { tints: { primary: '#0000ff' } }).colours[2], 1, 1e-4);
});

test('seeds are the same every time, so a take re-records identically', () => {
  const a = place(hollow(voxelise(model('tree'))), { at: [1, 0, 2] });
  const b = place(hollow(voxelise(model('tree'))), { at: [1, 0, 2] });
  assert.deepEqual([...a.seeds], [...b.seeds]);
  assert.ok(a.seeds.every((s) => s >= 0 && s <= 1), 'seeds should be within 0..1');
});

test('assembling several objects concatenates them into one field', () => {
  const grids = { house: hollow(voxelise(model('house'))), tree: hollow(voxelise(model('tree'))) };
  const scene = assemble([
    { grid: grids.house, at: [0, 0, 0] },
    { grid: grids.tree, at: [10, 0, 0] },
    { grid: grids.tree, at: [-10, 0, 4], scale: 1.5 },
  ]);
  assert.equal(scene.count, count(grids.house) + count(grids.tree) * 2);
  assert.equal(scene.positions.length, scene.count * 3);
  assert.equal(scene.sizes.length, scene.count);
  assert.ok(scene.positions.every(Number.isFinite));
});

test('cube size travels per instance, so objects can differ in resolution', () => {
  const grids = { house: hollow(voxelise(model('house'))), car: hollow(voxelise(model('car'))) };
  const scene = assemble([
    { grid: grids.house, at: [0, 0, 0] },
    { grid: grids.car, at: [12, 0, 0] },
  ]);
  const sizes = new Set(scene.sizes);
  assert.equal(sizes.size, 2, 'a house and a car should not share a cube size');
});

test('bounds cover what was placed and nothing else', () => {
  const scene = assemble([{ grid: unitCube(), at: [3, 0, -7] }]);
  const box = bounds(scene);
  near(box.min[0], 3);
  near(box.min[2], -7);
  assert.ok(box.min[1] >= 0, 'nothing should be below the ground');
});

test('the whole test scene stays inside the cube budget', () => {
  const grids = {
    house: hollow(voxelise(model('house'))),
    car: hollow(voxelise(model('car'))),
    tree: hollow(voxelise(model('tree'))),
  };
  const placements = [
    { grid: grids.house, at: [-6, 0, -4], rot: 14 },
    { grid: grids.car, at: [2.4, 0, 3.2], rot: -24 },
    { grid: grids.tree, at: [7, 0, -5] },
    { grid: grids.tree, at: [-13.5, 0, 3.5], scale: 1.25 },
    { grid: grids.tree, at: [9.5, 0, 5.5], scale: 0.8 },
  ];
  const scene = assemble(placements);

  // Structural rather than a remembered number: cube counts move whenever a
  // model's resolution is tuned, but nothing may be lost or invented on the way
  // into the buffers.
  const expected = placements.reduce((n, p) => n + count(p.grid), 0);
  assert.equal(scene.count, expected, 'the field must hold every cube and no others');
  assert.ok(scene.count < 400000, `scene is over budget at ${scene.count}`);
  assert.ok(scene.count > 0, 'scene is empty');
});

test('a scene made of coarser cubes is cheaper but keeps its extent', () => {
  const build = (scale) => {
    const recipe = model('house');
    const grid = hollow(voxelise({ ...recipe, unit: recipe.unit * scale }));
    return assemble([{ grid, at: [0, 0, 0] }]);
  };
  const fine = build(1);
  const coarse = build(2);
  assert.ok(coarse.count < fine.count, 'coarser cubes should cost less');
  const width = (s) => bounds(s).max[0] - bounds(s).min[0];
  assert.ok(Math.abs(width(coarse) - width(fine)) < 1.0,
    'changing cube size must not change how big the house is');
});

test('a model that is not in the library is refused by name', () => {
  // This surfaced as "cannot read properties of undefined (reading 'unit')"
  // several frames from the cause, naming nothing. A canvas can outlive the
  // library it was built against, so the failure has to say which model.
  assert.throws(
    () => place(undefined, { model: 'table-oak', at: [0, 0, 0] }),
    /there is no model called "table-oak"/,
  );
  assert.throws(() => place(null, {}), /there is no model called "unknown"/);
});

test('every object keeps its own slice of the buffers', () => {
  // The ranges are what a drag writes into. If one object's slice overlapped
  // the next, moving a figure would overwrite its neighbour's cubes, which is
  // exactly what turned a dragged person into half a tree.
  const grids = {
    house: hollow(voxelise(model('house'))),
    car: hollow(voxelise(model('car'))),
    tree: hollow(voxelise(model('tree'))),
  };
  const placements = [
    { grid: grids.house, at: [0, 0, 0] },
    { grid: grids.car, at: [10, 0, 0] },
    { grid: grids.tree, at: [20, 0, 0] },
  ];
  const scene = assemble(placements);

  let expected = 0;
  scene.ranges.forEach((range, i) => {
    assert.equal(range.start, expected, `object ${i} does not start where the last one ended`);
    assert.equal(range.count, count(placements[i].grid), `object ${i} has the wrong size`);
    expected += range.count;
  });
  assert.equal(expected, scene.count, 'the ranges do not cover the whole field');
});

test('moving an object writes exactly its own cubes and no others', () => {
  const grids = {
    house: hollow(voxelise(model('house'))),
    tree: hollow(voxelise(model('tree'))),
  };
  const placements = [
    { grid: grids.house, at: [0, 0, 0] },
    { grid: grids.tree, at: [10, 0, 0] },
  ];
  const scene = assemble(placements);
  const before = [...scene.positions];

  // Move the first object, as a drag does.
  const moved = place(grids.house, { at: [3, 0, 0] });
  const range = scene.ranges[0];
  assert.equal(moved.count, range.count, 'the same model must fill the same slice');
  scene.positions.set(moved.positions.subarray(0, range.count * 3), range.start * 3);

  // The second object must be untouched, to the last float.
  const second = scene.ranges[1];
  for (let i = second.start * 3; i < (second.start + second.count) * 3; i++) {
    assert.equal(scene.positions[i], before[i], 'moving one object disturbed another');
  }
});

// **The tests for an object that travels went with the feature.** An object
// could be given a line to walk, carried as three numbers per vertex so the
// field stayed static and nothing ran per frame over the cubes. It is not
// wanted - *"i dont want to add motion to my objects for now"* - and the whole
// mechanism went with it. The history has both.
