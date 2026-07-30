// What the weather leaves behind.
//
// Pure module. A low-resolution map over the canvas recording where it rained
// and where the fog came down, so the ground still shows it long after the sky
// has cleared. This is what makes the final pull-back worth composing for: the
// sky is one sky, but the ground reads as a record of the whole story.
//
// The map is derived from the steps rather than accumulated over time, so
// jumping straight to the last step looks identical to playing the whole route.

export const CHANNELS = { wet: 0, pale: 1 };

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Where a world coordinate falls on the map, in texels. */
export function toTexel(world, extent, resolution) {
  return ((world + extent) / (2 * extent)) * resolution;
}

/**
 * Build the map for a set of stamps.
 *
 * `extent` is half the width of the ground the map covers, centred on the
 * origin. A stamp is a step's own frame rectangle, feathered at the edges so a
 * wet patch does not read as a painted rectangle.
 */
export function scarMap(stamps, { extent = 60, resolution = 256, feather = 6 } = {}) {
  const data = new Uint8Array(resolution * resolution * 4);
  for (const stamp of stamps) {
    const channel = CHANNELS[stamp.kind];
    if (channel === undefined) continue;
    stampRect(data, stamp.frame, channel, { extent, resolution, feather });
  }
  return data;
}

function stampRect(data, frame, channel, { extent, resolution, feather }) {
  const x0 = toTexel(frame.x, extent, resolution);
  const x1 = toTexel(frame.x + frame.w, extent, resolution);
  const z0 = toTexel(frame.z, extent, resolution);
  const z1 = toTexel(frame.z + frame.d, extent, resolution);

  const from = [Math.max(0, Math.floor(x0 - feather)), Math.max(0, Math.floor(z0 - feather))];
  const to = [
    Math.min(resolution - 1, Math.ceil(x1 + feather)),
    Math.min(resolution - 1, Math.ceil(z1 + feather)),
  ];

  for (let z = from[1]; z <= to[1]; z++) {
    for (let x = from[0]; x <= to[0]; x++) {
      // Distance inside the rectangle, negative outside it.
      const inX = Math.min(x + 0.5 - x0, x1 - (x + 0.5));
      const inZ = Math.min(z + 0.5 - z0, z1 - (z + 0.5));
      const edge = Math.min(inX, inZ);
      const strength = clamp01((edge + feather) / (feather * 2));
      if (strength <= 0) continue;
      const at = (z * resolution + x) * 4 + channel;
      data[at] = Math.max(data[at], Math.round(strength * 255));
    }
  }
}

/** Read a channel back, for tests and for anything that wants to sample on the CPU. */
export function sample(data, world, channel, { extent = 60, resolution = 256 } = {}) {
  const x = Math.floor(toTexel(world[0], extent, resolution));
  const z = Math.floor(toTexel(world[2], extent, resolution));
  if (x < 0 || z < 0 || x >= resolution || z >= resolution) return 0;
  return data[(z * resolution + x) * 4 + CHANNELS[channel]] / 255;
}
