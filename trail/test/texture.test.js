import test from 'node:test';
import assert from 'node:assert/strict';

import { sample, paint, quantise } from '../lib/texture.js';

/** An image built from a function of its pixel, so a test says what it means. */
function image(width, height, at) {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = at(x, y);
      const p = (y * width + x) * 4;
      pixels[p] = r; pixels[p + 1] = g; pixels[p + 2] = b; pixels[p + 3] = a;
    }
  }
  return { width, height, pixels, name: 'test' };
}

// A triangle covering most of the picture, so an average is over a real area.
const WHOLE = [[0, 0], [1, 0], [0, 1]];

test('a flat texture gives its colour exactly', () => {
  const flat = image(8, 8, () => [88, 176, 44]);
  assert.equal(sample(flat, WHOLE), '#58b02c');
});

test('a face becomes the average of what it covers, not one texel of it', () => {
  // Half the picture black, half white. The middle texel is one or the other,
  // and the answer is neither: a face is one colour and it should be the
  // colour of the whole face.
  const split = image(16, 16, (x) => (x < 8 ? [0, 0, 0] : [255, 255, 255]));
  const [r] = [parseInt(sample(split, [[0, 0], [1, 0], [1, 1]]).slice(1, 3), 16)];
  assert.ok(r > 60 && r < 200, `expected a mid grey, got ${r}`);
});

test('coordinates outside the picture repeat, because a wall tiles', () => {
  const stripes = image(4, 4, (x) => (x % 2 ? [200, 0, 0] : [0, 0, 200]));
  const inside = sample(stripes, [[0, 0], [0.99, 0], [0, 0.99]]);
  const beyond = sample(stripes, [[3, 3], [3.99, 3], [3, 3.99]]);
  assert.equal(beyond, inside, 'the fourth tile reads like the first');
});

test('transparent texels are holes and are left out of the average', () => {
  // A leaf texture is a cut-out on a field of whatever the exporter left there,
  // which is usually black. Averaging that in makes every canopy dark.
  const leaf = image(16, 16, (x, y) => (y < 8 ? [0, 0, 0, 0] : [60, 180, 60, 255]));
  assert.equal(sample(leaf, WHOLE), '#3cb43c', 'only the solid half counts');
});

test('a face with nothing but holes behind it keeps the colour it had', () => {
  const empty = image(8, 8, () => [255, 0, 0, 0]);
  assert.equal(sample(empty, WHOLE), null);

  const mesh = {
    colours: ['#123456'],
    uvs: [WHOLE],
    faceImage: [0],
    images: [{ name: 'empty' }],
  };
  assert.deepEqual(paint(mesh, [empty]).colours, ['#123456']);
  assert.equal(paint(mesh, [empty]).painted, 0);
});

test('painting only touches faces that have both a picture and coordinates', () => {
  const red = image(4, 4, () => [255, 0, 0]);
  const mesh = {
    colours: ['#111111', '#222222', '#333333'],
    uvs: [WHOLE, null, WHOLE],
    faceImage: [0, 0, -1],
    images: [{ name: 'red' }],
  };
  const done = paint(mesh, [red]);
  assert.deepEqual(done.colours, ['#ff0000', '#222222', '#333333']);
  assert.equal(done.painted, 1);
});

test('a model whose image could not be read is left exactly as it was', () => {
  // The fallback is the whole reason this can be turned on for every pack: a
  // missing texture has to look like yesterday, not like a failure.
  const mesh = {
    colours: ['#abcdef', '#fedcba'],
    uvs: [WHOLE, WHOLE],
    faceImage: [0, 0],
    images: [{ name: 'gone' }],
  };
  const done = paint(mesh, [null]);
  assert.deepEqual(done.colours, ['#abcdef', '#fedcba']);
  assert.equal(done.painted, 0);
});

test('a mesh that carries no coordinates at all passes straight through', () => {
  const mesh = { colours: ['#010203'], triangles: [] };
  assert.equal(paint(mesh, []), mesh);
});

test('quantising leaves a model that fits exactly alone', () => {
  const colours = ['#ff0000', '#00ff00', '#ff0000'];
  assert.deepEqual(quantise(colours, 250), colours);
  assert.equal(quantise(colours, 2), colours, 'two distinct colours, a cap of two');
});

test('quantising keeps what covers the most and moves the rest to the nearest', () => {
  // Two dominant colours and one stray. The stray is nearer the red.
  const colours = [
    ...Array(10).fill('#ff0000'),
    ...Array(10).fill('#0000ff'),
    '#f00505',
  ];
  const done = quantise(colours, 2);
  assert.equal(new Set(done).size, 2);
  assert.equal(done[20], '#ff0000', 'the stray landed on the colour it is nearest');
  assert.deepEqual(done.slice(0, 10), Array(10).fill('#ff0000'), 'the common ones are untouched');
});

test('quantising never hands back more colours than it was asked for', () => {
  const colours = [];
  for (let i = 0; i < 400; i++) colours.push(`#${i.toString(16).padStart(6, '0')}`);
  assert.equal(new Set(quantise(colours, 250)).size, 250);
  assert.equal(colours.length, quantise(colours, 250).length, 'one colour per face still');
});
