import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  voxelise, hollow, crop, count, build, pack, unpack, load,
  encodeRLE, decodeRLE, isTintSlot, SOLID_NAMES,
} from '../lib/voxel.js';

const model = (name) => JSON.parse(
  readFileSync(fileURLToPath(new URL(`../models/${name}.json`, import.meta.url)), 'utf8')
);

const boxRecipe = (size, unit = 1) => ({
  id: 'test-box', unit, anchor: 'base',
  parts: [{ solid: 'box', at: [0, size[1] / 2, 0], size, color: '#ff0000' }],
});

test('a box fills the cells it should', () => {
  const grid = voxelise(boxRecipe([4, 4, 4]));
  assert.deepEqual([...grid.dims], [4, 4, 4]);
  assert.equal(count(grid), 64);
});

test('the grid is cropped to what it contains', () => {
  // A small part inside a much larger bounding region still yields a tight grid.
  const grid = voxelise({
    id: 'sparse', unit: 1, anchor: 'base',
    parts: [
      { solid: 'box', at: [0, 0.5, 0], size: [1, 1, 1], color: '#111111' },
      { solid: 'box', at: [20, 0.5, 0], size: [1, 1, 1], color: '#222222' },
    ],
  });
  assert.equal(grid.dims[1], 1);
  assert.equal(count(grid), 2);
});

test('later parts overwrite earlier ones', () => {
  const grid = voxelise({
    id: 'overwrite', unit: 1, anchor: 'base',
    parts: [
      { solid: 'box', at: [0, 1.5, 0], size: [3, 3, 3], color: '#aaaaaa' },
      { solid: 'box', at: [0, 1.5, 0], size: [1, 1, 1], color: '#bbbbbb' },
    ],
  });
  const [nx, ny] = grid.dims;
  const middle = grid.cells[(1 * ny + 1) * nx + 1];
  assert.equal(grid.palette[middle - 1].hex, '#bbbbbb');
});

test('hollowing removes only fully enclosed cells', () => {
  const solid = voxelise(boxRecipe([5, 5, 5]));
  assert.equal(count(solid), 125);
  const shell = hollow(solid);
  // A 5x5x5 block keeps its shell and loses the 3x3x3 core.
  assert.equal(count(shell), 125 - 27);
});

test('hollowing a thin part changes nothing', () => {
  const flat = voxelise(boxRecipe([5, 1, 5]));
  assert.equal(count(hollow(flat)), count(flat));
});

test('anchor base puts the model on the ground, centred', () => {
  const grid = voxelise(boxRecipe([4, 6, 4]));
  assert.equal(grid.offset[1], 0);
  assert.equal(grid.offset[0], -2);
  assert.equal(grid.offset[2], -2);
});

test('anchor center puts the origin in the middle', () => {
  const grid = voxelise({ ...boxRecipe([4, 6, 4]), anchor: 'center' });
  assert.equal(grid.offset[1], -3);
});

test('a sphere is round, not cubic', () => {
  const grid = voxelise({
    id: 'ball', unit: 0.1, anchor: 'center',
    parts: [{ solid: 'sphere', at: [0, 0, 0], size: [2, 2, 2], color: '#00ff00' }],
  });
  const cube = grid.dims[0] * grid.dims[1] * grid.dims[2];
  const filled = count(grid);
  // A ball fills about pi/6 of its bounding box.
  const ratio = filled / cube;
  assert.ok(ratio > 0.45 && ratio < 0.58, `sphere fill ratio was ${ratio.toFixed(3)}`);
});

test('a wedge is full at the base and narrow at the top', () => {
  const grid = voxelise({
    id: 'roof', unit: 0.1, anchor: 'base',
    parts: [{ solid: 'wedge', at: [0, 1, 0], size: [4, 2, 2], color: '#886644' }],
  });
  const [nx, ny] = grid.dims;
  const rowWidth = (j) => {
    let n = 0;
    for (let i = 0; i < nx; i++) if (grid.cells[(0 * ny + j) * nx + i]) n++;
    return n;
  };
  assert.ok(rowWidth(0) > rowWidth(ny - 1), 'base should be wider than the apex');
  assert.ok(rowWidth(ny - 1) < nx * 0.2, 'the apex should be narrow');
});

test('every named solid voxelises to something', () => {
  for (const solid of SOLID_NAMES) {
    const grid = voxelise({
      id: `solid-${solid}`, unit: 0.1, anchor: 'center',
      parts: [{ solid, at: [0, 0, 0], size: [1, 1, 1], color: '#ffffff' }],
    });
    assert.ok(count(grid) > 0, `${solid} produced nothing`);
  }
});

test('an unknown solid is refused by name', () => {
  assert.throws(
    () => voxelise({ id: 'bad', unit: 1, parts: [{ solid: 'torus', at: [0, 0, 0], size: [1, 1, 1] }] }),
    /unknown solid "torus"/
  );
});

test('tint slots are kept as slots, not as colours', () => {
  assert.equal(isTintSlot('#primary'), true);
  assert.equal(isTintSlot('#ff0000'), false);
  assert.equal(isTintSlot('#fff'), false);
  const grid = voxelise({
    id: 'tinted', unit: 1, anchor: 'base',
    parts: [{ solid: 'box', at: [0, 0.5, 0], size: [1, 1, 1], color: '#primary' }],
  });
  assert.deepEqual(grid.palette[0], { slot: 'primary', hex: undefined });
});

test('a tint slot carries the recipe\'s own colour as a fallback', () => {
  // Without this, a model placed with no tint turns grey rather than looking
  // like itself, which is what the library preview would show.
  const grid = voxelise({
    id: 'tinted', unit: 1, anchor: 'base',
    tints: { primary: '#3f6fb5' },
    parts: [{ solid: 'box', at: [0, 0.5, 0], size: [1, 1, 1], color: '#primary' }],
  });
  assert.deepEqual(grid.palette[0], { slot: 'primary', hex: '#3f6fb5' });
});

test('motion is recorded per cell, and only where there is a pivot', () => {
  const grid = voxelise({
    id: 'waver', unit: 1, anchor: 'base',
    parts: [
      { solid: 'box', at: [0, 0.5, 0], size: [1, 1, 1], color: '#111111' },
      {
        solid: 'box', at: [3, 0.5, 0], size: [1, 1, 1], color: '#222222',
        pivot: [3, 1, 0], motion: { type: 'sway', axis: 'x', amp: 6, phase: 0.5 },
      },
    ],
  });
  assert.equal(grid.motions.length, 1);
  assert.equal(grid.motions[0].type, 'sway');
  const moving = [...grid.motion].filter((m) => m > 0).length;
  assert.equal(moving, 1, 'only the pivoted part should move');
});

test('run-length encoding round-trips', () => {
  const bytes = new Uint8Array(1000);
  bytes.fill(7, 100, 400);
  bytes.fill(3, 500, 505);
  const text = encodeRLE(bytes);
  assert.deepEqual([...decodeRLE(text, bytes.length)], [...bytes]);
});

test('an encoded model is smaller than its grid and small enough to ship', () => {
  // Encode the solid grid, which is what pack() stores. Absolute cube counts
  // move whenever a model's resolution is tuned, so this asserts the two
  // properties that actually matter rather than a remembered number.
  for (const name of ['house', 'car', 'tree']) {
    const grid = voxelise(model(name));
    const text = encodeRLE(grid.cells);
    assert.ok(text.length < grid.cells.length,
      `${name}: encoding made it bigger (${text.length} from ${grid.cells.length})`);
    assert.ok(text.length < 16384,
      `${name}: ${(text.length / 1024).toFixed(1)} KB is too large for a library entry`);
  }
});

test('runs longer than a single field are split correctly', () => {
  const bytes = new Uint8Array(200000);
  bytes.fill(5);
  assert.deepEqual([...decodeRLE(encodeRLE(bytes), bytes.length)], [...bytes]);
});

test('the three starter models build into something solid and affordable', () => {
  for (const name of ['house', 'car', 'tree']) {
    const solid = voxelise(model(name));
    const drawn = build(model(name));
    assert.ok(drawn.count > 100, `${name} voxelised to almost nothing: ${drawn.count}`);
    assert.ok(drawn.count < 40000, `${name} is too heavy to place freely: ${drawn.count}`);
    assert.ok(drawn.count < count(solid), `${name}: hollowing removed nothing`);
    assert.ok(drawn.dims.every((n) => n >= 4),
      `${name} is too coarse to read at ${drawn.dims.join('x')}`);
  }
});

test('cube size is a knob, and turning it changes the count the right way', () => {
  // The page multiplies every recipe's unit at once. Bigger cubes must mean
  // fewer of them, and the model must survive being made much coarser.
  const recipe = model('house');
  const at = (scale) => build({ ...recipe, unit: recipe.unit * scale }).count;
  assert.ok(at(2) < at(1), 'bigger cubes should mean fewer cubes');
  assert.ok(at(0.5) > at(1), 'smaller cubes should mean more cubes');
  assert.ok(at(4) > 0, 'a very coarse house should still exist');
});

test('packing the solid grid is smaller than packing the hollowed one', () => {
  // The reason storage keeps the solid grid and hollows at load. A shell breaks
  // long runs into short ones, which makes run-length encoding worse.
  for (const name of ['house', 'car', 'tree']) {
    const solid = voxelise(model(name));
    const asSolid = encodeRLE(solid.cells).length;
    const asShell = encodeRLE(hollow(solid).cells).length;
    assert.ok(asSolid < asShell,
      `${name}: solid encoded to ${asSolid}, hollowed to ${asShell}`);
  }
});

test('a packed model round-trips and draws the same cubes', () => {
  const solid = voxelise(model('car'));
  const entry = pack(solid);
  const back = unpack(entry);
  assert.deepEqual([...back.dims], [...solid.dims]);
  assert.deepEqual([...back.cells], [...solid.cells]);
  assert.equal(load(entry).count, count(hollow(solid)));
});

test('a packed entry is plain data, safe to write to a file', () => {
  const entry = pack(voxelise(model('tree')));
  const revived = JSON.parse(JSON.stringify(entry));
  assert.equal(load(revived).count, load(entry).count);
});

test('hollowing saves most of a solid model', () => {
  const solid = voxelise(model('house'));
  const shell = hollow(solid);
  assert.ok(count(shell) < count(solid) * 0.5,
    'hollowing a house should remove more than half its cubes');
});
