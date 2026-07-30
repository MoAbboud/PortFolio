// Placed objects to instance buffers.
//
// Pure module. Takes grids and where they stand, returns flat arrays ready to
// be uploaded once and never touched again. Nothing here knows about WebGL.

const HEX3 = /^#[0-9a-f]{3}$/i;

function rgb(entry, tints) {
  if (!entry) return [0.7, 0.7, 0.7];
  if (entry.slot) {
    const colour = tints?.[entry.slot] ?? '#c8c8c8';
    return rgb({ hex: colour }, null);
  }
  let h = entry.hex.slice(1);
  if (HEX3.test(entry.hex)) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}

/**
 * Every cube of one placed object, in world space.
 *
 * A placement is { at: [x, y, z], rot, scale, tints }. The grid's own offset
 * puts its anchor where `at` says, so placing is an addition rather than a
 * calculation.
 */
export function place(grid, placement = {}) {
  const at = placement.at ?? [0, 0, 0];
  const scale = placement.scale ?? 1;
  const rot = ((placement.rot ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const unit = grid.unit * scale;
  const [nx, ny, nz] = grid.dims;

  const total = countCells(grid);
  const positions = new Float32Array(total * 3);
  const colours = new Float32Array(total * 3);
  const seeds = new Float32Array(total);

  const palette = grid.palette.map((entry) => rgb(entry, placement.tints));
  let n = 0;
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const value = grid.cells[(k * ny + j) * nx + i];
        if (!value) continue;
        // Local position of this cube's centre, relative to the anchor.
        const lx = grid.offset[0] * scale + (i + 0.5) * unit;
        const ly = grid.offset[1] * scale + (j + 0.5) * unit;
        const lz = grid.offset[2] * scale + (k + 0.5) * unit;
        positions[n * 3] = at[0] + lx * cos - lz * sin;
        positions[n * 3 + 1] = at[1] + ly;
        positions[n * 3 + 2] = at[2] + lx * sin + lz * cos;
        const colour = palette[value - 1] ?? [0.7, 0.7, 0.7];
        colours[n * 3] = colour[0];
        colours[n * 3 + 1] = colour[1];
        colours[n * 3 + 2] = colour[2];
        // Deterministic per-cube randomness: the same scene shimmers the same
        // way every play, which matters when a take is re-recorded.
        seeds[n] = fract(Math.sin((i * 12.9898 + j * 78.233 + k * 37.719)) * 43758.5453);
        n++;
      }
    }
  }
  return { positions, colours, seeds, count: n, unit };
}

/**
 * Everything on the canvas, as one set of buffers and one draw call.
 *
 * `ranges` records which slice of the buffers belongs to which placement, so
 * moving one object rewrites its own cubes rather than the whole field. That is
 * what keeps the field static in the way that matters: dragging a house does
 * not touch the other ninety-nine objects.
 */
export function assemble(placements) {
  const parts = placements.map(({ grid, ...rest }) => place(grid, rest));
  const count = parts.reduce((n, p) => n + p.count, 0);
  const positions = new Float32Array(count * 3);
  const colours = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const sizes = new Float32Array(count);
  const objects = new Float32Array(count);
  const fromStep = new Float32Array(count);
  const untilStep = new Float32Array(count);
  const ranges = [];

  let at = 0;
  parts.forEach((part, index) => {
    positions.set(part.positions.subarray(0, part.count * 3), at * 3);
    colours.set(part.colours.subarray(0, part.count * 3), at * 3);
    seeds.set(part.seeds.subarray(0, part.count), at);
    sizes.fill(part.unit, at, at + part.count);
    objects.fill(index, at, at + part.count);
    // A placement with no range is solid from the start and never leaves.
    fromStep.fill(placements[index].from ?? 0, at, at + part.count);
    untilStep.fill(placements[index].until ?? 9999, at, at + part.count);
    ranges.push({ start: at, count: part.count });
    at += part.count;
  });
  return { positions, colours, seeds, sizes, objects, fromStep, untilStep, ranges, count };
}

/**
 * A box around each placed object, for picking.
 *
 * Padded by half a cube, because a position is a cube's centre and the cube
 * itself extends past it. Without the padding, clicking the outer face of an
 * object misses it.
 */
export function objectBoxes(scene) {
  return scene.ranges.map(({ start, count }) => {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    let cube = 0;
    for (let i = start; i < start + count; i++) {
      cube = scene.sizes[i];
      for (let a = 0; a < 3; a++) {
        const v = scene.positions[i * 3 + a];
        if (v < min[a]) min[a] = v;
        if (v > max[a]) max[a] = v;
      }
    }
    const pad = cube / 2;
    return {
      min: min.map((v) => v - pad),
      max: max.map((v) => v + pad),
    };
  });
}

/** The world-space extents of what has been placed, for framing and for sanity. */
export function bounds(scene) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < scene.count; i++) {
    for (let a = 0; a < 3; a++) {
      const v = scene.positions[i * 3 + a];
      if (v < lo[a]) lo[a] = v;
      if (v > hi[a]) hi[a] = v;
    }
  }
  return { min: lo, max: hi };
}

function countCells(grid) {
  let n = 0;
  for (let i = 0; i < grid.cells.length; i++) if (grid.cells[i]) n++;
  return n;
}

const fract = (x) => x - Math.floor(x);
