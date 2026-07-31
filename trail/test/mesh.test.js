import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { surfaceNets } from '../lib/mesh.js';
import { voxelise, hollow } from '../lib/voxel.js';

const model = (name) => JSON.parse(
  readFileSync(fileURLToPath(new URL(`../models/${name}.json`, import.meta.url)), 'utf8')
);

const box = (size, unit = 1) => voxelise({
  id: 'block', unit, anchor: 'base',
  parts: [{ solid: 'box', at: [0, size[1] / 2, 0], size, color: '#ff0000' }],
});

const ball = (diameter = 2, unit = 0.1) => voxelise({
  id: 'ball', unit, anchor: 'center',
  parts: [{ solid: 'sphere', at: [0, 0, 0], size: [diameter, diameter, diameter], color: '#00ff00' }],
});

const extent = (mesh, axis) => {
  let lo = Infinity, hi = -Infinity;
  for (let i = axis; i < mesh.positions.length; i += 3) {
    lo = Math.min(lo, mesh.positions[i]);
    hi = Math.max(hi, mesh.positions[i]);
  }
  return { lo, hi, size: hi - lo };
};

test('a solid block becomes a closed surface', () => {
  const mesh = surfaceNets(box([4, 4, 4]), { roundness: 0 });
  assert.ok(mesh.count > 0, 'no vertices were produced');
  assert.ok(mesh.triangles > 0, 'no triangles were produced');
  assert.equal(mesh.indices.length % 3, 0);
});

test('the surface is watertight: every edge is shared by exactly two triangles', () => {
  // The property that matters. A hole shows up as an edge used once, and would
  // be visible as a gap you can see through.
  const mesh = surfaceNets(box([4, 5, 3]), { roundness: 0 });
  const edges = new Map();
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const tri = [mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]];
    for (let e = 0; e < 3; e++) {
      const [a, b] = [tri[e], tri[(e + 1) % 3]];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  const open = [...edges.values()].filter((n) => n !== 2);
  assert.equal(open.length, 0, `${open.length} edges are not shared by two triangles`);
});

test('every index points at a vertex that exists', () => {
  const mesh = surfaceNets(ball(), { roundness: 0.6 });
  for (const index of mesh.indices) {
    assert.ok(index >= 0 && index < mesh.count, `index ${index} is outside 0..${mesh.count}`);
  }
});

test('nothing comes out non-finite', () => {
  const mesh = surfaceNets(ball(), { roundness: 1 });
  assert.ok(mesh.positions.every(Number.isFinite), 'a position went bad');
  assert.ok(mesh.normals.every(Number.isFinite), 'a normal went bad');
});

test('normals are unit length', () => {
  const mesh = surfaceNets(ball(), { roundness: 0.6 });
  for (let i = 0; i < mesh.count * 3; i += 3) {
    const length = Math.hypot(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]);
    assert.ok(Math.abs(length - 1) < 1e-4, `normal ${i / 3} has length ${length}`);
  }
});

test('a sphere of cubes becomes an actually round surface', () => {
  // The whole point. Measure how far each vertex sits from the centre: on a
  // real sphere they are all the same distance, and on a pile of cubes the
  // corners stick out much further than the faces.
  const spread = (roundness) => {
    const mesh = surfaceNets(ball(2, 0.1), { roundness });
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < mesh.count * 3; i += 3) {
      const r = Math.hypot(mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]);
      lo = Math.min(lo, r); hi = Math.max(hi, r);
    }
    return hi / lo;
  };
  assert.ok(spread(1) < spread(0), 'relaxing should even out the radius');
});

test('roundness is a dial, not a switch', () => {
  const grid = ball(2, 0.1);
  const flat = surfaceNets(grid, { roundness: 0 });
  const some = surfaceNets(grid, { roundness: 0.5 });
  const lots = surfaceNets(grid, { roundness: 1 });
  assert.equal(some.count, flat.count, 'smoothing must not change the topology');
  assert.equal(lots.count, flat.count);
  assert.deepEqual([...lots.indices], [...flat.indices], 'the faces are the same faces');

  const moved = (a, b) => {
    let total = 0;
    for (let i = 0; i < a.positions.length; i++) total += Math.abs(a.positions[i] - b.positions[i]);
    return total;
  };
  assert.ok(moved(some, flat) > 0, 'half roundness should move something');
  assert.ok(moved(lots, flat) > moved(some, flat), 'full roundness should move more');
});

test('the surface stays roughly where the object was', () => {
  const grid = box([4, 4, 4], 0.5);
  const mesh = surfaceNets(grid, { roundness: 0.6 });
  const x = extent(mesh, 0);
  // Relaxing shrinks a shape a little; it must not move it or collapse it.
  assert.ok(x.size > 3 && x.size < 5, `block came out ${x.size.toFixed(2)} wide`);
  assert.ok(Math.abs(x.lo + x.hi) < 0.6, 'the block drifted off its own anchor');
});

test('a base-anchored object still stands on the ground', () => {
  const mesh = surfaceNets(box([4, 6, 4], 0.5), { roundness: 0.6 });
  const y = extent(mesh, 1);
  assert.ok(y.lo > -0.6 && y.lo < 0.6, `the base sat at ${y.lo.toFixed(2)} instead of 0`);
});

test('an empty grid produces an empty mesh rather than throwing', () => {
  const grid = { dims: [2, 2, 2], cells: new Uint8Array(8), unit: 1, offset: [0, 0, 0] };
  const mesh = surfaceNets(grid, { roundness: 0.5 });
  assert.equal(mesh.count, 0);
  assert.equal(mesh.indices.length, 0);
});

test('a single cube produces a closed shape', () => {
  const grid = { dims: [1, 1, 1], cells: Uint8Array.from([1]), unit: 1, offset: [0, 0, 0] };
  const mesh = surfaceNets(grid, { roundness: 0 });
  assert.ok(mesh.count >= 8, `a lone cube gave ${mesh.count} vertices`);
  assert.ok(mesh.triangles >= 12);
});

test('vertices carry the colour of the material they came from', () => {
  const mesh = surfaceNets(ball(), { roundness: 0.5 });
  assert.equal(mesh.values.length, mesh.count);
  assert.ok([...mesh.values].every((v) => v > 0), 'a vertex took its colour from empty space');
});

test('the real models mesh, and are cheaper than their cubes', () => {
  for (const name of ['house', 'car', 'tree']) {
    const grid = hollow(voxelise(model(name)));
    const mesh = surfaceNets(grid, { roundness: 0.6 });
    assert.ok(mesh.count > 50, `${name} meshed to almost nothing`);
    assert.ok(mesh.positions.every(Number.isFinite), `${name} produced a bad position`);
    // A cube is 24 vertices and 12 triangles; a surface vertex is one vertex.
    let cubes = 0;
    for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i]) cubes++;
    assert.ok(mesh.count < cubes * 24, `${name}: meshing should cost less than drawing cubes`);
  }
});

test('occlusion darkens creases and leaves open surfaces alone', () => {
  // Two blocks with a narrow gap between them. The facing walls of the gap are
  // enclosed and should be darker than the outer walls, which see the sky.
  const grid = voxelise({
    id: 'canyon', unit: 1, anchor: 'base',
    parts: [
      { solid: 'box', at: [-3, 3, 0], size: [4, 6, 8], color: '#888888' },
      { solid: 'box', at: [3, 3, 0], size: [4, 6, 8], color: '#888888' },
    ],
  });
  const mesh = surfaceNets(grid, { roundness: 0 });

  const averageAo = (test) => {
    let sum = 0, n = 0;
    for (let v = 0; v < mesh.count; v++) {
      const p = [mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]];
      if (!test(p)) continue;
      sum += mesh.ao[v]; n++;
    }
    return n ? sum / n : null;
  };

  const inside = averageAo((p) => Math.abs(p[0]) < 1.6 && p[1] > 1 && p[1] < 5);
  const outside = averageAo((p) => Math.abs(p[0]) > 4.4 && p[1] > 1 && p[1] < 5);
  assert.ok(inside !== null && outside !== null, 'the test did not find the walls it needed');
  assert.ok(inside < outside,
    `the inside of the gap (${inside.toFixed(2)}) should be darker than the outside (${outside.toFixed(2)})`);
});

test('occlusion stays within its range', () => {
  for (const name of ['house', 'car', 'tree']) {
    const mesh = surfaceNets(hollow(voxelise(model(name))), { roundness: 0.6 });
    assert.equal(mesh.ao.length, mesh.count);
    assert.ok([...mesh.ao].every((v) => v >= 0 && v <= 1), `${name} produced occlusion out of range`);
  }
});

test('vertices inherit the moving part they belong to', () => {
  const grid = hollow(voxelise(model('tree')));
  const mesh = surfaceNets(grid, { roundness: 0 });

  assert.ok(mesh.motions.length > 0, 'the tree should declare moving parts');
  assert.equal(mesh.motion.length, mesh.count);

  const moving = [...mesh.motion].filter((m) => m > 0).length;
  assert.ok(moving > 0, 'nothing in the tree moves');
  assert.ok(moving < mesh.count, 'the whole tree moves, including the trunk');

  // Every motion index must point at a part that exists.
  for (const index of mesh.motion) {
    assert.ok(index <= mesh.motions.length, `motion ${index} has no part behind it`);
  }
});

test('only the parts that should move do', () => {
  const grid = hollow(voxelise(model('tree')));
  const mesh = surfaceNets(grid, { roundness: 0 });
  const heightOf = (v) => mesh.positions[v * 3 + 1];

  let lowStill = 0, lowMoving = 0;
  for (let v = 0; v < mesh.count; v++) {
    if (heightOf(v) > 1.0) continue;      // the trunk, below the canopy
    if (mesh.motion[v]) lowMoving++; else lowStill++;
  }
  assert.ok(lowStill > lowMoving, 'the trunk should mostly be still');
});

test('a model with no moving parts still meshes', () => {
  const mesh = surfaceNets(hollow(voxelise(model('house'))), { roundness: 0 });
  assert.equal(mesh.motions.length, 0);
  assert.ok([...mesh.motion].every((m) => m === 0), 'a house should not sway');
});

test('meshing is deterministic, so a scene looks the same every load', () => {
  const grid = hollow(voxelise(model('tree')));
  const a = surfaceNets(grid, { roundness: 0.6 });
  const b = surfaceNets(grid, { roundness: 0.6 });
  assert.deepEqual([...a.positions], [...b.positions]);
  assert.deepEqual([...a.indices], [...b.indices]);
});
