import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';

import { readPng, reduce } from '../lib/png.js';

// Fixtures are built here rather than checked in as files, so what a test means
// is readable in the test. The compression is Node's, which makes this a real
// second opinion: the decoder is never handed anything it wrote itself.

const CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  let c = 0xffffffff;
  for (const b of body) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length - 4, 0);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE((c ^ 0xffffffff) >>> 0, 0);
  return Buffer.concat([head, body, tail]);
}

/**
 * A PNG carrying the given pixels.
 *
 * `filter` says how each row is written. Every one of the five is a different
 * arithmetic, and a decoder that gets one wrong produces a picture that is
 * wrong in a way nothing else notices.
 */
function png(width, height, channels, pixels, {
  filter = 0, depth = 8, colour = channels === 4 ? 6 : 2, interlace = 0, splits = 1,
} = {}) {
  const stride = width * channels;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = filter;
    for (let i = 0; i < stride; i++) {
      const value = pixels[y * stride + i];
      const left = i >= channels ? pixels[y * stride + i - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + i] : 0;
      const upLeft = y > 0 && i >= channels ? pixels[(y - 1) * stride + i - channels] : 0;
      let written = value;
      if (filter === 1) written = value - left;
      else if (filter === 2) written = value - up;
      else if (filter === 3) written = value - ((left + up) >> 1);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
        written = value - (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
      }
      raw[y * (stride + 1) + 1 + i] = written & 0xff;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = depth; ihdr[9] = colour; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = interlace;

  const compressed = deflateSync(raw, { level: 9 });
  const parts = [];
  const each = Math.ceil(compressed.length / splits);
  for (let at = 0; at < compressed.length; at += each) {
    parts.push(chunk('IDAT', compressed.subarray(at, at + each)));
  }

  return new Uint8Array(Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    ...parts,
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

// A picture with no flat runs anywhere, so a decoder cannot pass by accident:
// a length-distance copy that reaches the wrong way still produces plausible
// bytes when everything is the same colour.
function noisy(width, height, channels) {
  const pixels = new Uint8Array(width * height * channels);
  let seed = 7;
  for (let i = 0; i < pixels.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    pixels[i] = (seed >> 16) & 0xff;
  }
  return pixels;
}

test('a plain colour image comes back exactly as it went in', () => {
  const pixels = new Uint8Array([
    255, 0, 0, 0, 255, 0,
    0, 0, 255, 255, 255, 0,
  ]);
  const image = readPng(png(2, 2, 3, pixels));
  assert.equal(image.width, 2);
  assert.equal(image.height, 2);
  assert.deepEqual([...image.pixels], [
    255, 0, 0, 255, 0, 255, 0, 255,
    0, 0, 255, 255, 255, 255, 0, 255,
  ], 'colour without alpha is opaque');
});

test('alpha is kept, because a leaf texture is mostly holes', () => {
  const pixels = new Uint8Array([10, 20, 30, 0, 40, 50, 60, 255]);
  const image = readPng(png(2, 1, 4, pixels));
  assert.deepEqual([...image.pixels], [10, 20, 30, 0, 40, 50, 60, 255]);
});

for (const filter of [0, 1, 2, 3, 4]) {
  test(`filter ${filter} is undone correctly`, () => {
    // Undoing a filter reads the row above *after* it was undone, so an error
    // in any one of them corrupts everything below it rather than one pixel.
    const pixels = noisy(9, 7, 3);
    const image = readPng(png(9, 7, 3, pixels, { filter }));
    for (let i = 0; i < 9 * 7; i++) {
      for (let c = 0; c < 3; c++) {
        assert.equal(image.pixels[i * 4 + c], pixels[i * 3 + c],
          `pixel ${i} channel ${c} under filter ${filter}`);
      }
    }
  });
}

test('pixels split across several IDAT chunks are one stream, not several', () => {
  // A real 2048-square texture always arrives in many chunks, and a decoder
  // that restarts at each join produces garbage from the second one onward.
  const pixels = noisy(40, 40, 3);
  const image = readPng(png(40, 40, 3, pixels, { filter: 4, splits: 7 }));
  for (let i = 0; i < 40 * 40; i++) {
    assert.equal(image.pixels[i * 4], pixels[i * 3], `pixel ${i} after a chunk join`);
  }
});

test('a large image decodes, so the deflate is more than a stored block', () => {
  // Small fixtures can be written without Huffman coding at all. This one is
  // big enough that the compressor has to use both dynamic codes and back
  // references, which is what every real texture uses.
  const pixels = noisy(200, 200, 4);
  const image = readPng(png(200, 200, 4, pixels, { filter: 1 }));
  assert.equal(image.pixels.length, 200 * 200 * 4);
  let same = 0;
  for (let i = 0; i < pixels.length; i++) if (image.pixels[i] === pixels[i]) same++;
  assert.equal(same, pixels.length, 'every byte of a compressed image survived');
});

test('a run of one colour survives, which is what back references are for', () => {
  const pixels = new Uint8Array(64 * 64 * 3).fill(0);
  for (let i = 0; i < 64 * 64; i++) { pixels[i * 3] = 200; pixels[i * 3 + 1] = 40; pixels[i * 3 + 2] = 90; }
  const image = readPng(png(64, 64, 3, pixels));
  assert.deepEqual([...image.pixels.slice(0, 8)], [200, 40, 90, 255, 200, 40, 90, 255]);
  assert.deepEqual([...image.pixels.slice(-4)], [200, 40, 90, 255]);
});

test('what cannot be read is refused by name, never half-read', () => {
  // A texture that decodes into nonsense paints a model a confident wrong
  // colour, which is worse than the material-name guess it replaced.
  const pixels = noisy(4, 4, 3);
  assert.throws(() => readPng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), { name: 'brick.png' }),
    /brick\.png is not a PNG/);
  assert.throws(() => readPng(png(4, 4, 3, pixels, { depth: 16 }), { name: 'deep.png' }),
    /deep\.png is 16-bit/);
  assert.throws(() => readPng(png(4, 4, 3, pixels, { colour: 3 }), { name: 'indexed.png' }),
    /indexed\.png is a palette/);
  assert.throws(() => readPng(png(4, 4, 3, pixels, { interlace: 1 }), { name: 'woven.png' }),
    /woven\.png is interlaced/);
});

test('a truncated image says so rather than returning a short picture', () => {
  const whole = png(16, 16, 3, noisy(16, 16, 3), { filter: 2 });
  // Cut the last IDAT short, leaving the header claiming a full-sized picture.
  const cut = whole.slice(0, whole.length - 40);
  assert.throws(() => readPng(cut, { name: 'cut.png' }), /cut\.png/);
});

test('reducing averages a block rather than picking one pixel out of it', () => {
  // The distinction matters: a sampled pixel can land on a mortar line and
  // paint a whole brick wall grey, where an average is the wall's real colour.
  const pixels = new Uint8Array(4 * 4 * 3);
  for (let i = 0; i < 16; i++) {
    // A checkerboard of black and white: every average is mid grey, and no
    // single pixel is.
    const value = ((i % 4) + Math.floor(i / 4)) % 2 ? 0 : 200;
    pixels[i * 3] = value; pixels[i * 3 + 1] = value; pixels[i * 3 + 2] = value;
  }
  const small = reduce(readPng(png(4, 4, 3, pixels)), 2);
  assert.equal(small.width, 2);
  assert.equal(small.height, 2);
  for (let i = 0; i < 4; i++) {
    assert.equal(small.pixels[i * 4], 100, 'a block of half black and half white is mid grey');
  }
});

test('an image already small enough is handed back untouched', () => {
  // An atlas packs unrelated colours side by side, so shrinking one bleeds a
  // neighbouring island across an edge. Only what is oversized is reduced.
  const image = readPng(png(8, 8, 3, noisy(8, 8, 3)));
  assert.equal(reduce(image, 512), image);
  assert.equal(reduce(image, 8), image, 'at the limit exactly, not over it');
});

test('reducing keeps the alpha channel, so holes stay holes', () => {
  const pixels = new Uint8Array(4 * 4 * 4);
  for (let i = 0; i < 16; i++) {
    pixels[i * 4] = 90; pixels[i * 4 + 1] = 160; pixels[i * 4 + 2] = 40;
    pixels[i * 4 + 3] = i < 8 ? 0 : 255;
  }
  const small = reduce(readPng(png(4, 4, 4, pixels)), 2);
  assert.equal(small.pixels[3], 0, 'a fully transparent block stays transparent');
  assert.equal(small.pixels[small.pixels.length - 1], 255, 'a solid block stays solid');
});
