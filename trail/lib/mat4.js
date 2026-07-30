// The four matrices this project needs, column-major, as WebGL wants them.
// Pure. No dependency, and small enough to read in one sitting.

export function multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b[c * 4]
        + a[4 + r] * b[c * 4 + 1]
        + a[8 + r] * b[c * 4 + 2]
        + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

export function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const range = 1 / (near - far);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * range;
  out[11] = -1;
  out[14] = 2 * far * near * range;
  return out;
}

export function lookAt(eye, target, up = [0, 1, 0]) {
  const z = normalise(sub(eye, target));
  const x = normalise(cross(up, z));
  const y = cross(z, x);
  const out = new Float32Array(16);
  out[0] = x[0]; out[4] = x[1]; out[8] = x[2]; out[12] = -dot(x, eye);
  out[1] = y[0]; out[5] = y[1]; out[9] = y[2]; out[13] = -dot(y, eye);
  out[2] = z[0]; out[6] = z[1]; out[10] = z[2]; out[14] = -dot(z, eye);
  out[15] = 1;
  return out;
}

/** Mirror through the ground plane, for the floor's reflection. */
export function flipY() {
  const out = new Float32Array(16);
  out[0] = 1; out[5] = -1; out[10] = 1; out[15] = 1;
  return out;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
function normalise(v) {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}
