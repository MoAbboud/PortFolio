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
in float aObject;
in float aFrom;           // the step this object solidifies at
in float aUntil;          // the last step it is solid for

uniform mat4 uViewProj;
uniform float uTime;
uniform float uFlip;      // 1.0 upright, -1.0 mirrored under the floor
uniform float uShimmer;
uniform float uSelected;  // -1 for nothing selected
uniform float uStep;      // the step being shown
uniform float uStepT;     // how far into arriving at it, 0 to 1

out vec3 vColour;
out vec3 vNormal;
out float vDepth;
out float vY;
out float vPicked;
out float vSolid;

// How present this cube is. Unvisited parts of the canvas are ghosts, they
// solidify as the camera reaches them, and they fade back out once the story
// has moved on. One comparison, no per-object work on the processor.
float solidity(float step, float t, float from, float until) {
  if (step < from - 0.5) return 0.0;
  if (step < from + 0.5) return t;
  if (step < until + 0.5) return 1.0;
  if (step < until + 1.5) return 1.0 - t;
  return 0.0;
}

void main() {
  // Ambient shimmer: every cube breathes very slightly, so a static world is
  // never quite still. One line, and it is most of what stops a held shot
  // reading as a photograph.
  float s = aSeed * 6.2831853;
  vec3 wobble = vec3(sin(uTime * 1.1 + s), sin(uTime * 0.9 + s * 1.7), cos(uTime * 1.3 + s));
  vec3 world = aOffset + wobble * uShimmer;

  // A ghost is smaller as well as fainter, so an unvisited part of the canvas
  // reads as not-yet-arrived rather than as badly lit.
  vSolid = solidity(uStep, uStepT, aFrom, aUntil);
  float grow = mix(0.5, 1.0, vSolid);

  vec3 p = world + aPos * aSize * grow;
  vY = p.y;
  p.y *= uFlip;

  vColour = aColour;
  vPicked = abs(aObject - uSelected) < 0.5 ? 1.0 : 0.0;
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
in float vPicked;
in float vSolid;

uniform vec3 uSun;
uniform vec3 uSky;
uniform float uFogNear;
uniform float uFogFar;
uniform float uTint;      // mirrored pass is dimmed
uniform float uAmbient;

out vec4 frag;

void main() {
  vec3 n = normalize(vNormal);
  float lambert = max(dot(n, normalize(uSun)), 0.0);
  float sky = 0.5 + 0.5 * n.y;                 // a little light from above
  vec3 colour = vColour * (0.34 + 0.52 * lambert + 0.22 * sky) * uAmbient;

  float fog = clamp((vDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  colour = mix(colour, uSky, fog * 0.85);

  // A ghost is washed most of the way into the sky rather than made
  // transparent. It reads the same and it needs no sorting, which transparency
  // over a hundred thousand cubes would.
  vec3 ghost = mix(uSky, colour, 0.22);
  colour = mix(ghost, colour, vSolid);

  // A selected object lifts out of the scene without changing its own colours,
  // so what is being edited still looks like what it will look like.
  colour = mix(colour, colour * 1.25 + vec3(0.10, 0.16, 0.08), vPicked * 0.9);

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
uniform sampler2D uScars;
uniform float uScarExtent;
out vec4 frag;
void main() {
  float fog = clamp((vDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);

  // What the weather left behind. Red is wet, green is bleached by fog. The sky
  // is one sky, but the ground is a record of the whole story, which is what
  // the final pull-back is looking at.
  vec2 uv = (vWorld.xz + uScarExtent) / (2.0 * uScarExtent);
  vec2 marks = texture(uScars, uv).rg;
  float wet = marks.r * step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  float pale = marks.g * step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);

  // A shiny floor: the reflection beneath shows through where the floor is
  // near, and the sky takes over as it recedes.
  // "half" is a reserved word in GLSL, hence "halfway".
  vec3 view = normalize(uEye - vWorld);
  vec3 halfway = normalize(normalize(uSun) + view);
  float spec = pow(max(halfway.y, 0.0), mix(90.0, 220.0, wet));

  vec3 ground = uFloor * mix(1.0, 0.55, wet);          // rain darkens it
  ground = mix(ground, vec3(0.82, 0.83, 0.84), pale * 0.65);
  vec3 colour = mix(ground, uSky, fog * 0.9) + vec3(spec) * mix(0.6, 1.5, wet);

  // Wet ground mirrors harder; bleached ground barely mirrors at all.
  float clarity = mix(0.62, 0.34, wet);
  clarity = mix(clarity, 0.92, pale);
  float alpha = mix(clarity, 1.0, fog);
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

// The presets live in weather.js, which is pure and knows nothing about
// graphics. Re-exported so a caller need only import the renderer.
export { PRESETS as WEATHER, resolve as resolveWeather, lerpWeather } from './weather.js';
import { PRESETS as WEATHER } from './weather.js';

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
  if (!gl) throw new Error('This needs WebGL2, and this browser did not provide it.');

  const cube = program(gl, CUBE_VS, CUBE_FS, 'cube');
  const sky = program(gl, SKY_VS, SKY_FS, 'sky');
  const floor = program(gl, FLOOR_VS, FLOOR_FS, 'floor');

  const geo = cubeGeometry();
  const buffer = (data, target = gl.ARRAY_BUFFER, usage = gl.STATIC_DRAW) => {
    const b = gl.createBuffer();
    gl.bindBuffer(target, b);
    gl.bufferData(target, data, usage);
    return b;
  };

  const posBuf = buffer(geo.positions);
  const normBuf = buffer(geo.normals);
  const idxBuf = buffer(geo.indices, gl.ELEMENT_ARRAY_BUFFER);
  const quadBuf = buffer(new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]));

  let vao = null;
  let instanceCount = 0;
  const instanceBuffers = {};

  // The ground's memory of the weather. One texture, rewritten only when the
  // route reaches a step that leaves a mark.
  let scarExtent = 60;
  let scarResolution = 1;
  const scarTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, scarTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
    new Uint8Array([0, 0, 0, 0]));

  /** Hand the ground a new set of marks. Called when the current step changes. */
  function setScars(data, resolution, extent) {
    scarExtent = extent;
    gl.bindTexture(gl.TEXTURE_2D, scarTexture);
    if (resolution !== scarResolution) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, resolution, resolution, 0,
        gl.RGBA, gl.UNSIGNED_BYTE, data);
      scarResolution = resolution;
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, resolution, resolution,
        gl.RGBA, gl.UNSIGNED_BYTE, data);
    }
  }

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
    for (const key of ['positions', 'colours', 'seeds', 'sizes', 'objects', 'fromStep', 'untilStep']) {
      if (instanceBuffers[key]) gl.deleteBuffer(instanceBuffers[key]);
      // Positions are rewritten while dragging, so they are not static data.
      instanceBuffers[key] = buffer(scene[key],
        gl.ARRAY_BUFFER, key === 'positions' ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
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
    attribute(cube.handle, 'aObject', instanceBuffers.objects, 1, 1);
    attribute(cube.handle, 'aFrom', instanceBuffers.fromStep, 1, 1);
    attribute(cube.handle, 'aUntil', instanceBuffers.untilStep, 1, 1);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bindVertexArray(null);
  }

  /**
   * Rewrite one object's cubes without touching the rest of the field.
   *
   * Dragging a house re-uploads a few thousand floats rather than the whole
   * scene, which is the difference between a smooth drag and a stutter once a
   * canvas is full.
   */
  function updatePositions(positions, start, count) {
    if (!instanceBuffers.positions || count <= 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffers.positions);
    gl.bufferSubData(
      gl.ARRAY_BUFFER,
      start * 3 * Float32Array.BYTES_PER_ELEMENT,
      positions.subarray(start * 3, (start + count) * 3),
    );
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
      // How much of the window the composed frame actually occupies. Anything
      // under 100% is letterboxing, and the cure is a 16:9 viewport, which
      // usually means fullscreen rather than any change here.
      fill: (vw * vh) / Math.max(1, canvas.width * canvas.height),
      // The same rectangle in CSS pixels, which is what a pointer event speaks.
      css: { x: view0(vw, canvas.width) / dpr, y: view0(vh, canvas.height) / dpr,
        w: vw / dpr, h: vh / dpr },
    };
  }

  const view0 = (inner, outer) => Math.round((outer - inner) / 2);

  /** What the last frame was drawn into, for reporting rather than for drawing. */
  let lastView = { x: 0, y: 0, w: 0, h: 0, fill: 1 };

  function drawCubes(matrix, flip, weather, time, shimmer, selected, step, stepT) {
    gl.useProgram(cube.handle);
    gl.bindVertexArray(vao);
    gl.uniformMatrix4fv(cube.u.uViewProj, false, matrix);
    gl.uniform1f(cube.u.uTime, time);
    gl.uniform1f(cube.u.uFlip, flip);
    gl.uniform1f(cube.u.uShimmer, shimmer);
    gl.uniform1f(cube.u.uStep, step);
    gl.uniform1f(cube.u.uStepT, stepT);
    // The reflection is not highlighted; only the object itself.
    gl.uniform1f(cube.u.uSelected, flip < 0 ? -1 : selected);
    gl.uniform1f(cube.u.uTint, flip < 0 ? 0.72 : 1.0);
    gl.uniform1f(cube.u.uAmbient, weather.ambient ?? 1);
    gl.uniform3fv(cube.u.uSun, weather.sun);
    gl.uniform3fv(cube.u.uSky, weather.sky);
    gl.uniform1f(cube.u.uFogNear, weather.fogNear ?? 26);
    gl.uniform1f(cube.u.uFogFar, weather.fogFar ?? 180);
    gl.drawElementsInstanced(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0, instanceCount);
    gl.bindVertexArray(null);
  }

  function draw({
    matrix, eye, time, weather = WEATHER.clear, shimmer = 0.004,
    selected = -1, step = 0, stepT = 1,
  }) {
    const view = resize();
    lastView = view;
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
    if (instanceCount) drawCubes(matrix, -1, weather, time, shimmer, selected, step, stepT);

    // 3. The floor, blended over its own reflection, carrying the weather's marks.
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
    gl.uniform1f(floor.u.uFogNear, weather.fogNear ?? 26);
    gl.uniform1f(floor.u.uFogFar, weather.fogFar ?? 180);
    gl.uniform1f(floor.u.uScarExtent, scarExtent);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scarTexture);
    gl.uniform1i(floor.u.uScars, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // 4. The field itself.
    gl.disable(gl.BLEND);
    if (instanceCount) drawCubes(matrix, 1, weather, time, shimmer, selected, step, stepT);

    gl.disable(gl.SCISSOR_TEST);
  }

  return {
    gl,
    upload,
    updatePositions,
    setScars,
    draw,
    get count() { return instanceCount; },
    get view() { return lastView; },
  };
}
