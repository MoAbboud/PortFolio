import test from 'node:test';
import assert from 'node:assert/strict';

import { readVox, toGrid, importVox, isBadVox } from '../lib/vox.js';
import { count, hollow } from '../lib/voxel.js';
import { surfaceNets } from '../lib/mesh.js';

// Files are built here rather than kept on disk, so the tests describe the
// format they expect instead of depending on something opaque and binary.

function chunk(id, content = [], children = []) {
  const head = [];
  for (const c of id) head.push(c.charCodeAt(0));
  push32(head, content.length);
  push32(head, children.length);
  return [...head, ...content, ...children];
}

function push32(into, value) {
  into.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff);
}

function sizeChunk(x, y, z) {
  const content = [];
  push32(content, x); push32(content, y); push32(content, z);
  return chunk('SIZE', content);
}

function xyziChunk(voxels) {
  const content = [];
  push32(content, voxels.length);
  for (const [x, y, z, c] of voxels) content.push(x, y, z, c);
  return chunk('XYZI', content);
}

function rgbaChunk(colours) {
  const content = [];
  for (let i = 0; i < 256; i++) {
    const [r, g, b] = colours[i] ?? [0, 0, 0];
    content.push(r, g, b, 255);
  }
  return chunk('RGBA', content);
}

function voxFile(children, { magic = 'VOX ', version = 150 } = {}) {
  const bytes = [];
  for (const c of magic) bytes.push(c.charCodeAt(0));
  push32(bytes, version);
  bytes.push(...chunk('MAIN', [], children));
  return Uint8Array.from(bytes);
}

/** A red cube of colour index 1, two voxels tall. */
const simple = () => voxFile([
  ...sizeChunk(1, 1, 2),
  ...xyziChunk([[0, 0, 0, 1], [0, 0, 1, 1]]),
  ...rgbaChunk({ 0: [255, 0, 0] }),
]);

test('a file that is not a .vox is refused by name', () => {
  assert.throws(() => readVox(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])), (error) => {
    assert.ok(isBadVox(error));
    assert.match(error.message, /does not start with "VOX "/);
    return true;
  });
});

test('a file too short to be anything is refused', () => {
  assert.throws(() => readVox(Uint8Array.from([1, 2])), /too short/);
});

test('a file with no MAIN chunk is refused', () => {
  const bytes = [];
  for (const c of 'VOX ') bytes.push(c.charCodeAt(0));
  push32(bytes, 150);
  bytes.push(...chunk('SIZE', [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
  assert.throws(() => readVox(Uint8Array.from(bytes)), /no MAIN chunk/);
});

test('a file with no models is refused', () => {
  assert.throws(() => readVox(voxFile([...rgbaChunk({})])), /contains no models/);
});

test('the header, the model and the palette are all read', () => {
  const vox = readVox(simple());
  assert.equal(vox.version, 150);
  assert.equal(vox.models.length, 1);
  assert.deepEqual(vox.models[0].size, [1, 1, 2]);
  assert.equal(vox.models[0].count, 2);
  assert.equal(vox.usedDefaultPalette, false);
});

test('a voxel colour index is one-based against the palette', () => {
  // The single most likely thing to get wrong: index 1 is the FIRST palette
  // entry, which is why 0 is free to mean empty.
  const vox = readVox(simple());
  assert.equal(vox.palette[0].hex, '#ff0000');
  const grid = toGrid(vox);
  assert.equal(grid.palette[0].hex, '#ff0000');
});

test('unknown chunks are stepped over rather than tripped on', () => {
  const vox = readVox(voxFile([
    ...chunk('nTRN', [1, 2, 3, 4]),
    ...sizeChunk(1, 1, 1),
    ...xyziChunk([[0, 0, 0, 1]]),
    ...chunk('MATL', [9, 9, 9]),
    ...rgbaChunk({ 0: [10, 20, 30] }),
    ...chunk('LAYR', [7]),
  ]));
  assert.equal(vox.models.length, 1);
  assert.equal(vox.palette[0].hex, '#0a141e');
});

test('several models in one file are all read', () => {
  const vox = readVox(voxFile([
    ...sizeChunk(2, 2, 2),
    ...xyziChunk([[0, 0, 0, 1]]),
    ...sizeChunk(3, 3, 3),
    ...xyziChunk([[1, 1, 1, 2], [2, 2, 2, 2]]),
    ...rgbaChunk({ 0: [255, 0, 0], 1: [0, 255, 0] }),
  ]));
  assert.equal(vox.models.length, 2);
  assert.equal(vox.models[1].count, 2);
  assert.equal(toGrid(vox, { model: 1 }).palette[0].hex, '#00ff00');
});

test('asking for a model that is not there says so', () => {
  assert.throws(() => toGrid(readVox(simple()), { model: 5 }), /no model 6/);
});

test('a file with no palette comes in grey and admits it', () => {
  const vox = readVox(voxFile([...sizeChunk(1, 1, 1), ...xyziChunk([[0, 0, 0, 1]])]));
  assert.equal(vox.usedDefaultPalette, true);
  const grid = importVox(voxFile([...sizeChunk(1, 1, 1), ...xyziChunk([[0, 0, 0, 1]])]));
  assert.equal(grid.usedDefaultPalette, true);
  // Grey means the three channels match, not that the digits repeat.
  const [, r, g, b] = /^#(..)(..)(..)$/.exec(grid.palette[0].hex);
  assert.equal(r, g);
  assert.equal(g, b);
});

// --- the axis swap ----------------------------------------------------------

test('a model that is tall in the file is tall in the world', () => {
  // MagicaVoxel is z-up and Trail is y-up. Getting this backwards lays every
  // imported model on its side, which is the classic import failure.
  const vox = readVox(voxFile([
    ...sizeChunk(1, 1, 6),
    ...xyziChunk(Array.from({ length: 6 }, (_, i) => [0, 0, i, 1])),
    ...rgbaChunk({ 0: [255, 255, 255] }),
  ]));
  const grid = toGrid(vox);
  assert.deepEqual([...grid.dims], [1, 6, 1], 'six voxels up should be six cells tall');
});

test('a model that is wide in the file is wide in the world', () => {
  const vox = readVox(voxFile([
    ...sizeChunk(5, 2, 1),
    ...xyziChunk([[0, 0, 0, 1], [4, 1, 0, 1]]),
    ...rgbaChunk({ 0: [255, 255, 255] }),
  ]));
  const grid = toGrid(vox);
  assert.equal(grid.dims[0], 5, 'x stays x');
  assert.equal(grid.dims[1], 1, 'the file z becomes height');
  assert.equal(grid.dims[2], 2, 'the file y becomes depth');
});

test('a base-anchored import stands on the ground', () => {
  const grid = importVox(voxFile([
    ...sizeChunk(2, 2, 4),
    ...xyziChunk([[0, 0, 0, 1], [1, 1, 3, 1]]),
    ...rgbaChunk({ 0: [255, 255, 255] }),
  ]), { unit: 0.5 });
  assert.equal(grid.offset[1], 0);
  assert.equal(grid.anchor, 'base');
});

// --- the grid it produces ---------------------------------------------------

test('the palette is compacted to the colours actually used', () => {
  const vox = readVox(voxFile([
    ...sizeChunk(4, 1, 1),
    // Two voxels, using palette entries 1 and 200.
    ...xyziChunk([[0, 0, 0, 1], [3, 0, 0, 200]]),
    ...rgbaChunk({ 0: [255, 0, 0], 199: [0, 0, 255] }),
  ]));
  const grid = toGrid(vox);
  assert.equal(grid.palette.length, 2, 'an imported model should not carry 256 entries');
  assert.deepEqual(grid.palette.map((p) => p.hex).sort(), ['#0000ff', '#ff0000']);
});

test('an imported grid is cropped to what it contains', () => {
  const grid = importVox(voxFile([
    ...sizeChunk(20, 20, 20),
    ...xyziChunk([[10, 10, 10, 1]]),
    ...rgbaChunk({ 0: [255, 255, 255] }),
  ]));
  assert.deepEqual([...grid.dims], [1, 1, 1], 'empty space around a model should be trimmed');
  assert.equal(count(grid), 1);
});

test('an empty model is refused rather than producing nothing', () => {
  assert.throws(() => importVox(voxFile([
    ...sizeChunk(2, 2, 2),
    ...xyziChunk([[0, 0, 0, 0]]),   // colour 0 is empty
    ...rgbaChunk({ 0: [255, 255, 255] }),
  ])), /is empty/);
});

test('an imported grid works with everything a recipe grid works with', () => {
  // The point of the whole module: after import there is one kind of grid, and
  // nothing downstream can tell where it came from.
  const grid = importVox(voxFile([
    ...sizeChunk(5, 5, 5),
    ...xyziChunk(
      Array.from({ length: 125 }, (_, i) => [i % 5, Math.floor(i / 5) % 5, Math.floor(i / 25), 1])
    ),
    ...rgbaChunk({ 0: [120, 200, 90] }),
  ]), { unit: 0.2 });

  assert.equal(count(grid), 125);
  const shell = hollow(grid);
  assert.equal(count(shell), 125 - 27, 'hollowing should work on an import');

  const mesh = surfaceNets(shell, { roundness: 0.4 });
  assert.ok(mesh.count > 0 && mesh.triangles > 0, 'an import should mesh');
  assert.ok(mesh.positions.every(Number.isFinite));
});

test('the unit is the caller\'s to choose, since a file does not carry scale', () => {
  const file = voxFile([
    ...sizeChunk(1, 1, 1), ...xyziChunk([[0, 0, 0, 1]]), ...rgbaChunk({ 0: [1, 2, 3] }),
  ]);
  assert.equal(importVox(file, { unit: 0.1 }).unit, 0.1);
  assert.equal(importVox(file, { unit: 0.4 }).unit, 0.4);
});

test('a truncated file is refused rather than read as nonsense', () => {
  const good = simple();
  const cut = good.slice(0, good.length - 40);
  assert.throws(() => readVox(cut), (error) => {
    assert.ok(isBadVox(error) || error instanceof RangeError, 'should refuse, not guess');
    return true;
  });
});
