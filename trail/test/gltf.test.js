import test from 'node:test';
import assert from 'node:assert/strict';

import {
  readGltf, readGlb, importGlb, externalBuffers, materialColours, fromBase64,
} from '../lib/gltf.js';
import { voxeliseMesh, fromName } from '../lib/obj.js';
import { count } from '../lib/voxel.js';

// Documents are built here rather than read from a pack, because the packs are
// hundreds of megabytes of somebody else's models and are not in the
// repository. A test that needs one downloaded is a test that does not run.

const base64 = (bytes) => Buffer.from(bytes).toString('base64');
const dataUri = (bytes) => `data:application/octet-stream;base64,${base64(bytes)}`;

/** A glTF holding one triangle, with everything optional left out. */
function triangleDoc({ material, nodes, scene } = {}) {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const indices = new Uint16Array([0, 1, 2]);
  const bytes = new Uint8Array(positions.byteLength + indices.byteLength);
  bytes.set(new Uint8Array(positions.buffer), 0);
  bytes.set(new Uint8Array(indices.buffer), positions.byteLength);

  return {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: scene ?? [0] }],
    nodes: nodes ?? [{ mesh: 0 }],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0 },
        indices: 1,
        ...(material === undefined ? {} : { material }),
      }],
    }],
    ...(material === undefined ? {} : { materials: [{ name: 'Only' }] }),
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength },
    ],
    buffers: [{ byteLength: bytes.byteLength, uri: dataUri(bytes) }],
  };
}

// --- reading ----------------------------------------------------------------

test('a triangle comes back with the corners it was given', () => {
  const mesh = readGltf(triangleDoc());
  assert.equal(mesh.triangles.length, 1);
  assert.deepEqual(mesh.triangles[0][0], [0, 0, 0]);
  assert.deepEqual(mesh.triangles[0][1], [1, 0, 0]);
  assert.deepEqual(mesh.triangles[0][2], [0, 1, 0]);
});

test('a buffer written as a data URI needs nothing fetched', () => {
  assert.deepEqual(externalBuffers(triangleDoc()), [null]);
  assert.doesNotThrow(() => readGltf(triangleDoc()));
});

test('a companion .bin is named so the caller knows what to fetch', () => {
  const doc = triangleDoc();
  doc.buffers = [{ byteLength: 4, uri: 'Building%20Small.bin' }];
  assert.deepEqual(externalBuffers(doc), ['Building Small.bin']);
});

test('a buffer that was never supplied is refused by name, not read as zeroes', () => {
  const doc = triangleDoc();
  doc.buffers = [{ byteLength: 4, uri: 'missing.bin' }];
  assert.throws(() => readGltf(doc, [], { name: 'house' }), /buffer 0 was not supplied/);
});

test('base64 decodes to the bytes it was made from', () => {
  const bytes = new Uint8Array([0, 1, 2, 253, 254, 255, 42]);
  assert.deepEqual([...fromBase64(base64(bytes))], [...bytes]);
});

test('vertex data interleaved with other attributes is read at its stride', () => {
  // Position and a normal in one buffer view, alternating, which is what an
  // exporter writes when it packs a vertex as one struct.
  const data = new Float32Array([
    0, 0, 0, 9, 9, 9,
    1, 0, 0, 9, 9, 9,
    0, 1, 0, 9, 9, 9,
  ]);
  const doc = triangleDoc();
  doc.buffers = [{ byteLength: data.byteLength, uri: dataUri(new Uint8Array(data.buffer)) }];
  doc.bufferViews = [{ buffer: 0, byteOffset: 0, byteLength: data.byteLength, byteStride: 24 }];
  doc.accessors = [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }];
  doc.meshes[0].primitives[0] = { attributes: { POSITION: 0 } };

  const mesh = readGltf(doc);
  assert.equal(mesh.triangles.length, 1);
  assert.deepEqual(mesh.triangles[0][1], [1, 0, 0], 'the stride was ignored');
});

test('a primitive with no indices reads its vertices in order', () => {
  const doc = triangleDoc();
  delete doc.meshes[0].primitives[0].indices;
  assert.equal(readGltf(doc).triangles.length, 1);
});

// --- where a vertex actually is ---------------------------------------------

test('a node moves its mesh into world space', () => {
  const mesh = readGltf(triangleDoc({ nodes: [{ mesh: 0, translation: [10, 2, -3] }] }));
  assert.deepEqual(mesh.triangles[0][0], [10, 2, -3]);
});

test('a node scales its mesh', () => {
  const mesh = readGltf(triangleDoc({ nodes: [{ mesh: 0, scale: [2, 2, 2] }] }));
  assert.deepEqual(mesh.triangles[0][1], [2, 0, 0]);
});

test('a quarter turn about Y sends +X to -Z, as a right-handed system should', () => {
  const half = Math.SQRT1_2;
  const mesh = readGltf(triangleDoc({ nodes: [{ mesh: 0, rotation: [0, half, 0, half] }] }));
  const [x, y, z] = mesh.triangles[0][1];
  assert.ok(Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6, `expected the X axis to turn, got ${x},${y},${z}`);
  assert.ok(Math.abs(z + 1) < 1e-6, `expected z to be -1, got ${z}`);
});

test('a child inherits its parent transform, and the order is parent then child', () => {
  const mesh = readGltf(triangleDoc({
    nodes: [
      { children: [1], translation: [10, 0, 0], scale: [2, 2, 2] },
      { mesh: 0, translation: [1, 0, 0] },
    ],
  }));
  // The child's own metre is doubled by the parent, so it lands at 12, not 11.
  assert.deepEqual(mesh.triangles[0][0], [12, 0, 0]);
});

test('a node given a matrix outright is used as written', () => {
  const mesh = readGltf(triangleDoc({
    nodes: [{ mesh: 0, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1] }],
  }));
  assert.deepEqual(mesh.triangles[0][0], [5, 6, 7]);
});

test('a cycle in the node graph ends rather than running forever', () => {
  const doc = triangleDoc({ nodes: [{ mesh: 0, children: [1] }, { children: [0] }] });
  assert.equal(readGltf(doc).triangles.length, 1);
});

// --- colour -----------------------------------------------------------------

test('baseColorFactor is converted from linear light, not taken literally', () => {
  const doc = triangleDoc({ material: 0 });
  doc.materials = [{ name: 'Wood', pbrMetallicRoughness: { baseColorFactor: [0.216, 0.216, 0.216, 1] } }];
  const [hex] = materialColours(doc);
  // 0.216 linear is a mid grey, about #7f7f7f. Read literally it would be #37.
  const level = parseInt(hex.slice(1, 3), 16);
  assert.ok(level > 110 && level < 145, `${hex} is not a mid grey, so the conversion is wrong`);
});

test('a pack whose colour lives in a texture falls back to the material names', () => {
  const doc = triangleDoc({ material: 0 });
  // No baseColorFactor anywhere: this is what a PBR export with a texture
  // atlas looks like, and it is the whole Downtown City pack.
  doc.materials = [
    { name: 'MI_RedBrick' }, { name: 'MI_Glass' }, { name: 'MI_Asphalt' },
  ];
  const colours = materialColours(doc);
  assert.equal(new Set(colours).size, 3, 'three materials should not be one colour');
  assert.equal(colours[0], fromName('MI_RedBrick'));
  // And red brick should actually be reddish.
  const [r, g] = [parseInt(colours[0].slice(1, 3), 16), parseInt(colours[0].slice(3, 5), 16)];
  assert.ok(r > g, `${colours[0]} is not a red`);
});

test('every material stating the same colour is treated as no colour at all', () => {
  const doc = triangleDoc({ material: 0 });
  const flat = { baseColorFactor: [0.5, 0.5, 0.5, 1] };
  doc.materials = [
    { name: 'DarkBrown', pbrMetallicRoughness: flat },
    { name: 'White', pbrMetallicRoughness: flat },
  ];
  const colours = materialColours(doc);
  assert.notEqual(colours[0], colours[1]);
});

test('one material stating a real colour is kept', () => {
  const doc = triangleDoc({ material: 0 });
  doc.materials = [{ name: 'Anything', pbrMetallicRoughness: { baseColorFactor: [0.8, 0.05, 0.05, 1] } }];
  const [hex] = materialColours(doc);
  assert.ok(parseInt(hex.slice(1, 3), 16) > parseInt(hex.slice(5, 7), 16), `${hex} is not red`);
});

test('a primitive with no material still gets a colour', () => {
  const mesh = readGltf(triangleDoc());
  assert.match(mesh.colours[0], /^#[0-9a-f]{6}$/);
});

// --- the material name table ------------------------------------------------

test('a longer name wins, so a chair is not the colour of hair', () => {
  assert.notEqual(fromName('Chair'), fromName('Hair'));
  assert.equal(fromName('DarkGrey'), fromName('darkgrey'));
  assert.notEqual(fromName('DarkGrey'), fromName('Grey'));
  assert.notEqual(fromName('LightGreen'), fromName('Green'));
});

test('separators in a material name are ignored', () => {
  assert.equal(fromName('MI_Trim_Dark'), fromName('TrimDark'));
  assert.equal(fromName('red-brick'), fromName('RedBrick'));
});

test('a dark shop interior is not the same colour as a lit interior wall', () => {
  const dark = fromName('MI_FakeInterior');
  const wall = fromName('MI_InteriorWall');
  const level = (hex) => parseInt(hex.slice(1, 3), 16);
  assert.ok(level(wall) > level(dark), 'an interior wall should be lighter than a fake interior');
});

// --- .glb -------------------------------------------------------------------

/** A .glb around a document and its buffer, as the container specifies. */
function glb(json, binary = new Uint8Array(0)) {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const pad = (bytes, filler) => {
    const extra = (4 - (bytes.byteLength % 4)) % 4;
    const out = new Uint8Array(bytes.byteLength + extra).fill(filler);
    out.set(bytes, 0);
    return out;
  };
  const jsonChunk = pad(jsonBytes, 0x20);
  const binChunk = pad(binary, 0);
  const total = 12 + 8 + jsonChunk.byteLength + (binary.byteLength ? 8 + binChunk.byteLength : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonChunk.byteLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonChunk, 20);
  if (binary.byteLength) {
    const at = 20 + jsonChunk.byteLength;
    view.setUint32(at, binChunk.byteLength, true);
    view.setUint32(at + 4, 0x004e4942, true);
    out.set(binChunk, at + 8);
  }
  return out;
}

test('a .glb gives back the document that was packed into it', () => {
  const { json } = readGlb(glb({ asset: { version: '2.0' }, nodes: [] }));
  assert.equal(json.asset.version, '2.0');
});

test('a .glb reads its own binary chunk without fetching anything', () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const doc = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }],
    buffers: [{ byteLength: positions.byteLength }],
  };
  const mesh = importGlb(glb(doc, new Uint8Array(positions.buffer)));
  assert.equal(mesh.triangles.length, 1);
  assert.deepEqual(mesh.triangles[0][1], [1, 0, 0]);
});

test('something that is not a .glb says so rather than reading rubbish', () => {
  assert.throws(() => readGlb(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])),
    /does not start with "glTF"/);
});

// --- refusing, with a reason ------------------------------------------------

test('a document with nothing to draw names itself in the refusal', () => {
  const doc = triangleDoc();
  doc.meshes[0].primitives = [];
  assert.throws(() => readGltf(doc, [], { name: 'bollard' }), /"bollard" has no triangles/);
});

test('points and lines are not a surface, and the refusal says which it was', () => {
  const doc = triangleDoc();
  doc.meshes[0].primitives[0].mode = 1;
  assert.throws(() => readGltf(doc, [], { name: 'wire' }), /points or lines/);
});

test('glTF 1.0 is refused rather than half read', () => {
  const doc = triangleDoc();
  doc.asset = { version: '1.0' };
  assert.throws(() => readGltf(doc, [], { name: 'old' }), /only 2\.0 is read/);
});

test('a sparse accessor is refused rather than silently read as zeroes', () => {
  const doc = triangleDoc();
  doc.accessors[0].sparse = { count: 1 };
  assert.throws(() => readGltf(doc), /sparse accessors are not read/);
});

// --- all the way to a grid --------------------------------------------------

test('a glTF cube voxelises to a solid box, like an OBJ one does', () => {
  // Two triangles per face, twelve in all, written as a flat vertex list.
  const corners = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
  ];
  const faces = [
    [0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [0, 4, 5], [0, 5, 1],
    [3, 2, 6], [3, 6, 7], [0, 3, 7], [0, 7, 4], [1, 5, 6], [1, 6, 2],
  ];
  const positions = new Float32Array(faces.flat().flatMap((i) => corners[i]));
  const doc = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ bufferView: 0, componentType: 5126, count: faces.length * 3, type: 'VEC3' }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }],
    buffers: [{ byteLength: positions.byteLength, uri: dataUri(new Uint8Array(positions.buffer)) }],
  };

  const grid = voxeliseMesh(readGltf(doc, [], { name: 'cube' }), { id: 'cube', cells: 12 });
  const [nx, ny, nz] = grid.dims;
  assert.ok(nx >= 12 && ny >= 12 && nz >= 12, `expected about 12 cells a side, got ${grid.dims}`);

  // Only the surface is filled, so the shell should be there and the middle
  // should not - the same property the OBJ path is tested for.
  const at = (x, y, z) => grid.cells[(z * ny + y) * nx + x];
  assert.notEqual(at(Math.floor(nx / 2), 0, Math.floor(nz / 2)), 0, 'the bottom face is missing');
  assert.equal(at(Math.floor(nx / 2), Math.floor(ny / 2), Math.floor(nz / 2)), 0,
    'the inside was filled, which is work thrown away');
  assert.ok(count(grid) > 0);
});
