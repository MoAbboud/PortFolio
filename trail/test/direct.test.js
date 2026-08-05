import test from 'node:test';
import assert from 'node:assert/strict';

import { fromTriangles, surfaceNets } from '../lib/mesh.js';
import { preview, coverage } from '../lib/thumb.js';
import { assembleMeshes, finishFor } from '../lib/scene.js';
import { voxeliseMesh } from '../lib/obj.js';
import { hollow } from '../lib/voxel.js';

// A pyramid: four triangles, distinct colours, an obvious up and down.
const PYRAMID = {
  triangles: [
    [[-1, 0, -1], [1, 0, -1], [0, 2, 0]],
    [[1, 0, -1], [1, 0, 1], [0, 2, 0]],
    [[1, 0, 1], [-1, 0, 1], [0, 2, 0]],
    [[-1, 0, 1], [-1, 0, -1], [0, 2, 0]],
  ],
  colours: ['#ff0000', '#00ff00', '#0000ff', '#ffff00'],
};

test('a model keeps every triangle its artist drew', () => {
  const mesh = fromTriangles(PYRAMID);
  assert.equal(mesh.triangles, 4);
  assert.equal(mesh.count, 12, 'three vertices a face, so an edge stays an edge');
  assert.equal(mesh.indices.length, 12);
});

test('what comes out is the same shape a voxel surface produces', () => {
  // This is the whole reason the change is small: everything downstream was
  // written against this shape and knows nothing about where it came from.
  const direct = fromTriangles(PYRAMID);
  const voxels = surfaceNets(hollow(voxeliseMesh(PYRAMID, { id: 'p', cells: 8 })), { roundness: 0 });
  for (const key of ['positions', 'normals', 'values', 'indices', 'count', 'triangles', 'motions']) {
    assert.ok(key in direct, `a direct mesh is missing "${key}"`);
    assert.ok(key in voxels, `a voxel surface is missing "${key}"`);
  }
  assert.equal(direct.positions.constructor, voxels.positions.constructor);
  assert.equal(direct.values.constructor, voxels.values.constructor);
});

test('a face carries its own normal, so flat shading stays flat', () => {
  const mesh = fromTriangles(PYRAMID);
  for (let f = 0; f < mesh.triangles; f++) {
    const [a, b, c] = [0, 1, 2].map((k) => (f * 3 + k) * 3);
    assert.deepEqual(
      [mesh.faceNormals[a], mesh.faceNormals[a + 1], mesh.faceNormals[a + 2]],
      [mesh.faceNormals[b], mesh.faceNormals[b + 1], mesh.faceNormals[b + 2]],
      'two corners of one face disagree about which way it points',
    );
    const length = Math.hypot(mesh.faceNormals[c], mesh.faceNormals[c + 1], mesh.faceNormals[c + 2]);
    assert.ok(Math.abs(length - 1) < 1e-5, `normal is ${length} long`);
  }
});

test('copies of one corner agree, so the shimmer cannot tear the model open', () => {
  // Vertices are kept per face, so a corner where three faces meet exists
  // three times. The renderer moves a vertex along its normal by an amount its
  // seed decides; if the copies disagree about either they walk apart and open
  // a hole you can see through, which is exactly what happened when this
  // shipped without welding.
  const w = 2;
  const v = [
    [-w, 0, -w], [w, 0, -w], [w, w, -w], [-w, w, -w],
    [-w, 0, w], [w, 0, w], [w, w, w], [-w, w, w],
  ];
  const faces = [
    [0, 3, 2], [0, 2, 1], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4],
    [3, 7, 6], [3, 6, 2], [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5],
  ];
  const mesh = fromTriangles({
    triangles: faces.map((f) => f.map((i) => v[i])),
    colours: faces.map(() => '#888888'),
  });
  const merged = assembleMeshes([
    { mesh, grid: { palette: mesh.palette }, at: [0, 0, 0], rot: 0, model: 'box' },
  ]);

  const key = (n) => [0, 1, 2].map((a) => Math.round(mesh.positions[n * 3 + a] * 1000)).join(',');
  const groups = new Map();
  for (let n = 0; n < mesh.count; n++) {
    if (!groups.has(key(n))) groups.set(key(n), []);
    groups.get(key(n)).push(n);
  }

  let shared = 0;
  for (const copies of groups.values()) {
    if (copies.length < 2) continue;
    shared++;
    for (const n of copies) {
      assert.ok(Math.abs(merged.seeds[n] - merged.seeds[copies[0]]) < 1e-9,
        'two copies of one corner would shimmer by different amounts');
      for (let a = 0; a < 3; a++) {
        assert.ok(Math.abs(merged.normals[n * 3 + a] - merged.normals[copies[0] * 3 + a]) < 1e-6,
          'two copies of one corner would shimmer in different directions');
      }
    }
  }
  assert.ok(shared >= 8, `expected a box to share its corners, found ${shared}`);
});

test('a model stands on the ground and is centred over it', () => {
  const mesh = fromTriangles(PYRAMID);
  let minY = Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  for (let v = 0; v < mesh.count; v++) {
    minY = Math.min(minY, mesh.positions[v * 3 + 1]);
    minX = Math.min(minX, mesh.positions[v * 3]);
    maxX = Math.max(maxX, mesh.positions[v * 3]);
  }
  assert.ok(Math.abs(minY) < 1e-6, `the model floats or sinks: its base is at ${minY}`);
  assert.ok(Math.abs(minX + maxX) < 1e-6, 'the model is not centred across x');
});

test('a real height resizes the model without reshaping it', () => {
  const plain = fromTriangles(PYRAMID);
  const sized = fromTriangles(PYRAMID, { height: 6 });
  assert.ok(Math.abs(sized.size[1] - 6) < 1e-5, `asked for 6 tall, got ${sized.size[1]}`);
  const ratio = sized.size[0] / plain.size[0];
  assert.ok(Math.abs(ratio - sized.size[2] / plain.size[2]) < 1e-5, 'the model was stretched');
});

test('one palette entry per distinct colour, and a face points at its own', () => {
  const mesh = fromTriangles(PYRAMID);
  assert.equal(mesh.palette.length, 4);
  const used = new Set();
  for (let f = 0; f < mesh.triangles; f++) used.add(mesh.values[f * 3]);
  assert.equal(used.size, 4, 'four differently coloured faces should use four palette slots');
  assert.equal(mesh.palette[mesh.values[0] - 1].hex, '#ff0000');
});

test('an empty or flat model is refused with a reason', () => {
  assert.throws(() => fromTriangles({ triangles: [], colours: [] }), /no triangles/);
  assert.throws(
    () => fromTriangles({ triangles: [[[1, 1, 1], [1, 1, 1], [1, 1, 1]]], colours: ['#fff'] }),
    /no size/,
  );
});

test('real geometry goes through placing and merging unchanged', () => {
  const mesh = fromTriangles(PYRAMID);
  const merged = assembleMeshes([
    { mesh, grid: { palette: mesh.palette }, at: [3, 0, -2], rot: 45, model: 'pyramid', from: 1, until: 4 },
    { mesh, grid: { palette: mesh.palette }, at: [-3, 0, 2], rot: 0, model: 'pyramid' },
  ]);
  assert.equal(merged.triangles, 8);
  assert.equal(merged.ranges.length, 2);
  // Ghosting is a per-vertex attribute, so it reaches a mesh exactly as it
  // reached a cube.
  assert.equal(merged.fromStep[0], 1);
  assert.equal(merged.untilStep[0], 4);
  assert.notEqual(merged.positions[0], merged.positions[merged.ranges[1].start * 3]);
});

// --- occlusion ---------------------------------------------------------------

/** A box with its faces wound outward, so its normals point out of it. */
function box(cx, cz, w, h, d) {
  const [x0, x1] = [cx - w / 2, cx + w / 2];
  const [z0, z1] = [cz - d / 2, cz + d / 2];
  const v = [
    [x0, 0, z0], [x1, 0, z0], [x1, h, z0], [x0, h, z0],
    [x0, 0, z1], [x1, 0, z1], [x1, h, z1], [x0, h, z1],
  ];
  const faces = [
    [0, 3, 2], [0, 2, 1], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4],
    [3, 7, 6], [3, 6, 2], [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5],
  ];
  return { triangles: faces.map((f) => f.map((i) => v[i])), colours: faces.map(() => '#888888') };
}

test('a face tucked into a crease is darker than one in the open', () => {
  // Two boxes with a narrow gap. The walls facing each other are enclosed;
  // the outward walls are not. Without this the renderer's occlusion term does
  // nothing, every model is lit flat, and a shape reads as a silhouette.
  const a = box(0, 0, 2, 2, 2);
  const b = box(2.3, 0, 2, 2, 2);
  const mesh = fromTriangles({
    triangles: [...a.triangles, ...b.triangles],
    colours: [...a.colours, ...b.colours],
  });
  assert.ok(mesh.ao, 'no occlusion was baked at all');

  const facing = [];
  const open = [];
  for (let f = 0; f < mesh.triangles; f++) {
    const v = f * 3;
    let cx = 0;
    for (let k = 0; k < 3; k++) cx += mesh.positions[(v + k) * 3];
    cx /= 3;
    const nx = mesh.faceNormals[v * 3];
    if (cx < 0 && nx > 0.9) facing.push(mesh.ao[v]);
    if (cx < 0 && nx < -0.9) open.push(mesh.ao[v]);
  }
  const mean = (list) => list.reduce((s, x) => s + x, 0) / list.length;
  assert.ok(facing.length && open.length, 'the test did not find the walls it meant to compare');
  assert.ok(mean(facing) < mean(open) - 0.05,
    `the enclosed wall is ${mean(facing).toFixed(2)} against ${mean(open).toFixed(2)} in the open`);
});

test('occlusion stays within the range the shader expects', () => {
  const mesh = fromTriangles(PYRAMID);
  for (let v = 0; v < mesh.count; v++) {
    assert.ok(mesh.ao[v] >= 0 && mesh.ao[v] <= 1, `occlusion of ${mesh.ao[v]} is outside 0..1`);
  }
});

// --- previewing real geometry ------------------------------------------------

const bounds = (pixels, size) => {
  let x0 = Infinity; let y0 = Infinity; let x1 = -1; let y1 = -1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (pixels[(y * size + x) * 4 + 3]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return { top: y0, bottom: size - 1 - y1, left: x0, right: size - 1 - x1 };
};

test('a mesh previews to something, centred and inside its tile', () => {
  const size = 64;
  const pixels = preview(fromTriangles(PYRAMID), size);
  assert.ok(coverage(pixels) > 0.05, 'the preview is empty');
  const { top, bottom, left, right } = bounds(pixels, size);
  assert.ok(Math.abs(top - bottom) <= 1, `${top} from the top and ${bottom} from the bottom`);
  assert.ok(Math.abs(left - right) <= 1, `${left} from the left and ${right} from the right`);
  for (const [edge, gap] of Object.entries({ top, bottom, left, right })) {
    assert.ok(gap >= 1, `the preview touches the ${edge} of its tile`);
  }
});

test('a nearer face hides one behind it', () => {
  // Two identical quads, the second slid along the direction the camera looks
  // from. That is the one translation which lands both in exactly the same
  // place on screen while putting one genuinely in front of the other, so it
  // is the only way to ask whether depth is being respected at all.
  const quad = (t, colour) => ({
    triangles: [
      [[-1 + t, 0 + t, t], [1 + t, 0 + t, t], [1 + t, 2 + t, t]],
      [[-1 + t, 0 + t, t], [1 + t, 2 + t, t], [-1 + t, 2 + t, t]],
    ],
    colours: [colour, colour],
  });
  const behind = quad(0, '#ff0000');
  const infront = quad(3, '#0000ff');
  // The far one is listed *last* on purpose. Drawn in order it would paint
  // over the near one, so only a depth buffer can give the right answer here -
  // and the first version of this test had them the other way round, where
  // painter's order alone passed it and it proved nothing.
  const pixels = preview(fromTriangles({
    triangles: [...infront.triangles, ...behind.triangles],
    colours: [...infront.colours, ...behind.colours],
  }), 64);

  let red = 0;
  let blue = 0;
  for (let p = 0; p < pixels.length; p += 4) {
    if (!pixels[p + 3]) continue;
    if (pixels[p] > pixels[p + 2]) red++;
    else blue++;
  }
  assert.ok(blue > red, `the far quad won: ${red} red against ${blue} blue`);
});

test('a preview shades a face by which way it points', () => {
  const mesh = fromTriangles({
    triangles: [
      [[-2, 2, -2], [2, 2, -2], [2, 2, 2]],      // facing up
      [[-2, 0, -2], [-2, 2, -2], [-2, 2, 2]],    // facing sideways
    ],
    colours: ['#808080', '#808080'],
  });
  const pixels = preview(mesh, 64);
  const levels = new Set();
  for (let p = 0; p < pixels.length; p += 4) if (pixels[p + 3]) levels.add(pixels[p]);
  assert.ok(levels.size > 1, 'every face came out the same brightness, so nothing is shaded');
});

test('a preview of an empty model is empty rather than a crash', () => {
  assert.equal(coverage(preview(null, 32)), 0);
  assert.equal(coverage(preview({ positions: new Float32Array(0), count: 0 }, 32)), 0);
});

// --- how fine a model is, and what follows from it ---------------------------

test('a model reports how wide its triangles typically are', () => {
  const coarse = fromTriangles(box(0, 0, 2, 2, 2));
  // The same box cut into far smaller pieces would report a far smaller edge.
  const fine = fromTriangles({
    triangles: Array.from({ length: 200 }, (_, i) => {
      const x = (i / 200) * 2 - 1;
      return [[x, 0, 0], [x + 0.01, 0, 0], [x, 0.01, 0]];
    }),
    colours: Array.from({ length: 200 }, () => '#888888'),
  });
  assert.ok(coarse.edge > fine.edge * 10,
    `a chunky box (${coarse.edge}) should be far coarser than a fine strip (${fine.edge})`);
});

test('a chunky model keeps its facets and its shimmer', () => {
  // The low-poly packs are meant to look faceted and the shimmer was sized for
  // them, so nothing about them should change.
  const [smoothness, wobble] = finishFor(0.09);
  assert.equal(smoothness, 0, 'a car was smoothed, losing the look it is drawn for');
  assert.equal(wobble, 1, 'a car lost its shimmer');
});

test('a fine model is smoothed, and barely shimmers at all', () => {
  // A rigged character's triangles are about six millimetres. Flat shading
  // shatters it and a shimmer sized for cubes moves each vertex twice the width
  // of its own triangles, which slides neighbouring faces through each other.
  const [smoothness, wobble] = finishFor(0.0056);
  assert.equal(smoothness, 1, 'a character was left faceted');
  assert.ok(wobble < 0.2, `a character still shimmers at ${wobble} of full`);
});

test('nothing jumps between the two: a model in between is in between', () => {
  const [smoothness, wobble] = finishFor(0.028);
  assert.ok(smoothness > 0.1 && smoothness < 0.9, `smoothing snapped to ${smoothness}`);
  assert.ok(wobble > 0.2 && wobble < 0.9, `shimmer snapped to ${wobble}`);
});

test('a shrunk model is judged at the size it is actually drawn', () => {
  // Scale is applied per placement, so a model dropped to a quarter size has
  // quarter-size triangles on screen and should be treated as the finer thing
  // it has become.
  const full = finishFor(0.05, 1);
  const small = finishFor(0.05, 0.2);
  assert.ok(small[0] > full[0], 'shrinking a model did not make it smoother');
  assert.ok(small[1] < full[1], 'shrinking a model did not calm its shimmer');
});

test('the shimmer can never push a vertex further than its own triangles', () => {
  // The actual failure, stated as a number. The renderer moves a vertex by
  // uShimmer * 3 * wobble, and the default shimmer is 0.004.
  const DEFAULT_SHIMMER = 0.004;
  for (const edge of [0.0056, 0.012, 0.03, 0.0539, 0.0927]) {
    const [, wobble] = finishFor(edge);
    const moved = DEFAULT_SHIMMER * 3 * wobble;
    assert.ok(moved < edge,
      `a model with ${edge} triangles is moved ${moved.toFixed(4)}, which opens it up`);
  }
});
