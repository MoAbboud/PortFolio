// Look at a model without a renderer.
//
//   node tools/inspect.js            every model
//   node tools/inspect.js house car  named models
//   node tools/inspect.js --plain    no colour
//
// Prints the numbers that decide whether a model is affordable, and three
// silhouettes so you can tell whether a house looks like a house. This exists
// because judging a model by its cube count is not judging it at all.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { voxelise, hollow, count, encodeRLE } from '../lib/voxel.js';

const MODELS = fileURLToPath(new URL('../models/', import.meta.url));
const args = process.argv.slice(2);
const plain = args.includes('--plain') || !process.stdout.isTTY;
const names = args.filter((a) => !a.startsWith('--'));

const wanted = names.length
  ? names
  : readdirSync(MODELS).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));

const MAX_COLS = 54;
const RAMP = ' .:-=+*#%@';

function parseHex(hex) {
  if (!hex) return [200, 200, 200];
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function swatch(entry) {
  if (!entry) return [140, 140, 140];
  return entry.slot ? [220, 60, 200] : parseHex(entry.hex);
}

/**
 * Project the grid onto a plane by walking each ray from the viewer inward and
 * taking the first cell it meets. That is a silhouette with the front-facing
 * colour, which is what the eye needs to recognise a shape.
 */
function project(grid, view) {
  const [nx, ny, nz] = grid.dims;
  const at = (i, j, k) => (k * ny + j) * nx + i;
  const plans = {
    front: { w: nx, h: ny, d: nz, cell: (u, v, t) => at(u, ny - 1 - v, nz - 1 - t) },
    side: { w: nz, h: ny, d: nx, cell: (u, v, t) => at(nx - 1 - t, ny - 1 - v, u) },
    top: { w: nx, h: nz, d: ny, cell: (u, v, t) => at(u, ny - 1 - t, v) },
  };
  const { w, h, d, cell } = plans[view];

  // Character cells are about twice as tall as they are wide, so the vertical
  // sample step is doubled to keep proportions honest.
  const step = Math.max(1, Math.ceil(w / MAX_COLS), Math.ceil(h / (MAX_COLS / 2)));
  const cols = Math.ceil(w / step);
  const rows = Math.ceil(h / (step * 2));
  const lines = [];

  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      let hit = 0, filled = 0, total = 0;
      for (let dv = 0; dv < step * 2; dv++) {
        const v = r * step * 2 + dv;
        if (v >= h) continue;
        for (let du = 0; du < step; du++) {
          const u = c * step + du;
          if (u >= w) continue;
          total++;
          for (let t = 0; t < d; t++) {
            const value = grid.cells[cell(u, v, t)];
            if (value) { if (!hit) hit = value; filled++; break; }
          }
        }
      }
      if (!hit || !total) { line += ' '; continue; }
      if (plain) {
        const shade = Math.min(RAMP.length - 1, Math.ceil((filled / total) * (RAMP.length - 1)));
        line += RAMP[shade];
      } else {
        const [r8, g8, b8] = swatch(grid.palette[hit - 1]);
        const lit = filled / total;
        const dim = (n) => Math.round(n * (0.45 + 0.55 * lit));
        line += `\x1b[38;2;${dim(r8)};${dim(g8)};${dim(b8)}m█\x1b[0m`;
      }
    }
    lines.push(line.replace(/\s+$/, ''));
  }
  return lines;
}

function sideBySide(blocks, gap = 3) {
  const widths = blocks.map((b) => Math.max(...b.map(visibleLength)));
  const height = Math.max(...blocks.map((b) => b.length));
  const out = [];
  for (let i = 0; i < height; i++) {
    let line = '';
    blocks.forEach((block, n) => {
      const text = block[i] ?? '';
      line += text + ' '.repeat(Math.max(0, widths[n] - visibleLength(text) + gap));
    });
    out.push(line.replace(/\s+$/, ''));
  }
  return out;
}

const visibleLength = (s) => s.replace(/\x1b\[[0-9;]*m/g, '').length;

function inspect(name) {
  const recipe = JSON.parse(readFileSync(`${MODELS}${name}.json`, 'utf8'));
  const solid = voxelise(recipe);
  const shell = hollow(solid);
  const before = count(solid), after = count(shell);
  const encoded = encodeRLE(solid.cells); // storage keeps the solid grid
  const [nx, ny, nz] = shell.dims;
  const size = (n) => (n * shell.unit).toFixed(2);

  console.log(`\n${'='.repeat(64)}`);
  console.log(`${name}   ${recipe.parts.length} parts   unit ${shell.unit}`);
  console.log(`${'='.repeat(64)}`);
  console.log(`grid      ${nx} x ${ny} x ${nz} cells   (${size(nx)} x ${size(ny)} x ${size(nz)} units)`);
  console.log(`cubes     ${after.toLocaleString()} after hollowing, from ${before.toLocaleString()}`
    + `   (${Math.round((1 - after / before) * 100)}% saved)`);
  console.log(`encoded   ${(encoded.length / 1024).toFixed(1)} KB`);
  console.log(`palette   ${shell.palette.length} colours`
    + (shell.motions.length ? `   motions ${shell.motions.length}` : ''));
  console.log(`budget    ${((after / 400000) * 100).toFixed(1)}% of one canvas`);
  console.log('');

  const views = ['front', 'side', 'top'];
  const blocks = views.map((v) => project(shell, v));
  const labels = views.map((v, i) => {
    const width = Math.max(...blocks[i].map(visibleLength));
    return v + ' '.repeat(Math.max(0, width - v.length));
  });
  console.log('  ' + sideBySide([labels.map((l) => l)], 3)[0]);
  for (const line of sideBySide(blocks)) console.log('  ' + line);
}

for (const name of wanted) {
  try {
    inspect(name);
  } catch (error) {
    console.error(`\n${name}: ${error.message}`);
    process.exitCode = 1;
  }
}
console.log('');
