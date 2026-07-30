// WebGL2. Three draw calls carry the whole picture: the sky, the cube field,
// and the cube field again mirrored under a shiny floor.
//
// This is the one module that is not pure. It knows about buffers, shaders and
// uniforms, and it knows nothing about canvases, scripts or steps: it is handed
// arrays and a matrix.

const CUBE_VS = `#version 300 es
in vec3 aPos;
in vec3 aNormal;
in vec3 aOffset;
in vec3 aColour;
in float aSeed;
in float aSize;

uniform mat4 uViewProj;
uniform float uTime;
uniform float uFlip;      // 1.0 upright, -1.0 mirrored under the floor
uniform float uShimmer;

out vec3 vColour;
out vec3 vNormal;
out float vDepth;
out float vY;

void main() {
  // Ambient shimmer: every cube breathes very slightly, so a static world is
  // never quite still. One line, and it is most of what stops a held shot
  // reading as a photograph.
  float s = aSeed * 6.2831853;
  vec3 wobble = vec3(sin(uTime * 1.1 + s), sin(uTime * 0.9 + s * 1.7), cos(uTime * 1.3 + s));
  vec3 world = aOffset + wobble * uShimmer;

  vec3 p = world + aPos * aSize;
  vY = p.y;
  p.y *= uFlip;

  vColour = aColour;
  vNormal = vec3(aNormal.x, aNormal.y * uFlip, aNormal.z);
  vec4 clip = uViewProj * vec4(p, 1.0);
  vDepth = clip.w;
  gl_Position = clip;
}`;

const CUBE_FS = `#version 300 es
precision highp float;

in vec3 vColour;
in vec3 vNormal;
in float vDepth;
in float vY;

uniform vec3 uSun;
uniform vec3 uSky;
uniform float uFogNear;
uniform float uFogFar;
uniform float uTint;      // mirrored pass is dimmed

out vec4 frag;

void main() {
  vec3 n = normalize(vNormal);
  float lambert = max(dot(n, normalize(uSun)), 0.0);
  float sky = 0.5 + 0.5 * n.y;                 // a little light from above
  vec3 colour = vColour * (0.34 + 0.52 * lambert + 0.22 * sky);

  float fog = clamp((vDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  colour = mix(colour, uSky, fog * 0.85);
  frag = vec4(colour * uTint, 1.0);
}`;

const SKY_VS = `#version 300 es
in vec2 aCorner;
out vec2 vNdc;
void main() {
  vNdc = aCorner;
  gl_Position = vec4(aCorner, 0.999, 1.0);
}`;

const SKY_FS = `#version 300 es
precision highp float;
in vec2 vNdc;
uniform vec3 uSky;
uniform vec3 uHorizon;
uniform vec3 uSunColour;
out vec4 frag;
void main() {
  float h = clamp(vNdc.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 colour = mix(uHorizon, uSky, pow(h, 0.75));
  // A soft glow up and to the left, so the sky is not a flat gradient.
  float glow = exp(-8.0 * distance(vNdc, vec2(-0.45, 0.55)));
  colour += uSunColour * glow * 0.35;
  frag = vec4(colour, 1.0);
}`;

const FLOOR_VS = `#version 300 es
in vec2 aCorner;
uniform mat4 uViewProj;
uniform float uExtent;
out vec3 vWorld;
out float vDepth;
void main() {
  vWorld = vec3(aCorner.x * uExtent, 0.0, aCorner.y * uExtent);
  vec4 clip = uViewProj * vec4(vWorld, 1.0);
  vDepth = clip.w;
  gl_Position = clip;
}`;

const FLOOR_FS = `#version 300 es
precision highp float;
in vec3 vWorld;
in float vDepth;
uniform vec3 uFloor;
uniform vec3 uSky;
uniform vec3 uEye;
uniform vec3 uSun;
uniform float uFogNear;
uniform float uFogFar;
out vec4 frag;
void main() {
  float fog = clamp((vDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);

  // A shiny floor: the reflection beneath shows through where the floor is
  // near, and the sky takes over as it recedes.
  // "half" is a reserved word in GLSL, hence "halfway".
  vec3 view = normalize(uEye - vWorld);
  vec3 halfway = normalize(normalize(uSun) + view);
  float spec = pow(max(halfway.y, 0.0), 90.0);

  vec3 colour = mix(uFloor, uSky, fog * 0.9) + vec3(spec) * 0.6;
  float alpha = mix(0.62, 1.0, fog);
  frag = vec4(colour, alpha);
}`;

// A cube as 24 vertices and 36 indices, so each face gets its own normal.
function cubeGeometry() {
  const faces = [
    { n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
    { n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
    { n: [1, 0, 0], v: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
    { n: [-1, 0, 0], v: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
    { n: [0, 1, 0], v: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
    { n: [0, -1, 0], v: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
  ];
  const positions = [];
  const normals = [];
  const indices = [];
  faces.forEach((face, f) => {
    face.v.forEach((v) => {
      positions.push(v[0] * 0.5, v[1] * 0.5, v[2] * 0.5);
      normals.push(...face.n);
    });
    const b = f * 4;
    indices.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
  };
}

// Every shader, exported so they can be checked without a graphics context.
// See test/shaders.test.js: a compile error is a five-minute round trip through
// a browser, and most of them are catchable by reading the text.
export const SHADERS = {
  'cube vertex': CUBE_VS,
  'cube fragment': CUBE_FS,
  'sky vertex': SKY_VS,
  'sky fragment': SKY_FS,
  'floor vertex': FLOOR_VS,
  'floor fragment': FLOOR_FS,
};

/** Show the offending line, since a GLSL error is a line number and little else. */
function withSource(log, source) {
  const lines = source.split('\n');
  const at = /\d+:(\d+)/.exec(log ?? '');
  if (!at) return log;
  const n = Number(at[1]);
  const from = Math.max(0, n - 3), to = Math.min(lines.length, n + 2);
  const shown = lines.slice(from, to)
    .map((text, i) => `${String(from + i + 1).padStart(4)} ${from + i + 1 === n ? '>' : ' '} ${text}`)
    .join('\n');
  return `${log}\n\n${shown}`;
}

function compile(gl, type, source, label) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    throw new Error(`the ${label} shader failed to compile:\n\n${withSource(log, source)}`);
  }
  return shader;
}

function program(gl, vs, fs, label = 'shader') {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs, `${label} vertex`));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs, `${label} fragment`));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(`program failed to link: ${gl.getProgramInfoLog(p)}`);
  }
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(p, i).name;
    uniforms[name] = gl.getUniformLocation(p, name);
  }
  return { handle: p, u: uniforms };
}

export const WEATHER = {
  clear: {
    sky: [0.36, 0.62, 0.92],
    horizon: [0.76, 0.88, 0.98],
    floor: [0.42, 0.68, 0.90],
    sun: [0.45, 0.85, 0.35],
    sunColour: [1.0, 0.95, 0.82],
  },
  overcast: {
    sky: [0.55, 0.60, 0.67],
    horizon: [0.78, 0.80, 0.83],
    floor: [0.48, 0.56, 0.63],
    sun: [0.3, 0.9, 0.2],
    sunColour: [0.85, 0.87, 0.9],
  },
};

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
  if (!gl) throw new Error('This needs WebGL2, and this browser did not provide it.');

  const cube = program(gl, CUBE_VS, CUBE_FS, 'cube');
  const sky = program(gl, SKY_VS, SKY_FS, 'sky');
  const floor = program(gl, FLOOR_VS, FLOOR_FS, 'floor');

  const geo = cubeGeometry();
  const buffer = (data, target = gl.ARRAY_BUFFER) => {
    const b = gl.createBuffer();
    gl.bindBuffer(target, b);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    return b;
  };

  const posBuf = buffer(geo.positions);
  const normBuf = buffer(geo.normals);
  const idxBuf = buffer(geo.indices, gl.ELEMENT_ARRAY_BUFFER);
  const quadBuf = buffer(new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]));

  let vao = null;
  let instanceCount = 0;
  const instanceBuffers = {};

  function attribute(prog, name, buf, size, divisor = 0) {
    const location = gl.getAttribLocation(prog, name);
    if (location < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(location, divisor);
  }

  /** Upload the field. Called once when the canvas loads, and after an edit. */
  function upload(scene) {
    instanceCount = scene.count;
    for (const key of ['positions', 'colours', 'seeds', 'sizes']) {
      if (instanceBuffers[key]) gl.deleteBuffer(instanceBuffers[key]);
      instanceBuffers[key] = buffer(scene[key]);
    }
    if (vao) gl.deleteVertexArray(vao);
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    attribute(cube.handle, 'aPos', posBuf, 3);
    attribute(cube.handle, 'aNormal', normBuf, 3);
    attribute(cube.handle, 'aOffset', instanceBuffers.positions, 3, 1);
    attribute(cube.handle, 'aColour', instanceBuffers.colours, 3, 1);
    attribute(cube.handle, 'aSeed', instanceBuffers.seeds, 1, 1);
    attribute(cube.handle, 'aSize', instanceBuffers.sizes, 1, 1);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bindVertexArray(null);
  }

  let lastSize = { w: 0, h: 0, dpr: 0 };

  /**
   * Fit a 16:9 frame inside whatever the window is, and letterbox the rest.
   *
   * Assigning canvas.width reallocates the drawing buffer even when the value
   * is unchanged, so this only touches it when the size has actually moved.
   */
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w !== lastSize.w || h !== lastSize.h || dpr !== lastSize.dpr) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      lastSize = { w, h, dpr };
    }

    const wide = w / h > 16 / 9;
    const vw = wide ? Math.round(h * (16 / 9) * dpr) : canvas.width;
    const vh = wide ? canvas.height : Math.round((w * (9 / 16)) * dpr);
    return {
      x: Math.round((canvas.width - vw) / 2),
      y: Math.round((canvas.height - vh) / 2),
      w: vw,
      h: vh,
    };
  }

  function drawCubes(matrix, eye, flip, weather, time, shimmer) {
    gl.useProgram(cube.handle);
    gl.bindVertexArray(vao);
    gl.uniformMatrix4fv(cube.u.uViewProj, false, matrix);
    gl.uniform1f(cube.u.uTime, time);
    gl.uniform1f(cube.u.uFlip, flip);
    gl.uniform1f(cube.u.uShimmer, shimmer);
    gl.uniform1f(cube.u.uTint, flip < 0 ? 0.72 : 1.0);
    gl.uniform3fv(cube.u.uSun, weather.sun);
    gl.uniform3fv(cube.u.uSky, weather.sky);
    gl.uniform1f(cube.u.uFogNear, 26);
    gl.uniform1f(cube.u.uFogFar, 180);
    gl.drawElementsInstanced(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0, instanceCount);
    gl.bindVertexArray(null);
  }

  function draw({ matrix, eye, time, weather = WEATHER.clear, shimmer = 0.004 }) {
    const view = resize();
    gl.enable(gl.SCISSOR_TEST);

    // The letterbox stays black, so what is captured is exactly the composition.
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.scissor(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.viewport(view.x, view.y, view.w, view.h);
    gl.scissor(view.x, view.y, view.w, view.h);

    // 1. Sky.
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(sky.handle);
    attribute(sky.handle, 'aCorner', quadBuf, 2);
    gl.uniform3fv(sky.u.uSky, weather.sky);
    gl.uniform3fv(sky.u.uHorizon, weather.horizon);
    gl.uniform3fv(sky.u.uSunColour, weather.sunColour);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // 2. The field, mirrored under the floor.
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);
    if (instanceCount) drawCubes(matrix, eye, -1, weather, time, shimmer);

    // 3. The floor, blended over its own reflection.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(floor.handle);
    attribute(floor.handle, 'aCorner', quadBuf, 2);
    gl.uniformMatrix4fv(floor.u.uViewProj, false, matrix);
    gl.uniform1f(floor.u.uExtent, 400);
    gl.uniform3fv(floor.u.uFloor, weather.floor);
    gl.uniform3fv(floor.u.uSky, weather.sky);
    gl.uniform3fv(floor.u.uSun, weather.sun);
    gl.uniform3fv(floor.u.uEye, eye);
    gl.uniform1f(floor.u.uFogNear, 26);
    gl.uniform1f(floor.u.uFogFar, 180);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // 4. The field itself.
    gl.disable(gl.BLEND);
    if (instanceCount) drawCubes(matrix, eye, 1, weather, time, shimmer);

    gl.disable(gl.SCISSOR_TEST);
  }

  return { gl, upload, draw, get count() { return instanceCount; } };
}
