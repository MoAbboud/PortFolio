// Placed objects to instance buffers.
//
// Pure module. Takes grids and where they stand, returns flat arrays ready to
// be uploaded once and never touched again. Nothing here knows about WebGL.

const HEX3 = /^#[0-9a-f]{3}$/i;

function rgb(entry, tints) {
  if (!entry) return [0.7, 0.7, 0.7];
  if (entry.slot) {
    // What this placement asked for, then the model's own colour, then grey.
    const colour = tints?.[entry.slot] ?? entry.hex ?? '#c8c8c8';
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
  // A missing grid used to surface as "cannot read properties of undefined",
  // several frames from the cause and naming nothing. A canvas can outlive the
  // library it was built against, so this has to say which model is missing.
  if (!grid || !grid.cells) {
    throw new Error(
      `there is no model called "${placement.model ?? 'unknown'}" in the library.\n`
      + 'A canvas can refer to a model that is no longer loaded, usually because\n'
      + 'the pack it came from has not been listed in models/index.json.'
    );
  }
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

// **There is no travelOf.** An object could be given a line to walk: it was
// uploaded at the start of it and the vertex shader added an offset from three
// numbers carried per vertex, so the field stayed static and nothing ran per
// frame over the cubes. It was a sound mechanism for a feature that is not
// wanted - *"i dont want to add motion to my objects for now"* - and everything
// it fed went with it: the attribute in three shaders, the uniform that drove
// it, and the field in the canvas file.


/**
 * The same placements, as one merged surface instead of cubes.
 *
 * Each item is `{ mesh, grid, ...placement }`. Positions and normals are turned
 * by the placement's own rotation, and indices are shifted so every object
 * lands in one buffer and one draw.
 */
export function assembleMeshes(items) {
  for (const item of items) {
    if (!item.mesh || !item.grid) {
      throw new Error(`there is no model called "${item.model ?? 'unknown'}" in the library.`);
    }
  }
  const count = items.reduce((n, item) => n + item.mesh.count, 0);
  const triangles = items.reduce((n, item) => n + item.mesh.indices.length, 0);

  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const colours = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const objects = new Float32Array(count);
  const fromStep = new Float32Array(count);
  const untilStep = new Float32Array(count);
  const ao = new Float32Array(count);
  // Where a vertex turns, and how. Zero amplitude means it does not.
  const pivots = new Float32Array(count * 3);
  const motion = new Float32Array(count * 4);
  // How each model wants to be finished, worked out from how fine its own
  // triangles are. See `finishFor`.
  const finish = new Float32Array(count * 2);
  const indices = new Uint32Array(triangles);
  const ranges = [];

  const MOTION_KIND = { sway: 1, spin: 2, bob: 3, liquid: 4 };
  const AXIS = { x: 0, y: 1, z: 2 };

  let at = 0;
  let face = 0;
  items.forEach((item, index) => {
    const { mesh, grid } = item;
    const scale = item.scale ?? 1;
    const rot = ((item.rot ?? 0) * Math.PI) / 180;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const to = item.at ?? [0, 0, 0];
    const palette = grid.palette.map((entry) => rgb(entry, item.tints));
    const [smoothness, wobble] = finishFor(mesh.edge, mesh.fine, scale);

    for (let v = 0; v < mesh.count; v++) {
      const lx = mesh.positions[v * 3] * scale;
      const ly = mesh.positions[v * 3 + 1] * scale;
      const lz = mesh.positions[v * 3 + 2] * scale;
      positions[(at + v) * 3] = to[0] + lx * cos - lz * sin;
      positions[(at + v) * 3 + 1] = to[1] + ly;
      positions[(at + v) * 3 + 2] = to[2] + lx * sin + lz * cos;

      const nx = mesh.normals[v * 3], ny = mesh.normals[v * 3 + 1], nz = mesh.normals[v * 3 + 2];
      normals[(at + v) * 3] = nx * cos - nz * sin;
      normals[(at + v) * 3 + 1] = ny;
      normals[(at + v) * 3 + 2] = nx * sin + nz * cos;

      const colour = palette[mesh.values[v] - 1] ?? [0.7, 0.7, 0.7];
      colours[(at + v) * 3] = colour[0];
      colours[(at + v) * 3 + 1] = colour[1];
      colours[(at + v) * 3 + 2] = colour[2];
      // Seeded by where the vertex is, not by which one it is. The shimmer
      // moves a vertex along its normal by an amount this decides, so two
      // copies of one corner have to agree or they walk apart and tear a hole
      // in the model. A mesh kept per face is nothing but copies of corners.
      // Rounded to the same thousandth the normals are welded at.
      finish[(at + v) * 2] = smoothness;
      finish[(at + v) * 2 + 1] = wobble;
      seeds[at + v] = fract(Math.sin(
        Math.round(lx * 1000) * 12.9898
        + Math.round(ly * 1000) * 78.233
        + Math.round(lz * 1000) * 37.719
        + index * 7.233,
      ) * 43758.5453);
      ao[at + v] = mesh.ao ? mesh.ao[v] : 1;

      // A pivot is a point in the model, so it is placed exactly as the vertex
      // beside it: scaled, turned, and moved with the object.
      const part = mesh.motion?.[v] ? mesh.motions[mesh.motion[v] - 1] : null;
      if (part) {
        const [ox, oy, oz] = part.pivot;
        const sx = ox * scale, sy = oy * scale, sz = oz * scale;
        pivots[(at + v) * 3] = to[0] + sx * cos - sz * sin;
        pivots[(at + v) * 3 + 1] = to[1] + sy;
        pivots[(at + v) * 3 + 2] = to[2] + sx * sin + sz * cos;
        motion[(at + v) * 4] = MOTION_KIND[part.type] ?? 0;
        motion[(at + v) * 4 + 1] = ((part.amp ?? 4) * Math.PI) / 180;
        motion[(at + v) * 4 + 2] = (part.phase ?? 0) * Math.PI * 2;
        motion[(at + v) * 4 + 3] = AXIS[part.axis ?? 'x'] ?? 0;
      }
    }

    objects.fill(index, at, at + mesh.count);
    fromStep.fill(item.from ?? 0, at, at + mesh.count);
    untilStep.fill(item.until ?? 9999, at, at + mesh.count);

    for (let i = 0; i < mesh.indices.length; i++) indices[face + i] = mesh.indices[i] + at;

    ranges.push({ start: at, count: mesh.count, face, faces: mesh.indices.length });
    at += mesh.count;
    face += mesh.indices.length;
  });

  return {
    positions, normals, colours, seeds, objects, fromStep, untilStep, ao,
    pivots, motion, finish,
    indices, ranges, count, triangles: triangles / 3,
  };
}

// Where a triangle stops being big enough to be worth seeing as a facet. In
// world units, and measured rather than guessed: the low-poly packs sit around
// 0.05 to 0.09, and a rigged character around 0.006.
const COARSE = 0.045;
const FINE = 0.012;

// How far the renderer moves a vertex at full shimmer, in world units. It is
// `uShimmer * 3` with the default shimmer, and it is written here because the
// only way to size a displacement against a model is to know how big it is.
const FULL_SHIMMER = 0.012;

// A vertex may be pushed this much of the way across the smallest triangle it
// belongs to. Two vertices of one face move by different amounts - their seeds
// differ - so the face deforms by up to twice this. A fifth is small enough
// that nothing visibly bends and large enough to still be movement.
const SAFE = 0.2;

/**
 * How a model wants to be finished, from the size of its own triangles.
 *
 * Two problems, and they need **two different statistics**, which is what the
 * first version of this got wrong.
 *
 * *Whether facets are worth seeing* is about the typical triangle. A chunky
 * model is meant to look faceted; a model built from millimetre triangles is
 * shattered by flat shading. That is the median.
 *
 * *How far a vertex may be pushed* is about the smallest triangle, because the
 * smallest is what tears first. Judged by the median, a character - a broad
 * torso and a face of tiny triangles - reads as coarse and gets a shimmer that
 * moves its vertices further than its eyes are wide. Which is precisely what
 * happened: the faces came apart while the cars looked fine, because a car has
 * no eyes to ruin.
 */
export function finishFor(edge, fine = edge, scale = 1) {
  const typical = (edge ?? 0) * (scale || 1);
  const smallest = (fine ?? edge ?? 0) * (scale || 1);
  if (!(typical > 0)) return [0, 1];

  const t = Math.min(1, Math.max(0, (typical - FINE) / (COARSE - FINE)));
  const wobble = smallest > 0
    ? Math.min(1, (SAFE * smallest) / FULL_SHIMMER)
    : 1;
  return [1 - t, wobble];
}


/**
 * A soft dark patch under each object, so things sit on the ground instead of
 * hovering above it. Cheaper than a shadow map by an enormous margin, and for a
 * diorama lit by one high sun it reads the same.
 */
export function contactShadows(scene, placements) {
  const boxes = objectBoxes(scene);
  const count = boxes.length;
  const centres = new Float32Array(count * 3);
  const radii = new Float32Array(count);
  const fromStep = new Float32Array(count);
  const untilStep = new Float32Array(count);
  boxes.forEach((box, i) => {
    centres[i * 3] = (box.min[0] + box.max[0]) / 2;
    centres[i * 3 + 1] = 0;
    centres[i * 3 + 2] = (box.min[2] + box.max[2]) / 2;
    // Wide enough to read, tight enough not to pool under a tall thin thing.
    const footprint = Math.max(box.max[0] - box.min[0], box.max[2] - box.min[2]);
    radii[i] = footprint * 0.62;
    fromStep[i] = placements[i]?.from ?? 0;
    untilStep[i] = placements[i]?.until ?? 9999;
  });

  return { centres, radii, fromStep, untilStep, count };
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
