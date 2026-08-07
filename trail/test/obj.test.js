import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { textureRefs, readObj, readMtl, boundsOf, voxeliseMesh, importObj, atHeight, fromName } from '../lib/obj.js';
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

test('a material with no colour at all still has one, taken from its name', () => {
  // It used to come back flat grey. A material that states no colour has told
  // us nothing, and its name is the only evidence in the file, so it is read
  // the same way a textured material's name is.
  assert.match(readMtl('newmtl Bare\n').get('Bare'), /^#[0-9a-f]{6}$/);
  assert.equal(readMtl('newmtl Wood\n').get('Wood'), fromName('Wood'));
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

// --- correcting a pack that normalised its models ---------------------------

test('a grid can be resized to a real height without changing its shape', () => {
  const grid = importObj(CUBE_OBJ, CUBE_MTL, { id: 'cube', cells: 10 });
  const tall = grid.dims[1] * grid.unit;
  const sized = atHeight(grid, 1.5);

  assert.ok(Math.abs(sized.dims[1] * sized.unit - 1.5) < 1e-6,
    `asked for 1.5 units tall, got ${sized.dims[1] * sized.unit}`);
  // The cells are untouched: this is a change of scale, not of shape.
  assert.deepEqual(sized.dims, grid.dims);
  assert.equal(sized.cells, grid.cells);
  // And the placement offset scales with it, or the model would hover or sink.
  assert.ok(Math.abs(sized.offset[0] / grid.offset[0] - 1.5 / tall) < 1e-6);
});

test('resizing to nothing is refused rather than collapsing a model', () => {
  const grid = importObj(CUBE_OBJ, CUBE_MTL, { id: 'cube', cells: 10 });
  assert.equal(atHeight(grid, 0), grid);
  assert.equal(atHeight(grid, -3), grid);
  assert.equal(atHeight(grid, undefined), grid);
});

test('a height written in the manifest is a plausible real-world size', () => {
  // These are hand-written numbers, and a typo would put a five-metre dog in a
  // shot. Nothing in the library is smaller than a mouse or taller than a
  // house, so anything outside that is a slip rather than a decision.
  const manifest = JSON.parse(
    readFileSync(new URL('../models/index.json', import.meta.url), 'utf8')
  );
  for (const mesh of manifest.meshes ?? []) {
    if (mesh.height === undefined) continue;
    assert.ok(typeof mesh.height === 'number' && mesh.height > 0.05 && mesh.height < 30,
      `${mesh.name} is recorded as ${mesh.height} units tall`);
  }
});

// --- colours that cannot be believed -----------------------------------------

test('a textured material does not have its Kd taken as its colour', () => {
  // `map_Kd` means the colour is in the texture and `Kd` is a multiplier the
  // texture is tinted by. Left at white or 0.8 grey, as it almost always is,
  // taking it literally paints the model white - which is what happened to
  // every model in the Zombie kit at once.
  const textured = readMtl([
    'newmtl Wood', 'Kd 0.800000 0.800000 0.800000', 'map_Kd Atlas.png',
  ].join('\n'));
  assert.equal(textured.get('Wood'), fromName('Wood'));
  assert.notEqual(textured.get('Wood'), '#cccccc');
});

test('an exporter default grey is not evidence of anything', () => {
  // Blender writes 0.8 or 0.64 when nobody picks a colour. A material called
  // Sofa.002 with an untouched grey is a sofa, not a grey thing.
  for (const grey of ['1.0 1.0 1.0', '0.8 0.8 0.8', '0.64 0.64 0.64']) {
    const kept = readMtl(`newmtl Sofa.002\nKd ${grey}\n`);
    assert.equal(kept.get('Sofa.002'), fromName('sofa'),
      `Kd ${grey} was believed, so the sofa stays grey`);
  }
});

test('a pale grey somebody actually chose is kept', () => {
  // The other side of the rule. Concrete and kerbs really are pale grey, and
  // matching "any light colour" rather than the exporter defaults would throw
  // away a colour that was deliberate.
  const chosen = readMtl('newmtl Concrete\nKd 0.700000 0.690000 0.660000\n');
  const hex = chosen.get('Concrete');
  assert.notEqual(hex, fromName('Concrete'), 'a chosen colour was overridden by the name');
  assert.match(hex, /^#[0-9a-f]{6}$/);
});

test('a material named by the exporter falls back to the model name', () => {
  // `Atlas` and `Material.001` say nothing. The filename is then the only
  // evidence in the whole file about what the thing is.
  const anonymous = readMtl('newmtl Material.001\nKd 0.64 0.64 0.64\n', { model: 'cookie' });
  assert.equal(anonymous.get('Material.001'), fromName('cookie'));

  const atlas = readMtl('newmtl Atlas\nKd 0.8 0.8 0.8\nmap_Kd Zombie_Atlas.png\n', { model: 'couch' });
  assert.equal(atlas.get('Atlas'), fromName('couch'));
});

test('a meaningful material name still beats the model name', () => {
  // The model name is a last resort, not a preference: a bed's Sheets and
  // Pillow are better read as themselves than as "bed".
  const bed = readMtl([
    'newmtl Sheets', 'Kd 0.8 0.8 0.8', 'map_Kd Atlas.png',
    'newmtl DarkWood', 'Kd 0.8 0.8 0.8', 'map_Kd Atlas.png',
  ].join('\n'), { model: 'bed' });
  assert.equal(bed.get('Sheets'), fromName('Sheets'));
  assert.notEqual(bed.get('Sheets'), bed.get('DarkWood'));
});

// --- growing things ----------------------------------------------------------

test('a tree is not blue', () => {
  // Two whole packs are plants, and "leaves" does not contain "leaf". Every one
  // of these fell through to the hash: a birch had a blue trunk and a bush had
  // blue leaves.
  const green = (hex) => parseInt(hex.slice(3, 5), 16) > parseInt(hex.slice(1, 3), 16)
    && parseInt(hex.slice(3, 5), 16) > parseInt(hex.slice(5, 7), 16);
  for (const name of ['BirchTree_Leaves', 'Bush_Leaves', 'MapleTree_Leaves', 'Foliage']) {
    assert.ok(green(fromName(name)), `${name} came out ${fromName(name)}, which is not a leaf`);
  }
  // Bark is brown or pale, never blue.
  for (const name of ['NormalTree_Bark', 'MapleTree_Bark', 'Trunk']) {
    const hex = fromName(name);
    assert.ok(parseInt(hex.slice(1, 3), 16) >= parseInt(hex.slice(5, 7), 16),
      `${name} came out ${hex}, which is blue`);
  }
});

test('a species name beats the part name, and the part name beats nothing', () => {
  // `MapleTree_Bark` must be bark and `MapleTree_Leaves` must be a leaf, from
  // the same species word. Longest match is what makes that work.
  assert.notEqual(fromName('MapleTree_Bark'), fromName('MapleTree_Leaves'));
  assert.equal(fromName('MapleTree_Leaves'), fromName('BirchTree_Leaves'));
  // A birch is pale, unlike every other bark.
  assert.notEqual(fromName('BirchTree_Bark'), fromName('NormalTree_Bark'));
});

// --- textures ----------------------------------------------------------------

test('a material states the image it is painted with, reduced to a filename', () => {
  // Two of the three packs that ship textured OBJ write a path from the machine
  // the artist exported on. It cannot be followed, and the name at the end of
  // it can - which is what the manifest records where to find.
  const refs = textureRefs([
    'newmtl Leaves_TwistedTree',
    'Kd 0.640000 0.640000 0.640000',
    'map_Kd C:/Leaves_TwistedTree_C.png',
    'newmtl Atlas',
    'map_Kd Zombie_Atlas.png',
    'newmtl Plain',
    'Kd 0.500000 0.200000 0.100000',
  ].join('\n'));

  assert.equal(refs.get('Leaves_TwistedTree'), 'Leaves_TwistedTree_C.png');
  assert.equal(refs.get('Atlas'), 'Zombie_Atlas.png');
  assert.equal(refs.has('Plain'), false, 'a material with no image asks for none');
});

test('options written before a texture filename are not mistaken for it', () => {
  const refs = textureRefs('newmtl M\nmap_Kd -s 1 1 1 -o 0 0 0 Wall.png');
  assert.equal(refs.get('M'), 'Wall.png');
});

test('texture coordinates are flipped, because an OBJ measures v upward', () => {
  // An OBJ's origin is the bottom left of the image and a PNG is stored from
  // the top down. Getting this wrong paints every model from the wrong half of
  // its atlas, which looks like a plausible picture of the wrong thing.
  const mesh = readObj([
    'v 0 0 0', 'v 1 0 0', 'v 0 1 0',
    'vt 0 0', 'vt 1 0', 'vt 0 1',
    'usemtl M',
    'f 1/1 2/2 3/3',
  ].join('\n'), new Map([['M', '#ffffff']]), new Map([['M', 'atlas.png']]));

  assert.equal(mesh.uvs.length, 1);
  assert.deepEqual(mesh.uvs[0][0], [0, 1], 'v = 0 is the bottom of the picture');
  assert.deepEqual(mesh.uvs[0][2], [0, 0], 'v = 1 is the top');
  assert.deepEqual(mesh.images, [{ name: 'atlas.png', uri: 'atlas.png' }]);
  assert.deepEqual(mesh.faceImage, [0]);
});

test('a face written without a texture coordinate is not given one', () => {
  // `v`, `v/vt`, `v//vn` and `v/vt/vn` are all legal, and only two of them
  // carry a coordinate. A reader that takes the second field regardless would
  // read a normal's index as a texture coordinate.
  const mesh = readObj([
    'v 0 0 0', 'v 1 0 0', 'v 0 1 0', 'v 1 1 0',
    'vt 0 0', 'vt 1 0', 'vt 0 1',
    'vn 0 0 1',
    'usemtl M',
    'f 1 2 3',
    'f 1//1 2//1 3//1',
    'f 1/1/1 2/2/1 3/3/1',
  ].join('\n'), new Map([['M', '#ffffff']]), new Map([['M', 'atlas.png']]));

  assert.equal(mesh.uvs[0], null, 'no fields at all');
  assert.equal(mesh.uvs[1], null, 'a normal but no texture coordinate');
  assert.deepEqual(mesh.uvs[2][1], [1, 1], 'both, and the coordinate is read');
});

test('a polygon keeps the right coordinate on each triangle it fans into', () => {
  const mesh = readObj([
    'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0',
    'vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1',
    'usemtl M',
    'f 1/1 2/2 3/3 4/4',
  ].join('\n'), new Map([['M', '#ffffff']]), new Map([['M', 'atlas.png']]));

  assert.equal(mesh.triangles.length, 2, 'a quad is two triangles');
  // The corners a triangle got and the coordinates it got must be the same
  // corners, or a model is painted with its texture shuffled.
  assert.deepEqual(mesh.uvs[0], [[0, 1], [1, 1], [1, 0]]);
  assert.deepEqual(mesh.uvs[1], [[0, 1], [1, 0], [0, 0]]);
});

test('several materials sharing one image list it once', () => {
  const mesh = readObj([
    'v 0 0 0', 'v 1 0 0', 'v 0 1 0',
    'vt 0 0', 'vt 1 0', 'vt 0 1',
    'usemtl A', 'f 1/1 2/2 3/3',
    'usemtl B', 'f 1/1 2/2 3/3',
  ].join('\n'), new Map(), new Map([['A', 'shared.png'], ['B', 'shared.png']]));

  assert.equal(mesh.images.length, 1, 'one image, fetched once');
  assert.deepEqual(mesh.faceImage, [0, 0]);
});

test('a model with no textures reads exactly as it always did', () => {
  const mesh = readObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3');
  assert.equal(mesh.triangles.length, 1);
  assert.deepEqual(mesh.faceImage, [-1]);
  assert.deepEqual(mesh.uvs, [null]);
  assert.deepEqual(mesh.images, []);
});
