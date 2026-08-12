// The app itself: the wiring that turns modules into a page you can use.
//
// **This was 1,950 lines inside index.html.** It moved because the same bug
// appeared four times - a function reading a constant declared later - and the
// agreed signal for moving it was the fourth. A module can be imported,
// inspected and started deliberately; a script tag can only be read as text and
// evaluated, which is what the startup test had been doing.
//
// It is not pure and it does not pretend to be: it owns the canvas, the panel,
// the caches and the loop. Everything it decides *about* a model, a framing or
// a script is decided in a pure module beside it and tested there.

import { voxelise, hollow, anchor as reanchor } from './voxel.js';
import {
  assemble, assembleMeshes, contactShadows, bounds, place, objectBoxes, travelOf,
} from './scene.js';
import { surfaceNets, fromTriangles } from './mesh.js';
import { toNdc, insideFrame, rayThrough, pick, groundPoint, dragTo, rotateBy } from './pick.js';
import {
  viewProjection, drift, autoMove, routeAt, routeAtHour, stepAround, lerpFraming,
  routeDuration, easeInOut,
} from './camera.js';
// `walk`, `panScreen` and `fit` are gone from here: the camera does not travel
// any more, so there is nowhere to walk, nothing to pan across, and fitting
// everything is what the overview does.
import { orbit, zoom, rise, tidy, centreOf } from './orbit.js';
import {
  framingOf, revealFraming, veilFor, fogFor, pitchOf, radiusFor, ringGround, xAt, easeRoll,
  pivotAt,
  DEFAULT_PIECE,
} from './timeline.js';
import { createRenderer } from './render.js';
import { lerpWeather, resolve as resolveWeather, stampsUpTo } from './weather.js';
import { clockOf } from './daylight.js';
import { scarMap } from './scars.js';
import { multiply } from './mat4.js';
import {
  serialise, parse, isRefusal, reorder, dropped, byTime, openPiece, cutPiece, pieceOf,
} from './canvas.js';
import { scriptOf } from './script.js';
import * as pen from './pen.js';
import { thumbnail, preview } from './thumb.js';
import { readVox, toGrid, isBadVox } from './vox.js';
import { readObj, readMtl, textureRefs, voxeliseMesh, atHeight } from './obj.js';
import { readPng, reduce } from './png.js';
import { paint, quantise } from './texture.js';
import { readGltf, readGlb, externalBuffers, clipNames } from './gltf.js';

// Reached only if every module above loaded. The classic script watches for it.
window.__trail.started = true;

// --- the scene --------------------------------------------------------------
//
// **Trail opens empty.** No objects, no steps: an empty day, which the app has
// treated as a perfectly good thing to be looking at since the playground was
// settled. You fill it.
//
// It used to open on a three-piece demonstration - a house, two people and a
// car at nine, one person and the car at half past one, one person at quarter
// past six - which was there to show what the strip was for while it was being
// built. It had stopped earning its place: it is the first thing to delete
// every time the app is opened, it made "did my canvas load?" ambiguous, and
// it kept coming back over work in progress. The user's words: *"the app
// should just load and i need to fill it up with objects and steps."*
//
// The demonstration is not gone, it moved: `test/startup.test.js` builds it as
// a fixture and opens it the way a person would, through the file control. So
// the tests still exercise a real strip and the app carries no content.

/**
 * The film strip.
 *
 * **A step is a piece of film and it stands at its own place on the strip**, so
 * moving from one step to the next moves the world past the camera rather than
 * changing the weather where you already are. Piece `k` is centred at
 * `pieceX(k)`, which is what `restage` below turns a step's framing into.
 *
 * `width` has to hold a scene; `gap` is the join, and it is what stops two
 * pieces reading as one long floor.
 */
const PIECE = DEFAULT_PIECE;

// Nothing placed and no film yet. Both are read as ordinary state everywhere
// else, so there is no empty case to special-case: an empty day is a place at a
// time that can be looked at, lit and walked around before anything exists.
const PLACEMENTS = [];
const ROUTE = [];

const SCARS = { extent: 60, resolution: 256, feather: 7 };
const SOLIDIFY = 900;   // milliseconds for a ghost to become real

const canvas = document.getElementById('stage');
const flash = document.getElementById('flash');
const hud = document.getElementById('hud');
const toast = document.getElementById('toast');
/**
 * An element, or a useful complaint.
 *
 * Reaching for a control that is not in the markup used to surface as "cannot
 * read properties of null", several frames away from the line that caused it
 * and naming nothing. Renaming and removing controls is ordinary work, so the
 * failure has to say which id, and where to look.
 */
const el = (id) => {
  const node = document.getElementById(id);
  if (node) return node;
  const error = new Error(
    `The page has no element with id "${id}".\n\n`
    + 'Something in the code is reaching for a control that is not in the\n'
    + 'markup. It was probably renamed or removed and this reference was left\n'
    + `behind. Either add an element with id "${id}", or delete whatever is\n`
    + 'still asking for it.'
  );
  error.missingId = id;
  throw error;
};

let toastTimer;
function say(message) {
  toast.textContent = message;
  toast.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('on'), 1800);
}

async function loadJson(path) {
  const url = new URL(`./models/${path}`, location.href).href;
  let response;
  try {
    response = await fetch(url);
  } catch (cause) {
    throw new Error(`could not reach ${url}\n(${cause.message})`);
  }
  if (!response.ok) {
    throw new Error(`${url}\nreturned ${response.status} ${response.statusText}.`
      + `\n\nThe file exists on disk, so the server is almost certainly rooted in`
      + `\nthe wrong folder. Serve the trail folder itself.`);
  }
  return response.json();
}

const loadRecipe = (name) => loadJson(`${name}.json`);

/** Text, for a mesh and the file naming its colours. */
async function loadText(path) {
  const response = await fetch(new URL(`./models/${path}`, location.href).href);
  return response.ok ? response.text() : null;
}

/** Bytes, for a pack rather than a description. */
async function loadBytes(path) {
  const url = new URL(`./models/${path}`, location.href).href;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * A glTF model, as triangles.
 *
 * A `.glb` carries its numbers inside it and is one request. A `.gltf` keeps
 * them in a companion `.bin` named in the document, which has to be fetched
 * separately and relative to the model rather than to the page, because a pack
 * puts every model and every buffer in one folder together.
 */
async function loadMesh(source, pose = null) {
  // A pose and a set of tint slots travel with the model, so a rigged
  // character can be read once per pose and come out as an ordinary,
  // recolourable, entirely static object.
  const how = { name: source.file, pose: pose ?? null, slots: source.slots ?? null };
  if (source.kind === 'glb') {
    const { json, binary } = readGlb(await loadBytes(source.file));
    return { mesh: readGltf(json, [binary], how), clips: clipNames(json) };
  }
  const json = await loadJson(source.file);
  const folder = source.file.slice(0, source.file.lastIndexOf('/') + 1);
  const buffers = await Promise.all(externalBuffers(json).map(
    (uri) => (uri ? loadBytes(folder + uri) : null)
  ));
  return { mesh: readGltf(json, buffers, how), clips: clipNames(json) };
}

// --- textures ---------------------------------------------------------------
//
// 184 of the library's models keep their colour in a texture and nowhere else,
// so without this they are painted from a guess at their material's name - which
// is how the Zombie kit's four named characters came out as one flat hash colour
// each. Sampling gives them the colours their artist chose.
//
// Where each image lives is manifest data, written by `npm run scan`, because a
// model's own statement about it cannot be followed: two packs name a path from
// the machine they were exported on and a third names a file that is not in its
// own folder. Finding it means listing a directory, which a static server will
// not do, so the question is settled once by a tool rather than guessed at here.

/** Pack folder to the images it holds, by lower-case filename. */
const textureIndex = new Map();

// A decoded picture is worth keeping: one atlas serves sixty models, and a
// single building asks for eleven images. It is only ever a saving, though -
// every colour it produces is baked into the model's geometry at import - so
// this is capped by weight and the oldest goes first. Dropping one costs a
// decode and can never cost a colour.
const TEXTURE_BUDGET = 24 * 1024 * 1024;
const textures = new Map();
let textureWeight = 0;

function keepTexture(key, image) {
  textures.set(key, image);
  textureWeight += image ? image.pixels.length : 0;
  while (textureWeight > TEXTURE_BUDGET && textures.size > 1) {
    const [oldest, dropped] = textures.entries().next().value;
    if (oldest === key) break;
    textures.delete(oldest);
    textureWeight -= dropped ? dropped.pixels.length : 0;
  }
  return image;
}

/**
 * The picture behind each of a model's textures, in the order it asked for them.
 *
 * A missing or unreadable image is null rather than an error, and `paint` leaves
 * those faces the colour they already had. A model that cannot find its texture
 * should look like it did yesterday, not fail to appear.
 */
async function picturesFor(mesh, file) {
  const folder = file.split('/')[0];
  const index = textureIndex.get(folder) ?? {};

  return Promise.all((mesh.images ?? []).map(async (image) => {
    // Carried inside the document, which is what the Zombie kit's glTF does:
    // nothing to find and nothing to fetch.
    const key = image.bytes ? `${file}#${image.name}` : index[String(image.uri ?? '').toLowerCase()];
    if (!key) return null;
    if (textures.has(key)) {
      // Read again so it counts as recently used, which is what keeps the
      // atlas a whole pack shares from being dropped for a one-off.
      const held = textures.get(key);
      textures.delete(key);
      textures.set(key, held);
      return held;
    }
    try {
      const bytes = image.bytes ?? await loadBytes(key);
      // Held at 512 rather than the 2048 a pack ships. The question a face asks
      // is what colour it is, which a smaller picture answers identically, and
      // holding a dozen at full size is forty megabytes. An atlas that is
      // already small is untouched, which matters: shrinking one bleeds a
      // neighbouring island's colour across an edge.
      return keepTexture(key, reduce(readPng(bytes, { name: image.name }), 512));
    } catch (error) {
      say(`${image.name}: ${error.message}`);
      return keepTexture(key, null);
    }
  }));
}

/** The same model, painted from its textures wherever it has them. */
async function painted(mesh, file) {
  if (!mesh.images?.length) return mesh;
  const done = paint(mesh, await picturesFor(mesh, file));
  if (!done.painted) return done;
  // A model carries one byte per vertex indexing a palette of 255, and a detail
  // texture can hand back several hundred shades of one brown. Left alone,
  // everything past the last palette entry collapses onto whichever colour
  // happened to be there.
  return { ...done, colours: quantise(done.colours, 250) };
}

async function main() {
  const renderer = createRenderer(canvas);

  // What the library holds is a manifest, not a list in the code, so adding a
  // model is a file and a line of data.
  const manifest = await loadJson('index.json');

  /**
   * Where each pack's textures actually are, settled by `npm run scan`.
   *
   * Without it a model states a filename that is not beside it and nothing can
   * follow. Called from `begin` rather than run here, because everything above
   * `begin` is a declaration and nothing above it runs.
   */
  function indexTextures() {
    for (const download of manifest.downloads ?? []) {
      if (download.images) textureIndex.set(download.folder, download.images);
    }
  }
  // Only recipes are fetched as recipes. The arrangement may also name models
  // from a pack, and those are listed by `loadPacks` and read when they are
  // first wanted - asking for one as a `.json` here would simply 404.
  const wanted = [...new Set(manifest.recipes)];
  const recipes = Object.fromEntries(
    await Promise.all(wanted.map(async (n) => [n, await loadRecipe(n)]))
  );

  // Cube size is a property of each recipe. This multiplies all of them at once
  // so the right chunkiness can be found by eye rather than by guessing, and
  // then written back into the models.
  let cubeScale = 1;
  let extent;
  let grids = {};
  let scene;
  let boxes = [];
  // Models drawn in a voxel editor and dropped onto the page. They live beside
  // the recipes and nothing downstream can tell the difference.
  const imported = {};
  // Models read from a .vox file but not yet converted. A pack is often one
  // file with hundreds inside, and most of them will never be placed.
  const sources = {};

  // A working copy, because objects get moved around and the original list is
  // only the starting arrangement.
  // Only the parts of the arrangement that can be built right now. Models from
  // a pack are listed after the first frame, and the rest of the arrangement
  // arrives with them - see `loadPacks` below. Starting with the whole thing
  // would send the first rebuild down its "this model is missing" path before
  // the page has finished setting itself up.
  let layout = PLACEMENTS
    .filter((p) => manifest.recipes.includes(p.model))
    .map((p) => ({ ...p, at: [...p.at] }));
  let route = ROUTE.map((s) => ({ ...s, framing: { ...s.framing } }));
  // Named rectangles of ground. Not objects: they have no model and no height,
  // and they are drawn into the floor rather than standing on it.
  let areas = [];

  let surface = 'mesh';     // 'cubes' | 'mesh'
  // No relaxation and no averaged normals. Together those two produce a crisp
  // faceted solid; either one on its own is what made it look like putty.
  let roundness = 0;
  let smoothing = 0;

  /**
   * Turn the same voxel grids into a smooth surface.
   *
   * Nothing about authoring changes: recipes still describe solids and the
   * voxeliser still produces a grid. Only what is drawn is different, and the
   * cubes stay uploaded so the two can be compared with one key.
   */
  /**
   * What a placement is actually made of.
   *
   * A rigged model in one pose is different geometry from the same model in
   * another, so everything that caches by model has to cache by pose as well:
   * the grid, the converted mesh, the preview. The library name stays what the
   * object says it is, and this is only ever a key.
   */
  const keyOf = (model, pose) => (
    pose?.clip ? `${model}@${pose.clip}@${pose.time ?? 0}` : model
  );
  const keyFor = (placement) => keyOf(placement.model, placement.pose);

  /** The pose an object is in, or the one its model starts in. */
  const poseOf = (placement) => placement.pose ?? sources[placement.model]?.pose ?? null;

  const meshCache = new Map();
  // A drawn preview, kept so reopening the library is instant. Declared here
  // rather than beside the panel that fills it, so that the code which releases
  // a model can reach every cache it remains in - a function reading a
  // constant declared four hundred lines later is how this page has broken
  // three times.
  const thumbs = new Map();

  /**
   * Everything on the strip is solid, all of the time.
   *
   * **Being somewhere else is what hiding means now.** An object belongs to a
   * piece of the film and that piece stands in its own place, so a thing that is
   * not happening here is not faded out - it is further along the strip, behind
   * the camera or out of the shot.
   *
   * The ghost has to go rather than merely being unused, because it fights the
   * ending: the overview draws every piece at once, and a ghost is an object
   * washed most of the way into the sky. Two thirds of the film would be a
   * smear. `from` is kept on a placement and now says **which piece it belongs
   * to**, which is what version 5 makes explicit.
   */
  const solid = (placement) => ({ ...placement, from: 0, until: 9999 });

  function remesh() {
    // Only what is on the canvas, and only once per model. Meshing every grid
    // meant the whole library, which grows as previews are drawn, and meshing
    // it again on every frame of a drag.
    const meshes = {};
    for (const p of layout) {
      const key = keyFor(p);
      if (meshes[key]) continue;
      let built = meshCache.get(key);
      if (!built) {
        // A model that arrived as a mesh is drawn as the mesh it is. Only the
        // hand-authored recipes, which are described as solids and carry tint
        // slots and pivots, still go round by way of cubes.
        built = imported[key]?.drawn ?? surfaceNets(grids[key], { roundness });
        meshCache.set(key, built);
      }
      meshes[key] = built;
    }
    const merged = assembleMeshes(
      // The palette travels with whichever geometry was used, so the two paths
      // cannot disagree about which colour a face is.
      layout.map((p) => ({
        mesh: meshes[keyFor(p)],
        grid: meshes[keyFor(p)]?.palette
          ? { palette: meshes[keyFor(p)].palette }
          : grids[keyFor(p)],
        ...solid(p),
      }))
    );
    renderer.uploadMesh(merged);
    el('s-tris').textContent = merged.triangles.toLocaleString();
    return merged;
  }

  /**
   * Where the objects sit on the ground.
   *
   * Shadows are placed from the objects' own boxes, so they have to follow
   * anything that moves. This used to live inside the mesh rebuild, which meant
   * a dragged object left its shadow behind whenever the cubes were showing.
   */
  function refreshShadows() {
    renderer.uploadShadows(contactShadows(scene, layout.map(solid)));
  }

  /**
   * The grid for one model, built the first time it is wanted.
   *
   * Drawn models come in already voxelised, so they only need re-scaling and
   * hollowing. Re-anchoring is what makes the block size slider reach them.
   */
  function gridFor(key) {
    if (grids[key]) return grids[key];
    if (recipes[key]) {
      const recipe = recipes[key];
      grids[key] = hollow(voxelise({ ...recipe, unit: recipe.unit * cubeScale }));
      return grids[key];
    }
    const grid = imported[key];
    if (!grid) return null;
    grids[key] = hollow(reanchor({ ...grid, unit: grid.baseUnit * cubeScale }, grid.anchor));
    return grids[key];
  }

  // What the grids and meshes were built at. Only the grain changes them, so
  // only the grain is a reason to throw them away.
  let grain = null;

  function rebuild() {
    /**
     * **Only rebuild what the grain changed.**
     *
     * This used to empty `grids`, re-voxelise every recipe and re-hollow and
     * re-anchor **every model that had ever been converted** - which is every
     * model browsed in the library, not just the ones on the canvas - and then
     * clear the mesh cache so every object had to be meshed again. On every
     * change. Placing one object rebuilt the entire world, which is the few
     * seconds of stutter after adding something.
     *
     * Nothing about an existing model changes when another is placed. Only the
     * block size and the roundness do, so they are the only reason to start
     * again; everything else builds what is newly wanted and keeps the rest.
     */
    const want = `${cubeScale}|${roundness}`;
    if (grain !== want) {
      grids = {};
      meshCache.clear();
      grain = want;
    }
    for (const p of layout) gridFor(keyFor(p));
    // An entry whose model is not loaded would leave layout, scene.ranges and
    // boxes out of step, and a drag would then move the wrong object and write
    // over its neighbour's cubes. Drop it rather than carry a hole.
    const missing = layout.filter((p) => !grids[keyFor(p)]).map((p) => p.model);
    if (missing.length) {
      layout = layout.filter((p) => grids[keyFor(p)]);
      state.selected = -1;
      say(`left out ${[...new Set(missing)].join(', ')}: not in the library`);
    }
    // Guarded, so calling it from everything that rebuilds the world costs a
    // string compare and cannot be forgotten by one caller.
    refreshStrip();
    scene = assemble(layout.map((p) => ({ grid: grids[keyFor(p)], ...solid(p) })));
    renderer.upload(scene);
    boxes = objectBoxes(scene);
    extent = bounds(scene);
    el('s-cubes').textContent = scene.count.toLocaleString();
    remesh();
    refreshShadows();
    return scene;
  }

  /**
   * Move or turn one object, rewriting only its own cubes.
   *
   * The cube count cannot change - it is the same grid either way - so the
   * object keeps its slice of the buffers and the rest of the field is left
   * alone entirely.
   */
  function reposition(index, placement) {
    const swapped = keyFor(layout[index]) !== keyFor(placement);
    layout[index] = placement;
    // A different model has a different number of cubes, so its slice of the
    // buffers no longer fits and the whole field has to be built again.
    if (swapped) { rebuild(); autosave(); return; }
    const part = place(grids[keyFor(placement)], placement);
    const range = scene.ranges[index];
    // If the slice no longer fits, writing into it would overwrite the next
    // object's cubes. That is what made a dragged figure turn into half a tree.
    if (!range || part.count !== range.count) { rebuild(); autosave(); return; }
    scene.positions.set(part.positions.subarray(0, range.count * 3), range.start * 3);
    renderer.updatePositions(scene.positions, range.start, range.count);
    boxes = objectBoxes(scene);
    // The surface and the shadows are both built from placements, so both have
    // to follow. Shadows regardless of which way the field is being drawn.
    if (surface === 'mesh') remesh();
    refreshShadows();
    autosave();
  }

  // Recomputed when a canvas is opened, since a different route runs for a
  // different length of time.
  let duration = routeDuration(route) / 1000;

  // --- state ----------------------------------------------------------------
  // Roaming and the route produce the same kind of value, so switching between
  // them is a matter of which framing is current, not two camera systems.
  const state = {
    /**
     * **Opens paused, because there is nothing to play.**
     *
     * It used to open playing, which had two costs. A take running from the
     * first frame means a restored canvas starts scrubbing itself the moment it
     * loads, which nobody asked for. Worse, the hour is applied to the sky
     * inside the branch that runs while paused - so on load the sky was lit by
     * a bare weather preset carrying no time of day at all, which against a
     * space-black sky is a black screen until you touch something.
     */
    playing: false,
    clock: 0,
    pinned: null,
    /**
     * **How the camera is looking, and nothing about where it is.**
     *
     * Where it is comes from the strip, always. Before this there was a second
     * answer - a free framing the camera fell back to the moment you dragged -
     * and the two fought: cycling through the steps stopped moving the world,
     * and clicking snapped the view back to wherever the free camera had been
     * left. Reported as "the cycling through steps is busted".
     *
     * One place for the composition, one for the position, and they never
     * disagree because only one of them exists.
     */
    rig: { yaw: -8, pitch: 20, width: 26, height: 0 },
    selected: -1,
    forcedWeather: null,
    // True while a line is being traced for the selected object to walk.
    tracing: false,
    // True while a rectangle is being dragged out for a named place.
    drawingArea: false,
    // When the shot being watched began, so a camera move that was asked for
    // is measured from the start of its own shot rather than from wall time.
    shotAt: null,
    // **The hour is a property of the world, not of the route.** It is always a
    // number, so an empty canvas is a place at a time of day that can be looked
    // at, lit and walked around before a single step exists. Steps are added to
    // a playground rather than being the thing that makes one.
    hour: 12,
    // Whether the clock is being driven by hand rather than by playback.
    scrubbing: false,
    // The weather of the playground: what the world looks like where no step
    // says otherwise. A step's own weather wins wherever one applies.
    weather: 'clear',
    // The two moves the camera can make on its own. On the camera rather than
    // on a step, because nothing the clock does may take the view away from
    // whoever is composing it.
    orbit: 0,
    push: 0,
    // **The whole film at once.** Not a place on the strip but a way of looking
    // at it, so turning it off puts the camera back exactly where it was.
    overview: false,
    /**
     * How far the film is rolled into its ring, and how far it is going.
     *
     * **The two views are one geometry.** Halo mode is the strip rolled into a
     * loop with the piece you are on at the top; the overview is the same strip
     * lying flat. So the overview is not a second view, it is this number
     * easing to nought - the ball unfurling into a long straight piece.
     */
    roll: 1,
    rollTo: 1,
    /**
     * Where the clock is going, when it was told to go somewhere.
     *
     * Dragging the bar is direct - the hour follows the hand and nothing eases,
     * because an animation fighting a drag feels broken. **Asking** for a piece
     * is different: pressing an arrow or picking one off the list should turn
     * the ring to it rather than cutting to it, so those set a target and this
     * is eased toward it.
     */
    hourTo: null,
    // A hoop you can see through, or a filled body. A look, so it is a switch.
    solid: 0,
    /**
     * The angle the whole film is read from, kept apart from the working shot.
     *
     * Low enough to be looking **at** the ring rather than down on it, and
     * turned off square so the strip runs across the frame instead of straight
     * away from the camera. Straight down read as a diagram; this reads as an
     * object on a table.
     */
    wide: { yaw: -24, pitch: 34 },
    /**
     * How big the ground under a piece is drawn, as a multiple of the piece.
     *
     * **Only what you can see of the ground.** How far apart pieces stand is
     * the pitch, and every position on the film is measured against it, so it
     * cannot move without taking every object on the strip with it. This is
     * free to be any size because nothing is measured against it.
     */
    plate: 1,
  };

  /**
   * The route as it stands on the strip.
   *
   * **This is what makes the film move.** A step's framing says how it is
   * looked at - how wide, how high, which way round - and its place in the film
   * says where. So going from step 1 to step 2 travels the width of a piece,
   * and the world slides past a camera that is only ever turning.
   *
   * Before this, every step framed the same patch of ground and the only thing
   * that changed between them was the weather, which is what the user reported:
   * *"when i go from step 1 to step 2, its the same step just a different
   * weather."*
   *
   * Kept as a second array rather than rewritten into `route`, because where a
   * piece stands is derived from its position in the film. Recomputing it is
   * always right; storing it would let the two disagree the moment a step is
   * added, removed or dragged to another time.
   */
  let staged = [];

  /**
   * The staged route, rebuilt if anything has changed the real one without
   * saying so.
   *
   * A derived array that has to be refreshed by hand is exactly the shape of
   * bug this project has now been caught by four times: code left pointing at
   * something that had moved. The guard costs one comparison a frame and makes
   * forgetting `restage()` impossible rather than merely unlikely.
   */
  function onStrip() {
    if (staged.length !== route.length) restage();
    return staged;
  }

  /** How big the loop is for the film as it stands. */
  const ringSize = () => radiusFor(Math.max(1, route.length), PIECE);

  /**
   * Put the film on screen, if what it should look like has changed.
   *
   * **Guarded rather than called from the right places**, because it was not
   * called from all of them: opening a canvas rebuilt the world and never told
   * the renderer how many pieces there were, so a restored film had no ground
   * under it until a step was added and something else happened to refresh it.
   *
   * That is the third derived thing in this app to go stale by being refreshed
   * by hand - `staged` and the grids were the others - and the answer is the
   * same each time. Comparing is cheap; remembering is not reliable.
   */
  let filmShape = '';
  function refreshStrip() {
    const want = `${route.length}|${state.plate}|${PIECE.width}|${PIECE.depth}|${PIECE.gap}`;
    if (want === filmShape) return;
    filmShape = want;
    renderer.uploadStrip(route.length, {
      pitch: pitchOf(PIECE),
      width: PIECE.width * state.plate,
      depth: PIECE.depth * state.plate,
    });
  }

  /**
   * Where on the film the camera is pointed, in flat strip coordinates.
   *
   * **This is what turns when the clock moves.** In Halo mode the camera never
   * goes anywhere: this is handed to the shader as the place that should be at
   * the top of the ring, and the world rotates to bring it there.
   */
  /** Where the clock is on the film, in flat strip coordinates. */
  function clockX() {
    const moment = routeAtHour(onStrip(), state.hour);
    if (moment) return centreOf(moment.framing)[0];
    return xAt(editing(), PIECE);
  }

  function focusX() {
    // The middle of the whole film, which is what the overview turns about.
    const middle = xAt((Math.max(1, route.length) - 1) / 2, PIECE);
    const here = clockX();
    /**
     * **Blended by the roll, because it is the pivot the world turns about.**
     *
     * This used to switch the moment the overview was toggled: the point the
     * ring is rolled around jumped from the piece in front of you to the middle
     * of the film, so the whole world swung sideways in one frame and *then*
     * unrolled. That is the whip - the animation was fine and the thing it was
     * animating about had already moved.
     *
     * `state.roll` is continuous, so anything derived from it is too.
     */
    return pivotAt(here, middle, state.roll);
  }

  function restage() {
    // **One composition for the whole film.** Every piece is looked at the same
    // way and stands in its own place, so moving between them is travel rather
    // than a cut to a different shot. A framing per step was the old camera
    // language, and it is what made a step a shot instead of a moment.
    staged = route.map((step, index) => ({
      ...step,
      framing: framingOf(state.rig, index, PIECE),
    }));
  }

  /** Where the camera is when there is no film yet: the first piece. */
  const emptyFraming = () => framingOf(state.rig, 0, PIECE);

  /**
   * Change how the camera is looking, keeping where it is.
   *
   * The orbit functions all take a framing and return one, so they are handed
   * the shot as it stands and the rig is read back out of the result. That
   * keeps the tested pure code in use and means a drag can never move the
   * camera off its piece - which is the whole of "fixed camera, moving canvas".
   */
  function adjustCamera(change) {
    const before = currentRoute().framing;
    const after = change(before);

    /**
     * **The overview has its own angle, and the working shot is left alone.**
     *
     * This used to write whatever was on screen back into the one rig, so
     * turning or zooming while pulled back banked the overview's width - which
     * is the width of the whole film - into the shot you were composing. Coming
     * back out of the overview then left you as wide as the overview had been,
     * which reads as never having left it.
     *
     * The width is not taken here at all: the overview is fitted to the film,
     * so a zoom has nothing to change. What it does have is an angle, and
     * remembering that separately is what lets it be looked at from the side
     * without disturbing where you were working.
     */
    if (state.overview) {
      state.wide = {
        yaw: after.yaw ?? state.wide.yaw,
        pitch: after.pitch ?? state.wide.pitch,
      };
      return;
    }

    state.rig = {
      yaw: after.yaw ?? state.rig.yaw,
      pitch: after.pitch ?? state.rig.pitch,
      width: after.w ?? state.rig.width,
      // **Only when the change actually moved it.** A framing's `y` carries the
      // lift that keeps the eye above the ground when the camera is tilted up,
      // so reading it back in unconditionally would bank that lift into the rig
      // and the camera would ratchet upward a little on every tilt.
      height: after.y !== before.y ? after.y : state.rig.height,
    };
    restage();
  }

  /**
   * The whole film at once, which is what the overview button asks for.
   *
   * Fitted to the pieces **and** to what has actually been placed, because an
   * object dropped past the edge of its piece is still part of the film. The
   * bounds come from the built scene, so this is where things are rather than
   * where they were meant to be.
   */
  function overviewFraming() {
    const placed = Number.isFinite(extent?.min?.[0])
      ? { min: extent.min[0], max: extent.max[0] }
      : null;
    return revealFraming(
      { ...state.wide, width: state.rig.width, height: 0 },
      Math.max(1, route.length),
      PIECE,
      { include: placed, pitch: state.wide.pitch },
    );
  }

  function currentRoute() {
    // The whole film, from far enough back to read it as one. Deliberately
    // outranks the step being shown: it is a way of looking at the strip, not a
    // place on it, so leaving it puts you back exactly where you were.
    if (state.overview) {
      return { framing: overviewFraming(), step: editing(), phase: 'held', into: 1 };
    }
    // An empty day is the first piece of a film with nothing on it yet, which
    // is where every canvas starts.
    if (!route.length) {
      return { framing: emptyFraming(), step: 0, phase: 'held', into: 1 };
    }
    return state.pinned === null
      ? routeAt(onStrip(), state.clock)
      : { framing: onStrip()[state.pinned].framing, step: state.pinned, phase: 'held' };
  }

  /**
   * Take the camera by hand.
   *
   * **It no longer takes the camera anywhere.** Free roaming was a second
   * position for the camera to be in, and having two was the bug: a drag moved
   * the camera off the strip, and from then on cycling through the steps
   * changed nothing on screen. All this does now is stop playback, because a
   * take that carries on while you are composing is fighting you.
   */
  function roam() {
    state.playing = false;
  }

  function toRoute() {
    state.playing = true;
  }

  // --- pointer --------------------------------------------------------------

  let drag = null;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  /**
   * Where a ray meets the ground, in **strip** coordinates.
   *
   * Everything that places, drags or draws works on the flat film - that is
   * where objects live and where they are saved - so a click has to be read
   * back onto it. Rolled, the ground is the ring's surface and the answer comes
   * from `ringGround`; flat, it is the plane it always was.
   *
   * Part rolled, during an unfurl, the ring's answer is used: the surface it
   * describes is the one being looked at for all but the last moment of the
   * blend, and nobody places an object mid-animation.
   */
  function groundAt(ray, height = 0) {
    if (!ray) return null;
    if (state.roll > 0.5) return ringGround(ray, clockX(), ringSize());
    return groundPoint(ray, height);
  }

  /** The ray under the pointer, or null if the pointer is in the letterbox. */
  function rayAt(event) {
    const rect = canvas.getBoundingClientRect();
    const view = renderer.view.css;
    const ndc = toNdc(
      event.clientX - rect.left - view.x,
      event.clientY - rect.top - view.y,
      { x: 0, y: 0, w: view.w, h: view.h },
    );
    if (!insideFrame(ndc)) return null;
    const framing = currentRoute().framing;
    return rayThrough(framing, ndc);
  }

  // --- places -----------------------------------------------------------------
  //
  // A rectangle of ground with a name on it: the bar, the car park, the golf
  // course. It is a **place**, not an object, and that distinction is the whole
  // design: it has no model, no cubes and no height, it is drawn into the
  // ground rather than standing on it, and it is named by the same layer that
  // names people. It costs one instanced quad each and nothing per frame.
  //
  // It carries a step range like everything else, so a place arrives with the
  // part of the story that happens in it.

  // Enough different colours that neighbouring places are told apart at a
  // glance, and all of them muted, because a place is a wash on the ground
  // rather than a thing to look at.
  const PLACE_TINTS = [
    [0.86, 0.62, 0.34], [0.42, 0.68, 0.86], [0.52, 0.78, 0.48],
    [0.84, 0.48, 0.56], [0.72, 0.60, 0.86], [0.90, 0.82, 0.42],
  ];

  function uploadAreas() {
    const count = areas.length;
    const centres = new Float32Array(count * 3);
    const halves = new Float32Array(count * 2);
    const tints = new Float32Array(count * 3);
    const fromStep = new Float32Array(count);
    const untilStep = new Float32Array(count);
    areas.forEach((place, i) => {
      centres[i * 3] = place.at[0];
      centres[i * 3 + 2] = place.at[1];
      halves[i * 2] = Math.abs(place.size[0]) / 2;
      halves[i * 2 + 1] = Math.abs(place.size[1]) / 2;
      const tint = PLACE_TINTS[i % PLACE_TINTS.length];
      tints[i * 3] = tint[0]; tints[i * 3 + 1] = tint[1]; tints[i * 3 + 2] = tint[2];
      // Always on, like everything else on the strip. A named patch of ground
      // belongs to the piece it was drawn on, and that piece stands somewhere.
      fromStep[i] = 0;
      untilStep[i] = 9999;
    });
    renderer.uploadAreas({ centres, halves, tints, fromStep, untilStep, count });
  }

  /** One row per place, built from the data rather than written into the markup. */
  function paintAreas() {
    const host = el('areas');
    host.innerHTML = '';
    if (!areas.length) {
      const empty = document.createElement('div');
      empty.className = 'row';
      empty.innerHTML = '<span class="dim">none yet</span>';
      host.appendChild(empty);
      return;
    }
    areas.forEach((place, i) => {
      const row = document.createElement('div');
      row.className = 'row';

      const name = document.createElement('input');
      name.type = 'text';
      name.value = place.label ?? '';
      name.placeholder = 'the bar';
      name.maxLength = 24;
      name.addEventListener('input', () => {
        const label = name.value.trim();
        if (label) place.label = label; else delete place.label;
        autosave();
      });

      const gone = document.createElement('button');
      gone.className = 'btn';
      gone.textContent = 'remove';
      gone.addEventListener('click', () => {
        areas.splice(i, 1);
        uploadAreas();
        paintAreas();
        autosave();
      });

      row.appendChild(name);
      row.appendChild(gone);
      host.appendChild(row);
    });
  }

  el('b-area').addEventListener('click', () => {
    state.drawingArea = true;
    canvas.classList.add('tracing');
    say('drag a rectangle on the ground, then name it');
  });

  // --- tracing where an object goes -----------------------------------------
  //
  // Drag a line on the ground and the selected object walks it: it starts where
  // the line starts and ends where it ends, travelling across the flight into
  // whichever step is pinned.
  //
  // **Nothing about the field stops being static.** The object is uploaded once,
  // at the start of its line, and the vertex shader adds an offset from two
  // numbers that travelled with it. No processor work per frame, no work per
  // cube, one draw call as before. See `travelOf` in `scene.js`.

  function paintPath() {
    const chosen = state.selected >= 0 ? layout[state.selected] : null;
    const path = chosen?.path;
    el('s-path').textContent = !chosen ? 'nowhere'
      : path ? `to ${path.to[0].toFixed(1)}, ${path.to[1].toFixed(1)} on step ${(path.step ?? 0) + 1}`
        : 'nowhere';
    el('b-path').disabled = !chosen;
    el('b-path-clear').disabled = !chosen?.path;
  }

  el('b-path').addEventListener('click', () => {
    if (state.selected < 0) { say('select an object first'); return; }
    state.tracing = true;
    canvas.classList.add('tracing');
    say(`drag a line on the ground: ${layout[state.selected].model} walks it on step ${editing() + 1}`);
  });

  el('b-path-clear').addEventListener('click', () => {
    if (state.selected < 0) return;
    delete layout[state.selected].path;
    rebuild();
    paintPath();
    autosave();
    say('it stays where it is');
  });

  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId);
    const ray = rayAt(event);
    const hit = ray ? pick(ray, boxes) : null;

    // Drawing a place beats everything else: the button was pressed to draw
    // one, and picking an object instead would be ignoring what was asked.
    if (state.drawingArea && ray) {
      const ground = groundAt(ray);
      if (ground) {
        drag = { x: event.clientX, y: event.clientY, moved: 0, object: null, place: [ground[0], ground[2]] };
        return;
      }
    }

    // A traced line beats everything else, including picking a different
    // object: the button was pressed to draw one and nothing else is wanted.
    if (state.tracing && state.selected >= 0 && ray) {
      const ground = groundAt(ray);
      if (ground) {
        drag = { x: event.clientX, y: event.clientY, moved: 0, object: null, trace: [ground[0], ground[2]] };
        return;
      }
    }

    // Dragging an object you have already selected moves it. Dragging anything
    // else moves the camera. One click to choose, then drag to arrange, so
    // orbiting never fights with rearranging.
    if (ray && hit && hit.index === state.selected) {
      const ground = groundAt(ray, layout[hit.index].at[1]);
      const at = layout[hit.index].at;
      drag = {
        x: event.clientX, y: event.clientY, moved: 0, object: hit.index,
        grab: ground ? [at[0] - ground[0], 0, at[2] - ground[2]] : [0, 0, 0],
      };
      canvas.classList.add('moving');
      return;
    }

    const panning = event.button === 1 || event.button === 2 || event.shiftKey;
    drag = { x: event.clientX, y: event.clientY, moved: 0, panning, object: null };
    canvas.classList.add(panning ? 'panning' : 'dragging');
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);

    if (drag.place) {
      const ray = rayAt(event);
      const ground = groundAt(ray);
      if (ground) drag.placeTo = [ground[0], ground[2]];
      return;
    }

    // While a line is being traced, the object stands at its start so the
    // length and direction can be judged against the world rather than guessed.
    if (drag.place) {
      const from = drag.place;
      const to = drag.placeTo;
      state.drawingArea = false;
      canvas.classList.remove('tracing');
      drag = null;
      const w = to ? Math.abs(to[0] - from[0]) : 0;
      const d = to ? Math.abs(to[1] - from[1]) : 0;
      // A rectangle with no area is a click, and a click is how you change your
      // mind about having pressed the button.
      if (w < 0.5 || d < 0.5) { say('nothing drawn - drag a rectangle rather than clicking'); return; }
      areas.push({
        at: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2],
        size: [w, d],
        label: '',
        from: editing(),
      });
      uploadAreas();
      paintAreas();
      autosave();
      say(`a place ${w.toFixed(1)} by ${d.toFixed(1)} - give it a name in the panel`);
      return;
    }

    if (drag.trace) {
      const ray = rayAt(event);
      const ground = groundAt(ray);
      if (ground) drag.traceTo = [ground[0], ground[2]];
      return;
    }

    if (drag.object !== null) {
      const ray = rayAt(event);
      if (!ray) return;
      const ground = groundAt(ray, layout[drag.object].at[1]);
      reposition(drag.object, dragTo(layout[drag.object], drag.grab, ground));
      return;
    }

    // **Turn on the spot, never travel.** Panning used to drag the camera
    // across the ground with the right button; there is nowhere to pan to now,
    // because where the camera stands is the piece of film in front of it.
    roam();
    adjustCamera((f) => orbit(f, -dx * 0.32, dy * 0.26));
  });

  const endDrag = (event) => {
    if (!drag) return;

    if (drag.trace) {
      const from = drag.trace;
      const to = drag.traceTo;
      const chosen = state.selected >= 0 ? layout[state.selected] : null;
      state.tracing = false;
      canvas.classList.remove('tracing');
      drag = null;

      // A line with no length is a click, and a click is how you change your
      // mind about having pressed the button.
      const length = to ? Math.hypot(to[0] - from[0], to[1] - from[1]) : 0;
      if (!chosen || length < 0.25) {
        say('nothing traced - drag a line rather than clicking');
        paintPath();
        return;
      }

      // The object stands at the start of its line and walks to the end. Both
      // ends come from one gesture, which is what "trace where it goes" means.
      chosen.at = [from[0], chosen.at[1] ?? 0, from[1]];
      chosen.path = { to: [to[0], to[1]], step: editing() };
      rebuild();
      paintPath();
      autosave();
      say(`${chosen.model} walks ${length.toFixed(1)} units on step ${editing() + 1}`);
      return;
    }

    // A press that did not really move is a click, and a click chooses.
    if (drag.moved < 5 && drag.object === null) {
      const ray = rayAt(event);
      const hit = ray ? pick(ray, boxes) : null;
      select(hit ? hit.index : -1);
    }
    drag = null;
    canvas.classList.remove('dragging', 'panning', 'moving');
    if (event && canvas.hasPointerCapture?.(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  /**
   * The colours a model leaves for someone else to fill in.
   *
   * A slot is a palette entry an artist marked as "decide this per placement".
   * The figure has three; the rigged character has two. Anything with none is
   * simply the colour it was drawn, and gets no controls.
   */
  function slotsOf(model) {
    const palette = imported[model]?.drawn?.palette ?? gridFor(model)?.palette ?? [];
    const found = new Map();
    for (const entry of palette) {
      // The model's own colour is the default, so an untinted placement looks
      // like the model rather than going grey.
      if (entry.slot && !found.has(entry.slot)) found.set(entry.slot, entry.hex ?? '#c8c8c8');
    }
    return found;
  }

  /**
   * Step the selected object through the poses its model holds.
   *
   * The poses are only known once the model has been read, which happens when
   * it is first placed - so the list is whatever the file turned out to carry
   * rather than anything written down here.
   */
  async function cyclePose(by) {
    if (state.selected < 0) return;
    const placement = layout[state.selected];
    const clips = sources[placement.model]?.clips ?? [];
    if (clips.length < 2) { say(`${placement.model} holds no other poses`); return; }

    const now = poseOf(placement);
    const at = clips.indexOf(now?.clip);
    const next = clips[(((at < 0 ? 0 : at + by) % clips.length) + clips.length) % clips.length];
    // Held a little way in, because the first frame of a clip is usually the
    // rest pose it eases out of rather than the thing the clip is named for.
    const pose = { clip: next, time: 0.5 };

    if (!await materialise(placement.model, pose).catch((error) => {
      say(`could not pose ${placement.model}: ${error.message}`);
      return null;
    })) return;

    reposition(state.selected, { ...placement, pose });
    paintPose();
    say(`${placement.model}: ${next}`);
  }

  /** The pose row, when the selected model has poses to offer. */
  function paintPose() {
    const host = el('poses');
    host.innerHTML = '';
    if (state.selected < 0) return;
    const placement = layout[state.selected];
    const clips = sources[placement.model]?.clips ?? [];
    if (clips.length < 2) return;

    const row = document.createElement('div');
    row.className = 'row';
    const label = document.createElement('span');
    label.className = 'dim';
    label.textContent = 'pose';
    const value = document.createElement('span');
    value.className = 'val';
    const now = poseOf(placement);
    value.textContent = `${now?.clip ?? 'rest'} (${Math.max(1, clips.indexOf(now?.clip) + 1)}/${clips.length})`;
    row.append(label, value);

    const buttons = document.createElement('div');
    buttons.className = 'row';
    for (const [text, by] of [['previous pose', -1], ['next pose', 1]]) {
      const button = document.createElement('button');
      button.className = 'btn';
      button.textContent = text;
      button.addEventListener('click', () => { cyclePose(by); });
      buttons.append(button);
    }
    host.append(row, buttons);
  }

  /** A colour picker per slot, rebuilt whenever the selection changes. */
  function paintTints() {
    const host = el('tints');
    host.innerHTML = '';
    if (state.selected < 0) return;
    const placement = layout[state.selected];
    const slots = slotsOf(placement.model);
    if (!slots.size) return;

    for (const [slot, fallback] of slots) {
      const row = document.createElement('div');
      row.className = 'row';
      const label = document.createElement('span');
      label.className = 'dim';
      label.textContent = slot;
      const picker = document.createElement('input');
      picker.type = 'color';
      picker.value = placement.tints?.[slot] ?? fallback;
      picker.addEventListener('input', () => {
        const object = layout[state.selected];
        if (!object) return;
        object.tints = { ...object.tints, [slot]: picker.value };
        // Colour lives in the buffers the scene was assembled into, so the
        // field has to be put together again. Which one depends on how it is
        // being drawn, the same as moving an object does.
        if (surface === 'mesh') remesh(); else rebuild();
        autosave();
      });
      row.append(label, picker);
      host.append(row);
    }
  }

  /**
   * The name that floats over an object.
   *
   * The layer that draws these has existed since the first build - it reads
   * `label` off a placement, fades it with distance and drops it entirely on a
   * wide shot - and there has never been a way to set one, so every figure in
   * every scene was anonymous unless the page source was edited. This is the
   * control it was missing, and nothing else had to change.
   */
  function paintLabel() {
    const chosen = state.selected >= 0 ? layout[state.selected] : null;
    const input = el('o-label');
    input.disabled = !chosen;
    if (document.activeElement !== input) input.value = chosen?.label ?? '';
    el('v-label').textContent = chosen ? (chosen.label || 'none') : '-';
  }

  el('o-label').addEventListener('input', () => {
    const chosen = state.selected >= 0 ? layout[state.selected] : null;
    if (!chosen) return;
    const name = el('o-label').value.trim();
    // Removed rather than left empty, so a canvas file says what is true: an
    // object either has a name or does not carry the field at all.
    if (name) chosen.label = name; else delete chosen.label;
    el('v-label').textContent = name || 'none';
    autosave();
  });

  function select(index) {
    state.selected = index;
    el('s-sel').textContent = index < 0 ? 'nothing' : layout[index].model;
    paintObject();
    paintPose();
    paintTints();
    paintLabel();
    paintPath();
    if (index >= 0) say(`${layout[index].model} selected - drag to move it`);
  }
  // Nothing is selected to begin with, and the panel says so in its markup.
  // Calling select() here would reach the object controls before they exist.

  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    roam();
    adjustCamera((f) => zoom(f, event.deltaY > 0 ? 1.12 : 1 / 1.12));
  }, { passive: false });

  // --- keys -----------------------------------------------------------------

  // Walking is held, not tapped. Keys set a direction; the frame loop moves the
  // camera by however much time has passed, with the velocity easing in and out
  // so starting and stopping is not a jolt.
  const WALK = {
    w: [1, 0], s: [-1, 0], a: [0, -1], d: [0, 1],
    arrowup: [1, 0], arrowdown: [-1, 0], arrowleft: [0, -1], arrowright: [0, 1],
  };
  const RISE = { q: -1, e: 1 };
  const WALK_SPEED = 0.85;   // frame widths per second
  const RISE_SPEED = 0.55;
  const WALK_EASE = 9;       // how quickly velocity catches up

  const held = new Set();
  const velocity = { forward: 0, right: 0, up: 0 };
  addEventListener('blur', () => held.clear());

  /**
   * Whether the keyboard belongs to something being typed into.
   *
   * Every letter on this page does something - `a` walks left, `r` restarts the
   * take - so a script box is unusable until the keys know to stay out of it.
   * Asked of the element rather than listed per control, because the next text
   * field to be added would otherwise have the same bug on its first day.
   */
  const typing = (event) => {
    const into = event.target;
    if (!into) return false;
    const tag = String(into.tagName ?? '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || !!into.isContentEditable;
  };

  addEventListener('keyup', (event) => {
    if (typing(event)) return;
    held.delete(event.key.toLowerCase());
  });

  // Climbing is q and e. It used to have a pair of buttons in the panel too,
  // and they went when the panel was cut back to camera keys only.

  addEventListener('keydown', async (event) => {
    const key = event.key.toLowerCase();

    // Nothing on this page is a shortcut while something is being written.
    // Escape is the way out, because a field with the keyboard and no way to
    // give it back is its own trap.
    if (typing(event)) {
      if (key === 'escape') event.target.blur?.();
      return;
    }

    if (WALK[key] || RISE[key]) {
      event.preventDefault();
      held.add(key);
      roam();
      return;
    }

    // Keys move the camera and drive the take. Everything that is a value -
    // roundness, cube size, shading, weather - is a control in the panel, so
    // there is one place to look for it rather than a legend to memorise.
    if (key === 'escape') {
      select(-1);
      return;
    }

    if (key === '[' || key === ']') {
      event.preventDefault();
      cycleSelected(key === ']' ? 1 : -1);
      return;
    }

    if ((key === 'delete' || key === 'backspace') && state.selected >= 0) {
      event.preventDefault();
      removeSelected();
      return;
    }

    if (key === 's' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      download();
      return;
    }

    if (key === ' ') {
      event.preventDefault();
      state.playing = !state.playing;
    } else if (key === 'f') {
      // The whole film, which is what "frame everything" means on a strip.
      roam();
      state.overview = !state.overview;
      state.rollTo = state.overview ? 0 : 1;
      el('b-overview').setAttribute('aria-pressed', String(state.overview));
      say(state.overview ? 'the whole film' : 'back to the strip');
    } else if (key === 'r') {
      state.clock = 0; state.pinned = null; toRoute(); sync();
    } else if (key === 'enter') {
      event.preventDefault();
      toggleFullscreen();
    } else if (key === 'd') {
      penMode(!ink.on);
    } else if (key === 'h') {
      const hiding = !hud.classList.contains('hidden');
      hud.classList.toggle('hidden', hiding);
      el('penui').classList.toggle('hidden', hiding);
    } else if (key >= '1' && key <= String(route.length)) {
      state.pinned = Number(key) - 1;
      leaveOverview();
      state.playing = false;
    }
  });

  // --- fullscreen -----------------------------------------------------------
  // The frame is always 16:9. A browser viewport is not, because tabs and the
  // address bar take a slice of the height, so the composition gets black bars
  // either side. Fullscreen makes the viewport the shape of the screen, and on
  // a 16:9 monitor the bars disappear entirely rather than being worked around.

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (error) {
      say(`fullscreen refused: ${error.message}`);
    }
  }

  document.addEventListener('fullscreenchange', () => {
    // Going fullscreen is what you do to record, and a recording should have no
    // interface in it. `h` brings the panel back if it is wanted.
    hud.classList.toggle('hidden', Boolean(document.fullscreenElement));
    if (!document.fullscreenElement) say('press enter for fullscreen');
  });

  // --- keeping the work -----------------------------------------------------
  // The canvas file is the whole state of a video. Autosaved to the browser so
  // a reload is never a loss, and saveable to disk so it can live next to the
  // script it belongs to.

  const STORE = 'trail.canvas';
  let scarredUpTo = -2;

  function current() {
    return serialise({
      layout,
      route,
      areas,
      look: { surface, roundness, smoothing, cubeScale },
      title: 'untitled',
    });
  }

  let saveTimer;
  // True once anything has been changed. Startup finishes asynchronously - the
  // packs load and only then is the opening arrangement applied - and it must
  // not lay that over work done while it was waiting.
  let edited = false;
  function autosave() {
    // **Anything saved is something you did**, and startup must not undo it.
    // The packs take a moment to load and the opening arrangement is applied
    // when they land, so an edit made in that window was being silently thrown
    // away - which looked exactly like the button not working.
    edited = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORE, JSON.stringify(current()));
      } catch {
        // A browser refusing storage costs the convenience and nothing else.
      }
    }, 400);
  }

  /**
   * Open a canvas.
   *
   * **Reads what the canvas names before building it.** A pack's models are
   * only *listed* in the manifest until something asks for one - that is what
   * keeps opening the page from converting hundreds of models - so a canvas
   * naming them has to ask first. Without it, `rebuild` finds no grid for any
   * of them and drops every one as "not in the library", and a saved canvas
   * opens as a handful of recipes and nothing else.
   *
   * The app used to get away with it because the arrangement it opened on named
   * the same two pack models every time, and startup read those. It opens empty
   * now, so this is the only thing standing between a saved canvas and being
   * quietly emptied.
   */
  async function apply(canvas) {
    // Opening a canvas is unambiguously something you did, so startup must not
    // lay the last autosave over it when the packs finish loading.
    edited = true;
    const wanted = canvas.layout.filter((p) => !recipes[p.model] && sources[p.model]);
    if (wanted.length) {
      await Promise.all(wanted.map((p) => materialise(p.model, poseOf(p)).catch(() => null)));
    }
    layout = canvas.layout;
    route = canvas.route;
    areas = canvas.areas ?? [];
    surface = canvas.look.surface;
    roundness = canvas.look.roundness;
    smoothing = canvas.look.smoothing;
    cubeScale = canvas.look.cubeScale;
    // The script is only ever the steps read in order, so opening a canvas
    // fills the box from them rather than from a field of its own.
    el('script').value = scriptOf(canvas.route);
    state.selected = -1;
    state.pinned = null;
    state.clock = 0;
    scarredUpTo = -2;
    duration = routeDuration(route) / 1000;
    rebuild();
    uploadAreas();
    select(-1);
    paintScript();
    paintStep();
    paintPanel();
  }

  async function restore() {
    let saved;
    try {
      saved = localStorage.getItem(STORE);
    } catch { return false; }
    if (!saved) return false;
    try {
      await apply(parse(saved));
      return true;
    } catch (error) {
      // A stored canvas that cannot be read is not worth keeping.
      try { localStorage.removeItem(STORE); } catch { /* nothing to do */ }
      console.warn('the saved canvas could not be read:', error.message);
      return false;
    }
  }

  function download() {
    const text = JSON.stringify(current(), null, 2);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'canvas.json';
    link.click();
    URL.revokeObjectURL(url);
    say('canvas.json saved');
  }

  /**
   * Bring in models drawn in MagicaVoxel.
   *
   * A `.vox` file is already a voxel grid with an indexed palette, so this
   * skips voxelising, normalising and colour quantisation entirely. A file can
   * hold hundreds of models - a whole pack is often one file - so they are
   * parsed once and kept, and each one is only converted when it is first
   * placed. Converting all of them up front would cost seconds for models that
   * may never be used.
   */
  /**
   * Take in a file of models.
   *
   * A `.vox` file can hold hundreds, so they are parsed once and only converted
   * when one is first placed. Names come from a file beside the pack if there
   * is one, because a `.vox` carries none of its own.
   */
  function addPack(base, bytes, names = null) {
    const vox = readVox(bytes);
    const taken = new Set([...Object.keys(recipes), ...Object.keys(sources)]);
    for (let i = 0; i < vox.models.length; i++) {
      let id = names?.[i] ?? (vox.models.length === 1 ? base : `${base}-${i + 1}`);
      // Two models may be given the same name, and two packs may share one.
      // Numbering the later ones keeps every entry reachable.
      if (taken.has(id)) {
        let n = 2;
        while (taken.has(`${id}-${n}`)) n++;
        id = `${id}-${n}`;
      }
      taken.add(id);
      sources[id] = { kind: 'vox', vox, model: i };
    }
    paintLibrary();
    return vox;
  }

  /**
   * Every mesh the manifest lists, by path only.
   *
   * A mesh pack ships one OBJ per model and they are large - a house is
   * thirty thousand triangles - so nothing is read here. Listing them costs
   * nothing and each is fetched and voxelised the first time it is wanted.
   */
  function listMeshes() {
    let added = 0;
    let held = 0;
    for (const mesh of manifest.meshes ?? []) {
      if (sources[mesh.name] || recipes[mesh.name]) continue;
      // The rule is CC0 only and the output is monetised video, so anything
      // whose licence has not been established is not offered at all. A model
      // that cannot be seen cannot be placed in a video by accident.
      if (mesh.licence !== 'CC0') { held++; continue; }
      // The format is the extension. Nothing downstream cares which it was:
      // all three arrive as triangles and leave as the same voxel grid.
      const kind = mesh.file.toLowerCase().endsWith('.obj') ? 'obj'
        : mesh.file.toLowerCase().endsWith('.glb') ? 'glb' : 'gltf';
      sources[mesh.name] = { kind, file: mesh.file, height: mesh.height };
      added++;
    }
    // A rigged model is **one** entry however many poses it holds. Which pose
    // it stands in belongs to the object once it is placed, not to the library:
    // there are 309 poses across the library and listing them would bury
    // everything else.
    for (const rig of manifest.rigs ?? []) {
      // Said out loud. A rig quietly losing its name to a recipe is invisible,
      // and the model simply never appears - which is how this was found.
      if (sources[rig.name] || recipes[rig.name]) {
        say(`"${rig.name}" is already in the library, so that rig was left out`);
        continue;
      }
      if (rig.licence !== 'CC0') { held++; continue; }
      sources[rig.name] = {
        kind: rig.file.toLowerCase().endsWith('.glb') ? 'glb' : 'gltf',
        file: rig.file,
        height: rig.height,
        slots: rig.slots,
        rig: true,
        // What it stands in until somebody says otherwise. Without one a rigged
        // model arrives in its bind pose, which for a character is a T-pose.
        pose: rig.pose ? { ...rig.pose } : null,
        clips: [],
      };
      added++;
    }

    if (added) paintLibrary();
    if (held) say(`${held} models held back: their licence is not recorded as CC0`);
    return added;
  }

  /** Everything the manifest says the library holds. Runs after the first frame. */
  async function loadPacks() {
    const meshes = listMeshes();
    if (meshes) say(`${meshes} mesh models listed`);
    for (const pack of manifest.packs ?? []) {
      try {
        const base = pack.file.split('/').pop().replace(/\.vox$/i, '');
        const [bytes, names] = await Promise.all([
          loadBytes(pack.file),
          pack.names ? loadJson(pack.names).then((d) => d.names).catch(() => null) : null,
        ]);
        const vox = addPack(base, bytes, names);
        say(`${pack.title ?? base}: ${vox.models.length} models`);
      } catch (error) {
        // A missing pack costs its models and nothing else.
        say(`could not load ${pack.file}`);
        console.error(error);
      }
    }
  }

  /** A file dropped on the page, rather than one the manifest knew about. */
  async function addVoxFile(name, bytes) {
    const base = name.replace(/\.vox$/i, '').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
    const names = await packNames(base, readVox(bytes).models.length);
    const vox = addPack(base, bytes, names);
    if (vox.models.length === 1) placeModel(base);
    else say(`${name}: ${vox.models.length} models added`);
    if (vox.usedDefaultPalette) say(`${name} carried no palette, so it is grey`);
  }

  /**
   * Names for a pack, if anyone has written them down.
   *
   * A `.vox` file carries no names, so a pack arrives as hundreds of numbers.
   * A file beside it in `models/names/` can say what each one is, which turns
   * an unusable list into something you can filter for "table".
   */
  async function packNames(base, count) {
    try {
      const response = await fetch(new URL(`./models/names/${base}.json`, location.href).href);
      if (!response.ok) return null;
      const data = await response.json();
      if (!Array.isArray(data.names) || data.names.length !== count) {
        say(`names for ${base} do not match this file, so they were ignored`);
        return null;
      }
      return data.names;
    } catch {
      return null;   // No names is the ordinary case, not a failure.
    }
  }

  /**
   * Convert a model the first time it is wanted, then keep it.
   *
   * A voxel model is already a grid and comes back at once. A mesh has to be
   * fetched and voxelised, which is why this is asynchronous: doing it for all
   * of them at startup would read tens of megabytes for models never used.
   */
  /**
   * How many converted models to hold on to.
   *
   * Browsing the library converts everything it draws a preview of, and a
   * converted model is its geometry: measured at about half a megabyte each,
   * so the whole library at once is a hundred megabytes that is never given
   * back. Objects on the canvas are always kept - dropping one of those would
   * empty the scene - so this only ever releases models nobody is using.
   */
  const KEEP_CONVERTED = 48;
  const usedAt = new Map();
  let useClock = 0;
  const touch = (id) => usedAt.set(id, ++useClock);

  /**
   * What must not be released, whatever else is.
   *
   * **Keyed the way the cache is keyed.** `imported` is keyed by model *and
   * pose* - `Matt@Idle@0` - and this used to be built from `p.model` alone, so
   * a posed model standing on the canvas never matched and was eligible for
   * eviction. Browsing the library far enough would then drop its grid, and the
   * next rebuild would take the object off the canvas as "not in the library".
   * A cache evicting the thing it is holding for.
   */
  const inUse = () => new Set(layout.map(keyFor));

  function forget() {
    const held = Object.keys(imported);
    if (held.length <= KEEP_CONVERTED) return 0;
    const onCanvas = inUse();
    const spare = held
      .filter((id) => !onCanvas.has(id))
      .sort((a, b) => (usedAt.get(a) ?? 0) - (usedAt.get(b) ?? 0));

    let over = held.length - KEEP_CONVERTED;
    let gone = 0;
    for (const id of spare) {
      if (over <= 0) break;
      delete imported[id];
      usedAt.delete(id);
      // Both caches are keyed by model, and a mesh built from a grid that is
      // no longer held would be the largest thing left pointing at nothing.
      meshCache.delete(id);
      thumbs.delete(id);
      over--;
      gone++;
    }
    return gone;
  }

  /**
   * Give back everything that is not standing on the canvas.
   *
   * `forget` is the ordinary housekeeping: it keeps the last 48 conversions so
   * that browsing the library stays quick, which is the right trade while a
   * canvas is being built. This is the deliberate version, and it keeps
   * nothing - because clearing the canvas is a statement that none of it is
   * wanted.
   *
   * Decoded images go too. They are **only ever a saving**: every colour is
   * baked into the geometry at import, so dropping one costs a decode and can
   * never cost a colour.
   */
  function release() {
    const onCanvas = inUse();
    let models = 0;
    for (const key of Object.keys(imported)) {
      if (onCanvas.has(key)) continue;
      delete imported[key];
      usedAt.delete(key);
      meshCache.delete(key);
      thumbs.delete(key);
      models++;
    }
    // Previews of models that were never placed are the rest of it, and they
    // are the reason opening the library twice is cheap. Cheap to redraw.
    for (const key of [...thumbs.keys()]) if (!onCanvas.has(key)) thumbs.delete(key);
    // Swept by their own keys, not by what was imported: a recipe is meshed
    // like anything else but was never imported, so a loop over `imported`
    // walks straight past it. Rebuilding used to empty this every time and
    // hide that; it does not any more, because emptying it every time was the
    // stutter.
    for (const key of [...meshCache.keys()]) if (!onCanvas.has(key)) meshCache.delete(key);
    for (const key of Object.keys(grids)) if (!onCanvas.has(key)) delete grids[key];
    const bytes = textureWeight;
    textures.clear();
    textureWeight = 0;
    return { models, bytes };
  }

  // What is being held, for the readout and for a test. A cache that quietly
  // stops releasing looks exactly like one that works.
  // What the selected object is standing in, for a test. A pose that silently
  // fails to change looks exactly like one that has no other poses to go to.
  window.__trail.posed = () => (
    state.selected < 0 ? null : keyFor(layout[state.selected])
  );

  // How many objects are on the canvas. Reading a script must never change it:
  // Trail finds things, and putting them anywhere is the user's act.
  window.__trail.placed = () => layout.length;

  // The route, for a test. Until step editing existed this could only be
  // changed by editing the page source, so nothing could check it.
  // The whole canvas as it would be saved. A test can then check that a
  // control actually reached the file rather than only that it did not throw.
  window.__trail.canvas = () => current();

  // Where in the day the clock is, and which step that is. For a test: the
  // bar is the main control now, so what it is pointing at is worth asking.
  window.__trail.at = () => ({
    hour: state.hour,
    weather: route.length ? route[editing()].weather : state.weather,
    // Where the sun is at the moment on the clock. Asking for the hour only
    // proves the number was stored; this is the expression the frame draws
    // with, so it proves the hour reaches the sky.
    sun: skyNow(routeAtHour(route, state.hour)).sun,
    orbit: state.orbit,
    push: state.push,
    // The step being **worked on**, which is what the panel edits and what the
    // bar highlights. This used to report `routeAtHour(...).fromStep`, which is
    // the step being *left* - so it agreed with the bug where standing exactly
    // on a middle step reported its predecessor, and a test could not have seen
    // the difference.
    step: editing(),
  });

  /**
   * The shot as it stands, evaluated on demand.
   *
   * **Not read back from the panel.** An app instance from an earlier test goes
   * on drawing into the current stub's elements, so `s-centre` and `s-width`
   * report whichever instance drew last - which is how a working implementation
   * gets reported as broken. This calls the same expression the frame calls, so
   * it is this page's answer or nothing.
   *
   * Drift is deliberately not applied: it breathes the framing a per cent or so
   * every frame, and a test asking where the camera is does not want to know
   * about the breathing.
   */
  window.__trail.shot = () => {
    const framing = currentRoute().framing;
    const [cx, cz] = centreOf(framing);
    const seen = veilFor(framing.w, PIECE);
    return {
      x: cx,
      z: cz,
      w: framing.w,
      pitch: framing.pitch,
      yaw: framing.yaw,
      overview: state.overview,
      // How far the film is rolled into its ring: 1 is Halo mode, 0 is the
      // overview, and anything between is the unfurl mid-flight.
      roll: state.roll,
      // Where the roll is heading. The eased value needs frames to reach it; what
      // the app was *asked* for does not, and is the thing a control is judged on.
      rollTo: state.rollTo,
      solid: state.solid,
      // Plates of film the renderer is actually holding, and how big they are
      // drawn. A restored canvas with no ground under it is this being zero.
      // Whether a take is running. It decides which branch of the frame the
      // sky is worked out in, so it is the difference between the hour
      // reaching the sky and not.
      playing: state.playing,
      pieces: renderer.pieces,
      plate: state.plate,
      radius: ringSize(),
      // How far the world survives around the piece being looked at. Evaluated
      // here rather than read back from anything drawn, for the same reason
      // everything else on this object is.
      //
      // It doubles as a way to tell whether the browser is running the code on
      // disk: if this is missing after a reload, the page is on a cached copy
      // of this module and nothing changed recently will be visible. That has
      // now happened twice, and `serve.json` is the fix for the cause.
      veil: { near: seen.near, far: seen.far, piece: { ...PIECE } },
    };
  };

  window.__trail.route = () => route.map((s) => ({
    text: s.text ?? '', hold: s.hold, weather: s.weather, framing: { ...s.framing },
    // The hour is what a step is called now, so a test asking about the route
    // has to be able to see it.
    ...(typeof s.hour === 'number' ? { hour: s.hour } : {}),
  }));

  window.__trail.held = () => ({
    converted: Object.keys(imported).length,
    previews: thumbs.size,
    meshes: meshCache.size,
    textures: textures.size,
    textureBytes: textureWeight,
  });

  const pendingWork = new Map();
  async function materialise(id, pose = null) {
    const key = keyOf(id, pose);
    touch(key);
    if (imported[key]) return imported[key];
    if (pendingWork.has(key)) return pendingWork.get(key);
    const source = sources[id];
    if (!source) return null;

    const work = (async () => {
      let grid;
      // The model as its artist drew it, kept for anything that came in as a
      // mesh. This is what actually gets drawn; the grid beside it is only
      // still built because the object's box, its shadow and the extent of the
      // world are all measured from the cube field.
      let drawn = null;
      if (source.kind === 'obj') {
        const objText = await loadText(source.file);
        if (!objText) throw new Error(`could not read ${source.file}`);
        const mtlText = await loadText(source.file.replace(/\.obj$/i, '.mtl'));
        // The material names still decide the colour of anything with no
        // texture, and they are the fallback for every face the texture cannot
        // answer for, so both are read and the picture wins where there is one.
        const read = readObj(objText, readMtl(mtlText ?? '', { model: id }), textureRefs(mtlText ?? ''));
        const raw = await painted(read, source.file);
        grid = voxeliseMesh(raw, { id, cells: 34 });
        drawn = fromTriangles(raw, { height: source.height });
      } else if (source.kind === 'gltf' || source.kind === 'glb') {
        const wanted = pose ?? source.pose;
        const { mesh: read, clips } = await loadMesh(source, wanted);
        // Discovered on the first read and kept, so the panel can offer the
        // poses a model holds without opening the file again.
        if (clips.length && !source.clips.length) source.clips = clips;
        const raw = await painted(read, source.file);
        grid = voxeliseMesh(raw, { id, cells: 34 });
        drawn = fromTriangles(raw, { height: source.height });
      } else {
        grid = toGrid(source.vox, { model: source.model, unit: 0.12, anchor: 'base', id });
      }
      // A pack that normalised its models before exporting has lost their real
      // sizes, so the manifest carries the height back. `fromTriangles` was
      // already given the same number.
      if (source.height) grid = atHeight(grid, source.height);
      imported[key] = { ...grid, baseUnit: grid.unit, drawn };
      return imported[key];
    })();

    // Cleared however it ends. Deleting only on success left a failed model's
    // rejected promise in the map forever: it could never be tried again, and
    // it held on to everything the attempt had allocated.
    work.finally(() => {
      pendingWork.delete(key);
      touch(key);
      forget();
    }).catch(() => {});

    pendingWork.set(key, work);
    return work;
  }

  /** Put a model on the canvas, in the middle of whatever is being looked at. */
  async function placeModel(id) {
    const pose = sources[id]?.pose ? { ...sources[id].pose } : null;
    if (!recipes[id]) {
      const grid = await materialise(id, pose).catch((error) => {
        say(`could not read ${id}: ${error.message}`);
        return null;
      });
      if (!grid) return;
    }
    // The middle of the piece being looked at, so a model lands on the part of
    // the film you are composing. `from` records which piece that is.
    const [, cz] = centreOf(currentRoute().framing);
    layout.push({ model: id, at: [clockX(), 0, cz], rot: 0, from: editing(), ...(pose ? { pose } : {}) });
    rebuild();
    select(layout.length - 1);
    paintLibrary();
    autosave();
    say(`${id} placed, ${(scene.ranges.at(-1)?.count ?? 0).toLocaleString()} blocks`);
  }

  /** Take the selected object off the canvas. */
  function removeSelected() {
    if (state.selected < 0) { say('nothing selected'); return; }
    const gone = layout[state.selected].model;
    layout.splice(state.selected, 1);
    rebuild();
    select(-1);
    paintLibrary();
    autosave();
    say(`${gone} removed`);
  }

  // Drop a canvas or a model anywhere on the page.
  addEventListener('dragover', (event) => event.preventDefault());
  addEventListener('drop', async (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    try {
      if (/\.vox$/i.test(file.name)) {
        await addVoxFile(file.name, new Uint8Array(await file.arrayBuffer()));
      } else {
        await apply(parse(await file.text()));
        say(`opened ${file.name}`);
      }
    } catch (error) {
      const known = isRefusal(error) || isBadVox(error);
      say(known ? error.message : `could not open ${file.name}`);
      if (!known) console.error(error);
    }
  });

  // --- what the weather leaves behind ---------------------------------------
  // Derived from the steps rather than accumulated over time, so jumping
  // straight to the last step looks exactly like playing the whole route.

  function scarsFor(step) {
    if (step === scarredUpTo) return;
    scarredUpTo = step;
    renderer.setScars(
      scarMap(stampsUpTo(route, step), SCARS),
      SCARS.resolution,
      SCARS.extent,
    );
  }

  // --- name tags ------------------------------------------------------------
  // The one piece of text. Drawn on a 2D layer over the scene, positioned by
  // pushing the object's own anchor through the same matrix the cubes used.

  const tags = document.getElementById('tags');
  const tagCtx = tags.getContext('2d');

  function project(matrix, point) {
    const [x, y, z] = point;
    const clip = [
      matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
      matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
      matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
      matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15],
    ];
    if (clip[3] <= 0) return null;   // behind the camera
    return { x: clip[0] / clip[3], y: clip[1] / clip[3], w: clip[3] };
  }

  /**
   * Names on a 2D layer over the frame.
   *
   * `veil` is the same pool the world is drawn through, so **a name fades with
   * the thing it names**. Without it a tag is a screen-space label with no idea
   * where its object is, and the names of every other piece of the film hang in
   * mid-air over ground that has been faded to sky - which is exactly what was
   * reported. Removing the step range from tags is what let it happen: the
   * range used to hide them, and nothing took over the job.
   */
  function drawTags(matrix, step, arrive = 1, veil = null) {
    const view = renderer.view.css;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (tags.width !== Math.round(view.w * dpr) || tags.height !== Math.round(view.h * dpr)) {
      tags.width = Math.round(view.w * dpr);
      tags.height = Math.round(view.h * dpr);
    }
    tags.style.left = `${view.x}px`;
    tags.style.top = `${view.y}px`;
    tags.style.width = `${view.w}px`;
    tags.style.height = `${view.h}px`;

    tagCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    tagCtx.clearRect(0, 0, view.w, view.h);

    // How much of a name survives the veil, given where the thing it names
    // stands. The same numbers the shaders are given, so a label and the object
    // under it disappear together rather than one outliving the other.
    const through = (x, z) => {
      if (!veil) return 1;
      const away = Math.hypot(x - veil.focus[0], z - veil.focus[1]);
      const t = Math.min(1, Math.max(0, (away - veil.near) / Math.max(1e-6, veil.far - veil.near)));
      return 1 - t * t * (3 - 2 * t);   // smoothstep, as in the shader
    };

    // Places first, so a person standing in the bar is labelled over it.
    for (const place of areas) {
      if (!place.label) continue;
      const at = project(matrix, [place.at[0], 0.05, place.at[1]]);
      if (!at || Math.abs(at.x) > 1.1 || Math.abs(at.y) > 1.1) continue;
      // A place is read at a wider shot than a person is: it is the ground you
      // are looking across, so it survives the pull-back that drops the names.
      const fade = Math.max(0, Math.min(1, (200 - at.w) / 90))
        * through(place.at[0], place.at[1]);
      if (fade <= 0.02) continue;
      writeTag(place.label, (at.x * 0.5 + 0.5) * view.w, (1 - (at.y * 0.5 + 0.5)) * view.h,
        fade * 0.85);
    }

    for (let i = 0; i < layout.length; i++) {
      const p = layout[i];
      if (!p.label) continue;
      // No step range: a name belongs to the figure, and the figure belongs to
      // a piece of the film that is either in shot or is not.
      const box = boxes[i];
      // A box is measured from the buffers, which hold an object at the start
      // of its line - the travelling itself happens in the shader. So the tag
      // has to be offset by the same amount, or a name stands still while the
      // person it belongs to walks out from under it.
      const [dx, dz, when] = travelOf(p);
      const gone = when < 0 ? 0 : step > when ? 1 : step === when ? arrive : 0;
      const anchor = [
        (box.min[0] + box.max[0]) / 2 + dx * gone,
        box.max[1] + 0.5,
        (box.min[2] + box.max[2]) / 2 + dz * gone,
      ];
      const at = project(matrix, anchor);
      if (!at || Math.abs(at.x) > 1.1 || Math.abs(at.y) > 1.1) continue;

      // Tags fade with distance and vanish entirely on a wide shot, so the
      // final pull-back is a diorama and not a cloud of labels - and they fade
      // with the veil, so the names of other pieces of the film go with them.
      const fade = Math.max(0, Math.min(1, (90 - at.w) / 45))
        * through(anchor[0], anchor[2]);
      if (fade <= 0.02) continue;

      writeTag(p.label, (at.x * 0.5 + 0.5) * view.w, (1 - (at.y * 0.5 + 0.5)) * view.h, fade);
    }
  }

  /**
   * One name, drawn on the glass.
   *
   * Shared by people and by places so the two cannot end up looking like
   * different kinds of writing, which is the only thing that would make a
   * viewer think they mean different kinds of thing.
   */
  function writeTag(text, sx, sy, fade) {
    tagCtx.font = '600 13px ui-monospace, Consolas, monospace';
    const width = tagCtx.measureText(text).width + 14;
    tagCtx.globalAlpha = fade * 0.85;
    tagCtx.fillStyle = '#0d1420';
    tagCtx.fillRect(sx - width / 2, sy - 20, width, 20);
    tagCtx.globalAlpha = fade;
    tagCtx.fillStyle = '#eaf1f8';
    tagCtx.textAlign = 'center';
    tagCtx.fillText(text, sx, sy - 6);
    tagCtx.globalAlpha = 1;
  }

  // --- the take -------------------------------------------------------------

  // The sync flash: one white frame at the start, so lining the picture up
  // against a voice track is a one-second job in a video editor.
  function sync() {
    flash.style.transition = 'none';
    flash.style.opacity = '1';
    requestAnimationFrame(() => {
      flash.style.transition = 'opacity 90ms linear';
      flash.style.opacity = '0';
    });
  }
  // --- the pen --------------------------------------------------------------
  // Marks on the glass, not in the world. They do not turn with the camera and
  // they are not part of the canvas: this is for pointing at a shot while
  // talking over it.

  const penCanvas = el('pen');
  const penCtx = penCanvas.getContext('2d');
  const strokes = [];
  const ink = { on: false, colour: pen.COLOURS[0], width: pen.WIDTH.default };
  let inkDirty = true;
  let drawing = null;

  function paintInk() {
    const view = renderer.view.css;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(view.w * dpr);
    const h = Math.round(view.h * dpr);
    if (penCanvas.width !== w || penCanvas.height !== h) {
      penCanvas.width = w;
      penCanvas.height = h;
      inkDirty = true;
    }
    penCanvas.style.left = `${view.x}px`;
    penCanvas.style.top = `${view.y}px`;
    penCanvas.style.width = `${view.w}px`;
    penCanvas.style.height = `${view.h}px`;
    if (!inkDirty) return;
    inkDirty = false;
    penCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pen.draw(penCtx, strokes, view.w, view.h);
  }

  function penMode(on) {
    ink.on = on;
    penCanvas.classList.toggle('on', on);
    el('b-draw').setAttribute('aria-pressed', String(on));
  }

  penCanvas.addEventListener('pointerdown', (event) => {
    if (!ink.on) return;
    event.preventDefault();
    penCanvas.setPointerCapture(event.pointerId);
    const rect = penCanvas.getBoundingClientRect();
    drawing = pen.start(ink.colour, ink.width);
    pen.extend(drawing, ...pen.toFrame(event.clientX, event.clientY,
      { x: rect.left, y: rect.top, w: rect.width, h: rect.height }));
    strokes.push(drawing);
    inkDirty = true;
  });

  penCanvas.addEventListener('pointermove', (event) => {
    if (!drawing) return;
    const rect = penCanvas.getBoundingClientRect();
    const at = pen.toFrame(event.clientX, event.clientY,
      { x: rect.left, y: rect.top, w: rect.width, h: rect.height });
    if (pen.extend(drawing, ...at)) inkDirty = true;
  });

  const endStroke = () => { drawing = null; };
  penCanvas.addEventListener('pointerup', endStroke);
  penCanvas.addEventListener('pointercancel', endStroke);

  // Swatches are built from the palette, so adding a colour is a one-line edit.
  const swatches = el('swatches');
  function buildSwatches() {
    pen.COLOURS.forEach((colour) => {
      const button = document.createElement('button');
      button.style.background = colour;
      button.dataset.v = colour;
      button.title = colour;
      button.addEventListener('click', () => {
        ink.colour = colour;
        paintSwatches();
        if (!ink.on) penMode(true);
      });
      swatches.append(button);
    });
    paintSwatches();
  }

  function paintSwatches() {
    for (const b of swatches.children) {
      b.setAttribute('aria-pressed', String(b.dataset.v === ink.colour));
    }
  }

  el('b-draw').addEventListener('click', () => penMode(!ink.on));
  el('b-undo').addEventListener('click', () => {
    if (pen.undo(strokes)) inkDirty = true;
    else say('nothing to undo');
  });
  el('b-clear').addEventListener('click', () => {
    if (!strokes.length) return;
    strokes.length = 0;
    inkDirty = true;
    say('marks cleared');
  });
  el('r-pen').addEventListener('input', (event) => {
    ink.width = Number(event.target.value);
    el('v-pen').textContent = String(ink.width);
  });

  // --- steps ----------------------------------------------------------------
  //
  // A step is a rectangle on the ground and a pitch, plus the words said while
  // the camera holds there. Everything a step is made of already existed - the
  // route, the canvas file, playback, the scars - and could only be reached by
  // editing the page source. This is the panel that reaches it.

  /** The step being worked on. Pinning one is how you say which. */
  const editing = () => Math.max(0, Math.min(state.pinned ?? 0, route.length - 1));

  /**
   * A step's sky: the weather it names, at the hour it is set to.
   *
   * The two are separate on purpose. The weather says how much light gets
   * through, how far you can see and what is left on the ground; the hour says
   * where the light comes from and what colour it is. A step with no hour
   * resolves to exactly the preset it always did, which is what keeps every
   * canvas built before the clock existed looking the same.
   */
  const skyOf = (step) => (typeof step?.hour === 'number'
    ? { ...resolveWeather(step.weather ?? 'clear'), hour: step.hour }
    : (step?.weather ?? 'clear'));

  /**
   * What the sky looks like at the moment the clock is showing.
   *
   * A route that says something about this hour is used; otherwise this is an
   * empty day and the playground's own weather lights it. **Either way the hour
   * applies**, which is what makes a canvas with no steps a place at a time
   * rather than a dead bar - and it is the whole of the bug where removing every
   * step stopped the clock and the weather both.
   */
  function skyNow(moment) {
    const base = moment
      ? (route[moment.fromStep ?? moment.step]
        ? lerpWeather(
          skyOf(route[moment.fromStep ?? moment.step]),
          skyOf(route[moment.step]),
          moment.into,
        )
        : resolveWeather(skyOf(route[moment.step])))
      : resolveWeather(route[editing()]?.weather ?? state.weather);
    // The hour under the hand wins over whatever any step says, so the sun
    // follows the bar rather than snapping between steps.
    return resolveWeather({ ...base, hour: state.hour });
  }

  /**
   * Everything that has to follow a change to the route.
   *
   * Gathered in one place because a step carries more than it looks: the
   * buttons, how long the whole thing runs, the ground marks it leaves, and
   * the range an object can be placed in.
   */
  function stepsChanged() {
    // **First, because everything below reads where the pieces stand.** A step's
    // place on the strip comes from its position in the film, so adding,
    // removing or re-timing one moves every piece after it.
    restage();
    refreshStrip();
    buildSteps();
    paintClock();
    duration = routeDuration(route) / 1000;
    // The marks the weather leaves are derived from the steps, so a changed
    // route means a different ground. Forcing a rebuild keeps a seek looking
    // exactly like a playthrough, which is the whole point of deriving them.
    scarredUpTo = -2;
    paintStep();
    paintScript();
    autosave();
  }

  function paintStep() {
    const at = editing();
    const step = route[at];
    el('s-editing').textContent = !route.length ? '-'
      : typeof route[at]?.hour === 'number'
        ? `${clockOf(route[at].hour)} (${at + 1} of ${route.length})`
        : `${at + 1} of ${route.length}`;
    if (!step) return;
    holdSlider.set(step.hold ?? 5000);
    approachSlider.set(step.approachTime ?? 2500);
    paintMove();
    stepWeatherSeg.paint();
    // The box shows the words of the step being worked on. While there is only
    // one step that is the whole script, which is what pasting should give.
    const box = el('script');
    if (document.activeElement !== box) box.value = step.text ?? '';
  }

  el('b-step-add').addEventListener('click', () => {
    const at = editing();

    // The first step of an empty day is made from where the camera is and what
    // the playground already looks like, so adding one keeps what is on screen
    // rather than replacing it with a default nobody chose.
    if (!route.length) {
      route.push({
        framing: { ...currentRoute().framing },
        hold: 5000,
        approachTime: 2500,
        weather: state.weather,
        hour: state.hour,
        text: '',
      });
      state.pinned = 0;
      rebuild();
      uploadAreas();
      stepsChanged();
      say(`the day starts at ${clockOf(state.hour)}`);
      return;
    }

    // **At the time on the clock**, because that is where you are looking and
    // it is the only moment you could have meant. An earlier version put the
    // new step halfway to the next one instead, which is where the reported
    // "35 min later for some magical reason" came from.
    let hour = state.hour;
    // Two steps at the same minute would put two marks on top of each other and
    // leave `routeAtHour` with no way to say which one you meant.
    while (route.some((s) => typeof s.hour === 'number' && Math.abs(s.hour - hour) < 1e-6)) {
      hour = (hour + 1 / 60) % 24;
    }

    // Where that time belongs in the route. The strip is walked in array order
    // and read in time order, so a step added at eleven has to sit between the
    // steps either side of eleven - not after whichever one happens to be
    // selected.
    let index = route.findIndex((s) => typeof s.hour === 'number' && s.hour > hour);
    if (index < 0) index = route.length;

    // Make room: every piece after this one moves along the strip, and what
    // stands on them goes too.
    const opened = openPiece({ route, layout, areas }, index, pitchOf(PIECE));
    layout = opened.layout;
    areas = opened.areas;

    // A copy of the step it follows, so it is a real step immediately and the
    // next act is composing it - which is what you were going to do.
    const like = route[Math.max(0, index - 1)] ?? route[0];
    route.splice(index, 0, {
      framing: { ...(like?.framing ?? currentRoute().framing) },
      hold: like?.hold ?? 5000,
      approachTime: like?.approachTime ?? 2500,
      weather: like?.weather ?? state.weather,
      hour,
      text: '',
    });

    state.pinned = index;
    state.hour = hour;
    leaveOverview();
    rebuild();
    uploadAreas();
    stepsChanged();
    say(`step ${index + 1} of ${route.length}, at ${clockOf(hour)}`);
  });

  /**
   * Rearrange the route, dragging everything that points at a step with it.
   *
   * Never splice `route` directly. A step is referred to by its position - an
   * object's range, the step it walks its line on, a place's range - and moving
   * one without remapping those does not fail or warn. It quietly re-times the
   * video, and the only way to notice is to play it and find somebody arriving
   * in the wrong shot.
   */
  function rearrange(order, pinTo) {
    const out = reorder({ route, layout, areas }, order);
    route = out.route;
    layout = out.layout;
    areas = out.areas;
    state.pinned = Math.max(0, Math.min(pinTo, route.length - 1));
    rebuild();
    uploadAreas();
    stepsChanged();
    paintObject();
    paintPath();
  }

  el('b-step-remove').addEventListener('click', () => {
    // The last piece can go. An empty film is a place at a time of day, which
    // is a perfectly good thing to be looking at and is where a canvas starts.
    if (!route.length) { say('there are no pieces to cut'); return; }
    cutStep(editing());
  });






  // --- the words of a step --------------------------------------------------
  //
  // **Reading the script was cancelled.** Trail no longer takes a narration,
  // finds the objects it names, or offers a tray of them; the script lives
  // outside the app and the objects are placed by hand from the library.
  //
  // What survives is a box holding whatever a step is about, which is a note
  // to the person building the canvas and nothing more. Nothing reads it, and
  // splitting it in two is how one long note becomes stages.

  function paintScript() {
    const step = route[editing()];
    const box = el('script');
    if (step && document.activeElement !== box) box.value = step.text ?? '';
  }

  el('script').addEventListener('input', () => {
    const step = route[editing()];
    if (step) step.text = el('script').value;
    autosave();
  });

  // --- the library ----------------------------------------------------------
  // Everything that can be placed: the built-in recipes, and every model read
  // from a dropped file. A pack arrives as one file with hundreds inside, so
  // this needs a filter rather than a list you scroll.

  // A page of models. Everything is reachable by paging rather than by
  // narrowing the search until the list happens to be short enough.
  const PAGE = 60;
  // Drawn larger than the tile it is shown in, because a preview costs the same
  // whatever its size - the work is walking the voxels, not filling pixels -
  // and scaling down looks clean where scaling up does not.
  const THUMB = 128;
  let page = 0;

  // Drawing a preview means converting the model, which is the expensive part.
  // Both are cached, and the tiles fill in a few at a time so opening the panel
  // never stutters. `thumbs` itself is declared with the other caches, because
  // releasing a model has to clear all of them together.
  let thumbQueue = [];
  let thumbRunning = false;

  async function drawThumbInto(canvasEl, id) {
    const cached = thumbs.get(id);
    if (cached) {
      canvasEl.getContext('2d').putImageData(cached, 0, 0);
      return true;
    }
    const grid = recipes[id]
      ? gridFor(id)
      : await materialise(id, sources[id]?.pose ?? null).catch(() => null);
    if (!grid) return false;
    // A model that is drawn as a mesh is previewed as one, so the picture in
    // the library is the geometry that will actually appear on the canvas
    // rather than a blocky stand-in for it.
    const pixels = grid.drawn ? preview(grid.drawn, THUMB) : thumbnail(grid, THUMB);
    const image = new ImageData(pixels, THUMB, THUMB);
    thumbs.set(id, image);
    canvasEl.getContext('2d').putImageData(image, 0, 0);
    return true;
  }

  function runThumbQueue() {
    if (thumbRunning) return;
    thumbRunning = true;
    const step = () => {
      const started = performance.now();
      // A few milliseconds a frame: the panel fills in visibly rather than
      // freezing while sixty models are converted.
      while (thumbQueue.length && performance.now() - started < 6) {
        const job = thumbQueue.shift();
        // A mesh has to be fetched, so this may finish after the frame does.
        // Nothing waits on it: the tile fills in whenever it is ready.
        if (job.canvas.isConnected !== false) drawThumbInto(job.canvas, job.id);
      }
      if (thumbQueue.length) requestAnimationFrame(step);
      else thumbRunning = false;
    };
    requestAnimationFrame(step);
  }

  function libraryNames() {
    return [...new Set([...Object.keys(recipes), ...Object.keys(sources)])].sort();
  }

  /** The models currently listed, which is what the cycle keys step through. */
  let listed = [];

  function paintLibrary() {
    const all = libraryNames();
    const needle = el('filter').value.trim().toLowerCase();
    listed = needle ? all.filter((n) => n.includes(needle)) : all;
    const placed = new Set(layout.map((p) => p.model));

    el('s-lib').textContent = String(all.length);
    el('s-found').textContent = needle
      ? `${listed.length} of ${all.length}`
      : `${all.length} models`;

    const pages = Math.max(1, Math.ceil(listed.length / PAGE));
    page = Math.min(Math.max(0, page), pages - 1);
    const from = page * PAGE;
    const slice = listed.slice(from, from + PAGE);

    el('b-prev').disabled = page === 0;
    el('b-next').disabled = page >= pages - 1;
    el('s-more').textContent = listed.length
      ? `${from + 1} to ${from + slice.length} of ${listed.length}   -   page ${page + 1} of ${pages}`
      : 'nothing matches';

    // Drawing a preview converts the model, so none are drawn while the dialog
    // is shut. Otherwise opening the page would convert the whole library.
    const list = el('library');
    list.innerHTML = '';
    thumbQueue = [];
    if (!el('browser').open) return;

    for (const name of slice) {
      const button = document.createElement('button');
      button.title = name;
      if (placed.has(name)) button.className = 'drawn';

      const tile = document.createElement('canvas');
      tile.width = THUMB;
      tile.height = THUMB;
      button.append(tile);

      const label = document.createElement('span');
      label.textContent = name;
      button.append(label);

      button.addEventListener('click', () => {
        placeModel(name).then(paintLibrary);
      });
      list.append(button);
      thumbQueue.push({ canvas: tile, id: name });
    }
    runThumbQueue();
  }

  /**
   * Step the selected object through the models on show.
   *
   * Trying a shape in place beats placing and deleting: the object keeps its
   * position, turn and step range while only the model underneath changes.
   */
  async function cycleSelected(by) {
    if (state.selected < 0) { say('select an object first'); return; }
    if (!listed.length) { say('no models listed'); return; }
    const current = layout[state.selected].model;
    const at = listed.indexOf(current);
    const next = listed[((at < 0 ? 0 : at + by) % listed.length + listed.length) % listed.length];
    if (!recipes[next] && !await materialise(next, sources[next]?.pose ?? null).catch(() => null)) return;
    reposition(state.selected, { ...layout[state.selected], model: next });
    select(state.selected);
    paintLibrary();
    say(next);
  }

  el('filter').addEventListener('input', () => { page = 0; paintLibrary(); });
  el('b-prev').addEventListener('click', () => { page--; paintLibrary(); });
  el('b-next').addEventListener('click', () => { page++; paintLibrary(); });
  el('b-remove').addEventListener('click', removeSelected);

  const browser = el('browser');
  function openLibrary() {
    // Open first, then paint: previews are only drawn while the dialog is up,
    // so painting before opening fills nothing and the library appears empty.
    if (!browser.open) browser.showModal();
    paintLibrary();
    el('filter').focus();
  }
  el('b-library').addEventListener('click', openLibrary);

  /**
   * Take everything off the canvas, and give the memory back with it.
   *
   * The steps are left alone. A canvas keeps what has been placed on it whether
   * or not there are any steps - that is what makes an empty day a playground -
   * so objects outlive the steps they were put there for, and clearing them is
   * a separate act from cutting the film.
   */
  el('b-clear-all').addEventListener('click', () => {
    if (!layout.length && !areas.length) {
      // Still worth releasing: the library holds whatever has been browsed.
      const idle = release();
      say(idle.models ? `nothing placed; gave back ${idle.models} models` : 'nothing to remove');
      paintHeld();
      return;
    }
    const objects = layout.length;
    const places = areas.length;
    layout = [];
    areas = [];
    state.selected = -1;
    const freed = release();
    rebuild();
    uploadAreas();
    paintObject();
    paintAreas();
    paintLibrary();
    paintHeld();
    autosave();
    say(
      `removed ${objects} ${objects === 1 ? 'object' : 'objects'}`
      + (places ? ` and ${places} ${places === 1 ? 'place' : 'places'}` : '')
      + (freed.bytes ? `, gave back ${(freed.bytes / 1e6).toFixed(1)} MB` : '')
    );
  });

  /** What the library is holding on to. A cache that stops releasing looks
   *  exactly like one that works, so it is on screen rather than inferred. */
  function paintHeld() {
    const models = Object.keys(imported).length;
    const mb = textureWeight / 1e6;
    el('s-held').textContent = models || mb >= 0.05
      ? `${models} models, ${mb.toFixed(1)} MB`
      : 'nothing';
  }
  el('b-close').addEventListener('click', () => browser.close());
  // A dialog takes the keyboard, and the camera keys would otherwise reach the
  // page through it.
  browser.addEventListener('keydown', (event) => event.stopPropagation());

  // --- the panel ------------------------------------------------------------
  // Keys move the camera. Everything that is a value lives here, in one place,
  // with its number showing, so nothing has to be remembered.

  const slider = (id, read, write, { live = true, after } = {}) => {
    const input = el(id);
    const label = el(id.replace('r-', 'v-'));
    const show = () => { label.textContent = read(Number(input.value)); };
    let pending;
    input.addEventListener('input', () => {
      show();
      if (live) write(Number(input.value));
      // Rebuilding a model is tens of milliseconds, which is fine on release
      // and terrible on every pixel of a drag.
      clearTimeout(pending);
      pending = setTimeout(() => { after?.(Number(input.value)); autosave(); }, 90);
    });
    return { input, show, set: (v) => { input.value = String(v); show(); } };
  };

  const segment = (id, get, set) => {
    const box = el(id);
    const paint = () => {
      for (const b of box.querySelectorAll('button')) {
        b.setAttribute('aria-pressed', String(b.dataset.v === String(get() ?? '')));
      }
    };
    box.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      set(button.dataset.v);
      paint();
      autosave();
    });
    paint();
    return { paint };
  };

  const roundSlider = slider('r-round', (v) => `${v}%`,
    () => {}, { live: false, after: (v) => { roundness = v / 100; meshCache.clear(); remesh(); } });
  const shadeSlider = slider('r-shade',
    (v) => (v === 0 ? 'flat' : v === 100 ? 'smooth' : `${v}%`),
    (v) => { smoothing = v / 100; });
  const cubeSlider = slider('r-cube', (v) => `${v}%`,
    () => {}, { live: false, after: (v) => { cubeScale = v / 100; rebuild(); } });
  // How much ground a piece shows. Live, because it is judged by eye and it
  // costs one small buffer to change.
  const plateSlider = slider('r-plate', (v) => `${v}%`,
    (v) => { state.plate = v / 100; refreshStrip(); });

  // A step's own numbers. Declared here with the other controls rather than
  // beside the code that uses them, because `slider` and `segment` are defined
  // in this section and a control built above them is read before it exists -
  // which is the fourth time that has taken this page down.
  const holdSlider = slider('r-hold', (v) => `${(v / 1000).toFixed(2)}s`,
    (v) => { route[editing()].hold = v; }, { after: stepsChanged });
  const approachSlider = slider('r-approach', (v) => (v ? `${(v / 1000).toFixed(2)}s` : 'cut'),
    (v) => { route[editing()].approachTime = v; }, { after: stepsChanged });

  const stepWeatherSeg = segment('step-weather',
    () => route[editing()]?.weather ?? state.weather,
    (v) => {
      // With no steps this is the weather of the playground itself. A control
      // that quietly does nothing because there is no step to write to is worse
      // than not having it, and that is what an empty canvas used to give.
      if (route.length) route[editing()].weather = v; else state.weather = v;
      stepsChanged();
    });

  // The clock is kept in minutes rather than hours so the slider can be moved a
  // few minutes at a time near sunrise, which is where the sky actually changes.
  /**
   * A move the camera makes by itself.
   *
   * **These are switches on the camera, not something a step carries.** They
   * were per-step to begin with, so that a take would repeat. The trouble is
   * that anything a step does to the camera takes the view away from whoever is
   * composing it, and the camera is moved by hand. These two survive because
   * they are additions to where the camera already is rather than replacements
   * for it: an orbit sways around the point being looked at, and a push closes
   * in on it. Neither sends the camera anywhere it was not already.
   */
  function paintMove() {
    const moves = [state.orbit ? 'orbiting' : null, state.push ? 'pushing in' : null]
      .filter(Boolean);
    el('s-move').textContent = moves.length ? moves.join(' and ') : 'still';
    el('b-orbit').setAttribute('aria-pressed', String(!!state.orbit));
    el('b-push').setAttribute('aria-pressed', String(!!state.push));
  }

  // Registered from `begin`, not here. Everything above `begin` is a
  // declaration and nothing above it runs, which is the rule that closed a bug
  // that had taken this page down four times.
  const toggleMove = (key, id) => el(id).addEventListener('click', () => {
    state[key] = state[key] ? 0 : 1;
    // The move is watched from its beginning rather than joined part way.
    state.shotAt = null;
    paintMove();
  });

  const surfaceSeg = segment('surface', () => surface, (v) => {
    surface = v === 'cubes' ? 'cubes' : 'mesh';
  });
  const weatherSeg = segment('weather', () => state.forcedWeather ?? '', (v) => {
    state.forcedWeather = v || null;
  });

  // --- moving through the day -----------------------------------------------
  //
  // The route is a clock. Each step is a mark on the bar at the hour it happens,
  // dragging moves through time, and the camera goes wherever the story is at
  // that moment - interpolating between the two steps either side of it.
  //
  // **It hands the renderer exactly what playback hands it**: a step being
  // arrived at and how far through arriving. So ghosting, solidifying, the
  // weather cross-fade and an object walking its line all behave the same way
  // whether the route is playing or being scrubbed, and there is no second code
  // path to keep in step. See `routeAtHour` in `camera.js`.

  const DAY = 24;

  /** Where on the bar an hour sits, and the reverse. */
  const acrossDay = (hour) => Math.max(0, Math.min(1, hour / DAY));
  const hourAcross = (fraction) => Math.max(0, Math.min(DAY, fraction * DAY));

  /** Where on the day a pointer is, in hours. */
  function hourAt(event) {
    const box = el('track').getBoundingClientRect();
    return hourAcross(box.width ? (event.clientX - box.left) / box.width : 0);
  }

  function paintClock() {
    const ticks = el('ticks');
    ticks.innerHTML = '';
    const timed = route
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => typeof step.hour === 'number');

    for (const { step, index } of timed) {
      const mark = document.createElement('button');
      mark.style.left = `${acrossDay(step.hour) * 100}%`;
      mark.title = `${clockOf(step.hour)} - step ${index + 1}`;
      mark.dataset.v = String(index);
      mark.setAttribute('aria-pressed', String(index === editing()));

      // **Dragging a mark is how a step is moved in time.** It replaced both
      // the hour slider and the move-earlier and move-later buttons, and it is
      // the same gesture as reading the bar, which is what makes the bar the
      // whole route editor rather than a readout with an editor elsewhere.
      let dragging = false;
      mark.addEventListener('pointerdown', (event) => {
        dragging = true;
        mark.setPointerCapture?.(event.pointerId);
        state.pinned = index;
        state.playing = false;
        leaveOverview();
        paintStep();
        // Stop the track underneath from reading this as a scrub.
        event.stopPropagation?.();
      });
      mark.addEventListener('pointermove', (event) => {
        if (!dragging) return;
        step.hour = hourAt(event);
        // The needle follows the mark, so the sky shows the hour being chosen.
        state.hour = step.hour;
        paintStep();
        paintClock();
        event.stopPropagation?.();
      });
      const settle = (event) => {
        if (!dragging) return;
        dragging = false;
        if (event && mark.hasPointerCapture?.(event.pointerId)) {
          mark.releasePointerCapture(event.pointerId);
        }
        // The route is walked in array order and read in time order, so moving
        // a step on the clock has to move it in the route as well - otherwise
        // it shows earlier on the bar and still plays in its old place.
        // `reorder` drags every reference to a step along with it.
        const order = byTime(route);
        const landed = order.indexOf(index);
        rearrange(order, landed);
        say(`step ${landed + 1} happens at ${clockOf(step.hour)}`);
      };
      mark.addEventListener('pointerup', settle);
      mark.addEventListener('pointercancel', settle);

      mark.addEventListener('click', () => {
        // Landing exactly on a step rather than near it, which is the whole
        // point of having marks as well as a bar.
        state.playing = false;
        state.hour = step.hour;
        state.pinned = index;
        leaveOverview();
        paintStep();
        paintClock();
      });
      ticks.append(mark);
    }

    // The needle is always somewhere, because the hour always means something.
    const at = state.hour;
    el('needle').style.left = `${acrossDay(at) * 100}%`;
    el('now-time').textContent = clockOf(at);
    // **Where you are, not how many there are.** This used to read
    // "2 of 2 steps on the clock", which is a count of how many steps have a
    // time - so it never changed as you moved, while reading exactly like a
    // position. Reported as "it always says 2 of 2 steps".
    const untimed = route.length - timed.length;
    const note = untimed ? ` (${untimed} with no time)` : '';
    // Near enough to count as being on it: a mark is a click target a few
    // pixels wide, so landing on one lands within a rounding error of its hour.
    const on = timed.find(({ step }) => Math.abs(step.hour - at) < 1e-3);
    const before = stepAround(route, at, -1);
    const after = stepAround(route, at, 1);

    el('now-what').textContent = !route.length
      ? 'an empty day - drag to move through it, + to add a step'
      : !timed.length
        ? `no steps on the clock yet - ${route.length} waiting for a time`
        : on
          ? `step ${on.index + 1} of ${route.length}${note}`
          : before && after
            ? `between steps ${before.index + 1} and ${after.index + 1}${note}`
            : after
              ? `before step ${after.index + 1}${note}`
              : `after step ${before.index + 1}${note}`;
    el('b-time-prev').disabled = !stepAround(route, at, -1);
    el('b-time-next').disabled = !stepAround(route, at, 1);
    el('b-step-remove').disabled = !route.length;
  }

  el('b-solid').addEventListener('click', () => {
    state.solid = state.solid ? 0 : 1;
    el('b-solid').setAttribute('aria-pressed', String(!!state.solid));
    say(state.solid ? 'a solid body' : 'a ring, open in the middle');
  });

  /**
   * Leave the overview, because you have asked to be somewhere.
   *
   * Going to a step is a statement about where you want to be, and the overview
   * is a way of looking at the whole film rather than a place on it - so asking
   * for a step and staying pulled back is the app ignoring what was asked.
   * Reported as the overview "not returning to a step".
   */
  function leaveOverview() {
    if (!state.overview) return;
    state.overview = false;
    state.rollTo = 1;
    el('b-overview').setAttribute('aria-pressed', 'false');
  }

  /**
   * The film as a list: what stands on each piece, and when it happens.
   *
   * **The clock bar turns the ring and this says what is on it.** Splitting
   * them is the point: the bar was doing both and the buttons that changed the
   * film were a pixel away from the ones that only moved through it.
   *
   * Rebuilt from the route and the layout rather than kept in step with them,
   * so it cannot drift - which is the failure this app keeps finding whenever
   * two things describe the same fact.
   */
  let cutting = -1;   // the piece whose delete is waiting to be confirmed

  function paintReel() {
    const host = el('reel-list');
    host.innerHTML = '';

    if (!route.length) {
      const empty = document.createElement('div');
      empty.className = 'reel-empty';
      empty.textContent = 'No pieces yet. Move the clock to a time and press + to start one.';
      host.append(empty);
      return;
    }

    const pitch = pitchOf(PIECE);
    route.forEach((step, index) => {
      const row = document.createElement('div');
      row.className = index === editing() ? 'reel-piece on' : 'reel-piece';

      const head = document.createElement('div');
      head.className = 'reel-head';

      const when = document.createElement('span');
      when.className = 'reel-time';
      when.textContent = typeof step.hour === 'number' ? clockOf(step.hour) : `piece ${index + 1}`;
      head.append(when);

      const go = document.createElement('button');
      go.className = 'reel-btn';
      go.textContent = '▶';
      go.title = 'turn the ring to this piece';
      go.addEventListener('click', () => {
        cutting = -1;
        goToStep(index);
      });
      head.append(go);

      const cut = document.createElement('button');
      cut.className = 'reel-btn cut';
      // **Asked twice before anything is lost.** Cutting a piece takes what
      // stands on it, and there is no undo.
      cut.textContent = cutting === index ? 'sure?' : '✕';
      cut.title = cutting === index
        ? 'press again to cut this piece and everything on it'
        : 'cut this piece out of the film';
      if (cutting === index) cut.style.width = '44px';
      cut.addEventListener('click', () => {
        if (cutting !== index) { cutting = index; paintReel(); return; }
        cutting = -1;
        goToStep(index);
        cutStep(index);
      });
      head.append(cut);
      row.append(head);

      // What is standing on this piece, counted by model so a crowd reads as a
      // crowd rather than as forty lines.
      const here = layout.filter((p) => pieceOf(p.at?.[0], pitch) === index);
      const what = document.createElement('div');
      what.className = 'reel-what';
      if (!here.length) {
        what.textContent = 'nothing on it yet';
      } else {
        const counts = new Map();
        for (const p of here) {
          const name = p.label || p.model;
          counts.set(name, (counts.get(name) ?? 0) + 1);
        }
        what.textContent = [...counts]
          .map(([name, n]) => (n > 1 ? `${name} x${n}` : name))
          .join(', ');
      }
      row.append(what);
      host.append(row);
    });
  }

  /** Ask the clock to travel somewhere, rather than jumping there. */
  function glideTo(hour) {
    state.playing = false;
    state.scrubbing = true;
    state.hourTo = ((hour % 24) + 24) % 24;
  }

  /**
   * Cut a piece out of the film, taking what stands on it.
   *
   * Shared by the bar's minus button and the list, so the two cannot come to
   * mean different things - which is how the same gesture in two places usually
   * ends up doing two jobs.
   */
  function cutStep(index) {
    if (!route[index]) return;
    const pitch = pitchOf(PIECE);
    const before = layout.length;
    const survivors = layout
      .map((o, i) => i)
      .filter((i) => pieceOf(layout[i].at?.[0], pitch) !== index);

    const cut = cutPiece({ route, layout, areas }, index, pitch);
    layout = cut.layout;
    areas = cut.areas;
    const taken = before - layout.length;

    route = route.filter((_, i) => i !== index);
    state.pinned = Math.max(0, Math.min(index, route.length - 1));
    state.selected = survivors.indexOf(state.selected);
    rebuild();
    uploadAreas();
    stepsChanged();
    paintObject();
    paintPath();

    if (!route.length) {
      say('every piece cut - an empty film, drag the clock and press + to start one');
    } else {
      say(taken
        ? `piece cut, and the ${taken} ${taken === 1 ? 'thing' : 'things'} on it`
        : 'piece cut');
    }
  }

  /** Turn the ring to a piece, smoothly. */
  function goToStep(index) {
    const step = route[index];
    if (!step) return;
    state.pinned = index;
    state.playing = false;
    leaveOverview();
    if (typeof step.hour === 'number') glideTo(step.hour);
    paintStep();
    paintClock();
    paintReel();
  }

  /** Move to a moment in the day, and let the panel follow. */
  function scrubTo(hour) {
    leaveOverview();
    // The camera keeps its composition. What moves is where along the film it
    // is standing, which is the whole of what the clock decides.
    state.playing = false;
    state.scrubbing = true;
    state.hour = hour;
    // A drag is the hand on the clock. Anything it was gliding toward is over.
    state.hourTo = null;
    const found = routeAtHour(route, hour);
    // The step being worked on follows the clock, so opening the panel edits
    // what is on screen rather than whatever was pinned last. With no steps
    // there is nothing to follow, and that is a perfectly good state to be in.
    //
    // **Landing exactly on a step pins that step**, and it has to be asked
    // first. `routeAtHour` reports the step being *arrived at* and the one
    // being left, and standing precisely on a mark counts as both - so taking
    // the one being left meant every middle step was skipped. Arrowing along
    // the route showed step 1, then step 1 again, then step 3, and the panel
    // could never be pointed at step 2 at all.
    const exact = route.findIndex(
      (step) => typeof step.hour === 'number' && Math.abs(step.hour - hour) < 1e-6
    );
    if (exact >= 0) state.pinned = exact;
    else if (found) state.pinned = found.fromStep ?? found.step;
    paintStep();
    paintClock();
  }

  {
    const track = el('track');
    let scrubbing = false;
    track.addEventListener('pointerdown', (event) => {
      scrubbing = true;
      track.setPointerCapture?.(event.pointerId);
      scrubTo(hourAt(event));
    });
    track.addEventListener('pointermove', (event) => {
      if (scrubbing) scrubTo(hourAt(event));
    });
    const stop = (event) => {
      scrubbing = false;
      if (event && track.hasPointerCapture?.(event.pointerId)) {
        track.releasePointerCapture(event.pointerId);
      }
    };
    track.addEventListener('pointerup', stop);
    track.addEventListener('pointercancel', stop);
  }

  const jump = (direction) => {
    // **From where the clock is heading, not where it has got to.** The ring
    // turns rather than cutting, so the hour is part way through moving when
    // the next press arrives - and reading the hour it has reached finds the
    // same piece again. Pressing twice quickly should move two pieces.
    const found = stepAround(route, state.hourTo ?? state.hour, direction);
    if (!found) { say(direction < 0 ? 'that is the first step of the day' : 'that is the last'); return; }
    state.pinned = found.index;
    leaveOverview();
    glideTo(found.step.hour);
    paintStep();
    paintClock();
    paintReel();
    say(clockOf(found.step.hour));
  };
  el('b-time-prev').addEventListener('click', () => jump(-1));
  el('b-time-next').addEventListener('click', () => jump(1));

  /**
   * The whole film, from far enough back to read it in one.
   *
   * The ending the format is built around: every piece in the order it
   * happened, so a viewer sees how the event went rather than being told. It is
   * a **way of looking**, not a place - the clock keeps running underneath it
   * and turning it off puts the camera back exactly where it was.
   *
   * It also takes the camera out of roaming, because a free camera and a fitted
   * one are two answers to the same question and the fitted one has to win while
   * it is on.
   */
  el('b-overview').addEventListener('click', () => {
    state.overview = !state.overview;
    // **The overview is the film unrolling.** Not a second view: the same
    // geometry, with the ring opening out into a long straight strip.
    state.rollTo = state.overview ? 0 : 1;
    if (state.overview) {
      state.playing = false;
    }
    el('b-overview').setAttribute('aria-pressed', String(state.overview));
    say(state.overview
      ? `the whole film: ${route.length} ${route.length === 1 ? 'piece' : 'pieces'}`
      : 'back to the strip');
  });

  // The panel is where everything that is not the clock lives, and it is out of
  // the way until it is wanted.
  el('b-panel').addEventListener('click', () => {
    const shown = el('hud').classList.contains('hidden');
    el('hud').classList.toggle('hidden', !shown);
    el('b-panel').setAttribute('aria-pressed', String(shown));
  });

  // One button per step, built from the route rather than written out, so a
  // longer route does not need the panel edited.
  function buildSteps() {
    const box = el('steps');
    box.innerHTML = '';
    route.forEach((step, i) => {
      const button = document.createElement('button');
      // A step is called by the hour it happens at. Its number is still what
      // orders it, and is still what everything else refers to; the clock is
      // what a person reading the strip actually wants to see. A step with no
      // hour keeps its number, because the clock is optional and always was.
      button.textContent = typeof step.hour === 'number' ? clockOf(step.hour) : String(i + 1);
      button.title = `step ${i + 1}`;
      button.dataset.v = String(i);
      button.addEventListener('click', () => {
        state.pinned = i;
        state.playing = false;
        leaveOverview();
        // Pinning a step is also choosing which one to work on, so the panel
        // follows rather than making you say it twice.
        paintStep();
      });
      box.append(button);
    });
    el('r-from').max = String(route.length);
  }

  el('b-play').addEventListener('click', () => {
    // Playing is watching the route, not scrubbing it, so the bar lets go.
    state.scrubbing = false;
    state.playing = !state.playing;
    paintClock();
  });
  el('b-restart').addEventListener('click', () => {
    state.clock = 0; state.pinned = null; toRoute(); sync();
  });
  el('b-save').addEventListener('click', download);
  el('b-open').addEventListener('click', () => el('file').click());
  el('file').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await apply(parse(await file.text()));
      say(`opened ${file.name}`);
    } catch (error) {
      say(isRefusal(error) ? error.message : `could not open ${file.name}`);
    }
    event.target.value = '';
  });
  el('b-frame').addEventListener('click', async () => {
    const framing = tidy(currentRoute().framing);
    const text = `{ framing: ${JSON.stringify(framing)}, hold: 5000, approachTime: 3000 },`;
    try {
      await navigator.clipboard.writeText(text);
      say('framing copied');
    } catch {
      say('clipboard refused; the framing is in the console');
    }
    console.log(text);
  });

  // The object controls act on whatever is selected, and are dead when nothing is.
  const objectSliders = [
    ['r-rot', (p) => (p.rot ?? 0), (p, v) => rotateBy({ ...p, rot: 0 }, v), (v) => `${v} deg`],
    ['r-scale', (p) => (p.scale ?? 1) * 100, (p, v) => ({ ...p, scale: v / 100 }), (v) => `${v}%`],
    ['r-from', (p) => (p.from ?? 0) + 1, (p, v) => ({ ...p, from: v - 1 }), (v) => `${v}`],
  ];
  function buildObjectSliders() {
    for (const [id, , change, format] of objectSliders) {
      const input = el(id);
      const label = el(id.replace('r-', 'v-'));
      input.addEventListener('input', () => {
        label.textContent = format(Number(input.value));
        if (state.selected < 0) return;
        reposition(state.selected, change(layout[state.selected], Number(input.value)));
      });
    }
  }

  function paintObject() {
    const chosen = state.selected >= 0 ? layout[state.selected] : null;
    for (const [id, read, , format] of objectSliders) {
      const input = el(id);
      input.disabled = !chosen;
      const value = chosen ? Math.round(read(chosen)) : Number(input.min);
      input.value = String(value);
      el(id.replace('r-', 'v-')).textContent = chosen ? format(value) : '-';
    }
  }

  function paintPanel() {
    roundSlider.set(Math.round(roundness * 100));
    shadeSlider.set(Math.round(smoothing * 100));
    cubeSlider.set(Math.round(cubeScale * 100));
    surfaceSeg.paint();
    weatherSeg.paint();
    plateSlider.set(Math.round(state.plate * 100));
    buildSteps();
    paintClock();
    paintObject();
    paintAreas();
    paintLibrary();
    paintHeld();
    paintReel();
  }

  /**
   * Everything that actually runs, gathered into one place at the end.
   *
   * **This is the fix for a bug that happened four times.** Everything above is
   * a declaration; nothing above executes. A statement part way down the file
   * runs while the declarations below it are still in their dead zone, which is
   * how `rebuild()` - once a thousand lines above the state it touches - kept
   * reaching things that did not exist yet: `state`, `keyFor`, `slider`.
   *
   * Add code anywhere above this and it cannot run too early, because nothing
   * up there runs at all.
   */
  function begin() {
    indexTextures();
    uploadAreas();
    toggleMove('orbit', 'b-orbit');
    toggleMove('push', 'b-push');
    buildSwatches();
    buildObjectSliders();
    rebuild();
    // The pieces have to be standing before anything asks where the camera is.
    restage();
    refreshStrip();
    paintReel();
    // Whatever was being worked on last time, if anything.
    paintPanel();
    sync();

  // After the first frame, so the scene is on screen before a few megabytes of
  // models are fetched and parsed.
  // Packs first, then whatever was being worked on. Restoring before the
  // library exists means the canvas refers to models that are not there yet.
  requestAnimationFrame(async () => {
    await loadPacks();
    // The starting arrangement may name models from a pack, which are only
    // listed until something asks for them. Read them now and build again, or
    // the opening scene would drop every one of them as "not in the library".
    const fromPacks = [...new Set(PLACEMENTS.map((p) => p.model))]
      .filter((name) => !recipes[name] && sources[name]);
    if (fromPacks.length) {
      await Promise.all(fromPacks.map((name) => materialise(name).catch(() => null)));
      // Only if the canvas is still the one this frame started with. Laying the
      // opening arrangement over something the user has already changed is
      // startup overwriting work, and it reads as the edit never happening.
      if (!edited) {
        layout = PLACEMENTS.map((p) => ({ ...p, at: [...p.at] }));
        rebuild();
      }
    }
    if (!edited && await restore()) say('picked up where you left off');
    paintPanel();
  });

  let last = performance.now();
  let frames = 0, fpsClock = 0;

  function frame(now) {
    const delta = Math.min((now - last) / 1000, 0.1);
    last = now;

    frames++; fpsClock += delta;
    if (fpsClock > 0.5) {
      el('s-fps').textContent = `${Math.round(frames / fpsClock)} fps`;
      frames = 0; fpsClock = 0;
    }

    // Smooth walking: ease the velocity toward what the keys are asking for,
    // then move by time rather than by keypress.
    const wants = { forward: 0, right: 0, up: 0 };
    for (const key of held) {
      if (WALK[key]) {
        wants.forward += WALK[key][0];
        wants.right += WALK[key][1];
      }
      if (RISE[key]) wants.up += RISE[key];
    }
    const ease = 1 - Math.exp(-delta * WALK_EASE);
    velocity.forward += (wants.forward - velocity.forward) * ease;
    velocity.right += (wants.right - velocity.right) * ease;
    velocity.up += (wants.up - velocity.up) * ease;

    // **Climbing is all that is left of walking.** The camera does not travel
    // any more - the film does - so forward and sideways have nowhere to go.
    // Height stays, because looking down on a piece from higher up is a
    // composition rather than a journey.
    if (Math.abs(velocity.up) > 0.001) {
      adjustCamera((f) => rise(f, velocity.up * RISE_SPEED * delta));
    }
    velocity.forward = velocity.right = 0;

    let framing;
    let step = state.pinned ?? 0;
    let stepT = 1;
    // How far through the flight into this step the route is. An object that
    // travels is exactly this far along its line; settled on a step means the
    // move is over. Roaming shows the world as the story left it, so it is 1.
    let arrive = 1;
    let weather = resolveWeather(skyOf(route[step]));

    // How long this shot has been held. A camera move is measured from the
    // start of its own shot rather than from the clock on the wall, so a take
    // plays the same way twice - which is the whole reason play mode carries no
    // interface.
    if (state.shotAt === null || state.shotAt === undefined) state.shotAt = now;
    let shotHeld = (now - state.shotAt) / 1000;

    // **There is one camera and it is on the strip.** The roaming branch that
    // used to sit here was a second answer to "where is the camera", and having
    // two was the bug: one drag moved the camera off the film, and cycling
    // through the steps changed nothing on screen from then on.
    {
      // **A film with no length cannot be played.** `duration` is nought with
      // no pieces, and a modulo by nought is NaN - which then spreads into the
      // clock, the framing and everything downstream of them.
      if (state.playing && duration > 0) {
        state.clock = (state.clock + delta) % duration;
        state.scrubbing = false;
      } else if (state.playing) {
        // Nothing to play. Stopping is what lets the paused branch below apply
        // the hour to the sky, which is the difference between a lit world and
        // a black one.
        state.playing = false;
      }

      const at = currentRoute();
      // Time into this hold, so a move restarts with every shot rather than
      // carrying on from the last one.
      if (at.phase === 'hold') shotHeld = (at.into ?? 0) * ((route[at.step]?.hold ?? 0) / 1000);
      framing = drift(
        at.phase === 'fly' ? at.framing : autoMove(at.framing, shotHeld, state),
        now / 1000,
      );
      step = at.step;
      el('mode').textContent = state.playing ? at.phase : 'paused';
      el('mode').className = 'route';
      el('s-step').textContent = `${at.step + 1} / ${route.length}`;

      if (at.phase === 'fly' && route[at.step + 1]) {
        // A flight is where the weather turns and the next part of the canvas
        // arrives. Both land together, which reads as one change rather than two.
        const flight = (route[at.step + 1].approachTime ?? 2500) / 1000;
        const into = Math.min(1, Math.max(0, at.into ?? 0));
        weather = lerpWeather(skyOf(route[at.step]), skyOf(route[at.step + 1]), into);
        step = at.step + 1;
        stepT = Math.min(1, (into * flight * 1000) / SOLIDIFY);
        // Eased rather than linear, so an object that walks somewhere starts
        // and stops rather than sliding at one speed, which reads as a prop
        // being pushed.
        arrive = easeInOut(into);
      }
    }

    // --- the clock ------------------------------------------------------------
    //
    // **Moving through the day moves you along the film.** The strip runs in
    // time, so dragging the bar travels from one piece to the next and the world
    // slides past a camera that is only ever turning.
    //
    // This reads like a reversal of the rule written a day earlier - "moving
    // through the day never touches the camera" - and it is not. That rule
    // existed because scrubbing **snapped the framing back to a step's own
    // composition**, so the view you had chosen was taken away every time the
    // bar moved. What travels now is the camera's *position along the strip*;
    // how it is looking - the yaw, the pitch, how wide - is untouched.
    //
    // It sits outside the roam-or-route branch because the clock works the same
    // way whichever the camera is in, rather than taking its mode away.
    if (!state.playing) {
      // A route that says something about this hour is used; otherwise this is
      // an empty day, and the playground's own weather lights it. **Either way
      // the hour applies**, which is what makes an empty canvas a place at a
      // time rather than a dead bar.
      // The staged route, so scrubbing the clock travels along the strip and the
      // world slides past. Reading the unstaged one is what made every step
      // frame the same patch of ground.
      const moment = routeAtHour(onStrip(), state.hour);
      if (moment) {
        step = moment.step;
        stepT = moment.into;
        arrive = easeInOut(moment.into);
        // **Travel along the strip**, so a step is somewhere rather than a
        // different weather where you already are. Left alone while roaming,
        // because the camera has been taken by hand, and while the overview is
        // on, because that is the whole film rather than a place on it.
        if (!state.overview) {
          framing = drift(moment.framing, now / 1000);
        }
        // The step being **worked on**, which is the one the bar and the panel
        // both name. `moment.step` is the step being arrived at, which is what
        // the ghosting needs and is a step ahead of where you think you are:
        // it read "2 / 2" everywhere above the first step's hour.
        el('s-step').textContent = `${editing() + 1} / ${route.length}`;
      } else {
        el('s-step').textContent = route.length ? `${editing() + 1} / ${route.length}` : 'none';
      }
      weather = skyNow(moment);
      if (state.scrubbing || !route.length) {
        el('mode').textContent = clockOf(state.hour);
        el('mode').className = 'route';
      }
    }

    // Forcing a weather while roaming keeps the hour of the step being worked
    // on, so looking at a scene in a different weather does not also move the sun.
    if (state.forcedWeather) {
      weather = resolveWeather(skyOf({ weather: state.forcedWeather, hour: route[editing()]?.hour }));
    }
    // Depth fog is left to the weather. It cannot separate the film - a
    // neighbouring piece is beside the camera, not beyond it - so the veil
    // below does that job, and doing both only made the scene itself hazy.
    scarsFor(step);
    el('s-rain').textContent = `${Math.round((weather.rain ?? 0) * 100)}%`;

    const [cx, cz] = centreOf(framing);
    el('s-height').textContent = (framing.y ?? 0).toFixed(1);
    el('s-centre').textContent = `${cx.toFixed(1)}, ${cz.toFixed(1)}`;
    el('s-width').textContent = framing.w.toFixed(1);
    el('s-angles').textContent = `${(framing.pitch ?? 25).toFixed(0)} / ${(framing.yaw ?? 0).toFixed(0)}`;

    // **The veil is centred on the piece being looked at**, not on the camera,
    // so what falls away is everything that is not this moment of the film. It
    // opens with the shot, so the overview shows the whole strip rather than a
    // hole cut in it.
    // **Halo mode: the camera stops travelling and the world turns.** What was
    // worked out above is where the camera would stand on the flat strip; when
    // the film is rolled, that place is brought to the top of the ring instead
    // and the camera sits still at the origin. Blended by the roll, so the
    // unfurl moves the camera and the world together.
    // **The ring turns rather than cutting.** An arrow or a piece picked off
    // the list asks the clock to travel; dragging the bar sets the hour
    // directly and clears the target, because an animation fighting the hand on
    // the mouse feels broken.
    if (state.hourTo !== null) {
      state.hour = easeRoll(state.hour, state.hourTo, delta, 4.5);
      if (state.hour === state.hourTo) state.hourTo = null;
      paintClock();
    }

    // Gentle. The unfurl is the best thing the app does and it is worth
    // watching, so it is slower than a control that is merely getting out of
    // the way would be.
    state.roll = easeRoll(state.roll, state.rollTo, delta, 2.2);
    if (state.roll > 0.0005) {
      framing = lerpFraming(framing, framingOf(state.rig, 0, PIECE), state.roll, 0);
    }

    const seen = veilFor(framing.w, PIECE);
    // **Fog opens with the shot too.** Fixed in world units it is right for one
    // piece and swallows the whole film at any wider one, which is what turned
    // everything the colour of the sky in the overview.
    const haze = fogFor(framing.w, PIECE, {
      near: weather.fogNear ?? 26,
      far: weather.fogFar ?? 180,
    });
    weather = { ...weather, fogNear: haze.near, fogFar: haze.far };

    const { matrix, eye, target } = viewProjection(framing);
    renderer.draw({
      focus: [focusX(), 0],
      veilNear: seen.near,
      veilFar: seen.far,
      roll: state.roll,
      radius: ringSize(),
      solid: state.solid,
      // The sky needs where the camera looks as well as where it is, so it can
      // turn a pixel into a direction and put the sun where it actually is.
      matrix, eye, target, time: now / 1000, weather,
      arrive,
      selected: state.selected,
      surface,
      smooth: smoothing,
      // While roaming, show the canvas as the story left it rather than ghosting
      // half of it: roaming is for looking at the world, not for playing it.
      step,
      stepT,
    });
    drawTags(matrix, step, arrive, { focus: [cx, cz], near: seen.near, far: seen.far });
    paintInk();

    const fill = renderer.view.fill;
    const percent = Math.round(fill * 100);
    el('s-fill').textContent = percent >= 100
      ? '100%'
      : `${percent}%  (enter)`;
    el('s-fill').style.color = percent >= 99 ? '#7fd4a0' : '#e8c07f';

    requestAnimationFrame(frame);
  }
    requestAnimationFrame(frame);
  }

  begin();
}

/**
 * Start the app.
 *
 * The one thing this module does when asked, and nothing it does when merely
 * imported - which is what lets a test import it, look at it, and start it
 * deliberately rather than extracting it out of a page as text.
 */
export function start() {
  return main().catch((error) => {
    window.__trail.fail('Something failed while starting up.', report(error));
    console.error(error);
  });
}

/** Everything worth knowing about a failure, in the order it is worth knowing it. */
function report(error) {
  const lines = [error?.message ?? String(error)];

  // The first frame inside the page is the one that matters. The rest of the
  // stack is usually the browser's own machinery.
  const frames = String(error?.stack ?? '')
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.includes(location.origin) || line.includes('at '));
  if (frames.length) {
    lines.push('', 'Where:', ...frames.slice(0, 4).map((f) => `  ${f}`));
  }

  lines.push('', `Served from: ${location.href}`);
  lines.push('The full error and its stack are in the browser console.');
  return lines.join('\n');
}
