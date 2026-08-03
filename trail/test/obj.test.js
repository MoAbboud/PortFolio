import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { readObj, readMtl, boundsOf, voxeliseMesh, importObj } from '../lib/obj.js';
import { hollow, count } from '../lib/voxel.js';
import { thumbnail, coverage } from '../lib/thumb.js';
import { assemble } from '../lib/scene.js';
import { surfaceNets } from '../lib/mesh.js';

// A unit cube as OBJ, written out here so the tests describe the format they
// expect rather than depending on a file in a downloaded pack.
const CUBE_OBJ = `
# a cube
mtllib cube.mtl
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
v 0 0 1
v 1 0 1
v 1 1 1
v 0 1 1
usemtl Red
f 1 2 3 4
f 5 6 7 8
usemtl Blue
f 1 2 6 5
f 4 3 7 8
f 1 4 8 5
f 2 3 7 6
`;

const CUBE_MTL = `
newmtl Red
Kd 1.000000 0.000000 0.000000
newmtl Blue
Kd 0.000000 0.000000 1.000000
`;

test('vertices and faces are read, and polygons become triangles', () => {
  const mesh = readObj(CUBE_OBJ);
  assert.equal(mesh.vertices, 8);
  // Six quads, fanned into two triangles each.
  assert.equal(mesh.triangles.length, 12);
  assert.ok(mesh.triangles.every((t) => t.length === 3 && t.every((v) => v.length === 3)));
});

test('a face keeps the material that was current when it was read', () => {
  const mesh = readObj(CUBE_OBJ, readMtl(CUBE_MTL));
  const used = new Set(mesh.colours);
  assert.equal(used.size, 2, `expected two materials, got ${[...used].join(', ')}`);
});

test('vertex indices may count back from the end', () => {
  const mesh = readObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1\n');
  assert.equal(mesh.triangles.length, 1);
  assert.deepEqual(mesh.triangles[0][0], [0, 0, 0]);
  assert.deepEqual(mesh.triangles[0][2], [0, 1, 0]);
});

test('a face naming a vertex that does not exist is skipped, not crashed on', () => {
  const mesh = readObj('v 0 0 0\nv 1 0 0\nf 1 2 99\nf 1 2 2\n');
  assert.ok(mesh.triangles.every((t) => t.every(Boolean)));
});

test('an MTL diffuse is read as sRGB, not left as linear', () => {
  // Blender writes linear light. Taken literally, every imported material comes
  // out far too dark: a mid brown arrives almost black.
  const materials = readMtl('newmtl Mid\nKd 0.216 0.216 0.216\n');
  const hex = materials.get('Mid');
  const level = parseInt(hex.slice(1, 3), 16);
  assert.ok(level > 110 && level < 150, `0.216 linear should be mid grey, got ${hex}`);
});

test('a material with no colour at all still has one', () => {
  assert.equal(readMtl('newmtl Bare\n').get('Bare'), '#bbbbbb');
});

test('when every material shares one colour, the names are used instead', () => {
  // What a texture atlas leaves behind: several materials, all flat grey.
  const flat = readMtl([
    'newmtl DarkBrown', 'Kd 0.64 0.64 0.64',
    'newmtl White', 'Kd 0.64 0.64 0.64',
    'newmtl Wood', 'Kd 0.64 0.64 0.64',
  ].join('\n'));
  const colours = [...flat.values()];
  assert.equal(new Set(colours).size, 3, 'three materials should not be one colour');
  assert.notEqual(flat.get('DarkBrown'), flat.get('White'));
  // And they should be roughly what they say they are.
  const brightness = (hex) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16);
  assert.ok(brightness(flat.get('White')) > brightness(flat.get('DarkBrown')));
});

test('real, varied diffuse colours are kept rather than overridden', () => {
  const real = readMtl([
    'newmtl A', 'Kd 0.8 0.1 0.1',
    'newmtl B', 'Kd 0.1 0.1 0.8',
  ].join('\n'));
  const [a, b] = [real.get('A'), real.get('B')];
  assert.ok(parseInt(a.slice(1, 3), 16) > parseInt(a.slice(5, 7), 16), 'A should be red');
  assert.ok(parseInt(b.slice(5, 7), 16) > parseInt(b.slice(1, 3), 16), 'B should be blue');
});

test('an unrecognised material name still gets a colour of its own', () => {
  const flat = readMtl([
    'newmtl Xyzzy', 'Kd 0.5 0.5 0.5',
    'newmtl Plugh', 'Kd 0.5 0.5 0.5',
  ].join('\n'));
  assert.match(flat.get('Xyzzy'), /^#[0-9a-f]{6}$/);
  assert.notEqual(flat.get('Xyzzy'), flat.get('Plugh'));
});

// --- voxelising -------------------------------------------------------------

test('a mesh becomes a grid of about the size asked for', () => {
  const grid = importObj(CUBE_OBJ, CUBE_MTL, { id: 'cube', cells: 20 });
  assert.ok(Math.max(...grid.dims) <= 22, `too big: ${grid.dims.join('x')}`);
  assert.ok(Math.max(...grid.dims) >= 18, `too small: ${grid.dims.join('x')}`);
  assert.ok(count(grid) > 0);
});

test('the cube size follows the model, so any units come in the same chunkiness', () => {
  const small = importObj(CUBE_OBJ, CUBE_MTL, { cells: 20 });
  // The same cube, modelled a hundred times larger.
  const huge = importObj(CUBE_OBJ.replace(/^v (.+)$/gm, (line, nums) =>
    `v ${nums.split(' ').map((n) => Number(n) * 100).join(' ')}`), CUBE_MTL, { cells: 20 });
  assert.deepEqual([...huge.dims], [...small.dims], 'scale should not change the grid');
  assert.ok(Math.abs(huge.unit / small.unit - 100) < 1, 'the cube size should carry the scale');
});

test('only the surface is filled, never the inside', () => {
  // Trail hollows every grid anyway, so a solid fill would be work thrown away.
  const grid = importObj(CUBE_OBJ, CUBE_MTL, { cells: 16 });
  const [nx, ny, nz] = grid.dims;
  const middle = grid.cells[(Math.floor(nz / 2) * ny + Math.floor(ny / 2)) * nx + Math.floor(nx / 2)];
  assert.equal(middle, 0, 'the inside of a closed mesh should be empty');
});

test('no triangle slips between two cells', () => {
  // Sampling has to be finer than a cell, or a surface comes out full of holes.
  const grid = importObj(CUBE_OBJ, CUBE_MTL, { cells: 24 });
  const [nx, ny, nz] = grid.dims;
  let bottom = 0;
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) if (grid.cells[(k * ny + 0) * nx + i]) bottom++;
  assert.ok(bottom > nx * nz * 0.9, `the bottom face has holes: ${bottom} of ${nx * nz}`);
});

test('the palette holds the materials the mesh actually used', () => {
  const grid = importObj(CUBE_OBJ, CUBE_MTL, { cells: 12 });
  assert.equal(grid.palette.length, 2);
  assert.ok(grid.palette.every((p) => /^#[0-9a-f]{6}$/.test(p.hex)));
});

test('a base-anchored mesh stands on the ground', () => {
  const grid = importObj(CUBE_OBJ, CUBE_MTL, { cells: 12 });
  assert.equal(grid.offset[1], 0);
  assert.equal(grid.anchor, 'base');
});

test('an empty or sizeless mesh is refused by name', () => {
  assert.throws(() => voxeliseMesh({ triangles: [], colours: [] }, { id: 'nothing' }),
    /"nothing" has no triangles/);
  assert.throws(
    () => voxeliseMesh({ triangles: [[[1, 1, 1], [1, 1, 1], [1, 1, 1]]], colours: ['#fff'] }, { id: 'flat' }),
    /"flat" has no size/,
  );
});

test('an imported mesh works with everything a recipe grid works with', () => {
  const grid = importObj(CUBE_OBJ, CUBE_MTL, { id: 'cube', cells: 16 });
  const shell = hollow(grid);
  assert.ok(count(shell) > 0);
  assert.ok(coverage(thumbnail(shell, 64)) > 0.05, 'it should preview to something');
  const mesh = surfaceNets(shell, { roundness: 0 });
  assert.ok(mesh.triangles > 0, 'it should mesh');
  const scene = assemble([{ grid: shell, at: [0, 0, 0], model: 'cube' }]);
  assert.equal(scene.count, count(shell), 'it should place');
});

test('bounds cover every vertex', () => {
  const { min, max } = boundsOf(readObj(CUBE_OBJ).triangles);
  assert.deepEqual(min, [0, 0, 0]);
  assert.deepEqual(max, [1, 1, 1]);
});
