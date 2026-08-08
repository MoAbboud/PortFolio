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
in vec3 aTravel;          // where this object goes: dx, dz, and the step it arrives at

uniform mat4 uViewProj;
uniform float uTime;
uniform float uFlip;      // 1.0 upright, -1.0 mirrored under the floor
uniform float uShimmer;
uniform float uSelected;  // -1 for nothing selected
uniform float uStep;      // the step being shown
uniform float uStepT;     // how far into arriving at it, 0 to 1
uniform float uArrive;    // how far through the flight into it, 0 to 1

out vec3 vColour;
out vec3 vNormal;
out float vDepth;
out float vY;
out float vPicked;
out float vSolid;
out float vAo;
out vec3 vWorld;
out vec2 vFinish;


// How far along its line this object is.
//
// An object never moves in the buffers: it is uploaded once, at the start of
// its line, and this offset is added here. Before the step it arrives at, it is
// at the beginning; after, at the end; across the flight into it, part way. So
// the field stays static, the processor does nothing per frame, and an object
// can still cross the canvas.
vec3 travelled(vec3 t, float step, float arrive) {
  if (t.z < -0.5) return vec3(0.0);
  float f = step > t.z + 0.5 ? 1.0 : (step > t.z - 0.5 ? arrive : 0.0);
  return vec3(t.x, 0.0, t.y) * f;
}

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
  vec3 world = aOffset + wobble * uShimmer + travelled(aTravel, uStep, uArrive);

  // A ghost is smaller as well as fainter, so an unvisited part of the canvas
  // reads as not-yet-arrived rather than as badly lit.
  vSolid = solidity(uStep, uStepT, aFrom, aUntil);
  float grow = mix(0.5, 1.0, vSolid);

  vec3 p = world + aPos * aSize * grow;
  vY = p.y;
  p.y *= uFlip;
  vWorld = p;

  vColour = aColour;
  vAo = 1.0;                     // a cube has no crease of its own
  // A cube is as coarse as a thing gets: its facets are the whole point, and
  // the shimmer was sized for it in the first place.
  vFinish = vec2(0.0, 1.0);
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
in float vAo;
in vec3 vWorld;
in vec2 vFinish;

uniform vec3 uSun;
uniform vec3 uSky;
uniform float uFogNear;
uniform float uFogFar;
uniform float uTint;      // mirrored pass is dimmed
uniform float uAmbient;
uniform float uSmooth;    // 0 flat facets, 1 averaged across the surface

out vec4 frag;

void main() {
  // Flat shading, taken from how the surface changes across the screen. This
  // is the difference between crisp faceted forms and something boneless:
  // averaged normals make every flat plane read as curved, so a face stays a
  // face only if it is lit by its own normal rather than its neighbours'.
  vec3 faceted = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 averaged = normalize(vNormal);
  faceted *= sign(dot(faceted, averaged));   // derivatives do not know winding
  // Faceting is right for a shape whose facets are meant to be seen. On a mesh
  // whose triangles are smaller than the light changes across them it only
  // shatters the surface, so a fine model asks for its own smoothing and the
  // dial can still force more.
  vec3 n = normalize(mix(faceted, averaged, max(uSmooth, vFinish.x)));

  // Wrapped lighting rather than a hard terminator. A flat cut between lit and
  // unlit is what makes low-poly read as a rendering; softening it and letting
  // the sky fill the shadow side is what makes it read as an illustration.
  float sun = normalize(uSun).y > -2.0 ? dot(n, normalize(uSun)) : 0.0;
  float lambert = max((sun + 0.35) / 1.35, 0.0);
  float sky = 0.5 + 0.5 * n.y;

  // Occlusion darkens creases, which is what gives a smooth surface weight.
  float ao = mix(0.42, 1.0, clamp(vAo, 0.0, 1.0));
  vec3 colour = vColour * (0.30 * ao + 0.50 * lambert * mix(0.55, 1.0, ao)
    + 0.26 * sky * ao) * uAmbient;

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

// The mesh path. Different geometry, identical lighting: it shares the cube
// fragment shader exactly, so the two ways of drawing an object cannot drift
// apart in how they are lit, fogged, ghosted or highlighted.
const MESH_VS = `#version 300 es
in vec3 aPos;
in vec3 aNormal;
in vec3 aColour;
in float aSeed;
in float aObject;
in float aFrom;
in float aUntil;
in float aAo;
in vec3 aTravel;
in vec3 aPivot;
in vec4 aMotion;   // kind, amplitude in radians, phase, axis
// How this model wants to be finished, decided from how fine its own triangles
// are: x smooths its shading, y scales the ambient shimmer down. A chunky car
// wants neither; a character built from millimetre triangles wants both.
in vec2 aFinish;

uniform mat4 uViewProj;
uniform float uTime;
uniform float uFlip;
uniform float uShimmer;
uniform float uSelected;
uniform float uStep;
uniform float uStepT;
uniform float uArrive;

// Small looped movement about a point. Enough for an arm swaying, a wheel
// turning, a canopy in the wind and water on a pool; deliberately not enough
// for a walk cycle, which is not what a diorama needs.
vec3 turned(vec3 p, vec3 pivot, vec4 m, float t) {
  if (m.x < 0.5 || m.y == 0.0) return p;
  float wave = sin(t * 1.15 + m.z);
  vec3 rel = p - pivot;

  if (m.x > 2.5 && m.x < 3.5) return p + vec3(0.0, wave * m.y * 0.6, 0.0);   // bob
  if (m.x > 3.5) {
    // liquid: a travelling wave, so a surface moves rather than pulsing.
    return p + vec3(0.0, sin(t * 1.6 + p.x * 2.2 + p.z * 1.7) * m.y * 0.5, 0.0);
  }

  float angle = m.x > 1.5 ? t * m.y * 3.0 : wave * m.y;   // spin, or sway
  float c = cos(angle), s = sin(angle);
  vec3 out3 = rel;
  if (m.w < 0.5)      out3 = vec3(rel.x, rel.y * c - rel.z * s, rel.y * s + rel.z * c);
  else if (m.w < 1.5) out3 = vec3(rel.x * c + rel.z * s, rel.y, -rel.x * s + rel.z * c);
  else                out3 = vec3(rel.x * c - rel.y * s, rel.x * s + rel.y * c, rel.z);
  return pivot + out3;
}

out vec3 vColour;
out vec3 vNormal;
out float vDepth;
out float vY;
out float vPicked;
out float vSolid;
out float vAo;
out vec3 vWorld;
out vec2 vFinish;

float solidity(float step, float t, float from, float until) {
  if (step < from - 0.5) return 0.0;
  if (step < from + 0.5) return t;
  if (step < until + 0.5) return 1.0;
  if (step < until + 1.5) return 1.0 - t;
  return 0.0;
}

// See the cube shader: an object never moves in the buffers, it is offset here.
vec3 travelled(vec3 t, float step, float arrive) {
  if (t.z < -0.5) return vec3(0.0);
  float f = step > t.z + 0.5 ? 1.0 : (step > t.z - 0.5 ? arrive : 0.0);
  return vec3(t.x, 0.0, t.y) * f;
}

void main() {
  vSolid = solidity(uStep, uStepT, aFrom, aUntil);

  // A surface has to move along its own normal rather than per vertex, or the
  // shimmer would tear the mesh open. A ghost is pulled slightly inward, which
  // reads as not-yet-arrived the same way a smaller cube did.
  // Scaled to the model. Displacing a vertex further than its own triangles are
  // wide slides neighbouring faces through each other, and a fine mesh comes
  // apart into something that is not the shape any more.
  float breathe = sin(uTime * 1.1 + aSeed * 6.2831853) * uShimmer * 3.0 * aFinish.y;
  float shrink = mix(-0.06, 0.0, vSolid);
  vec3 p = turned(aPos, aPivot, aMotion, uTime) + aNormal * (breathe + shrink)
    + travelled(aTravel, uStep, uArrive);

  vY = p.y;
  p.y *= uFlip;
  vWorld = p;

  vColour = aColour;
  vAo = aAo;
  vFinish = aFinish;
  vPicked = abs(aObject - uSelected) < 0.5 ? 1.0 : 0.0;
  vNormal = vec3(aNormal.x, aNormal.y * uFlip, aNormal.z);
  vec4 clip = uViewProj * vec4(p, 1.0);
  vDepth = clip.w;
  gl_Position = clip;
}`;

// A soft patch of darkness under each object. Without one, everything hovers
// a little, and no amount of shading on the object itself fixes that.
const SHADOW_VS = `#version 300 es
in vec2 aCorner;
in vec3 aCentre;
in float aRadius;
in float aFrom;
in float aUntil;
in vec3 aTravel;

uniform mat4 uViewProj;
uniform float uStep;
uniform float uStepT;
uniform float uArrive;

out vec2 vLocal;
out float vSolid;

float solidity(float step, float t, float from, float until) {
  if (step < from - 0.5) return 0.0;
  if (step < from + 0.5) return t;
  if (step < until + 0.5) return 1.0;
  if (step < until + 1.5) return 1.0 - t;
  return 0.0;
}


// See the cube shader: an object never moves in the buffers, it is offset here.
vec3 travelled(vec3 t, float step, float arrive) {
  if (t.z < -0.5) return vec3(0.0);
  float f = step > t.z + 0.5 ? 1.0 : (step > t.z - 0.5 ? arrive : 0.0);
  return vec3(t.x, 0.0, t.y) * f;
}

void main() {
  vLocal = aCorner;
  vSolid = solidity(uStep, uStepT, aFrom, aUntil);
  // Just above the ground, so it never fights the floor for depth. A shadow
  // travels with the object casting it, or it is left standing where the
  // object used to be.
  vec3 p = aCentre + vec3(aCorner.x * aRadius, 0.01, aCorner.y * aRadius)
    + travelled(aTravel, uStep, uArrive);
  gl_Position = uViewProj * vec4(p, 1.0);
}`;

const SHADOW_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
in float vSolid;
uniform float uStrength;
out vec4 frag;
void main() {
  float edge = 1.0 - clamp(length(vLocal), 0.0, 1.0);
  float mask = edge * edge * vSolid * uStrength;
  // Multiplied onto the ground rather than drawn over it, so a shadow darkens
  // whatever is beneath it instead of painting a grey disc on top.
  frag = vec4(vec3(1.0 - mask), 1.0);
}`;

// A labelled patch of ground: a bar, a car park, a golf course.
//
// It is a place rather than a thing, so it is drawn as part of the ground
// rather than as an object: a flat rectangle laid just above the floor, tinted
// and soft at its edges, with its name drawn over it by the tag layer. It has a
// step range like everything else, so an area arrives with the part of the
// story that happens in it.
const AREA_VS = `#version 300 es
in vec2 aCorner;
in vec3 aCentre;
in vec2 aHalf;
in vec3 aTint;
in float aFrom;
in float aUntil;

uniform mat4 uViewProj;
uniform float uStep;
uniform float uStepT;

out vec2 vLocal;
out vec3 vTint;
out float vSolid;

float solidity(float step, float t, float from, float until) {
  if (step < from - 0.5) return 0.0;
  if (step < from + 0.5) return t;
  if (step < until + 0.5) return 1.0;
  if (step < until + 1.5) return 1.0 - t;
  return 0.0;
}

void main() {
  vLocal = aCorner;
  vTint = aTint;
  vSolid = solidity(uStep, uStepT, aFrom, aUntil);
  // Above the floor but under the contact shadows, so a figure standing in a
  // bar still sits on the ground rather than hovering over a coloured card.
  vec3 p = aCentre + vec3(aCorner.x * aHalf.x, 0.006, aCorner.y * aHalf.y);
  gl_Position = uViewProj * vec4(p, 1.0);
}`;

const AREA_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec3 vTint;
in float vSolid;
out vec4 frag;
void main() {
  // Soft at the edges and stronger at the rim than in the middle, so an area
  // reads as a region of ground rather than as a painted rectangle - and so
  // that anything standing on it is still standing on ground.
  vec2 d = abs(vLocal);
  float inside = (1.0 - smoothstep(0.86, 1.0, max(d.x, d.y)));
  float rim = smoothstep(0.62, 0.99, max(d.x, d.y));
  float alpha = inside * vSolid * (0.16 + 0.30 * rim);
  if (alpha < 0.004) discard;
  frag = vec4(vTint, alpha);
}`;

// Rain. One fixed cloud of drops that follows the camera and wraps around it,
// so a fixed number of instances covers any shot without ever running out or
// being wasted on somewhere you are not looking.
const RAIN_VS = `#version 300 es
in vec3 aPos;
in vec3 aSeed;

uniform mat4 uViewProj;
uniform vec3 uEye;
uniform float uTime;
uniform float uRain;
uniform float uBox;
uniform float uScale;

out float vFade;

void main() {
  // Thin out by hiding the drops beyond the current density, rather than by
  // uploading a different number of them.
  if (aSeed.x > uRain) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vFade = 0.0;
    return;
  }

  float fall = uTime * (9.0 + aSeed.y * 5.0);
  vec3 drift = vec3(1.4, 0.0, 0.7) * uTime;
  vec3 base = aSeed * uBox + drift - vec3(0.0, fall, 0.0);

  // Wrap into a box centred on the camera.
  vec3 centred = base - uEye + uBox * 0.5;
  vec3 wrapped = mod(centred, uBox) - uBox * 0.5 + uEye;

  // A drop is a thin streak, stretched along the way it is falling.
  vec3 stretched = aPos * vec3(uScale, uScale * 14.0, uScale);
  vec3 world = wrapped + stretched;

  // Fade out at the edge of the box so drops appear and vanish unnoticed.
  float edge = length((wrapped - uEye).xz) / (uBox * 0.5);
  vFade = clamp(1.6 - edge * 1.6, 0.0, 1.0);

  gl_Position = uViewProj * vec4(world, 1.0);
}`;

const RAIN_FS = `#version 300 es
precision highp float;
in float vFade;
uniform vec3 uColour;
out vec4 frag;
void main() {
  if (vFade <= 0.01) discard;
  frag = vec4(uColour, vFade * 0.34);
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
// The camera's own axes, so a screen position becomes a direction in the world.
// Without these the sky can only be a gradient with a glow painted at a fixed
// place on the screen, which is what it was: the sun could not move, because
// there was nothing for it to move relative to.
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uForward;
uniform vec2 uTan;
uniform vec3 uSun;
uniform vec3 uMoon;
uniform float uSunUp;
uniform float uMoonUp;
uniform float uNight;
out vec4 frag;

// A stable value per direction, for stars. Nothing is stored and nothing is
// uploaded: the same direction always hashes to the same number, so the sky
// holds still while the camera turns through it.
float hash(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}

void main() {
  vec3 dir = normalize(uForward + uRight * vNdc.x * uTan.x + uUp * vNdc.y * uTan.y);

  // The gradient follows the horizon in the world rather than the middle of the
  // screen, so tilting the camera tilts the sky with it.
  float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 colour = mix(uHorizon, uSky, pow(h, 0.75));

  vec3 sun = normalize(uSun);
  vec3 moon = normalize(uMoon);
  float toSun = max(dot(dir, sun), 0.0);
  float toMoon = max(dot(dir, moon), 0.0);

  // **Whether a body can be seen is not how much light it is giving.**
  // uSunUp and uMoonUp ramp across most of an hour, because that is how long
  // the light takes to change; a disc, though, is either over the horizon or
  // behind it. Using the light ramp for both made the sun faintest exactly at
  // sunrise and sunset, which are the only times the camera can see it at all:
  // it orbits a point on the ground and cannot look up, so a midday sun is
  // always above the frame.
  float sunShow = smoothstep(-0.035, 0.02, sun.y);
  float moonShow = smoothstep(-0.035, 0.02, moon.y);

  // Stars, before either body, so both are drawn over them. They fade in with
  // the dark and never appear in daylight.
  if (uNight > 0.01) {
    vec3 cell = floor(dir * 220.0);
    float star = hash(cell);
    float bright = smoothstep(0.9975, 1.0, star) * max(dir.y, 0.0);
    colour += vec3(0.85, 0.88, 1.0) * bright * uNight;
  }

  // The glow around the sun, wide and soft, and much wider near the horizon -
  // which is most of what makes a sunrise read as one.
  float low = 1.0 - clamp(sun.y * 3.0, 0.0, 1.0);
  float spread = mix(220.0, 14.0, low);
  colour += uSunColour * pow(toSun, spread) * 0.9 * sunShow;
  colour += uSunColour * pow(toSun, 3.0) * 0.16 * sunShow * low;

  // The sun itself. A disc rather than a point, softened at its edge so it does
  // not crawl with the pixel grid as the camera turns.
  float disc = smoothstep(0.99955, 0.99980, toSun);
  colour = mix(colour, uSunColour * 2.4, disc * sunShow);

  // The moon: smaller, cooler, and with a much tighter glow, because a wide one
  // reads as fog rather than as moonlight.
  float moonGlow = pow(toMoon, 900.0) * 0.5 + pow(toMoon, 60.0) * 0.05;
  colour += vec3(0.78, 0.83, 1.0) * moonGlow * moonShow;
  float face = smoothstep(0.99968, 0.99988, toMoon);
  colour = mix(colour, vec3(0.93, 0.95, 1.0), face * moonShow);

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
  'mesh vertex': MESH_VS,
  'mesh fragment': CUBE_FS,
  'shadow vertex': SHADOW_VS,
  'shadow fragment': SHADOW_FS,
  'area vertex': AREA_VS,
  'area fragment': AREA_FS,
  'rain vertex': RAIN_VS,
  'rain fragment': RAIN_FS,
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
import { axesOf, FOV_Y, ASPECT } from './camera.js';

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
  if (!gl) throw new Error('This needs WebGL2, and this browser did not provide it.');

  const cube = program(gl, CUBE_VS, CUBE_FS, 'cube');
  const mesh = program(gl, MESH_VS, CUBE_FS, 'mesh');
  const shadow = program(gl, SHADOW_VS, SHADOW_FS, 'shadow');
  const area = program(gl, AREA_VS, AREA_FS, 'area');
  const rain = program(gl, RAIN_VS, RAIN_FS, 'rain');
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

  let meshVao = null;
  let meshIndexCount = 0;
  const meshBuffers = {};

  /** The same scene as a surface. Kept alongside the cubes so the two compare. */
  function uploadMesh(surface) {
    meshIndexCount = surface.indices.length;
    for (const key of ['positions', 'normals', 'colours', 'seeds', 'objects',
      'fromStep', 'untilStep', 'ao', 'pivots', 'motion', 'finish', 'travel']) {
      if (meshBuffers[key]) gl.deleteBuffer(meshBuffers[key]);
      meshBuffers[key] = buffer(surface[key]);
    }
    if (meshBuffers.indices) gl.deleteBuffer(meshBuffers.indices);
    meshBuffers.indices = buffer(surface.indices, gl.ELEMENT_ARRAY_BUFFER);

    if (meshVao) gl.deleteVertexArray(meshVao);
    meshVao = gl.createVertexArray();
    gl.bindVertexArray(meshVao);
    attribute(mesh.handle, 'aPos', meshBuffers.positions, 3);
    attribute(mesh.handle, 'aNormal', meshBuffers.normals, 3);
    attribute(mesh.handle, 'aColour', meshBuffers.colours, 3);
    attribute(mesh.handle, 'aSeed', meshBuffers.seeds, 1);
    attribute(mesh.handle, 'aObject', meshBuffers.objects, 1);
    attribute(mesh.handle, 'aFrom', meshBuffers.fromStep, 1);
    attribute(mesh.handle, 'aUntil', meshBuffers.untilStep, 1);
    attribute(mesh.handle, 'aTravel', meshBuffers.travel, 3);
    attribute(mesh.handle, 'aAo', meshBuffers.ao, 1);
    attribute(mesh.handle, 'aPivot', meshBuffers.pivots, 3);
    attribute(mesh.handle, 'aMotion', meshBuffers.motion, 4);
    attribute(mesh.handle, 'aFinish', meshBuffers.finish, 2);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshBuffers.indices);
    gl.bindVertexArray(null);
  }

  // The drops. Allocated once and never resized; how many are visible is a
  // uniform, so weather can change without touching a buffer.
  const RAIN_DROPS = 9000;
  const rainSeeds = new Float32Array(RAIN_DROPS * 3);
  // Deterministic, so a re-recorded take has the rain in the same places.
  for (let i = 0; i < RAIN_DROPS; i++) {
    for (let a = 0; a < 3; a++) {
      const n = Math.sin((i + 1) * (12.9898 + a * 7.13) + a * 3.7) * 43758.5453;
      rainSeeds[i * 3 + a] = n - Math.floor(n);
    }
  }
  const rainSeedBuf = buffer(rainSeeds);
  const rainVao = gl.createVertexArray();
  gl.bindVertexArray(rainVao);
  attribute(rain.handle, 'aPos', posBuf, 3);
  attribute(rain.handle, 'aSeed', rainSeedBuf, 3, 1);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
  gl.bindVertexArray(null);

  // How much normals are averaged across the surface. 0 keeps every facet its
  // own plane, which is what makes forms read as built rather than as moulded.
  let smoothing = 0;

  let shadowVao = null;
  let shadowCount = 0;
  const shadowBuffers = {};

  function uploadShadows(patches) {
    shadowCount = patches.count;
    for (const [key, data] of Object.entries({
      centres: patches.centres, radii: patches.radii,
      fromStep: patches.fromStep, untilStep: patches.untilStep, travel: patches.travel,
    })) {
      if (shadowBuffers[key]) gl.deleteBuffer(shadowBuffers[key]);
      shadowBuffers[key] = buffer(data);
    }
    if (shadowVao) gl.deleteVertexArray(shadowVao);
    shadowVao = gl.createVertexArray();
    gl.bindVertexArray(shadowVao);
    attribute(shadow.handle, 'aCorner', quadBuf, 2);
    attribute(shadow.handle, 'aCentre', shadowBuffers.centres, 3, 1);
    attribute(shadow.handle, 'aRadius', shadowBuffers.radii, 1, 1);
    attribute(shadow.handle, 'aFrom', shadowBuffers.fromStep, 1, 1);
    attribute(shadow.handle, 'aUntil', shadowBuffers.untilStep, 1, 1);
    attribute(shadow.handle, 'aTravel', shadowBuffers.travel, 3, 1);
    gl.bindVertexArray(null);
  }

  let areaVao = null;
  let areaCount = 0;
  const areaBuffers = {};

  /** Hand the ground its labelled places. Called whenever they change. */
  function uploadAreas(patches) {
    areaCount = patches.count;
    for (const [key, data] of Object.entries({
      centres: patches.centres, halves: patches.halves, tints: patches.tints,
      fromStep: patches.fromStep, untilStep: patches.untilStep,
    })) {
      if (areaBuffers[key]) gl.deleteBuffer(areaBuffers[key]);
      areaBuffers[key] = buffer(data);
    }
    if (areaVao) gl.deleteVertexArray(areaVao);
    areaVao = gl.createVertexArray();
    gl.bindVertexArray(areaVao);
    attribute(area.handle, 'aCorner', quadBuf, 2);
    attribute(area.handle, 'aCentre', areaBuffers.centres, 3, 1);
    attribute(area.handle, 'aHalf', areaBuffers.halves, 2, 1);
    attribute(area.handle, 'aTint', areaBuffers.tints, 3, 1);
    attribute(area.handle, 'aFrom', areaBuffers.fromStep, 1, 1);
    attribute(area.handle, 'aUntil', areaBuffers.untilStep, 1, 1);
    gl.bindVertexArray(null);
  }

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
    // **Refused by name rather than bound to nothing.** Enabling an attribute
    // array with no buffer behind it makes every draw call that uses it
    // invalid, so the whole field silently stops appearing - and the shader,
    // the geometry and the uniforms all still look perfectly correct. That is
    // exactly what happened when `aTravel` was added to three shaders and left
    // out of the three lists of buffers to create.
    if (!buf) {
      throw new Error(`"${name}" has no buffer: whatever builds this program's`
        + ' data is not producing it, and binding nothing here would stop the'
        + ' whole draw call without saying why.');
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(location, divisor);
  }

  /** Upload the field. Called once when the canvas loads, and after an edit. */
  function upload(scene) {
    instanceCount = scene.count;
    for (const key of ['positions', 'colours', 'seeds', 'sizes', 'objects',
      'fromStep', 'untilStep', 'travel']) {
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
    attribute(cube.handle, 'aTravel', instanceBuffers.travel, 3, 1);
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

  function drawCubes(matrix, flip, weather, time, shimmer, selected, step, stepT, arrive) {
    gl.useProgram(cube.handle);
    gl.bindVertexArray(vao);
    gl.uniformMatrix4fv(cube.u.uViewProj, false, matrix);
    gl.uniform1f(cube.u.uTime, time);
    gl.uniform1f(cube.u.uFlip, flip);
    gl.uniform1f(cube.u.uShimmer, shimmer);
    gl.uniform1f(cube.u.uStep, step);
    gl.uniform1f(cube.u.uStepT, stepT);
    gl.uniform1f(cube.u.uArrive, arrive);
    // The reflection is not highlighted; only the object itself.
    gl.uniform1f(cube.u.uSelected, flip < 0 ? -1 : selected);
    gl.uniform1f(cube.u.uTint, flip < 0 ? 0.72 : 1.0);
    gl.uniform1f(cube.u.uAmbient, weather.ambient ?? 1);
    gl.uniform1f(cube.u.uSmooth, smoothing);
    gl.uniform3fv(cube.u.uSun, weather.sun);
    gl.uniform3fv(cube.u.uSky, weather.sky);
    gl.uniform1f(cube.u.uFogNear, weather.fogNear ?? 26);
    gl.uniform1f(cube.u.uFogFar, weather.fogFar ?? 180);
    gl.drawElementsInstanced(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0, instanceCount);
    gl.bindVertexArray(null);
  }

  function drawMesh(matrix, flip, weather, time, shimmer, selected, step, stepT, arrive) {
    gl.useProgram(mesh.handle);
    gl.bindVertexArray(meshVao);
    gl.uniformMatrix4fv(mesh.u.uViewProj, false, matrix);
    gl.uniform1f(mesh.u.uTime, time);
    gl.uniform1f(mesh.u.uFlip, flip);
    gl.uniform1f(mesh.u.uShimmer, shimmer);
    gl.uniform1f(mesh.u.uStep, step);
    gl.uniform1f(mesh.u.uStepT, stepT);
    gl.uniform1f(mesh.u.uArrive, arrive);
    gl.uniform1f(mesh.u.uSelected, flip < 0 ? -1 : selected);
    gl.uniform1f(mesh.u.uTint, flip < 0 ? 0.72 : 1.0);
    gl.uniform1f(mesh.u.uAmbient, weather.ambient ?? 1);
    gl.uniform1f(mesh.u.uSmooth, smoothing);
    gl.uniform3fv(mesh.u.uSun, weather.sun);
    gl.uniform3fv(mesh.u.uSky, weather.sky);
    gl.uniform1f(mesh.u.uFogNear, weather.fogNear ?? 26);
    gl.uniform1f(mesh.u.uFogFar, weather.fogFar ?? 180);
    gl.drawElements(gl.TRIANGLES, meshIndexCount, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  /** Whichever way the field is being drawn today. */
  function drawField(surface, ...args) {
    if (surface === 'mesh') {
      if (meshIndexCount) drawMesh(...args);
    } else if (instanceCount) {
      drawCubes(...args);
    }
  }

  function draw({
    matrix, eye, target = [0, 0, 0], time, weather = WEATHER.clear, shimmer = 0.004,
    selected = -1, step = 0, stepT = 1, surface = 'cubes', smooth = 0,
    // How far through the flight into the current step the route is. An object
    // that travels is part way along its line by exactly this much. Settled on
    // a step means 1: the move is over and the object is where it ended up.
    arrive = 1,
  }) {
    smoothing = smooth;
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
    // The camera's axes, so the shader can turn a pixel into a direction and
    // put the sun where it actually is rather than where the screen is.
    {
      const [f, r, u] = axesOf(eye, target);
      gl.uniform3fv(sky.u.uForward, f);
      gl.uniform3fv(sky.u.uRight, r);
      gl.uniform3fv(sky.u.uUp, u);
      const tanY = Math.tan(FOV_Y / 2);
      gl.uniform2f(sky.u.uTan, tanY * ASPECT, tanY);
    }
    gl.uniform3fv(sky.u.uSun, weather.sun);
    gl.uniform3fv(sky.u.uMoon, weather.moon ?? [0, -1, 0]);
    gl.uniform1f(sky.u.uSunUp, weather.sunUp ?? 1);
    gl.uniform1f(sky.u.uMoonUp, weather.moonUp ?? 0);
    gl.uniform1f(sky.u.uNight, weather.night ?? 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // 2. The field, mirrored under the floor.
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);
    drawField(surface, matrix, -1, weather, time, shimmer, selected, step, stepT, arrive);

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

    // 4. Labelled places, laid on the ground under everything that stands on it.
    if (areaCount) {
      gl.depthMask(false);
      gl.useProgram(area.handle);
      gl.bindVertexArray(areaVao);
      gl.uniformMatrix4fv(area.u.uViewProj, false, matrix);
      gl.uniform1f(area.u.uStep, step);
      gl.uniform1f(area.u.uStepT, stepT);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, areaCount);
      gl.bindVertexArray(null);
      gl.depthMask(true);
    }

    // 5. Contact shadows, multiplied onto the ground so things sit on it.
    if (shadowCount) {
      gl.blendFunc(gl.DST_COLOR, gl.ZERO);
      gl.depthMask(false);
      gl.useProgram(shadow.handle);
      gl.bindVertexArray(shadowVao);
      gl.uniformMatrix4fv(shadow.u.uViewProj, false, matrix);
      gl.uniform1f(shadow.u.uStep, step);
      gl.uniform1f(shadow.u.uStepT, stepT);
      gl.uniform1f(shadow.u.uArrive, arrive);
      gl.uniform1f(shadow.u.uStrength, 0.55);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, shadowCount);
      gl.bindVertexArray(null);
      gl.depthMask(true);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }

    // 5. The field itself.
    gl.disable(gl.BLEND);
    drawField(surface, matrix, 1, weather, time, shimmer, selected, step, stepT, arrive);

    // 6. Rain, in front of the world but hidden behind anything solid.
    const falling = weather.rain ?? 0;
    if (falling > 0.001) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.useProgram(rain.handle);
      gl.bindVertexArray(rainVao);
      gl.uniformMatrix4fv(rain.u.uViewProj, false, matrix);
      gl.uniform3fv(rain.u.uEye, eye);
      gl.uniform1f(rain.u.uTime, time);
      gl.uniform1f(rain.u.uRain, falling);
      gl.uniform1f(rain.u.uBox, 60);
      gl.uniform1f(rain.u.uScale, 0.022);
      gl.uniform3fv(rain.u.uColour, weather.horizon ?? [0.8, 0.85, 0.9]);
      gl.drawElementsInstanced(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0, RAIN_DROPS);
      gl.bindVertexArray(null);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    gl.disable(gl.SCISSOR_TEST);
  }

  return {
    gl,
    upload,
    uploadMesh,
    uploadShadows,
    uploadAreas,
    updatePositions,
    setScars,
    draw,
    get count() { return instanceCount; },
    get view() { return lastView; },
  };
}
