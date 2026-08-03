// Reading MagicaVoxel files.
//
// Pure module. A `.vox` file is already a voxel grid with an indexed palette,
// which is what Trail stores, so this is a translation rather than a
// conversion: no voxelising, no normalising, no colour quantisation. Those are
// the three hardest stages of importing a mesh, and a drawn model skips all of
// them because it was drawn on the same kind of lattice.
//
// The format is a chunk tree, described at
// github.com/ephtracy/voxel-model/blob/master/MagicaVoxel-file-format-vox.txt
// Chunks carry their own length, so anything unrecognised is stepped over.

import { crop, anchor as anchorGrid } from './voxel.js';

const MAGIC = 'VOX ';

/** MagicaVoxel is Z-up. Trail is Y-up. */
export const AXIS_NOTE = 'z-up to y-up';

class BadVox extends Error {}
export const isBadVox = (error) => error instanceof BadVox;

const tag = (view, at) => String.fromCharCode(
  view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3),
);

const hex = (r, g, b) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/**
 * Everything in the file: its models, and its palette.
 *
 * A file can hold several models. Newer files also carry a scene graph placing
 * them relative to each other, which is not read: for a single drawn object,
 * which is what this is for, there is one model and no arrangement to honour.
 */
export function readVox(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 8) throw new BadVox('that file is too short to be a .vox');

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (tag(view, 0) !== MAGIC) {
    throw new BadVox('that is not a MagicaVoxel file: it does not start with "VOX "');
  }
  const version = view.getInt32(4, true);

  const main = readChunkHeader(view, 8);
  if (main.id !== 'MAIN') throw new BadVox('that .vox file has no MAIN chunk');

  const models = [];
  let palette = null;
  let pending = null;

  walk(view, main.childrenAt, main.childrenAt + main.childrenBytes, (chunk) => {
    if (chunk.id === 'SIZE') {
      pending = [
        view.getInt32(chunk.contentAt, true),
        view.getInt32(chunk.contentAt + 4, true),
        view.getInt32(chunk.contentAt + 8, true),
      ];
    } else if (chunk.id === 'XYZI') {
      const count = view.getInt32(chunk.contentAt, true);
      const voxels = new Uint8Array(bytes.buffer, bytes.byteOffset + chunk.contentAt + 4, count * 4);
      models.push({ size: pending ?? [0, 0, 0], count, voxels });
      pending = null;
    } else if (chunk.id === 'RGBA') {
      // 256 entries, and entry i is palette index i + 1: a voxel's colour index
      // is one-based, which is what leaves 0 free to mean empty.
      palette = [];
      for (let i = 0; i < 256; i++) {
        const at = chunk.contentAt + i * 4;
        palette.push({ hex: hex(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2)) });
      }
    }
  });

  if (!models.length) throw new BadVox('that .vox file contains no models');

  return {
    version,
    models,
    palette: palette ?? defaultPalette(),
    usedDefaultPalette: !palette,
  };
}

function readChunkHeader(view, at) {
  return {
    id: tag(view, at),
    contentBytes: view.getInt32(at + 4, true),
    childrenBytes: view.getInt32(at + 8, true),
    contentAt: at + 12,
    childrenAt: at + 12 + view.getInt32(at + 4, true),
  };
}

function walk(view, from, to, visit) {
  let at = from;
  while (at + 12 <= to) {
    const chunk = readChunkHeader(view, at);
    if (chunk.contentBytes < 0 || chunk.childrenBytes < 0) {
      throw new BadVox('that .vox file has a chunk with a negative length');
    }
    visit(chunk);
    const next = chunk.childrenAt + chunk.childrenBytes;
    if (next <= at) throw new BadVox('that .vox file has a chunk that does not advance');
    at = next;
  }
}

/**
 * One model, as a Trail grid.
 *
 * The palette is compacted to the colours actually used, so an imported model
 * carries five entries rather than the file's full 256.
 */
export function toGrid(vox, { model = 0, unit = 0.12, anchor = 'base', id = 'imported' } = {}) {
  const chosen = vox.models[model];
  if (!chosen) throw new BadVox(`that .vox file has no model ${model + 1}`);

  const [sx, sy, sz] = chosen.size;
  if (!(sx > 0 && sy > 0 && sz > 0)) throw new BadVox('that model has no size');

  // Z-up to Y-up, and the depth axis is reversed so the model faces the way it
  // did in the editor rather than mirrored.
  const dims = [sx, sz, sy];
  const cells = new Uint8Array(sx * sz * sy);
  const used = new Map();

  for (let i = 0; i < chosen.count; i++) {
    const at = i * 4;
    const vx = chosen.voxels[at];
    const vy = chosen.voxels[at + 1];
    const vz = chosen.voxels[at + 2];
    const colour = chosen.voxels[at + 3];
    if (!colour) continue;

    if (!used.has(colour)) used.set(colour, used.size + 1);
    const x = vx;
    const y = vz;
    const z = sy - 1 - vy;
    if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sz || z >= sy) continue;
    cells[(z * sz + y) * sx + x] = used.get(colour);
  }

  if (!used.size) throw new BadVox('that model is empty');
  if (used.size > 255) throw new BadVox('that model uses more than 255 colours');

  const palette = new Array(used.size);
  for (const [colour, index] of used) {
    palette[index - 1] = vox.palette[colour - 1] ?? { hex: '#bbbbbb' };
  }

  const grid = {
    id,
    unit,
    dims,
    origin: [0, 0, 0],
    cells,
    motion: null,
    motions: [],
    palette,
  };
  return anchorGrid(crop(grid), anchor);
}

/** Read a file and turn its first model into a grid, in one call. */
export function importVox(input, options = {}) {
  const vox = readVox(input);
  return { ...toGrid(vox, options), usedDefaultPalette: vox.usedDefaultPalette };
}

/**
 * A neutral ramp, for a file that carries no palette of its own.
 *
 * MagicaVoxel omits the palette when a model uses its built-in one, and that
 * palette is 256 specific colours this module does not have. Rather than invent
 * them, the model comes in grey and says so, which is visibly wrong instead of
 * quietly wrong.
 */
function defaultPalette() {
  return Array.from({ length: 256 }, (_, i) => {
    const v = 60 + Math.round((i / 255) * 160);
    return { hex: hex(v, v, v) };
  });
}
