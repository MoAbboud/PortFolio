// Shows a painted face only as far as the engine has earned it, pixelating in.
//
// For every pixel the shader finds the bin under it from its angle round the centre, reads
// that bin's development d, and decides two things:
//
//   block size   b = 2 ^ round(5 * (1 - d))       32, 16, 8, 4, 2, 1 pixels
//   shown        if  d > bayer(block)             a 4 x 4 ordered-dither threshold
//
// The face is sampled at the centre of the b-by-b block the pixel falls in. So a little
// development scatters a few big blocks; more multiplies them and shrinks them until the face
// is sharp. Ordered dithering makes blocks appear in a fixed, even pattern rather than
// fading, which is what reads as pixelating in. Film grain over it, as in the pen, makes
// coarse blocks and grain one texture.
//
// Without WebGL2 a canvas 2D fallback shows each bin's wedge of the face at an opacity of d:
// no pixels, but the same build-up.

import { START_ANGLE, SWEEP } from './layout.js';

const VERTEX = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D u_face;
uniform sampler2D u_event;
uniform sampler2D u_dev;
uniform float u_bins;
uniform float u_binsPerValue;
uniform float u_max;
uniform float u_start;
uniform float u_sweep;
uniform float u_mean;
uniform float u_event_level;
uniform float u_time;
uniform vec2 u_res;
out vec4 colour;

const float TAU = 6.28318530718;

float bayer(vec2 cell) {
  int x = int(mod(cell.x, 4.0));
  int y = int(mod(cell.y, 4.0));
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[y * 4 + x]) + 0.5) / 16.0;
}

// Development under a point: the bin its angle falls in, or the face's average near the
// middle, where the unit label sits and there is no angle to speak of.
float devAt(vec2 p) {
  vec2 v = p - u_res * 0.5;
  float r = length(v) / (u_res.x * 0.5);
  if (r < 0.4) return u_mean;
  float rel = mod(atan(v.y, v.x) - u_start + TAU, TAU);
  float frac = rel / u_sweep;
  if (frac > 1.0) frac = rel > u_sweep + (TAU - u_sweep) * 0.5 ? 0.0 : 1.0;
  float bin = frac * u_max * u_binsPerValue;
  return texture(u_dev, vec2((bin + 0.5) / u_bins, 0.5)).r;
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233)) + u_time) * 43758.5453);
}

float blockSize(float d) {
  return exp2(floor(5.0 * (1.0 - d) + 0.5));
}

bool shown(float d, vec2 cell) {
  return d >= 1.0 || (d > 0.0 && d > bayer(cell) * 0.94 + 0.03);
}

void main() {
  // Pixel coordinates with the origin at the top left, as the face was painted.
  vec2 p = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);

  // The block size comes from the development under this pixel; the whole block is then
  // decided, and coloured, from its centre, so every pixel of a block agrees.
  float b = blockSize(devAt(p));
  vec2 cell = floor(p / b);
  vec2 centre = (cell + 0.5) * b;
  float d = devAt(centre);
  vec4 c = shown(d, cell) ? texture(u_face, centre / u_res) : vec4(0.0);

  // The redline arc pixelates in on its own clock, once the engine has reached it.
  float e = u_event_level;
  float be = blockSize(e);
  vec2 ecell = floor(p / be);
  if (shown(e, ecell)) c += texture(u_event, (ecell + 0.5) * be / u_res);

  float grain = (hash(floor(p)) - 0.5) * 0.06 * max(c.a, 0.15);
  colour = vec4(c.rgb + grain, clamp(c.a, 0.0, 1.0));
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader));
  }
  return shader;
}

function texture(gl, unit) {
  const t = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

class GlReveal {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, alpha: true, antialias: false });
    if (!gl) throw new Error('no WebGL2');
    this.gl = gl;
    this.canvas = canvas;
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    this.program = program;

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.faceTex = texture(gl, 0);
    this.eventTex = texture(gl, 1);
    this.devTex = texture(gl, 2);
    const u = (name) => gl.getUniformLocation(program, name);
    this.u = Object.fromEntries(['u_face', 'u_event', 'u_dev', 'u_bins', 'u_binsPerValue', 'u_max',
      'u_start', 'u_sweep', 'u_mean', 'u_event_level', 'u_time', 'u_res'].map((n) => [n, u(n)]));
    gl.uniform1i(this.u.u_face, 0);
    gl.uniform1i(this.u.u_event, 1);
    gl.uniform1i(this.u.u_dev, 2);
    gl.uniform1f(this.u.u_start, START_ANGLE);
    gl.uniform1f(this.u.u_sweep, SWEEP);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  setFace(face, event, scale) {
    const { gl } = this;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.faceTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, face);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.eventTex);
    if (event) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, event);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    this.scale = scale;
    this.bytes = new Uint8Array(scale.bins);
  }

  draw(bins, mean, eventLevel, time) {
    const { gl, canvas, scale } = this;
    for (let i = 0; i < bins.length; i++) this.bytes[i] = Math.round(bins[i] * 255);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.devTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, bins.length, 1, 0, gl.RED, gl.UNSIGNED_BYTE, this.bytes);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform1f(this.u.u_bins, bins.length);
    gl.uniform1f(this.u.u_binsPerValue, 1 / scale.binSize);
    gl.uniform1f(this.u.u_max, scale.max);
    gl.uniform1f(this.u.u_mean, mean);
    gl.uniform1f(this.u.u_event_level, eventLevel);
    gl.uniform1f(this.u.u_time, time % 1000);
    gl.uniform2f(this.u.u_res, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

class FlatReveal {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  setFace(face, event, scale) {
    this.face = face;
    this.event = event;
    this.scale = scale;
  }

  draw(bins, mean, eventLevel) {
    const { ctx, canvas, scale } = this;
    const c = canvas.width / 2;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const per = (scale.max / scale.binSize);
    for (let i = 0; i < bins.length; i++) {
      if (bins[i] <= 0) continue;
      const a0 = START_ANGLE + (i / per) * SWEEP;
      const a1 = START_ANGLE + ((i + 1) / per) * SWEEP;
      ctx.save();
      ctx.globalAlpha = bins[i];
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.arc(c, c, c, a0, a1 + 0.002);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(this.face, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
    ctx.save();
    ctx.globalAlpha = mean;
    ctx.beginPath();
    ctx.arc(c, c, c * 0.4, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(this.face, 0, 0, canvas.width, canvas.height);
    ctx.restore();
    if (this.event && eventLevel > 0) {
      ctx.globalAlpha = eventLevel;
      ctx.drawImage(this.event, 0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
    }
  }
}

// A WebGL2 reveal if the browser has it, the flat one if not.
export function createReveal(canvas) {
  try {
    return { reveal: new GlReveal(canvas), pixelated: true };
  } catch {
    return { reveal: new FlatReveal(canvas), pixelated: false };
  }
}
