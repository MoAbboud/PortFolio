// WebGL2. The sky, the film, and what stands on it.
//
// **The world is a ring hanging in space.** There is no ground plane and no
// mirrored pass: the strip is rolled into a loop in the vertex shader, and the
// only ground is the film itself, one plate per piece.
//
// This is the one module that is not pure. It knows about buffers, shaders and
// uniforms, and it knows nothing about canvases, scripts or steps: it is handed
// arrays and a matrix.

/**
 * Rolling the strip into a ring, shared by every program that draws the world.
 *
 * **A film strip rolls into a cylinder, not a sphere** - the poles of a sphere
 * have nowhere to come from - so the world is a ring seen edge on with nothing
 * in the middle. Rolled about the across-strip axis, so a piece's "up" points
 * outward and things stand on the outside of the loop like a rolled reel.
 *
 * `uRoll` blends flat to rolled, which is what makes the overview an unfurl
 * rather than a second view: the ball opens into a long straight strip and the
 * same geometry is doing both. `uFocus.x` is the place on the film currently at
 * the top of the ring, so scrubbing turns the world rather than travelling
 * along it.
 *
 * Nothing here costs the processor anything: it is three uniforms, and the
 * field is still built once and uploaded once.
 */
const ROLL = `
uniform float uRoll;      // 0 flat, 1 rolled into the ring
uniform float uRadius;
uniform float uFocusX;    // the place on the film at the top of the ring
uniform float uVeilNear;  // clear out to here, measured along the film
uniform float uVeilFar;   // wholly gone by here

// How much of the world survives here.
//
// **Measured on the flat strip**, always, whatever the world has been rolled
// into: it is a distance along the film. On a ring two pieces can be close
// together in space while being half a story apart, so anything measured after
// the roll would fade the wrong things.
float veilOf(vec3 onStrip) {
  return 1.0 - smoothstep(uVeilNear, uVeilFar,
    distance(onStrip.xz, vec2(uFocusX, 0.0)));
}

uniform float uPitch;     // centre to centre along the film

float bendAngle(float x) { return (x - uFocusX) / max(uRadius, 0.001); }

/** The middle of the piece a place belongs to. */
float pieceCentre(float x) { return floor(x / max(uPitch, 0.001) + 0.5) * uPitch; }

/**
 * **A frame of film is flat, and a whole piece turns as one.**
 *
 * Bending every vertex by its own position curves the things standing on the
 * strip: a tall object leans, a wide one shears, and its base no longer meets
 * the plate it is standing on - which reads as objects tilting near the edges
 * and hovering above the ground.
 *
 * So the angle is taken once, from the middle of the **piece**, and everything
 * belonging to that piece is turned rigidly by it. The plate, what stands on it
 * and their shadows all share one frame, so they cannot come apart. The ring is
 * a polygon of flat frames rather than a smooth tube, which is what a real
 * strip of film rolled up actually is.
 */
vec3 bend(vec3 p) {
  if (uRoll < 0.0005) return p;
  float a = bendAngle(pieceCentre(p.x));
  float dx = p.x - pieceCentre(p.x);
  float r = uRadius + p.y;
  vec3 rolled = vec3(
    sin(a) * r + cos(a) * dx,
    cos(a) * r - sin(a) * dx - uRadius,
    p.z
  );
  return mix(p, rolled, uRoll);
}

// The same turn applied to a direction, taken from the same piece, so lighting
// agrees with the geometry instead of staying flat while the world curves.
vec3 bendNormal(vec3 n, float x) {
  if (uRoll < 0.0005) return n;
  float a = bendAngle(pieceCentre(x)) * uRoll;
  float c = cos(a), s = sin(a);
  return normalize(vec3(n.x * c + n.y * s, -n.x * s + n.y * c, n.z));
}
`;

/**
 * The room, and the light in it.
 *
 * **Its own block rather than part of the roll**, because the two are wanted in
 * different places. The roll is geometry and belongs to vertex shaders; this is
 * light, and it belongs to **fragment shaders only** - every shader that
 * receives it works the pool out per fragment, and the vertex shaders' whole
 * part in it is carrying a position on the flat film across.
 *
 * **Per fragment everywhere, and it took two goes to get there.** The ground was
 * always per fragment for a stated reason - a plate is two triangles, so a
 * circle interpolated across its corners is a diamond - and objects were left
 * per vertex, which is fine for a person and wrong for a street. This library is
 * 61 street and pavement pieces and they are the same two triangles.
 *
 * Putting it in the roll block was a real bug: the ground's fragment shader
 * called `spotAt` while the declaration only ever reached vertex shaders, which
 * is a compile failure a browser would have reported and the shader lint did
 * not, because nothing checked that a called function is declared.
 *
 * Measured on the flat strip, for the same reason the veil is: a spot lands on
 * a place in the film, and once the world is rolled two places can be near each
 * other in space while being half a story apart.
 */
/**
 * How far a piece has been drawn in.
 *
 * **The canvas is drawn into mid air before anything stands on it.** Asked for
 * as: *"when i change steps, I want the canvas box to start from one point, the
 * middle of the short side of the rectangle, 2 points diverge, making the
 * corner, longer side, closing corner and coverging back into a point forming
 * and filling the canvas."*
 *
 * **Two numbers do both cases**, which is why there is no second code path:
 *
 * - Changing step draws one piece. `uDrawOnly` names it; every other piece is
 *   already there and stays at 1.
 * - The overview draws them in order, first to last, so the whole event arrives
 *   as a sequence rather than all at once. `uDrawOnly` is -1 and the head
 *   sweeps along the film, so each piece starts as the head reaches it.
 *
 * Nothing per frame on the processor and nothing rewritten: a piece works out
 * its own progress from its own index, which it already has as an attribute.
 */
const DRAW = `
uniform vec2 uDraw;       // where the drawing has reached, and how long a piece takes
uniform float uDrawOnly;  // the one piece being drawn, or -1 for all of them in order

float drawnAt(float piece) {
  if (uDraw.y <= 0.0) return 1.0;
  // A piece nobody is drawing is simply there, which is what makes changing one
  // step leave the rest of the film alone.
  if (uDrawOnly >= -0.5 && abs(piece - uDrawOnly) > 0.5) return 1.0;
  return clamp((uDraw.x - piece) / uDraw.y, 0.0, 1.0);
}
`;

const LIGHT = `
uniform float uRoom;      // 0 the world as lit, 1 a dark room
uniform vec4 uSpot;       // where the light points: x, z, its radius, and how bright

/**
 * How much of the spotlight reaches a place on the film.
 *
 * **It comes in from the top right rather than from straight above**, which is
 * how a stage light is hung and is what the user asked for: *"not from straight
 * the top. From the top right, as if its coming into a stage."*
 *
 * Two things say so. The pool is an **ellipse**, because a cone meeting the
 * ground at an angle makes one - a circle is what you get only from directly
 * overhead - and it is stretched along the direction the light travels. And it
 * is **thrown past** what it is aimed at, because the far side of a tilted cone
 * reaches further than the near side.
 */
float spotAt(vec3 onStrip) {
  if (uSpot.w < 0.001) return 0.0;
  // Where the light comes from, on the ground: up and to the right of the
  // object, so the pool is cast down and to the left of it.
  const vec2 FROM = vec2(0.55, -0.34);
  vec2 away = onStrip.xz - (uSpot.xy - FROM * uSpot.z * 0.42);
  // Squashed across the throw and stretched along it, which is the ellipse.
  vec2 along = normalize(FROM);
  vec2 shaped = vec2(dot(away, along) / 1.35, dot(away, vec2(-along.y, along.x)));
  float reach = length(shaped);
  // Bright in the middle, soft at the rim. A hard circle reads as a decal on
  // the ground; a soft one reads as light falling on it.
  float pool = 1.0 - smoothstep(uSpot.z * 0.45, uSpot.z, reach);
  return pool * pool * uSpot.w;
}
`;

const CUBE_VS = `#version 300 es
${ROLL}
${DRAW}
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
out float vAo;
out vec3 vWorld;
out vec2 vFinish;
out float vVeil;
out vec3 vStrip;
out float vArrived;

/**
 * How much of this object has arrived.
 *
 * **A thing standing on a piece cannot be there before the piece is.** The
 * sheet is drawn into mid air first and what stands on it fades in after a
 * short delay, which is the whole shape the user asked for. The delay is the
 * 0.72 below: nothing appears until the sheet is nearly closed.
 *
 * Which piece a thing is on is read from **where it stands**, exactly as
 * everything else in this app reads it - there is no field to keep in step and
 * nothing to go stale.
 */
float arrivedAt(vec3 onStrip) {
  float piece = floor(onStrip.x / uPitch + 0.5);
  return smoothstep(0.72, 1.0, drawnAt(piece));
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
  vec3 world = aOffset + wobble * uShimmer;

  // A ghost is smaller as well as fainter, so an unvisited part of the canvas
  // reads as not-yet-arrived rather than as badly lit.
  vSolid = solidity(uStep, uStepT, aFrom, aUntil);
  float grow = mix(0.5, 1.0, vSolid);

  // Measured on the flat strip, before the world is rolled: the veil is a
  // distance along the film, and on a ring the rolled positions of two pieces
  // can be close together while being half a story apart.
  vec3 onStrip = world + aPos * aSize * grow;
  vVeil = veilOf(onStrip);
  // Where this is on the flat film, carried through so the fragment shader can
  // ask the spotlight the same question the ground does. See the note on vStrip
  // in the fragment shader for why it is not answered here.
  vStrip = onStrip;
  vArrived = arrivedAt(onStrip);
  vY = onStrip.y;
  vec3 p = bend(onStrip);
  vWorld = p;

  vColour = aColour;
  vAo = 1.0;                     // a cube has no crease of its own
  // A cube is as coarse as a thing gets: its facets are the whole point, and
  // the shimmer was sized for it in the first place.
  vFinish = vec2(0.0, 1.0);
  vPicked = abs(aObject - uSelected) < 0.5 ? 1.0 : 0.0;
  vNormal = bendNormal(aNormal, onStrip.x);
  vec4 clip = uViewProj * vec4(p, 1.0);
  vDepth = clip.w;
  gl_Position = clip;
}`;

const CUBE_FS = `#version 300 es
precision highp float;
${LIGHT}

in vec3 vColour;
in vec3 vNormal;
in float vDepth;
in float vY;
in float vPicked;
in float vSolid;
in float vAo;
in vec3 vWorld;
in vec2 vFinish;
in float vVeil;
/**
 * Where this fragment is on the flat film, for the spotlight to measure against.
 *
 * **Per fragment, for the same reason the ground is.** The pool was worked out
 * at the vertices first, which is fine for a person and wrong for a street: this
 * library is 61 street and pavement pieces, and a slab that is two triangles
 * interpolates a circle into a diamond exactly as the plate did.
 */
in vec3 vStrip;
// How much of this object has arrived, which is nothing until the sheet under
// it has been drawn.
in float vArrived;

uniform vec3 uSun;
uniform vec3 uSky;
/**
 * What is actually behind the world.
 *
 * **uSky is the weather's own sky colour** - a bright blue for clear - and the
 * sky shader pulls that most of the way to black, because the film hangs in
 * space rather than under an atmosphere. So anything fading "into the sky" has
 * to fade into the colour that is really there: fading into uSky turned a
 * distant piece blue against a black backdrop, which is what the user saw as
 * *"a blue fog that shows up when i zoom out too far"*.
 */
uniform vec3 uBackdrop;
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

  // **The room, then the light in it.** Dimming first and adding the spot
  // after is what makes a spotlight read as the only light in the place rather
  // than as a bright patch laid over a lit world.
  colour *= mix(1.0, 0.12, uRoom);
  // **Lit from where the light is.** A pool on the ground with a flatly
  // brightened object standing in it reads as a decal; the faces turned toward
  // the light have to take more of it, which is what says the light is coming
  // from up and to the right rather than from everywhere.
  vec3 fromLight = normalize(vec3(0.55, 0.78, -0.34));
  float facing = 0.45 + 0.55 * max(dot(n, fromLight), 0.0);
  colour += vColour * spotAt(vStrip) * 1.5 * facing;

  float fog = clamp((vDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  colour = mix(colour, uBackdrop, fog * 0.85);

  // **The veil: measured from the piece, not from the camera.**
  //
  // Distance fog cannot separate the film - a neighbouring piece sits *beside*
  // the camera at nearly the same depth as the one in front of it, so anything
  // keyed to depth shows both or hides both. This is worked out in the vertex
  // shader from the position on the **flat** strip, because once the world is
  // rolled two pieces can be near each other in space while being half a story
  // apart along the film.
  // **Fading into the backdrop rather than becoming transparent**, exactly as
  // the veil does - it reads the same against space and needs no sorting, which
  // transparency over a hundred thousand cubes would.
  colour = mix(uBackdrop, colour, vVeil * vArrived);

  // A ghost is washed most of the way into the sky rather than made
  // transparent. It reads the same and it needs no sorting, which transparency
  // over a hundred thousand cubes would.
  vec3 ghost = mix(uBackdrop, colour, 0.22);
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
${ROLL}
${DRAW}
in vec3 aPos;
in vec3 aNormal;
in vec3 aColour;
in float aSeed;
in float aObject;
in float aFrom;
in float aUntil;
in float aAo;
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
out float vVeil;
out vec3 vStrip;
out float vArrived;

/**
 * How much of this object has arrived.
 *
 * **A thing standing on a piece cannot be there before the piece is.** The
 * sheet is drawn into mid air first and what stands on it fades in after a
 * short delay, which is the whole shape the user asked for. The delay is the
 * 0.72 below: nothing appears until the sheet is nearly closed.
 *
 * Which piece a thing is on is read from **where it stands**, exactly as
 * everything else in this app reads it - there is no field to keep in step and
 * nothing to go stale.
 */
float arrivedAt(vec3 onStrip) {
  float piece = floor(onStrip.x / uPitch + 0.5);
  return smoothstep(0.72, 1.0, drawnAt(piece));
}

float solidity(float step, float t, float from, float until) {
  if (step < from - 0.5) return 0.0;
  if (step < from + 0.5) return t;
  if (step < until + 0.5) return 1.0;
  if (step < until + 1.5) return 1.0 - t;
  return 0.0;
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
  vec3 p = turned(aPos, aPivot, aMotion, uTime) + aNormal * (breathe + shrink);

  // See the cube shader: the veil and the spotlight are measured on the flat
  // strip, and the spotlight is asked per fragment rather than here.
  vVeil = veilOf(p);
  vStrip = p;
  vArrived = arrivedAt(p);
  vY = p.y;
  vec3 onStrip = p;
  p = bend(p);
  vWorld = p;

  vColour = aColour;
  vAo = aAo;
  vFinish = aFinish;
  vPicked = abs(aObject - uSelected) < 0.5 ? 1.0 : 0.0;
  vNormal = bendNormal(aNormal, onStrip.x);
  vec4 clip = uViewProj * vec4(p, 1.0);
  vDepth = clip.w;
  gl_Position = clip;
}`;

// A soft patch of darkness under each object. Without one, everything hovers
// a little, and no amount of shading on the object itself fixes that.
const SHADOW_VS = `#version 300 es
${ROLL}
${DRAW}
in vec2 aCorner;
in vec3 aCentre;
in float aRadius;
in float aFrom;
in float aUntil;

uniform mat4 uViewProj;
uniform float uStep;
uniform float uStepT;
out vec2 vLocal;
out float vSolid;
out float vVeil;
// A contact shadow before the thing casting it has arrived is a shadow of
// nothing, so it comes in with its object.
out float vArrived;

float solidity(float step, float t, float from, float until) {
  if (step < from - 0.5) return 0.0;
  if (step < from + 0.5) return t;
  if (step < until + 0.5) return 1.0;
  if (step < until + 1.5) return 1.0 - t;
  return 0.0;
}



void main() {
  vLocal = aCorner;
  vSolid = solidity(uStep, uStepT, aFrom, aUntil);
  // Veiled with the thing casting it. A shadow is multiplied onto the ground,
  // so one left behind past the veil is a dark blot on what should be sky.
  vVeil = veilOf(aCentre);
  vArrived = smoothstep(0.72, 1.0, drawnAt(floor(aCentre.x / uPitch + 0.5)));
  // Just above the ground, so it never fights the floor for depth. A shadow
  // travels with the object casting it, or it is left standing where the
  // object used to be.
  vec3 p = aCentre + vec3(aCorner.x * aRadius, 0.01, aCorner.y * aRadius);
  // **Rolled with everything else.** Left flat, a shadow stays where the object
  // used to be while the world turns out from under it.
  gl_Position = uViewProj * vec4(bend(p), 1.0);
}`;

const SHADOW_FS = `#version 300 es
precision highp float;
in vec2 vLocal;
in float vSolid;
in float vVeil;
in float vArrived;
uniform float uStrength;
out vec4 frag;
void main() {
  float edge = 1.0 - clamp(length(vLocal), 0.0, 1.0);
  float mask = edge * edge * vSolid * uStrength * vVeil * vArrived;
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
${ROLL}
${DRAW}
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
out vec3 vStrip;
out float vArrived;

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
  // Where this is on the flat film, for the light to be measured against - the
  // same thing the objects and the plates carry, and per fragment for the same
  // reason: a place is two triangles.
  vStrip = p;
  vArrived = smoothstep(0.72, 1.0, drawnAt(floor(p.x / uPitch + 0.5)));
  gl_Position = uViewProj * vec4(bend(p), 1.0);
}`;

const AREA_FS = `#version 300 es
precision highp float;
${LIGHT}
in vec2 vLocal;
in vec3 vTint;
in float vSolid;
in vec3 vStrip;
in float vArrived;
out vec4 frag;
void main() {
  // Soft at the edges and stronger at the rim than in the middle, so an area
  // reads as a region of ground rather than as a painted rectangle - and so
  // that anything standing on it is still standing on ground.
  vec2 d = abs(vLocal);
  float inside = (1.0 - smoothstep(0.86, 1.0, max(d.x, d.y)));
  float rim = smoothstep(0.62, 0.99, max(d.x, d.y));
  float alpha = inside * vSolid * (0.16 + 0.30 * rim) * vArrived;
  if (alpha < 0.004) discard;

  // **A place is ground, so the room reaches it.** It is laid into the floor and
  // blended over it, so leaving it out of the dimming lit it at full strength
  // over ground at a tenth of that - a coloured card glowing in a dark room,
  // which is the one thing a wash of colour on the floor must not do.
  vec3 colour = vTint * mix(1.0, 0.12, uRoom);
  colour += vTint * spotAt(vStrip) * 0.9;
  frag = vec4(colour, alpha);
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
// For the twinkle and the slow turn of the disc. One number a frame, which is
// the only kind of per-frame work this app does.
uniform float uTime;
// How far the sky is space rather than air. The world is a ring hanging in
// nothing, so there is no atmosphere to hold a gradient and no horizon for one
// to sit on - what is left is black with stars in it.
uniform float uSpace;
out vec4 frag;

// **Never write a backtick in a shader comment.** These sources are template
// literals, so a backtick ends the string and the error names a line of GLSL as
// though it were JavaScript. It has cost five rounds so far, and no test can
// catch it: a broken template literal stops the module loading, which stops the
// test file that would have checked it from importing anything at all.

// A stable value per direction, for stars. Nothing is stored and nothing is
// uploaded: the same direction always hashes to the same number, so the sky
// holds still while the camera turns through it.
float hash(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
}

/**
 * One layer of stars.
 *
 * **A star is a point, not a cell.** The field used to be a lit cell wherever
 * the hash crossed a threshold, which makes every star the same square, the
 * same size and the same colour - a grid of identical dots, which is what reads
 * as noise rather than as a sky. Each cell now holds one star at a jittered
 * place inside it, drawn as a round point with a falloff, and hashes its own
 * brightness and colour.
 *
 * Only the cell the direction falls in is sampled, rather than its neighbours
 * too. A star close to a cell wall is clipped by it, and at these radii - a
 * star is a fraction of a cell across - that is rare enough to be invisible and
 * saves twenty-six samples a layer.
 *
 * Depth comes from calling it more than once. One layer at any density is a
 * flat sheet of dots; three at different densities, sizes and brightnesses read
 * as near, middle and far.
 */
vec3 starLayer(vec3 dir, float density, float cut, float gain, float time) {
  vec3 cell = floor(dir * density);
  float pick = hash(cell);
  // Most cells are empty. This is what sets how crowded the sky is, and it is
  // the first thing to reach for if it ever looks busy.
  if (pick < cut) return vec3(0.0);

  /**
   * **Everything here is measured in cells, and that is the whole fix.**
   *
   * The first version took a radius in *radians* and a density separately, and
   * at the density it was given the radius came out larger than the cell it was
   * drawn in. So every star was a soft ball wider than its own box, and the box
   * cut it off - which is exactly what was reported: *"blurry blubs that are cut
   * off at the edges."*
   *
   * A star is jittered no further than 0.2 of a cell from the middle and is no
   * wider than 0.28, so the furthest it can reach is 0.48 - inside the 0.5 that
   * would touch the wall. **It cannot be clipped by construction** rather than
   * by choosing numbers that happen not to be.
   */
  vec3 jitter = vec3(hash(cell + 1.7), hash(cell + 5.3), hash(cell + 9.1));
  vec3 at = normalize((cell + 0.5 + (jitter - 0.5) * 0.4) / density);
  float away = length(at - dir) * density;

  // **Never smaller than a pixel.** A star finer than the screen can resolve
  // does not look fine, it flickers as the camera turns and the sample lands
  // on it or misses. Widened to about a pixel and left to be dim instead.
  float pixel = length(fwidth(dir)) * density;
  float radius = clamp(max(0.15, pixel * 1.1), 0.08, 0.30);

  // Edges in increasing order: smoothstep is undefined the other way round.
  // Cubed, so a star is a tight point with a soft edge rather than a ball.
  float point = 1.0 - smoothstep(0.0, radius, away);
  point = point * point * point;

  // **Each star keeps its own phase**, so the field shimmers rather than
  // pulsing as one, which is what an animated starfield usually gets wrong.
  float phase = fract(pick * 17.0) * 6.2831853;
  float alive = 0.82 + 0.18 * sin(time * 1.3 + phase);
  // Stars are not all white and not all the same brightness. Both come off the
  // same hash, so a star keeps its colour and its size wherever you look from.
  vec3 tint = mix(vec3(0.72, 0.80, 1.00), vec3(1.00, 0.87, 0.70), fract(pick * 31.0));
  float scale = 0.25 + 0.75 * fract(pick * 53.0);

  return tint * point * alive * scale * gain;
}

void main() {
  vec3 dir = normalize(uForward + uRight * vNdc.x * uTan.x + uUp * vNdc.y * uTan.y);

  // The gradient follows the horizon in the world rather than the middle of the
  // screen, so tilting the camera tilts the sky with it.
  float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 colour = mix(uHorizon, uSky, pow(h, 0.75));
  // Pulled toward black, keeping a little of the hour's colour so the weather
  // and the time of day still say something rather than nothing.
  colour = mix(colour, colour * 0.06, uSpace);

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
  float starlight = max(uNight, uSpace);
  if (starlight > 0.01) {
    // In space there is no ground to hide the lower half of the sky, so stars
    // go all the way round rather than fading out below the horizon.
    float below = mix(max(dir.y, 0.0), 1.0, uSpace);

    /**
     * **The singularity.** A far-off core the field falls toward.
     *
     * Asked for after the user went looking at CodePen: *"especially the
     * singularity, would that be possible to incorporate in the background? not
     * 1 for 1 copy but more to beautify the stars."* So it is not a copy of
     * anything - it is the one shape that gives a starfield somewhere to be.
     * A sky of evenly scattered points has no depth and nowhere to look; a
     * bright ring around a dark middle, with the stars crowding toward it, has
     * both, and it costs an angle and two curves.
     *
     * Fixed in the **world**, like everything else out here, so it holds still
     * as the camera turns and sits off to one side rather than centred, where
     * it would read as a target rather than as a place.
     */
    vec3 core = normalize(vec3(-0.46, 0.20, 0.86));
    float ang = acos(clamp(dot(dir, core), -1.0, 1.0));

    // Two axes across the core, so the disc can be given a slow turn. Built
    // from a vector the core is not parallel to, which is why it is up rather
    // than anything derived from the camera.
    vec3 across = normalize(cross(core, vec3(0.0, 1.0, 0.0)));
    vec3 along = cross(core, across);
    float around = atan(dot(dir, along), dot(dir, across));
    // **A slow sweep rather than a spin.** Fast enough to notice on a held shot
    // and slow enough never to be what you are looking at.
    float sweep = 0.72 + 0.28 * sin(around * 2.0 + uTime * 0.22);

    // The middle is dark and the light is in a ring around it, which is the
    // whole of what makes this read as a singularity rather than as a lamp.
    float halo = exp(-ang * 5.5) * smoothstep(0.0, 0.055, ang);
    // **Squared by multiplying, not by pow.** The base goes negative inside the
    // ring - that is what makes it a ring - and pow of a negative base is
    // undefined in GLSL, which is a driver-by-driver result rather than an
    // error anything would report.
    float off = (ang - 0.085) / 0.045;
    float ring = exp(-off * off) * sweep;

    colour += vec3(0.34, 0.42, 0.78) * halo * 0.5 * starlight;
    colour += vec3(0.70, 0.76, 1.00) * ring * 0.32 * starlight;

    // Stars crowd toward it and thin out at the far side, so the field reads as
    // being pulled rather than sprinkled - and the very middle takes them away
    // again, because nothing gets out of there.
    float pull = 1.0 + 0.85 * exp(-ang * 2.2);
    float swallowed = smoothstep(0.0, 0.075, ang);

    // Three layers: near and bright, middle, and a fine dust that never quite
    // resolves. One layer at any density is a flat sheet of dots.
    vec3 field = starLayer(dir, 90.0, 0.9820, 1.00, uTime)
      + starLayer(dir, 190.0, 0.9890, 0.62, uTime)
      + starLayer(dir, 380.0, 0.9930, 0.34, uTime);

    colour += field * below * starlight * pull * swallowed;
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

/**
 * The film itself: one plate of ground per piece.
 *
 * **This replaced the infinite floor**, which was an endless plane the world
 * stood on. There is no ground any more - the world is a ring hanging in space
 * - so the only ground is the film, and a piece of film is a plate you can see
 * the edges of. That is what makes the strip read as a strip rather than as
 * objects floating in the dark.
 *
 * One instanced quad per piece, rolled by the same transform everything else
 * is, so the plates curve into the ring with what stands on them.
 */
const STRIP_VS = `#version 300 es
${ROLL}
${DRAW}
in vec2 aCorner;
in float aPiece;          // which piece of the film this plate is

uniform mat4 uViewProj;
uniform vec2 uPlate;      // how big a plate is: along the film, across it

out vec3 vStrip;
out vec2 vLocal;
out vec3 vPos;
out vec3 vFace;
// How far this piece has been drawn in. Worked out per piece rather than per
// fragment, because every fragment of one plate shares the answer.
out float vDrawn;
out float vDepth;
out float vVeil;

void main() {
  // **There is no filled body.** A switch used to drag a plate's near edge in
  // toward the middle of the ring, so the hole closed up and the loop read as a
  // disc rather than a hoop. It was there to be compared by eye and nobody
  // could say afterwards what it was for - and the user's own reference for
  // this shape was a halo, which is open in the middle by definition.
  vec3 onStrip = vec3(
    aPiece * uPitch + aCorner.x * uPlate.x * 0.5,
    0.0,
    aCorner.y * uPlate.y * 0.5
  );
  vLocal = aCorner;
  vStrip = onStrip;
  vDrawn = drawnAt(aPiece);
  vVeil = veilOf(onStrip);

  vec3 p = bend(onStrip);
  vPos = p;
  // The plate faces outward from the ring, which is what its own turn says.
  // Kept whole rather than reduced to how much light it catches: a sheen needs
  // to know where the surface is pointing as well as how lit it is.
  vFace = bendNormal(vec3(0.0, 1.0, 0.0), onStrip.x);

  vec4 clip = uViewProj * vec4(p, 1.0);
  vDepth = clip.w;
  gl_Position = clip;
}`;

const STRIP_FS = `#version 300 es
precision highp float;
${LIGHT}
in vec3 vStrip;
in vec2 vLocal;
in vec3 vPos;
in vec3 vFace;
in float vDrawn;
in float vDepth;
in float vVeil;

uniform vec2 uPlate;      // how big a plate is, so a drawn line is a real width
uniform vec3 uFloor;
uniform vec3 uSky;
// See the note in the object shader: the colour the world recedes into is not
// the weather's sky colour, because the film hangs in space.
uniform vec3 uBackdrop;
uniform vec3 uSun;
uniform vec3 uEye;
uniform float uFogNear;
uniform float uFogFar;
uniform sampler2D uScars;
uniform float uScarExtent;
// What the ground is made of: 0 the board itself, 1 grass, 2 concrete.
uniform float uGround;

/**
 * The blueprint palette.
 *
 * Taken from the reference the user settled on - a technical drawing on
 * parchment, ink lines, a gold accent - so the app and the design it is going
 * to live inside are the same thing rather than two things that nearly match.
 * Written here as constants because they are the identity of the app, not a
 * setting: nothing should be able to reach in and change them by accident.
 */
const vec3 PARCHMENT = vec3(0.961, 0.918, 0.839);       // #f5ead6
const vec3 PARCHMENT_DARK = vec3(0.910, 0.835, 0.706);  // #e8d5b4
const vec3 INK = vec3(0.173, 0.094, 0.063);             // #2c1810
const vec3 GOLD = vec3(0.831, 0.659, 0.325);            // #d4a853

out vec4 frag;

/**
 * A stable number per place on the ground.
 *
 * Nothing is stored and nothing is uploaded: the same place always hashes to
 * the same number, so the ground holds still while the world turns through it.
 * The same trick the stars use.
 */
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

/** Softened, so it reads as a material rather than as pixels. */
float grain(vec2 p) {
  vec2 cell = floor(p);
  vec2 into = smoothstep(0.0, 1.0, fract(p));
  return mix(
    mix(hash(cell), hash(cell + vec2(1.0, 0.0)), into.x),
    mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0, 1.0)), into.x),
    into.y
  );
}

/**
 * A ruled line at a spacing, thinning with distance.
 *
 * Screen-space derivatives, because a grid drawn at a fixed world width goes to
 * moire the moment the camera pulls back for the overview - forty pieces of
 * ruled paper at once is where a naive grid turns into interference. Keeping
 * the line one pixel wide however far away it is, is the whole trick.
 */
float ruled(vec2 at, float every, float weight) {
  vec2 grid = abs(fract(at / every - 0.5) - 0.5) * every;
  vec2 width = fwidth(at) * weight;
  vec2 line = 1.0 - smoothstep(vec2(0.0), width, grid);
  return clamp(max(line.x, line.y), 0.0, 1.0);
}

void main() {
  // What the weather left behind. Red is wet, green is bleached by fog. Read in
  // **strip space**, so a mark stays on the piece it fell on however the world
  // is rolled.
  vec2 uv = (vStrip.xz + uScarExtent) / (2.0 * uScarExtent);
  vec2 marks = texture(uScars, uv).rg;
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  float wet = marks.r * inside;
  float pale = marks.g * inside;

  vec2 at = vStrip.xz;
  float coarse = grain(at * 0.42);
  float fine = grain(at * 2.6);

  /**
   * **The board.**
   *
   * Trail is not a projector and the ground is not film: *"its an illustrator,
   * like a drawing board."* So a piece is a sheet of paper - pale, warm, matte -
   * with a faint tooth to it and a grid ruled on it, and everything placed
   * stands on the sheet the way a drawing sits on a board.
   *
   * Pale rather than dark is the substantive change. Film stock was chosen so
   * colours would read against it; paper does the same job from the other side,
   * and it is the one that says "this is being drawn" rather than "this is
   * being projected".
   */
  vec3 paper = mix(PARCHMENT_DARK, PARCHMENT, coarse);
  paper = mix(paper, paper * 0.97, fine * 0.6);
  // Two rules, like any drawing board: a light one to read the spacing from and
  // a heavier one every fifth line so the eye has something to count by. The
  // ratio is the reference's own - a minor grid at 20px and a major at 100.
  float fineRule = ruled(at, 2.0, 1.0);
  float heavyRule = ruled(at, 10.0, 1.2);
  paper = mix(paper, INK, fineRule * 0.10);
  paper = mix(paper, INK, heavyRule * 0.20);

  // Grass: mown patches running across the piece, with a dry tip on the high
  // ground so it is not one sheet of green.
  vec3 grass = mix(vec3(0.16, 0.30, 0.13), vec3(0.30, 0.46, 0.20), coarse);
  grass = mix(grass, vec3(0.44, 0.50, 0.26), fine * fine * 0.5);

  // Concrete: pale and mottled, scored into slabs. The joints are what say
  // "poured" rather than "painted".
  vec3 concrete = mix(vec3(0.40, 0.40, 0.42), vec3(0.55, 0.55, 0.56), coarse * 0.7 + fine * 0.3);
  vec2 slab = abs(fract(at / 4.0) - 0.5);
  float joint = 1.0 - smoothstep(0.44, 0.5, max(slab.x, slab.y));
  concrete *= mix(0.72, 1.0, joint);

  // The weather still tints the board, because the ground remembering what
  // happened on it is the one thing the strip carries across a whole event.
  vec3 stuff = paper;
  stuff = mix(stuff, grass, clamp(1.0 - abs(uGround - 1.0), 0.0, 1.0));
  stuff = mix(stuff, concrete, clamp(1.0 - abs(uGround - 2.0), 0.0, 1.0));
  stuff = mix(stuff, stuff * mix(vec3(1.0), uFloor * 1.6, 0.5), 0.18);

  vec3 ground = stuff * mix(1.0, 0.62, wet);
  ground = mix(ground, vec3(0.88, 0.89, 0.90), pale * 0.5);

  // Lit by where this part of the ring is facing, so the far side of the loop
  // falls into shadow and the world reads as round. **Flatter than a scene**:
  // paper is matte and a board is meant to be read, not lit dramatically, so
  // this is a gentle wash rather than the range a surface in a scene gets.
  vec3 n = normalize(vFace);
  float lambert = max((dot(n, normalize(uSun)) + 0.45) / 1.45, 0.0);
  vec3 colour = ground * mix(0.72, 1.06, lambert);

  // **The room, then the light in it**, and the pool is worked out here rather
  // than at the corners: a plate is two triangles, so a circle interpolated
  // across it would be a diamond.
  colour *= mix(1.0, 0.12, uRoom);
  float pool = spotAt(vStrip);
  colour += mix(vec3(1.0, 0.96, 0.88), ground * 3.0, 0.35) * pool * 0.9;

  /**
   * **Drawn into mid air, from one point.**
   *
   * The sheet is measured in the units it is actually drawn at rather than in
   * local ones, so the pen keeps its width whatever size a plate is set to.
   *
   *        start                              end
   *          v                                 v
   *          +---------------------------------+
   *   two points diverge, take the corners, run
   *   the long sides, and converge on the far side
   *
   * The line is one path with two halves running in opposite directions, so a
   * fragment's place along it is the same on the top edge and the bottom. The
   * fill follows the pen: it reaches exactly as far along the film as the two
   * points have, which is what makes the sheet close rather than appear.
   */
  // "half" is a reserved word in GLSL, which this file has already been caught
  // by once - hence "halfPlate".
  vec2 halfPlate = uPlate * 0.5;
  vec2 fromEdge = (1.0 - abs(vLocal)) * halfPlate;  // to the nearer long / short side
  float shortSide = halfPlate.y;                    // half the across-strip side
  float longSide = uPlate.x;                       // a whole side along the film
  float total = shortSide + longSide + shortSide;
  float reached = vDrawn * total;

  // Where this fragment sits along that path, if it is on the border at all.
  float alongShort = abs(vLocal.y) * halfPlate.y;                    // out from the middle
  float alongLong = shortSide + (vLocal.x + 1.0) * 0.5 * longSide;
  bool onNear = fromEdge.x < fromEdge.y && vLocal.x < 0.0;
  bool onFar = fromEdge.x < fromEdge.y && vLocal.x >= 0.0;
  float place = onNear ? alongShort
    : (onFar ? shortSide + longSide + (halfPlate.y - alongShort) : alongLong);

  /**
   * **The border, measured in pixels.**
   *
   * The first version ramped from full brightness *at* the edge down to nothing
   * across the whole of its width. That is a gradient, not a line, and it is why
   * it read as undefined however bright it was made: there was no width at which
   * it was simply solid.
   *
   * Working in pixels rather than world units fixes both halves at once.
   * The distance to the edge divided by the pixel is how many pixels this
   * fragment is from it, so a line is **solid out to its half-width and then
   * softened over exactly one pixel** - crisp close up, and still there at the
   * pull-back, where a line measured in world units is thinner than the screen.
   *
   * It also keeps the smoothstep edges increasing by construction, which the
   * specification requires and which is undefined rather than inverted when it
   * is got wrong.
   */
  float toBorder = min(fromEdge.x, fromEdge.y);
  float pixel = max(max(fwidth(vStrip.x), fwidth(vStrip.z)), 1e-6);
  float outPx = toBorder / pixel;

  // Capped in world terms as well, or a plate small on screen is all border -
  // and floored at a pixel, or it disappears entirely at the far end of the
  // overview, which is the one place the border is doing the most work.
  float widest = min(uPlate.x, uPlate.y) * 0.04 / pixel;
  float ruleW = clamp(widest, 1.0, 2.6);
  float border = 1.0 - smoothstep(ruleW, ruleW + 1.0, outPx);

  // **A second rule set in from the first**, which is what a border on a
  // technical drawing actually is and what makes it read as drawn rather than
  // as the sheet simply stopping. Gold, against an ink outer line.
  // Never closer than a couple of pixels to the outer rule, or the two merge
  // into one thick line and the drawing reads as a slab edge again.
  float innerAt = max(ruleW + 2.5, min(9.0, widest * 3.0));
  float inner = 1.0 - smoothstep(1.0, 2.0, abs(outPx - innerAt));

  float pen = border * step(place, reached);
  float trim = inner * step(place, reached);

  // **The two points that are doing the drawing.** A bright head travelling
  // along the path is what makes it read as being drawn rather than as a line
  // growing, and it is the whole of what was missing.
  float head = (1.0 - smoothstep(6.0, 26.0, abs(place - reached) / pixel))
    * max(border, inner) * step(0.001, vDrawn) * step(vDrawn, 0.999);

  // The fill follows the two points along the film and stops where they are.
  float front = clamp((reached - shortSide) / longSide, 0.0, 1.0);
  float filled = step((vLocal.x + 1.0) * 0.5, front);
  // Once the far side is closed the whole sheet is there, however the sweep
  // rounded off.
  filled = max(filled, step(0.999, vDrawn));

  float fog = clamp((vDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
  colour = mix(colour, uBackdrop, fog * 0.9);

  /**
   * **The outer rule is ink and the inner one is gold.**
   *
   * Gold on parchment is two warm light colours a few steps apart, so a gold
   * border on a parchment sheet has almost nothing to define itself against -
   * which is most of why it stayed hard to see however bright it was made. Ink
   * is what a line on a drawing board is, and it is the only thing here with
   * real contrast against the paper.
   *
   * The gold does not go: it moves inward to the second rule, where it reads as
   * the accent it is rather than as the thing holding the edge.
   */
  colour = mix(colour, INK, pen * 0.92);
  colour = mix(colour, GOLD, trim * 0.85);
  colour = mix(colour, vec3(1.0, 0.97, 0.88), head);

  // **A hard edge.** The sheet used to fade out over a tenth of its width, so it
  // had no boundary at all - reported as *"im not a fan of the blurry canvas
  // edges"*. It ends where the border is, and the border is what says where.
  // The inner rule is drawn with the outer one rather than waiting for the
  // fill to reach it, so what you watch is two concentric lines being traced.
  frag = vec4(colour, vVeil * max(max(filled, pen), trim));
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
  'strip vertex': STRIP_VS,
  'strip fragment': STRIP_FS,
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
  const strip = program(gl, STRIP_VS, STRIP_FS, 'strip');

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
      'fromStep', 'untilStep', 'ao', 'pivots', 'motion', 'finish']) {
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
      fromStep: patches.fromStep, untilStep: patches.untilStep,
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
    gl.bindVertexArray(null);
  }

  let areaVao = null;
  let areaCount = 0;
  const areaBuffers = {};

  let stripVao = null;
  let pieceBuf = null;

  /**
   * The film itself: one plate of ground per piece.
   *
   * Called when the number of pieces changes, which is the only thing it
   * depends on - where each plate stands comes from its index and the geometry,
   * both of which the shader is given. So adding a piece is one small buffer,
   * not a rebuild of the world.
   */
  function uploadStrip(count, { pitch, width, depth }) {
    plateCount = Math.max(0, Math.floor(count) || 0);
    // **How big a plate is drawn and how far apart pieces stand are separate.**
    // The pitch is what every position on the film is measured against, so it
    // cannot move without every object on the strip moving with it. The plate
    // is only what you can see of the ground, and is free to be any size.
    plate = [Math.max(0.1, width), Math.max(0.1, depth)];
    platePitch = Math.max(0.001, pitch);
    if (!plateCount) return;

    const ids = new Float32Array(plateCount);
    for (let i = 0; i < plateCount; i++) ids[i] = i;
    if (pieceBuf) gl.deleteBuffer(pieceBuf);
    pieceBuf = buffer(ids);

    if (stripVao) gl.deleteVertexArray(stripVao);
    stripVao = gl.createVertexArray();
    gl.bindVertexArray(stripVao);
    attribute(strip.handle, 'aCorner', quadBuf, 2);
    attribute(strip.handle, 'aPiece', pieceBuf, 1, 1);
    gl.bindVertexArray(null);
  }

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
      'fromStep', 'untilStep']) {
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
    veil(cube);
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
    gl.uniform1f(cube.u.uSmooth, smoothing);
    gl.uniform3fv(cube.u.uSun, weather.sun);
    gl.uniform3fv(cube.u.uSky, weather.sky);
    gl.uniform3fv(cube.u.uBackdrop, backdrop);
    gl.uniform1f(cube.u.uFogNear, weather.fogNear ?? 26);
    gl.uniform1f(cube.u.uFogFar, weather.fogFar ?? 180);
    gl.drawElementsInstanced(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0, instanceCount);
    gl.bindVertexArray(null);
  }

  function drawMesh(matrix, flip, weather, time, shimmer, selected, step, stepT) {
    gl.useProgram(mesh.handle);
    veil(mesh);
    gl.bindVertexArray(meshVao);
    gl.uniformMatrix4fv(mesh.u.uViewProj, false, matrix);
    gl.uniform1f(mesh.u.uTime, time);
    gl.uniform1f(mesh.u.uFlip, flip);
    gl.uniform1f(mesh.u.uShimmer, shimmer);
    gl.uniform1f(mesh.u.uStep, step);
    gl.uniform1f(mesh.u.uStepT, stepT);
    gl.uniform1f(mesh.u.uSelected, flip < 0 ? -1 : selected);
    gl.uniform1f(mesh.u.uTint, flip < 0 ? 0.72 : 1.0);
    gl.uniform1f(mesh.u.uAmbient, weather.ambient ?? 1);
    gl.uniform1f(mesh.u.uSmooth, smoothing);
    gl.uniform3fv(mesh.u.uSun, weather.sun);
    gl.uniform3fv(mesh.u.uSky, weather.sky);
    gl.uniform3fv(mesh.u.uBackdrop, backdrop);
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

  /**
   * How far from the piece being looked at the world survives.
   *
   * Set once per frame and handed to every program that draws something
   * standing on the ground, so the cubes, the surface, the floor and the
   * shadows all agree about where the world stops.
   */
  let veilAt = [0, 0];
  let veilFrom = 1e6;
  let veilTo = 1e6 + 1;
  // How far the world is rolled, and how big the loop is when it is.
  let rolled = 0;
  let ringRadius = 1000;
  let plateCount = 0;
  let plate = [34, 22];
  let platePitch = 64;
  // What the world fades into. Held here rather than passed, because the cube
  // and mesh passes are their own functions and every one of them fades.
  let backdrop = [0, 0, 0];
  // The drawing in: how far it has reached along the film, how long one piece
  // takes, and which piece is being drawn (-1 draws them all in order).
  let drawHead = 1e6, drawSpan = 0, drawOnly = -1;
  // The room the film is in, and where the light in it is pointed.
  let darkRoom = 0;
  let spotAt = [0, 0, 6, 0];

  /**
   * The shape of the world, handed to every program that draws part of it.
   *
   * The roll, the ring's size and where the veil sits all have to agree across
   * the cubes, the surface, the film and the shadows, or the world comes apart
   * along the seams between programs. One place to set them is the only way
   * that stays true.
   */
  /**
   * The colour the world recedes into.
   *
   * The sky shader paints `mix(sky, sky * 0.06, uSpace)`, so in space the
   * backdrop is very nearly black however blue the weather's own sky colour is.
   * Worked out once here rather than three times in three shaders, and handed to
   * everything that fades - which is the veil, the fog and the ghost.
   */
  function backdropOf(sky, space) {
    const dark = Math.min(1, Math.max(0, space));
    return sky.map((c) => c * (1 - dark) + c * 0.06 * dark);
  }

  function veil({ u }) {
    if (u.uVeilNear) gl.uniform1f(u.uVeilNear, veilFrom);
    if (u.uVeilFar) gl.uniform1f(u.uVeilFar, veilTo);
    if (u.uRoll) gl.uniform1f(u.uRoll, rolled);
    if (u.uRadius) gl.uniform1f(u.uRadius, ringRadius);
    if (u.uFocusX) gl.uniform1f(u.uFocusX, veilAt[0]);
    // Every program needs the pitch now: it is how a place finds which piece it
    // belongs to, and therefore which frame it turns with.
    if (u.uPitch) gl.uniform1f(u.uPitch, platePitch);
    if (u.uRoom) gl.uniform1f(u.uRoom, darkRoom);
    // How far the drawing has got, and which piece is being drawn. Every
    // program that draws part of a piece has to agree, or the sheet arrives
    // without what stands on it or the other way round.
    if (u.uDraw) gl.uniform2f(u.uDraw, drawHead, drawSpan);
    if (u.uDrawOnly) gl.uniform1f(u.uDrawOnly, drawOnly);
    if (u.uSpot) gl.uniform4f(u.uSpot, spotAt[0], spotAt[1], spotAt[2], spotAt[3]);
  }

  function draw({
    matrix, eye, target = [0, 0, 0], time, weather = WEATHER.clear, shimmer = 0.004,
    selected = -1, step = 0, stepT = 1, surface = 'cubes', smooth = 0,
    // Where the veil is centred, and how far it reaches. Defaults are wide
    // enough to change nothing, so a caller that does not ask for a veil does
    // not get one.
    focus = [0, 0], veilNear = 1e6, veilFar = 1e6 + 1,
    // How far the strip is rolled into its ring, how big that ring is, and
    // whether its middle is filled in.
    roll = 0, radius = 1000,
    // What the ground is made of, how dark the room is, and where the light in
    // it is pointed: x, z, its radius, and how bright.
    ground = 0, room = 0, spot = [0, 0, 6, 0],
    // How far the sky is space rather than air.
    space = 1,
    // The canvas being drawn into mid air: where the pen has reached along the
    // film, how long one piece takes, and which piece - or -1 for all of them
    // in order, which is what the overview asks for.
    draw = null,
  }) {
    smoothing = smooth;
    // What the world fades into, which is not the weather's sky colour.
    backdrop = backdropOf(weather.sky, space);
    // No drawing asked for means everything is already there, which is what a
    // span of nought says.
    drawHead = draw?.head ?? 1e6;
    drawSpan = draw?.span ?? 0;
    drawOnly = draw?.only ?? -1;
    veilAt = focus; veilFrom = veilNear; veilTo = veilFar;
    rolled = roll; ringRadius = Math.max(1, radius);
    darkRoom = room; spotAt = spot;
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
    gl.uniform1f(sky.u.uTime, time);
    gl.uniform1f(sky.u.uSpace, space);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // 2. Depth from here on. **There is no mirrored pass any more**: it was the
    // field drawn upside down under a shiny floor, and there is no floor - the
    // world is a ring hanging in space.
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);

    // 3. The film: one plate of ground per piece, carrying the weather's marks.
    if (plateCount) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(strip.handle);
      veil(strip);
      gl.bindVertexArray(stripVao);
      gl.uniformMatrix4fv(strip.u.uViewProj, false, matrix);
      gl.uniform2f(strip.u.uPlate, plate[0], plate[1]);
      gl.uniform3fv(strip.u.uFloor, weather.floor);
      gl.uniform3fv(strip.u.uSky, weather.sky);
      gl.uniform3fv(strip.u.uBackdrop, backdrop);
      gl.uniform3fv(strip.u.uSun, weather.sun);
      gl.uniform3fv(strip.u.uEye, eye);
      gl.uniform1f(strip.u.uGround, ground);
      gl.uniform1f(strip.u.uFogNear, weather.fogNear ?? 26);
      gl.uniform1f(strip.u.uFogFar, weather.fogFar ?? 180);
      gl.uniform1f(strip.u.uScarExtent, scarExtent);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, scarTexture);
      gl.uniform1i(strip.u.uScars, 0);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, plateCount);
      gl.bindVertexArray(null);
    }

    // 4. Labelled places, laid on the ground under everything that stands on it.
    if (areaCount) {
      gl.depthMask(false);
      gl.useProgram(area.handle);
      // **This was missing, and places were the only part of the world drawn
      // without it.** `AREA_VS` takes the roll block and calls `bend`, so a
      // place is meant to turn with the piece it is drawn on - but nothing ever
      // handed it `uRoll`, which is nought until it is set, so `bend` returned
      // the flat position and every place stayed lying in the plane while the
      // ring turned out from under it. It cost nothing so far only because
      // nothing on the canvas has used a place since the ring landed.
      veil(area);
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
      veil(shadow);
      gl.bindVertexArray(shadowVao);
      gl.uniformMatrix4fv(shadow.u.uViewProj, false, matrix);
      gl.uniform1f(shadow.u.uStep, step);
      gl.uniform1f(shadow.u.uStepT, stepT);
      gl.uniform1f(shadow.u.uStrength, 0.55);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, shadowCount);
      gl.bindVertexArray(null);
      gl.depthMask(true);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }

    // 5. The field itself.
    gl.disable(gl.BLEND);
    drawField(surface, matrix, 1, weather, time, shimmer, selected, step, stepT);

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
    uploadStrip,
    updatePositions,
    setScars,
    draw,
    get count() { return instanceCount; },
    // How many plates of film the renderer is holding. Asked on demand rather
    // than inferred from what was drawn, because a page starved of frames has
    // drawn nothing and that says nothing about what it was given.
    get pieces() { return plateCount; },
    get view() { return lastView; },
  };
}
