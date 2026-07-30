import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  toNdc, insideFrame, rayThrough, intersectBox, pick, groundPoint, dragTo, rotateBy,
} from '../lib/pick.js';
import { voxelise, hollow } from '../lib/voxel.js';
import { assemble, objectBoxes } from '../lib/scene.js';
import { framingToView } from '../lib/camera.js';

const model = (name) => JSON.parse(
  readFileSync(fileURLToPath(new URL(`../models/${name}.json`, import.meta.url)), 'utf8')
);

const near = (a, b, tolerance = 1e-4) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} is not near ${b}`);

const VIEW = { x: 0, y: 0, w: 1600, h: 900 };
const LOOKING_DOWN = { x: -20, z: -20, w: 40, d: 40, pitch: 45, yaw: 0 };

test('the middle of the frame is the middle of the ndc square', () => {
  assert.deepEqual(toNdc(800, 450, VIEW), [0, 0]);
});

test('ndc runs left to right and bottom to top', () => {
  const [left] = toNdc(0, 450, VIEW);
  const [right] = toNdc(1600, 450, VIEW);
  const [, top] = toNdc(800, 0, VIEW);
  const [, bottom] = toNdc(800, 900, VIEW);
  assert.equal(left, -1);
  assert.equal(right, 1);
  assert.equal(top, 1);
  assert.equal(bottom, -1);
});

test('a click in the letterbox falls outside the frame', () => {
  const offset = { x: 200, y: 0, w: 1200, h: 900 };
  assert.ok(!insideFrame(toNdc(50, 450, offset)), 'left bar should not count');
  assert.ok(!insideFrame(toNdc(1550, 450, offset)), 'right bar should not count');
  assert.ok(insideFrame(toNdc(800, 450, offset)), 'the frame itself should count');
});

test('the ray through the centre of the frame points at what is being looked at', () => {
  const { eye, target } = framingToView(LOOKING_DOWN);
  const ray = rayThrough(LOOKING_DOWN, [0, 0]);
  const toTarget = [
    target[0] - eye[0], target[1] - eye[1], target[2] - eye[2],
  ];
  const length = Math.hypot(...toTarget);
  for (let a = 0; a < 3; a++) near(ray.direction[a], toTarget[a] / length, 1e-6);
});

test('a ray starts at the eye and is a unit vector', () => {
  const ray = rayThrough(LOOKING_DOWN, [0.4, -0.7]);
  assert.deepEqual(ray.origin, framingToView(LOOKING_DOWN).eye);
  near(Math.hypot(...ray.direction), 1, 1e-9);
});

test('rays fan out the way the frame does', () => {
  const left = rayThrough(LOOKING_DOWN, [-0.9, 0]);
  const right = rayThrough(LOOKING_DOWN, [0.9, 0]);
  assert.ok(left.direction[0] < right.direction[0], 'left of frame should aim further left');
  const up = rayThrough(LOOKING_DOWN, [0, 0.9]);
  const down = rayThrough(LOOKING_DOWN, [0, -0.9]);
  assert.ok(up.direction[1] > down.direction[1], 'up the frame should aim higher');
});

const BOX = { min: [-1, 0, -1], max: [1, 2, 1] };

test('a ray straight at a box hits it at the near face', () => {
  const ray = { origin: [0, 1, 10], direction: [0, 0, -1] };
  near(intersectBox(ray, BOX), 9);
});

test('a ray that misses returns nothing', () => {
  assert.equal(intersectBox({ origin: [8, 1, 10], direction: [0, 0, -1] }, BOX), null);
  assert.equal(intersectBox({ origin: [0, 40, 10], direction: [0, 0, -1] }, BOX), null);
});

test('a ray pointing away from a box does not hit it', () => {
  assert.equal(intersectBox({ origin: [0, 1, 10], direction: [0, 0, 1] }, BOX), null);
});

test('a ray parallel to a face outside the box misses', () => {
  assert.equal(intersectBox({ origin: [0, 9, 0], direction: [1, 0, 0] }, BOX), null);
});

test('the nearest object wins when several are lined up', () => {
  const boxes = [
    { min: [-1, 0, -21], max: [1, 2, -19] },   // far
    { min: [-1, 0, -6], max: [1, 2, -4] },     // near
    { min: [-1, 0, -13], max: [1, 2, -11] },   // middle
  ];
  const hit = pick({ origin: [0, 1, 0], direction: [0, 0, -1] }, boxes);
  assert.equal(hit.index, 1);
});

test('picking nothing is null rather than a guess', () => {
  assert.equal(pick({ origin: [0, 50, 0], direction: [0, 1, 0] }, [BOX]), null);
  assert.equal(pick({ origin: [0, 1, 10], direction: [0, 0, -1] }, []), null);
});

test('a downward ray meets the ground where it should', () => {
  const point = groundPoint({ origin: [3, 10, 4], direction: [0, -1, 0] });
  assert.deepEqual(point, [3, 0, 4]);
});

test('a ray angled at the ground lands away from directly below', () => {
  const d = 1 / Math.sqrt(2);
  const point = groundPoint({ origin: [0, 10, 0], direction: [d, -d, 0] });
  near(point[0], 10);
  near(point[1], 0);
});

test('a ray pointing at the sky never meets the ground', () => {
  assert.equal(groundPoint({ origin: [0, 5, 0], direction: [0, 1, 0] }), null);
  assert.equal(groundPoint({ origin: [0, 5, 0], direction: [1, 0, 0] }), null);
});

test('dragging keeps hold of the point that was grabbed', () => {
  // Grabbed 2 to the left and 1 behind the object's own origin.
  const placement = { model: 'car', at: [10, 0, 10], rot: 30 };
  const grabOffset = [2, 0, 1];
  const moved = dragTo(placement, grabOffset, [40, 0, -5]);
  assert.deepEqual(moved.at, [42, 0, -4]);
  assert.equal(moved.rot, 30, 'dragging must not spin the object');
});

test('dragging to nowhere leaves the object alone', () => {
  const placement = { at: [1, 0, 2] };
  assert.deepEqual(dragTo(placement, [0, 0, 0], null), placement);
});

test('rotating wraps and never goes negative', () => {
  assert.equal(rotateBy({ at: [0, 0, 0], rot: 350 }, 20).rot, 10);
  assert.equal(rotateBy({ at: [0, 0, 0], rot: 10 }, -20).rot, 350);
  assert.equal(rotateBy({ at: [0, 0, 0] }, 15).rot, 15);
});

// --- against a real scene ---------------------------------------------------

function testScene() {
  const grids = {
    house: hollow(voxelise(model('house'))),
    car: hollow(voxelise(model('car'))),
    tree: hollow(voxelise(model('tree'))),
  };
  const placements = [
    { grid: grids.house, at: [-6, 0, -4], rot: 14 },
    { grid: grids.car, at: [2.4, 0, 3.2], rot: -24 },
    { grid: grids.tree, at: [7, 0, -5] },
  ];
  return { scene: assemble(placements), placements };
}

test('a box is drawn around each object, in the right place', () => {
  const { scene, placements } = testScene();
  const boxes = objectBoxes(scene);
  assert.equal(boxes.length, placements.length);
  boxes.forEach((box, i) => {
    const [x, , z] = placements[i].at;
    assert.ok(box.min[0] <= x && x <= box.max[0], `object ${i} box misses its own x`);
    assert.ok(box.min[2] <= z && z <= box.max[2], `object ${i} box misses its own z`);
    assert.ok(box.min[1] <= 0.01, `object ${i} should reach the ground`);
    assert.ok(box.max[1] > box.min[1], `object ${i} has no height`);
  });
});

test('boxes cover the cubes and are not wildly larger', () => {
  const { scene } = testScene();
  const boxes = objectBoxes(scene);
  scene.ranges.forEach(({ start, count }, index) => {
    const box = boxes[index];
    for (let i = start; i < start + count; i++) {
      for (let a = 0; a < 3; a++) {
        const v = scene.positions[i * 3 + a];
        assert.ok(v >= box.min[a] && v <= box.max[a],
          `object ${index} has a cube outside its own box`);
      }
    }
  });
});

test('looking straight down at an object picks that object', () => {
  const { scene, placements } = testScene();
  const boxes = objectBoxes(scene);
  placements.forEach((placement, index) => {
    const [x, , z] = placement.at;
    // Frame tightly on this object, and pick the centre of the frame.
    const framing = { x: x - 3, z: z - 3, w: 6, d: 6, pitch: 89, yaw: 0 };
    const hit = pick(rayThrough(framing, [0, 0]), boxes);
    assert.ok(hit, `nothing was under the cursor for object ${index}`);
    assert.equal(hit.index, index, `looking at object ${index} picked ${hit?.index}`);
  });
});

test('clicking empty ground picks nothing but still lands somewhere', () => {
  const { scene } = testScene();
  const boxes = objectBoxes(scene);
  const framing = { x: 40, z: 40, w: 10, d: 10, pitch: 60, yaw: 0 };
  const ray = rayThrough(framing, [0, 0]);
  assert.equal(pick(ray, boxes), null, 'empty ground should pick nothing');
  const ground = groundPoint(ray);
  assert.ok(ground, 'a downward ray must still meet the ground');
  assert.ok(ground[0] > 30 && ground[2] > 30, 'and it should land where it was aimed');
});

test('every point in the frame yields a usable ray', () => {
  const framing = { x: -20, z: -20, w: 40, d: 40, pitch: 35, yaw: 25 };
  for (let nx = -1; nx <= 1; nx += 0.25) {
    for (let ny = -1; ny <= 1; ny += 0.25) {
      const ray = rayThrough(framing, [nx, ny]);
      assert.ok(ray.direction.every(Number.isFinite), `ray broke at ${nx},${ny}`);
      near(Math.hypot(...ray.direction), 1, 1e-9);
    }
  }
});
