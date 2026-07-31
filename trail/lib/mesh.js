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
    indices: Uint32Array.from(indices),
    count,
    triangles: indices.length / 3,
  };
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
