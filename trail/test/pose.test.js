import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { readGltf, clipNames } from '../lib/gltf.js';
import { fromTriangles } from '../lib/mesh.js';
import { assembleMeshes } from '../lib/scene.js';

// A rigged model, built here rather than read from a pack, because the packs
// are not in the repository. It is the smallest thing that can be posed: one
// triangle hanging off one bone, and a clip that turns that bone.

/** Typed arrays laid end to end, with a buffer view describing each. */
function pack(arrays) {
  const parts = arrays.map((a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const bytes = new Uint8Array(total);
  const views = [];
  let at = 0;
  for (const part of parts) {
    views.push({ buffer: 0, byteOffset: at, byteLength: part.byteLength });
    bytes.set(part, at);
    at += part.byteLength;
  }
  return { bytes, views };
}

const QUARTER_TURN_Z = [0, 0, Math.SQRT1_2, Math.SQRT1_2];

/**
 * One triangle, weighted entirely to a bone that a clip turns.
 *
 * The bone rests along +Y. `Turn` rotates it a quarter turn about Z at one
 * second, which swings anything attached to it from +Y round to -X.
 */
function rigged() {
  const positions = new Float32Array([0, 1, 0, 1, 1, 0, 0, 2, 0]);
  const joints = new Uint8Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  const weights = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  // Joint 0 rests at the origin; joint 1 rests one unit up. The inverse bind
  // matrix of each undoes exactly that.
  const bind = new Float32Array([
    1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
    1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1, 0, 1,
  ]);
  const times = new Float32Array([0, 1]);
  const turns = new Float32Array([0, 0, 0, 1, ...QUARTER_TURN_Z]);

  const { bytes, views } = pack([positions, joints, weights, bind, times, turns]);
  const b64 = Buffer.from(bytes).toString('base64');

  return {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0, 2] }],
    nodes: [
      { name: 'root', children: [1] },
      { name: 'bone', translation: [0, 1, 0] },
      { name: 'body', mesh: 0, skin: 0 },
    ],
    skins: [{ joints: [0, 1], inverseBindMatrices: 3 }],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 },
        material: 0,
      }],
    }],
    materials: [{ name: 'M_Body', pbrMetallicRoughness: { baseColorFactor: [0.5, 0.2, 0.1, 1] } }],
    animations: [{
      name: 'Turn',
      channels: [{ sampler: 0, target: { node: 0, path: 'rotation' } }],
      samplers: [{ input: 4, output: 5, interpolation: 'LINEAR' }],
    }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5121, count: 3, type: 'VEC4' },
      { bufferView: 2, componentType: 5126, count: 3, type: 'VEC4' },
      { bufferView: 3, componentType: 5126, count: 2, type: 'MAT4' },
      { bufferView: 4, componentType: 5126, count: 2, type: 'SCALAR' },
      { bufferView: 5, componentType: 5126, count: 2, type: 'VEC4' },
    ],
    bufferViews: views,
    buffers: [{ byteLength: bytes.byteLength, uri: `data:application/octet-stream;base64,${b64}` }],
  };
}

const corners = (mesh) => mesh.triangles[0];
const near = (a, b, slack = 1e-5) => Math.abs(a - b) < slack;

// --- reading what a document offers -----------------------------------------

test('the poses a model can be put into are listed by name', () => {
  assert.deepEqual(clipNames(rigged()), ['Turn']);
  assert.deepEqual(clipNames({}), []);
  assert.deepEqual(clipNames(null), []);
});

test('asking for a pose that does not exist says what does', () => {
  assert.throws(
    () => readGltf(rigged(), [], { name: 'dummy', pose: { clip: 'Backflip', time: 0 } }),
    /no pose called "Backflip".*Turn/s,
  );
});

// --- skinning ----------------------------------------------------------------

test('a skinned model with no pose comes out in its rest shape', () => {
  const mesh = readGltf(rigged(), [], { name: 'dummy' });
  assert.equal(mesh.triangles.length, 1);
  assert.deepEqual(corners(mesh)[0].map((v) => Math.round(v * 1000) / 1000), [0, 1, 0]);
});

test('a pose at rest leaves the model where it was', () => {
  const rest = readGltf(rigged(), [], { name: 'dummy', pose: { clip: 'Turn', time: 0 } });
  const [x, y, z] = corners(rest)[0];
  assert.ok(near(x, 0) && near(y, 1) && near(z, 0), `moved to ${x},${y},${z}`);
});

test('turning a bone carries what is attached to it', () => {
  // The clip turns the *root*, and the chain hangs off it: the bone rests one
  // unit above the root and this vertex one unit above the bone, so it sits two
  // units out. A quarter turn about Z sends +Y to -X, which puts it at x = -2.
  const posed = readGltf(rigged(), [], { name: 'dummy', pose: { clip: 'Turn', time: 1 } });
  const [x, y, z] = corners(posed)[2];      // the vertex at [0, 2, 0] at rest
  assert.ok(near(x, -2, 1e-4), `expected x of -2, got ${x}`);
  assert.ok(near(y, 0, 1e-4), `expected y of 0, got ${y}`);
  assert.ok(near(z, 0, 1e-4), `expected z of 0, got ${z}`);
});

test('a moment between two keys is between the two poses', () => {
  const half = readGltf(rigged(), [], { name: 'dummy', pose: { clip: 'Turn', time: 0.5 } });
  const [x, y] = corners(half)[2];
  // Half a quarter turn is an eighth, so the vertex is up and to the left of
  // where it started but has not gone all the way round.
  assert.ok(x < -0.5 && x > -1.9, `x of ${x} is not part way round`);
  assert.ok(y > 0.5 && y < 1.9, `y of ${y} is not part way round`);
  // Still two units from the joint it turns about. A rotation that changes the
  // distance is not a rotation, and normalising the quaternion is what keeps
  // this true.
  assert.ok(near(Math.hypot(x, y), 2, 1e-4), `the model changed size: ${Math.hypot(x, y)}`);
});

test('a time past the end of a clip holds its last frame', () => {
  const end = readGltf(rigged(), [], { name: 'dummy', pose: { clip: 'Turn', time: 1 } });
  const past = readGltf(rigged(), [], { name: 'dummy', pose: { clip: 'Turn', time: 99 } });
  assert.deepEqual(corners(past)[2], corners(end)[2]);
});

test('a pose can be asked for by index as well as by name', () => {
  const byName = readGltf(rigged(), [], { name: 'dummy', pose: { clip: 'Turn', time: 1 } });
  const byIndex = readGltf(rigged(), [], { name: 'dummy', pose: { clip: 0, time: 1 } });
  assert.deepEqual(corners(byIndex)[2], corners(byName)[2]);
});

test('the mesh node transform is ignored on a skinned model', () => {
  // The specification is explicit: a skinned mesh is placed by its joints and
  // its own node transform must not be applied. Obeying it is what stops a
  // character being moved twice.
  const doc = rigged();
  doc.nodes[2].translation = [100, 100, 100];
  const mesh = readGltf(doc, [], { name: 'dummy' });
  const [x] = corners(mesh)[0];
  assert.ok(near(x, 0), `the node transform leaked in: x is ${x}`);
});

// --- tint slots --------------------------------------------------------------

test('a material named as a slot becomes one, so a cast shares a model', () => {
  const raw = readGltf(rigged(), [], {
    name: 'dummy',
    pose: { clip: 'Turn', time: 0 },
    slots: { M_Body: 'primary' },
  });
  assert.deepEqual(raw.slots, ['primary']);

  const mesh = fromTriangles(raw);
  assert.equal(mesh.palette.length, 1);
  assert.equal(mesh.palette[0].slot, 'primary');
  // And the recipe's own colour survives as the fallback, so an untinted
  // placement looks like the model rather than turning grey.
  assert.match(mesh.palette[0].hex, /^#[0-9a-f]{6}$/);
});

test('without a slot map nothing is tintable, and nothing breaks', () => {
  const raw = readGltf(rigged(), [], { name: 'dummy' });
  assert.deepEqual(raw.slots, [null]);
  assert.equal(fromTriangles(raw).palette[0].slot, undefined);
});

test('two faces of one colour in different slots stay two palette entries', () => {
  // Otherwise tinting a character's shirt would tint their shoes.
  const mesh = fromTriangles({
    triangles: [
      [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      [[0, 0, 1], [1, 0, 1], [0, 1, 1]],
    ],
    colours: ['#808080', '#808080'],
    slots: ['primary', 'secondary'],
  });
  assert.equal(mesh.palette.length, 2);
  assert.deepEqual(mesh.palette.map((e) => e.slot), ['primary', 'secondary']);
});

// --- the poses the manifest actually offers ----------------------------------

test('every pose in the manifest names a clip and a moment', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../models/index.json', import.meta.url), 'utf8')
  );
  for (const pose of manifest.poses ?? []) {
    assert.ok(pose.name && pose.file && pose.clip, `${pose.name ?? 'a pose'} is incomplete`);
    assert.ok(Number.isFinite(pose.time) && pose.time >= 0,
      `${pose.name} is frozen at "${pose.time}", which is not a moment`);
    assert.equal(pose.licence, 'CC0', `${pose.name} is not established as CC0`);
  }
  const names = (manifest.poses ?? []).map((p) => p.name);
  assert.equal(new Set(names).size, names.length, 'two poses share a name');
});

test('one model placed twice can be two different people', () => {
  // The whole point of a slot: the cast shares a mesh and differs by colour,
  // which is what makes a crowd affordable.
  const raw = readGltf(rigged(), [], {
    name: 'dummy', pose: { clip: 'Turn', time: 0 }, slots: { M_Body: 'primary' },
  });
  const mesh = fromTriangles(raw);
  const merged = assembleMeshes([
    { mesh, grid: { palette: mesh.palette }, at: [0, 0, 0], model: 'a', tints: { primary: '#e08a3c' } },
    { mesh, grid: { palette: mesh.palette }, at: [3, 0, 0], model: 'b', tints: { primary: '#3c7ae0' } },
  ]);

  const colourAt = (range) => [0, 1, 2].map((a) => merged.colours[range.start * 3 + a]);
  const [one, two] = merged.ranges.map(colourAt);
  assert.notDeepEqual(one, two, 'both placements came out the same colour');
  // The first is orange and the second blue, so the slot reached the right one.
  assert.ok(one[0] > one[2], `expected the first to be warm, got ${one}`);
  assert.ok(two[2] > two[0], `expected the second to be cool, got ${two}`);
});

test('a placement with no tints keeps the model its own colours', () => {
  const raw = readGltf(rigged(), [], {
    name: 'dummy', pose: { clip: 'Turn', time: 0 }, slots: { M_Body: 'primary' },
  });
  const mesh = fromTriangles(raw);
  const merged = assembleMeshes([
    { mesh, grid: { palette: mesh.palette }, at: [0, 0, 0], model: 'a' },
  ]);
  const [r, g, b] = [0, 1, 2].map((a) => merged.colours[a]);
  // The material is a warm brown. Untinted it should still be that, not grey.
  assert.ok(r > g && g > b, `an untinted slot lost the model's colour: ${r},${g},${b}`);
});
