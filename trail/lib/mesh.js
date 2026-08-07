// Cubes into a solid.
//
// Pure module. Takes the same voxel grid everything else uses and returns a
// smooth, watertight surface, so a canopy reads as round rather than as a pile
// of blocks. Nothing about authoring changes: recipes still describe solids and
// the voxeliser still produces a grid. Only what gets drawn is different.
//
// The method is Surface Nets. For every cell of the dual grid that straddles
// the surface, place one vertex at the average of where the surface crosses
// that cell's edges, then join neighbouring vertices into quads. It is simpler
// than marching cubes, has no ambiguous cases, and produces a mesh that can be
// relaxed toward roundness by a number you can turn.

const CORNERS = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
  [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
];

// The 12 edges of a cell, as pairs of corner indices.
const EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

/**
 * A smooth surface over a voxel grid.
 *
 * `roundness` runs from 0, the raw faceted surface, to 1, several passes of
 * relaxation. Positions come out in the model's own space, already carrying the
 * grid's anchor offset, so placing a mesh is the same addition as placing cubes.
 */
export function surfaceNets(grid, { roundness = 0.6, passes = 4 } = {}) {
  const [nx, ny, nz] = grid.dims;
  const { cells, unit, offset } = grid;

  // Sampled with a border of empty space, so the outside of the object is a
  // surface rather than being cut off at the edge of the grid.
  const at = (i, j, k) => (
    i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz
      ? 0
      : cells[(k * ny + j) * nx + i]
  );

  const dx = nx + 1, dy = ny + 1, dz = nz + 1;
  const vertexAt = new Int32Array(dx * dy * dz).fill(-1);
  const dual = (a, b, c) => (c * dy + b) * dx + a;

  const px = [], py = [], pz = [], value = [];

  for (let c = 0; c < dz; c++) {
    for (let b = 0; b < dy; b++) {
      for (let a = 0; a < dx; a++) {
        let mask = 0;
        let filled = 0;
        for (let n = 0; n < 8; n++) {
          const [ox, oy, oz] = CORNERS[n];
          const v = at(a - 1 + ox, b - 1 + oy, c - 1 + oz);
          if (v) { mask |= 1 << n; if (!filled) filled = v; }
        }
        if (mask === 0 || mask === 255) continue;

        // Where the surface crosses this cell's edges. The field is binary, so
        // every crossing sits at an edge's midpoint.
        let sx = 0, sy = 0, sz = 0, crossings = 0;
        for (const [u, v] of EDGES) {
          if (((mask >> u) & 1) === ((mask >> v) & 1)) continue;
          sx += (CORNERS[u][0] + CORNERS[v][0]) / 2;
          sy += (CORNERS[u][1] + CORNERS[v][1]) / 2;
          sz += (CORNERS[u][2] + CORNERS[v][2]) / 2;
          crossings++;
        }
        if (!crossings) continue;

        vertexAt[dual(a, b, c)] = px.length;
        px.push(a - 1 + sx / crossings);
        py.push(b - 1 + sy / crossings);
        pz.push(c - 1 + sz / crossings);
        value.push(filled);
      }
    }
  }

  // Quads. A sample edge with occupancy changing across it is surrounded by
  // four dual cells, and those four vertices are a face.
  const indices = [];
  const quad = (v0, v1, v2, v3, flip) => {
    if (v0 < 0 || v1 < 0 || v2 < 0 || v3 < 0) return;
    if (flip) indices.push(v0, v1, v2, v0, v2, v3);
    else indices.push(v0, v2, v1, v0, v3, v2);
  };

  for (let k = -1; k < nz; k++) {
    for (let j = -1; j < ny; j++) {
      for (let i = -1; i < nx; i++) {
        const here = at(i, j, k) ? 1 : 0;
        if (i + 1 <= nx) {
          const there = at(i + 1, j, k) ? 1 : 0;
          if (here !== there) {
            quad(
              vertexAt[dual(i + 1, j, k)], vertexAt[dual(i + 1, j + 1, k)],
              vertexAt[dual(i + 1, j + 1, k + 1)], vertexAt[dual(i + 1, j, k + 1)],
              here === 1,
            );
          }
        }
        if (j + 1 <= ny) {
          const there = at(i, j + 1, k) ? 1 : 0;
          if (here !== there) {
            quad(
              vertexAt[dual(i, j + 1, k)], vertexAt[dual(i, j + 1, k + 1)],
              vertexAt[dual(i + 1, j + 1, k + 1)], vertexAt[dual(i + 1, j + 1, k)],
              here === 1,
            );
          }
        }
        if (k + 1 <= nz) {
          const there = at(i, j, k + 1) ? 1 : 0;
          if (here !== there) {
            quad(
              vertexAt[dual(i, j, k + 1)], vertexAt[dual(i + 1, j, k + 1)],
              vertexAt[dual(i + 1, j + 1, k + 1)], vertexAt[dual(i, j + 1, k + 1)],
              here === 1,
            );
          }
        }
      }
    }
  }

  relax(px, py, pz, indices, roundness, passes);

  const count = px.length;
  const positions = new Float32Array(count * 3);
  for (let n = 0; n < count; n++) {
    positions[n * 3] = offset[0] + (px[n] + 0.5) * unit;
    positions[n * 3 + 1] = offset[1] + (py[n] + 0.5) * unit;
    positions[n * 3 + 2] = offset[2] + (pz[n] + 0.5) * unit;
  }

  const normals = normalsFor(positions, indices, count);
  return {
    positions,
    normals,
    values: Uint8Array.from(value),
    ao: occlusion(px, py, pz, normals, count, at),
    motion: motionFor(px, py, pz, count, grid),
    motions: grid.motions ?? [],
    indices: Uint32Array.from(indices),
    count,
    triangles: indices.length / 3,
    // A cube grid's triangles are a cell wide, near enough, and this is what
    // lets a voxel surface and a real mesh be sized by the same rule. A lattice
    // is even, so its smallest triangles are its typical ones.
    edge: unit,
    fine: unit,
  };
}

/**
 * Which moving part each vertex belongs to.
 *
 * A vertex sits between cells, so it takes the motion of the nearest occupied
 * one. A vertex on the seam between a swaying arm and a still body will pick a
 * side, which is correct enough: the seam is inside the join.
 */
function motionFor(px, py, pz, count, grid) {
  const out = new Uint8Array(count);
  if (!grid.motion) return out;
  const [nx, ny, nz] = grid.dims;
  for (let v = 0; v < count; v++) {
    let best = 0;
    // The eight cells around the vertex; take the first that is solid.
    for (let k = 0; k < 2 && !best; k++) {
      for (let j = 0; j < 2 && !best; j++) {
        for (let i = 0; i < 2 && !best; i++) {
          const x = Math.floor(px[v]) + i;
          const y = Math.floor(py[v]) + j;
          const z = Math.floor(pz[v]) + k;
          if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) continue;
          const at = (z * ny + y) * nx + x;
          if (grid.cells[at]) best = grid.motion[at];
        }
      }
    }
    out[v] = best;
  }
  return out;
}

// Thirteen directions, at two distances. Enough to tell a crease from a bulge
// without sampling a whole neighbourhood per vertex.
const PROBES = (() => {
  const dirs = [];
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        if (x === 0 && y === 0 && z === 0) continue;
        if (dirs.some((d) => d[0] === -x && d[1] === -y && d[2] === -z)) continue;
        dirs.push([x, y, z]);
      }
    }
  }
  return dirs.flatMap((d) => [1.4, 2.8].map((r) => {
    const length = Math.hypot(...d);
    return [(d[0] / length) * r, (d[1] / length) * r, (d[2] / length) * r];
  }));
})();

/**
 * How enclosed each vertex is.
 *
 * Look outward along the surface normal and count how much solid is in the way.
 * A crease is surrounded and goes dark; an exposed corner is open and stays
 * bright. This is what gives a smooth surface weight, and without it a low-poly
 * shape reads as flat shading on a silhouette rather than as an object.
 */
function occlusion(px, py, pz, normals, count, at) {
  const ao = new Float32Array(count);
  for (let v = 0; v < count; v++) {
    const nx = normals[v * 3], ny = normals[v * 3 + 1], nz = normals[v * 3 + 2];
    let blocked = 0;
    let total = 0;
    for (const [ox, oy, oz] of PROBES) {
      // Only the hemisphere the surface faces into can occlude it.
      const facing = ox * nx + oy * ny + oz * nz;
      if (facing <= 0) continue;
      total += facing;
      const solid = at(
        Math.round(px[v] + ox),
        Math.round(py[v] + oy),
        Math.round(pz[v] + oz),
      );
      if (solid) blocked += facing;
    }
    ao[v] = total > 0 ? 1 - blocked / total : 1;
  }
  return ao;
}

/**
 * Pull every vertex toward the average of the ones it is joined to.
 *
 * This is what turns a faceted surface into a rounded one. It shrinks the shape
 * slightly, which is why the strength is a dial rather than always on.
 */
function relax(px, py, pz, indices, strength, passes) {
  if (strength <= 0 || px.length === 0) return;

  // Neighbours, from the triangle edges.
  const count = px.length;
  const neighbours = Array.from({ length: count }, () => new Set());
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]];
    neighbours[a].add(b); neighbours[a].add(c);
    neighbours[b].add(a); neighbours[b].add(c);
    neighbours[c].add(a); neighbours[c].add(b);
  }

  const rounds = Math.max(1, Math.round(passes * strength));
  const step = Math.min(1, strength) * 0.65;
  for (let pass = 0; pass < rounds; pass++) {
    const nx = new Float64Array(count);
    const nyy = new Float64Array(count);
    const nz = new Float64Array(count);
    for (let v = 0; v < count; v++) {
      const near = neighbours[v];
      if (near.size === 0) { nx[v] = px[v]; nyy[v] = py[v]; nz[v] = pz[v]; continue; }
      let sx = 0, sy = 0, sz = 0;
      for (const n of near) { sx += px[n]; sy += py[n]; sz += pz[n]; }
      nx[v] = px[v] + (sx / near.size - px[v]) * step;
      nyy[v] = py[v] + (sy / near.size - py[v]) * step;
      nz[v] = pz[v] + (sz / near.size - pz[v]) * step;
    }
    for (let v = 0; v < count; v++) { px[v] = nx[v]; py[v] = nyy[v]; pz[v] = nz[v]; }
  }
}

/** Smooth normals, accumulated from the faces meeting at each vertex. */
function normalsFor(positions, indices, count) {
  const normals = new Float32Array(count * 3);
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i] * 3, indices[i + 1] * 3, indices[i + 2] * 3];
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const at of [a, b, c]) {
      normals[at] += nx; normals[at + 1] += ny; normals[at + 2] += nz;
    }
  }
  for (let n = 0; n < count * 3; n += 3) {
    const length = Math.hypot(normals[n], normals[n + 1], normals[n + 2]) || 1;
    normals[n] /= length; normals[n + 1] /= length; normals[n + 2] /= length;
  }
  return normals;
}

/**
 * A model as it was actually drawn, rather than as cubes.
 *
 * The packs are low-poly art: a car is a few thousand triangles that somebody
 * shaped on purpose. Voxelising it throws that away and hands back a blocky
 * approximation, and no amount of smoothing afterwards recovers a shape that
 * was destroyed on the way in - relaxing it only turns blocks into putty.
 *
 * So this is the other way in. It returns exactly what `surfaceNets` returns,
 * because everything downstream - merging, placing, ghosting, motion, the
 * renderer - was written against that shape and knows nothing about voxels.
 * The two are interchangeable, which is why a hand-authored recipe can still
 * take the voxel route while an imported model no longer does.
 *
 * Vertices are not shared between triangles. Each face carries its own normal
 * and its own colour, which is what keeps an edge an edge under flat shading,
 * and it is the same decision the faceted voxel surface already made.
 */
export function fromTriangles(source, { height = 0, anchor = 'base' } = {}) {
  const faces = source?.triangles ?? [];
  if (!faces.length) throw new Error('a model with no triangles cannot be drawn');

  // The model's own box, so it can be stood on the ground and centred, exactly
  // as a voxel grid's anchor offset does it.
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const tri of faces) {
    for (const v of tri) {
      for (let a = 0; a < 3; a++) {
        if (v[a] < min[a]) min[a] = v[a];
        if (v[a] > max[a]) max[a] = v[a];
      }
    }
  }
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  if (!(Math.max(...size) > 0)) throw new Error('a model with no size cannot be drawn');

  // A pack that normalised its models before exporting has lost their real
  // sizes, so a height from the manifest puts them back. Same rule as the
  // voxel path, applied to the vertices instead of to the cube size.
  const scale = height > 0 && size[1] > 0 ? height / size[1] : 1;
  const midX = (min[0] + max[0]) / 2;
  const midZ = (min[2] + max[2]) / 2;
  const baseY = anchor === 'center' ? (min[1] + max[1]) / 2 : min[1];

  const count = faces.length * 3;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const values = new Uint8Array(count);
  const indices = new Uint32Array(count);

  const palette = [];
  const byColour = new Map();
  // A slot is a colour somebody fills in per placement. Two faces that happen
  // to be the same colour but answer to different slots are two entries, or
  // tinting one would tint the other.
  const indexOf = (hex, slot) => {
    const key = slot ? `${hex}|${slot}` : hex;
    if (!byColour.has(key)) {
      if (palette.length >= 255) return 255;
      palette.push(slot ? { hex, slot } : { hex });
      byColour.set(key, palette.length);
    }
    return byColour.get(key);
  };

  faces.forEach((tri, f) => {
    const value = indexOf(source.colours?.[f] ?? '#bbbbbb', source.slots?.[f] ?? null);
    const local = tri.map((v) => [
      (v[0] - midX) * scale,
      (v[1] - baseY) * scale,
      (v[2] - midZ) * scale,
    ]);

    // The face's own normal, from its winding.
    const [a, b, c] = local;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;

    for (let k = 0; k < 3; k++) {
      const at = f * 3 + k;
      positions[at * 3] = local[k][0];
      positions[at * 3 + 1] = local[k][1];
      positions[at * 3 + 2] = local[k][2];
      normals[at * 3] = nx;
      normals[at * 3 + 1] = ny;
      normals[at * 3 + 2] = nz;
      values[at] = value;
      indices[at] = at;
    }
  });

  // Every face keeps its own three vertices, so the same corner of a model
  // exists once per face that touches it. Left alone, those copies each carry
  // their own normal - and the renderer's ambient shimmer moves a vertex
  // *along its normal*, so the copies walk apart and tear the model open.
  // Welding makes them agree about which way the surface goes.
  //
  // Shading does not suffer, because the shader takes its faceted normal from
  // how the surface changes across the screen and only uses this one for
  // winding and for the smoothing dial.
  const faceNormals = normals.slice();
  weld(positions, normals, count);

  return {
    positions,
    normals,
    values,
    ao: occlude(positions, faceNormals, count, size, scale),
    // See `weld`: what ships as `normals` is welded, and these are the raw
    // per-face ones, kept for anything that needs to know which way a single
    // face points rather than which way the surface goes.
    faceNormals,
    motion: null,
    motions: [],
    indices,
    count,
    triangles: faces.length,
    // How wide a triangle is, typically, and how wide the small ones are.
    // **They answer different questions and a model needs both.** Whether
    // facets are worth seeing is about the typical triangle; how far a vertex
    // may be pushed is about the smallest, because that is what tears first. A
    // character is a coarse torso and a face of tiny triangles, and judging it
    // by the middle destroyed the face.
    edge: percentileEdge(positions, count, 0.5),
    fine: percentileEdge(positions, count, 0.1),
    // Carried so the page can place, box and shadow the model without ever
    // building a grid for it.
    palette,
    size: [size[0] * scale, size[1] * scale, size[2] * scale],
    unit: Math.max(...size) * scale / 34,
  };
}

// Thirteen directions over a hemisphere, which is enough to tell a crease from
// an exposed face and cheap enough to run over a character's forty thousand
// vertices without anyone noticing.
const RAYS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  [0.577, 0.577, 0.577], [-0.577, 0.577, 0.577], [0.577, 0.577, -0.577],
  [-0.577, 0.577, -0.577], [0.707, 0, 0.707], [-0.707, 0, 0.707], [0, 0.707, 0.707],
];

/**
 * How enclosed each vertex is, baked once so it costs nothing to draw.
 *
 * The renderer darkens creases by this, and without it a model is lit flat and
 * reads as a silhouette rather than an object - which is the same thing the
 * voxel surface needed, arrived at from the other direction. Surface Nets can
 * ask the grid it came from; a mesh has no grid, so a coarse one is built here
 * purely to answer "is there something over there".
 *
 * Occupancy only, never colour: it is a few kilobytes and it is thrown away.
 */
function occlude(positions, normals, count, size, scale) {
  const longest = Math.max(...size);
  if (!(longest > 0)) return null;

  const CELLS = 24;
  const step = longest / CELLS;
  // The model sits centred on x and z with its base at zero, so the grid is
  // laid out the same way rather than around the origin.
  const half = [size[0] / 2, 0, size[2] / 2];
  const dims = size.map((s) => Math.max(1, Math.ceil(s / step) + 1));
  const [gx, gy, gz] = dims;
  const solid = new Uint8Array(gx * gy * gz);
  const cellOf = (x, y, z) => {
    const i = Math.round((x + half[0]) / step);
    const j = Math.round((y - half[1]) / step);
    const k = Math.round((z + half[2]) / step);
    if (i < 0 || j < 0 || k < 0 || i >= gx || j >= gy || k >= gz) return -1;
    return (k * gy + j) * gx + i;
  };

  // Every vertex marks its own cell. Triangles larger than a cell would leave
  // gaps, so each is walked as well - the same barycentric sweep the voxeliser
  // uses, at a quarter of the resolution.
  for (let f = 0; f * 3 < count; f++) {
    const a = [positions[f * 9], positions[f * 9 + 1], positions[f * 9 + 2]];
    const b = [positions[f * 9 + 3], positions[f * 9 + 4], positions[f * 9 + 5]];
    const c = [positions[f * 9 + 6], positions[f * 9 + 7], positions[f * 9 + 8]];
    const side = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    const steps = Math.min(24, Math.max(1,
      Math.ceil(Math.max(side(a, b), side(a, c), side(b, c)) / (step * 0.5))));
    for (let i = 0; i <= steps; i++) {
      for (let j = 0; i + j <= steps; j++) {
        const u = i / steps; const v = j / steps; const w = 1 - u - v;
        const at = cellOf(
          a[0] * w + b[0] * u + c[0] * v,
          a[1] * w + b[1] * u + c[1] * v,
          a[2] * w + b[2] * u + c[2] * v,
        );
        if (at >= 0) solid[at] = 1;
      }
    }
  }

  // Look a little way along each direction that faces outward. Anything solid
  // out there is something this vertex is tucked behind.
  const reach = step * 2.2;
  const ao = new Float32Array(count);
  for (let v = 0; v < count; v++) {
    const px = positions[v * 3]; const py = positions[v * 3 + 1]; const pz = positions[v * 3 + 2];
    const nx = normals[v * 3]; const ny = normals[v * 3 + 1]; const nz = normals[v * 3 + 2];
    let looked = 0;
    let blocked = 0;
    for (const [dx, dy, dz] of RAYS) {
      if (dx * nx + dy * ny + dz * nz <= 0.1) continue;   // behind the surface
      looked++;
      const at = cellOf(px + dx * reach, py + dy * reach, pz + dz * reach);
      if (at >= 0 && solid[at]) blocked++;
    }
    // The ground counts too: a face low down is shaded by whatever it stands on.
    const open = looked ? 1 - blocked / looked : 1;
    ao[v] = Math.max(0, Math.min(1, 0.25 + 0.75 * open));
  }
  // `scale` only exists so a resized model is occluded the same as an
  // unresized one; the grid is already in the resized space, so there is
  // nothing to undo.
  void scale;
  return ao;
}

/**
 * Make copies of one corner agree about which way the surface goes.
 *
 * Vertices are kept per face so that an edge stays an edge, which means a
 * corner where three faces meet exists three times over. That is fine until
 * something moves a vertex along its normal - the ambient shimmer does exactly
 * that - and the three copies set off in three directions, opening a hole that
 * you can see through and that ripples as the shimmer runs.
 *
 * Averaging the normals of the faces that share a position fixes it at the
 * source: the copies still exist, and they now move together.
 *
 * A position is matched to a thousandth of a unit. Exact float equality would
 * miss corners that an exporter wrote at very slightly different values, which
 * is most of them.
 */
function weld(positions, normals, count) {
  const key = (v) => `${Math.round(positions[v * 3] * 1000)},`
    + `${Math.round(positions[v * 3 + 1] * 1000)},`
    + `${Math.round(positions[v * 3 + 2] * 1000)}`;

  const sums = new Map();
  for (let v = 0; v < count; v++) {
    const at = key(v);
    const found = sums.get(at);
    if (found) {
      found[0] += normals[v * 3];
      found[1] += normals[v * 3 + 1];
      found[2] += normals[v * 3 + 2];
    } else {
      sums.set(at, [normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]]);
    }
  }

  for (let v = 0; v < count; v++) {
    const [x, y, z] = sums.get(key(v));
    const length = Math.hypot(x, y, z);
    // Two faces pointing exactly opposite - a sheet with no thickness - cancel
    // out. There is no surface direction to agree on, so the face keeps its
    // own and only that one vertex is left able to tear.
    if (length < 1e-6) continue;
    normals[v * 3] = x / length;
    normals[v * 3 + 1] = y / length;
    normals[v * 3 + 2] = z / length;
  }
}


/**
 * How wide this model's triangles are, at a given point in the range.
 *
 * A percentile rather than a mean, because one enormous ground plane among ten
 * thousand small faces would drag an average up and say the model is coarse
 * when every part you look at is fine.
 *
 * **The range is wider than it looks.** Measured across the library, the middle
 * triangle is three to ten times the width of the small ones - a car, a tree
 * and a person all mix a broad body with fine detail. So there is no single
 * number that describes a model, and asking for one is what let the shimmer
 * move a vertex further than a character's eye is wide.
 *
 * Sampled rather than measured in full: a two-thousandth of the faces of a
 * large model is thousands of edges, which settles a percentile long before it
 * costs anything.
 */
function percentileEdge(positions, count, at) {
  const faces = count / 3;
  if (!(faces > 0)) return 0;
  const step = Math.max(1, Math.floor(faces / 2000));
  const lengths = [];
  for (let f = 0; f < faces; f += step) {
    const at = (k) => (f * 3 + k) * 3;
    const [a, b, c] = [at(0), at(1), at(2)];
    const span = (u, v) => Math.hypot(
      positions[u] - positions[v],
      positions[u + 1] - positions[v + 1],
      positions[u + 2] - positions[v + 2],
    );
    lengths.push(span(a, b), span(b, c), span(c, a));
  }
  lengths.sort((x, y) => x - y);
  const k = Math.min(lengths.length - 1, Math.max(0, Math.floor(lengths.length * at)));
  return lengths[k] ?? 0;
}
