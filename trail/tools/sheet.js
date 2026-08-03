// A visual index of a .vox pack.
//
//   node tools/sheet.js path/to/pack.vox [outDir] [perSheet]
//
// Renders every model in a file as a small isometric picture and lays them out
// on numbered contact sheets. A pack arrives as one file with hundreds of
// nameless models inside, and no amount of block counts tells you which one is
// a barrel. This is how you look at them.
//
// Writes PNG directly: a raw bitmap, deflated, wrapped in three chunks. Adding
// an image library for one tool would be a dependency the project does not have.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { readVox, toGrid } from '../lib/vox.js';

const [, , file, outDir = 'sheets', perSheet = '64'] = process.argv;
if (!file) {
  console.error('usage: node tools/sheet.js <pack.vox> [outDir] [perSheet]');
  process.exit(1);
}

const TILE = 116;      // pixels per model
const COLS = 8;
const LABEL = 11;      // rows of pixels reserved under each model
const BG = [16, 20, 26];

// --- a picture of one model -------------------------------------------------

/**
 * Isometric, painter's order.
 *
 * Voxels nearer the camera have a larger x + y + z, so drawing in ascending
 * order lets nearer ones cover the rest. A face with nothing above it is lit
 * more brightly, which is enough shading to read a shape.
 */
function drawModel(pixels, sheetW, ox, oy, grid) {
  const [nx, ny, nz] = grid.dims;
  const at = (i, j, k) => (k * ny + j) * nx + i;

  // Fit the model's isometric footprint into the tile.
  const isoW = (nx + nz);
  const isoH = (nx + nz) / 2 + ny;
  const scale = Math.max(1, Math.min((TILE - 8) / isoW, (TILE - LABEL - 8) / isoH));
  const cell = Math.max(1, Math.round(scale));

  const shiftX = ox + Math.round((TILE - isoW * scale) / 2 + nz * scale);
  const shiftY = oy + LABEL + Math.round((TILE - LABEL - isoH * scale) / 2 + ny * scale);

  const order = [];
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (grid.cells[at(i, j, k)]) order.push([i, j, k]);
      }
    }
  }
  order.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));

  for (const [i, j, k] of order) {
    const value = grid.cells[at(i, j, k)];
    const entry = grid.palette[value - 1];
    const rgb = parseHex(entry?.hex ?? '#bbbbbb');

    const open = j + 1 >= ny || !grid.cells[at(i, j + 1, k)];
    const light = open ? 1.0 : 0.66;

    const sx = Math.round(shiftX + (i - k) * scale);
    const sy = Math.round(shiftY - (i + k) * scale * 0.5 - j * scale);

    for (let py = 0; py < cell; py++) {
      for (let px = 0; px < cell; px++) {
        const x = sx + px;
        const y = sy + py;
        if (x < 0 || y < 0 || x >= sheetW || y >= pixels.length / (sheetW * 3)) continue;
        const p = (y * sheetW + x) * 3;
        pixels[p] = Math.min(255, Math.round(rgb[0] * light));
        pixels[p + 1] = Math.min(255, Math.round(rgb[1] * light));
        pixels[p + 2] = Math.min(255, Math.round(rgb[2] * light));
      }
    }
  }
}

const parseHex = (hex) => {
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};

// --- a very small font, so a tile can say which model it is -----------------

const DIGITS = {
  0: ['111', '101', '101', '101', '111'],
  1: ['010', '110', '010', '010', '111'],
  2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'],
  5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'],
  7: ['111', '001', '010', '010', '010'],
  8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'],
};

function drawNumber(pixels, sheetW, x, y, text) {
  let cursor = x;
  for (const ch of text) {
    const glyph = DIGITS[ch];
    if (!glyph) { cursor += 2; continue; }
    glyph.forEach((row, ry) => {
      [...row].forEach((on, rx) => {
        if (on !== '1') return;
        const p = ((y + ry) * sheetW + cursor + rx) * 3;
        if (p < 0 || p + 2 >= pixels.length) return;
        pixels[p] = 200; pixels[p + 1] = 220; pixels[p + 2] = 240;
      });
    });
    cursor += 4;
  }
}

// --- PNG --------------------------------------------------------------------

const CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head.subarray(0, 8), data, tail]);
}

function writePng(path, width, height, rgb) {
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    Buffer.from(rgb.buffer, y * width * 3, width * 3)
      .copy(raw, y * (width * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  writeFileSync(path, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

// --- go ---------------------------------------------------------------------

const vox = readVox(new Uint8Array(readFileSync(file)));
const total = vox.models.length;
const each = Number(perSheet);
mkdirSync(outDir, { recursive: true });

console.log(`${file}: ${total} models`);

for (let start = 0; start < total; start += each) {
  const slice = Math.min(each, total - start);
  const rows = Math.ceil(slice / COLS);
  const width = COLS * TILE;
  const height = rows * TILE;
  const pixels = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 3] = BG[0]; pixels[i * 3 + 1] = BG[1]; pixels[i * 3 + 2] = BG[2];
  }

  for (let n = 0; n < slice; n++) {
    const index = start + n;
    const ox = (n % COLS) * TILE;
    const oy = Math.floor(n / COLS) * TILE;
    try {
      const grid = toGrid(vox, { model: index, unit: 1, id: `m${index}` });
      drawModel(pixels, width, ox, oy, grid);
    } catch {
      // An empty model still gets a tile, so the numbering never slips.
    }
    // Top left, so a number is unmistakably the label of the tile it sits in.
    drawNumber(pixels, width, ox + 4, oy + 3, String(index + 1));
  }

  const name = `${outDir}/sheet-${String(start / each + 1).padStart(2, '0')}.png`;
  writePng(name, width, height, pixels);
  console.log(`  ${name}  models ${start + 1} to ${start + slice}`);
}
