import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { readVox } from '../lib/vox.js';
import { VERSION } from '../lib/canvas.js';

const readVoxCount = (bytes) => readVox(bytes).models.length;

// Actually start the app.
//
// index.html is the one file the other tests cannot reach, and it has now
// produced two failures that a single run would have caught: a function reading
// a constant declared later, and an element id that no longer existed. Neither
// is subtle once the code runs; both are invisible to reading.
//
// So this stubs a browser well enough to evaluate the page's module, load the
// models, build the scene and draw a few frames. It proves nothing about how
// anything looks, and it proves the thing that keeps breaking: that it runs.

const root = fileURLToPath(new URL('../', import.meta.url));

/** A DOM element that answers to everything the page asks of it. */
class FakeElement {
  constructor(id = '', tagName = 'DIV') {
    this.id = id;
    // A real element knows what it is, and code asks: keyboard shortcuts have
    // to stay out of anything being typed into, and they decide that from the
    // tag. Without it every fake element looked like a div and a correct guard
    // looked broken.
    this.tagName = String(tagName).toUpperCase();
    this.textContent = '';
    // Setting innerHTML to '' empties an element in a browser, and anything
    // that rebuilds a list does exactly that before refilling it. A stub that
    // kept its children made every rebuilt list look as though it had appended
    // instead of replaced, which is a working implementation looking broken -
    // the same shape of stub gap this file has now hit four times.
    this._html = '';
    // An empty text input reads as '', not '0'. Defaulting to '0' made the
    // library's filter box look as though it contained "0", which filtered out
    // every model and hid the fact that no previews were being drawn.
    this.value = '';
    this.min = '0';
    this.max = '100';
    this.disabled = false;
    this.width = 1600;
    this.height = 900;
    this.clientWidth = 1600;
    this.clientHeight = 900;
    this.style = {};
    this.dataset = {};
    this.files = [];
    this.children = [];
    this.listeners = new Map();
    this.classList = {
      add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false,
    };
  }

  get innerHTML() { return this._html; }

  set innerHTML(value) {
    this._html = String(value);
    if (this._html === '') this.children = [];
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }

  removeEventListener() {}
  setAttribute() {}
  getAttribute() { return null; }
  append(...kids) { this.children.push(...kids); }
  appendChild(kid) { this.children.push(kid); }
  querySelectorAll() { return []; }
  closest() { return null; }
  click() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 1600, height: 900 }; }
  getContext(kind) { return kind === 'webgl2' ? fakeGl(glCalls) : fake2d(); }
  showModal() { this.open = true; }
  close() { this.open = false; }
  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() { return false; }
  focus() {}
}

// What the 2D layers were asked to draw. A preview that never reaches
// putImageData is a preview that did not happen, and the panel would be empty.
let drawn2d = [];

// What the renderer asked the graphics context to do. A stub that only says
// yes cannot tell which of two paths the page took, and "was the film drawn at
// all" is exactly that kind of question.
let glCalls = [];

const fake2d = () => new Proxy({}, {
  get: (_, name) => (name === 'measureText'
    ? () => ({ width: 40 })
    : (...args) => { drawn2d.push([name, ...args]); }),
});

/**
 * A WebGL2 context that says yes to everything.
 *
 * Constants are ALL_CAPS and get a distinct number each; anything else is a
 * method and does nothing. The two calls whose answers matter are answered.
 */
function fakeGl(calls = []) {
  const constants = new Map();
  const target = {};
  const gl = new Proxy(target, {
    get(_, name) {
      if (typeof name !== 'string') return undefined;
      if (name in target) return target[name];
      if (/^[A-Z0-9_]+$/.test(name)) {
        if (!constants.has(name)) constants.set(name, constants.size + 1);
        return constants.get(name);
      }
      // Recorded, because a stub that only says yes cannot tell which of two
      // paths the page took. Drawing cubes and drawing a surface are different
      // calls, and the difference is the whole look of the app.
      return (...args) => { calls.push([name, ...args]); return {}; };
    },
  });
  target.getShaderParameter = () => true;
  target.getProgramParameter = (_, pname) => (pname === gl.ACTIVE_UNIFORMS ? 0 : true);
  target.getShaderInfoLog = () => '';
  target.getProgramInfoLog = () => '';
  target.getAttribLocation = () => 0;
  target.getUniformLocation = () => ({});
  return gl;
}

function stubBrowser({ frames = 3, ids = new Set(), tags = new Map() } = {}) {
  const failures = [];
  const byId = new Map();
  /**
   * Only ids that actually exist in the markup resolve.
   *
   * A stub that answers to every id can never catch code left behind pointing
   * at an element that was deleted, which is exactly how a removed pair of
   * buttons took the page down.
   */
  const element = (id) => {
    if (!ids.has(id)) return null;
    if (!byId.has(id)) byId.set(id, new FakeElement(id, tags.get(id) ?? 'DIV'));
    return byId.get(id);
  };

  const store = new Map();
  const requested = [];
  // Key handlers were bound to a listener that did nothing, so every hotkey on
  // the page was invisible to this test. Recording them is what makes "does a
  // shortcut fire while somebody is typing" a question that can be asked.
  const keys = new Map();
  drawn2d = [];
  glCalls = [];
  let clock = 0;
  let drawn = 0;
  let closed = false;

  const win = {
    __trail: { started: false, fail: (title, detail) => failures.push(`${title} ${detail}`) },
    devicePixelRatio: 1,
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  // Some of these already exist on globalThis as getters, so they have to be
  // defined rather than assigned.
  const define = (values) => {
    for (const [name, value] of Object.entries(values)) {
      Object.defineProperty(globalThis, name, {
        value, writable: true, configurable: true, enumerable: true,
      });
    }
  };

  define({
    window: win,
    document: {
      getElementById: element,
      createElement: (tag) => new FakeElement('', tag),
      addEventListener: () => {},
      body: new FakeElement(),
      documentElement: new FakeElement(),
      fullscreenElement: null,
      exitFullscreen: async () => {},
    },
    location: { href: 'http://localhost:3000/', protocol: 'http:' },
    navigator: { clipboard: { writeText: async () => {} } },
    localStorage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, v),
      removeItem: (k) => store.delete(k),
    },
    // Time advances per frame, not per reading. A clock that jumps on every
    // call makes any "work for N milliseconds" loop exit before doing anything,
    // which silently hid the library's previews.
    performance: { now: () => clock },
    requestAnimationFrame: (fn) => {
      // A handful of frames, then stop, so the draw path runs without looping.
      // A closed stub schedules nothing: a page from an earlier test keeps
      // asking for frames forever, and it must not touch this test's counters.
      if (!closed && drawn++ < frames) queueMicrotask(() => { clock += 16; fn(clock); });
      return drawn;
    },
    addEventListener: (type, fn) => {
      if (!keys.has(type)) keys.set(type, []);
      keys.get(type).push(fn);
    },
    removeEventListener: () => {},
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    URL: globalThis.URL,
    Blob: class { constructor() {} },
    // The library draws model previews into these. Without it the thumbnail
    // path throws in a frame callback and the test quietly covers nothing.
    ImageData: class {
      constructor(data, width, height) {
        this.data = data;
        this.width = width;
        this.height = height;
      }
    },
    fetch: async (url) => {
      const path = String(url).replace('http://localhost:3000/', '');
      requested.push(path);
      try {
        // Read as bytes. A model pack is binary, and reading it as text would
        // fail quietly, which would make a test that loads packs prove nothing.
        const bytes = readFileSync(new URL(path, `file://${root.replace(/\\/g, '/')}`));
        return {
          ok: true,
          status: 200,
          json: async () => JSON.parse(bytes.toString('utf8')),
          text: async () => bytes.toString('utf8'),
          arrayBuffer: async () => bytes.buffer.slice(
            bytes.byteOffset, bytes.byteOffset + bytes.byteLength,
          ),
        };
      } catch {
        return { ok: false, status: 404, statusText: 'Not Found' };
      }
    },
  });

  globalThis.URL.createObjectURL = () => 'blob:stub';
  globalThis.URL.revokeObjectURL = () => {};

  return {
    failures, win, element, requested,
    /** Press a key at something, the way a browser would. */
    press: (key, target = null) => {
      for (const fn of keys.get('keydown') ?? []) {
        fn({ key, target, preventDefault: () => {}, stopPropagation: () => {} });
      }
    },
    frames: () => drawn,
    get calls() { return glCalls; },
    drew: (name) => drawn2d.filter((c) => c[0] === name).length,
    // The page asks for a frame every frame, so a fixed budget is spent by the
    // render loop long before a test can interact. This hands back some more.
    allowFrames: (n) => { drawn = Math.max(0, drawn - n); },
    close: () => { closed = true; },
  };
}

const page = () => readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// The app's own source. Assertions about the markup read `page`; assertions
// about what the code does read this. They were one file until the wiring moved
// out of the page, and keeping them apart is what stops a test about behaviour
// quietly passing because a comment in the HTML happened to match.
const app = () => readFileSync(new URL('../lib/app.js', import.meta.url), 'utf8');

// The models the opening arrangement names, read out of the page itself so the
// test cannot drift from what actually ships.
const PLACED = [...app().matchAll(/\{ model: '([^']+)'/g)].map((m) => m[1]);

/**
 * Load the app and run it.
 *
 * It used to be scraped out of index.html as text and written to a scratch
 * file, because that was the only way to reach code living in a script tag.
 * The app is a real module now, so this imports it - which means the thing
 * under test is the thing that ships, rather than a copy of it.
 *
 * The query string is a fresh module for every call: several tests start the
 * app, and each needs its own.
 */
async function runApp() {
  const { start } = await import(`../lib/app.js?t=${Date.now()}${Math.random()}`);
  await start();
  // The app's own startup is asynchronous, so let its promises settle.
  for (let i = 0; i < 80; i += 1) await new Promise((r) => setTimeout(r, 0));
}

/** Every id the markup actually declares. Nothing else will resolve. */
const declaredIds = () => new Set([...page().matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

// What kind of element each id belongs to, so the stub can answer honestly.
const declaredTags = () => new Map(
  [...page().matchAll(/<([a-z]+)\b[^>]*\bid="([^"]+)"/gi)].map((m) => [m[2], m[1]])
);

/**
 * A three-piece strip, as a canvas file.
 *
 * **The app opens empty**, so a test that needs a film has to bring one. This
 * is the demonstration the app used to open on - a house, two people and a car
 * at nine, one person and the car at half past one, one person at quarter past
 * six - moved out of the app and into the one place that still needs it.
 *
 * Written at the **current** version. An older one would be put through the
 * migration that spreads a version 5 canvas along the strip, which rescales
 * every position - so a fixture written at 5 with today's spacing comes out
 * scattered, which is exactly what it did on the first attempt.
 */
const SCENE = () => {
  const pitch = 64;   // DEFAULT_PIECE: 34 wide with a 30 join
  const on = (piece, at) => [at[0] + piece * pitch, at[1], at[2]];
  const marla = { primary: '#e08a3c', hair: '#2b2118', skin: '#d9a97e' };
  const devon = { primary: '#3c7ae0', hair: '#4a3327', skin: '#c68a5e' };
  const frame = { x: 0, z: 0, w: 26, d: 20, pitch: 20, yaw: -8 };
  return {
    trail: VERSION,
    title: 'three pieces',
    objects: [
      { model: 'house1', at: on(0, [-6, 0, -4]), rot: 14, from: 0 },
      { model: 'tree', at: on(0, [7, 0, -5]), from: 0 },
      { model: 'normal-car1', at: on(0, [2.4, 0, 3.2]), rot: -24, from: 0 },
      { model: 'person', at: on(0, [0.6, 0, 1.4]), rot: 200, from: 0, label: 'Marla', tints: marla },
      { model: 'person', at: on(0, [-0.7, 0, 2.1]), rot: 20, from: 0, label: 'Devon', tints: devon },

      { model: 'house1', at: on(1, [-6, 0, -4]), rot: 14, from: 1 },
      { model: 'tree', at: on(1, [7, 0, -5]), from: 1 },
      { model: 'normal-car1', at: on(1, [2.4, 0, 3.2]), rot: -24, from: 1 },
      { model: 'person', at: on(1, [0.6, 0, 1.4]), rot: 200, from: 1, label: 'Marla', tints: marla },

      { model: 'house1', at: on(2, [-6, 0, -4]), rot: 14, from: 2 },
      { model: 'tree', at: on(2, [7, 0, -5]), from: 2 },
      { model: 'person', at: on(2, [0.6, 0, 1.4]), rot: 180, from: 2, label: 'Marla', tints: marla },
    ],
    steps: [
      { framing: { ...frame }, hold: 5000, weather: 'clear', hour: 9 },
      { framing: { ...frame }, hold: 5000, approachTime: 3200, weather: 'storm', hour: 13.5 },
      { framing: { ...frame }, hold: 9000, approachTime: 4200, weather: 'clear', hour: 18.25 },
    ],
  };
};

/**
 * Open a canvas the way a person does: through the file control.
 *
 * Deliberately not a back door. Anything a test can only reach by a route the
 * user has not got is a route that can rot without a test noticing.
 */
async function openCanvas(stub, canvas = SCENE()) {
  // **Wait for the packs first.** A canvas naming a pack model that has not
  // been read yet has every one of them dropped as "not in the library".
  for (let i = 0; i < 120; i++) await new Promise((r) => setTimeout(r, 0));
  const input = stub.element('file');
  const change = input.listeners.get('change')?.[0];
  assert.ok(change, 'there is no way to open a canvas file');
  await change({
    target: { files: [{ name: 'scene.json', text: async () => JSON.stringify(canvas) }], value: '' },
  });
  for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 0));
}

test('the app opens with nothing on it', async () => {
  // Asked for: "the app should just load and i need to fill it up with objects
  // and steps". It used to open on a three-piece demonstration, which had to be
  // deleted every time and came back over work in progress.
  const stub = stubBrowser({ ids: declaredIds(), tags: declaredTags(), frames: 400 });
  await runApp();
  for (let i = 0; i < 60; i++) await new Promise((r) => setTimeout(r, 0));

  assert.equal(stub.win.__trail.placed(), 0, 'the app opened with objects on the canvas');
  assert.equal(stub.win.__trail.route().length, 0, 'the app opened with steps already in it');
  // And an empty day is still a place: the clock lights it and it draws.
  assert.ok(Number.isFinite(stub.win.__trail.at().hour));
  assert.ok(stub.win.__trail.at().sun, 'an empty day was never drawn');
  assert.deepEqual(stub.failures, [], 'opening empty reported a failure');
});

test('no id is used twice in the markup', () => {
  // **`getElementById` returns the first match and says nothing about the
  // second.** A new "remove everything" button was given the id the pen's
  // "clear" button already had, so both handlers bound to the same element:
  // the pen cleared its marks and the canvas was never touched, with no error
  // anywhere. The stub cannot catch it either - it keys elements by id, so a
  // duplicate is one element to it as well, exactly as in a browser.
  const seen = new Map();
  const twice = [];
  for (const [, id] of page().matchAll(/id="([^"]+)"/g)) {
    seen.set(id, (seen.get(id) ?? 0) + 1);
    if (seen.get(id) === 2) twice.push(id);
  }
  assert.deepEqual(twice, [], `these ids appear more than once: ${twice.join(', ')}`);
});

test('the page starts, loads its models, and draws', async () => {
  const stub = stubBrowser({ ids: declaredIds(), tags: declaredTags(), frames: 60 });
  await runApp();
  // The app opens empty, so this test brings its own film.
  await openCanvas(stub);

  assert.deepEqual(stub.failures, [], 'the page reported a startup failure');
  assert.equal(stub.win.__trail.started, true, 'the module never reached its first line');
  assert.ok(stub.frames() > 1, 'the page never drew a frame');

  // Previews are only drawn while the library is open, so open it the way a
  // click does. A frame callback that throws is swallowed, so what matters is
  // what the previews produced rather than the absence of an error.
  const open = stub.element('b-library').listeners.get('click')?.[0];
  assert.ok(open, 'there is no way to open the library');
  stub.allowFrames(60);
  open();
  for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 0));
  assert.ok(stub.drew('putImageData') > 5,
    `the library drew ${stub.drew('putImageData')} previews; it would open empty`);

  // Placing a model that has tint slots must offer a colour for each of them.
  // The slots, the canvas file and the renderer all supported tinting long
  // before there was any way to do it, so this is the part that was missing.
  // The library shows a page at a time and the figure is well past the first,
  // so it is searched for the way anyone would.
  const filter = stub.element('filter');
  filter.value = 'person';
  filter.listeners.get('input')?.[0]?.();
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));

  const tile = stub.element('library').children.find((c) => c.title === 'person');
  assert.ok(tile, 'searching the library for "person" did not find the figure');
  tile.listeners.get('click')?.[0]?.();
  for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 0));

  const pickers = stub.element('tints').children;
  assert.ok(pickers.length >= 2,
    `a figure has tint slots and the panel offered ${pickers.length} colours`);
  const swatch = pickers[0].children.find((c) => c.type === 'color');
  assert.ok(swatch, 'a tint row has no colour picker in it');
  // And changing one must be accepted rather than throwing in a listener.
  swatch.value = '#123456';
  swatch.listeners.get('input')?.[0]?.();
  assert.deepEqual(stub.failures, [], 'changing a colour reported a failure');

  // A step carries a note about what happens in it. Reading a script was
  // cancelled, so nothing resolves it and nothing is offered from it.
  const box = stub.element('script');
  const placedBefore = stub.win.__trail.placed();
  box.value = 'Marla arrives at the house.';
  box.listeners.get('input')?.[0]?.();
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  assert.equal(stub.win.__trail.route()[0].text, 'Marla arrives at the house.',
    'a step did not keep its note');
  assert.equal(stub.win.__trail.placed(), placedBefore,
    'writing a note put something on the canvas by itself');

  // A step is added and removed from the clock bar, where steps live now. The
  // panel's step editor was taken out for being three editors in one tab.
  {
    const before = stub.win.__trail.route().length;
    stub.element('b-step-add').listeners.get('click')?.[0]?.();
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
    assert.equal(stub.win.__trail.route().length, before + 1, 'adding a step did nothing');

    // The note box writes to the step being worked on, not to the first.
    box.value = 'The dog waited by the car.';
    box.listeners.get('input')?.[0]?.();
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
    const route = stub.win.__trail.route();
    assert.equal(route[1].text, 'The dog waited by the car.',
      'the words went to the wrong step');
    assert.notEqual(route[0].text, route[1].text, 'both steps got the same words');

    stub.element('b-step-remove').listeners.get('click')?.[0]?.();
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
    assert.equal(stub.win.__trail.route().length, before, 'removing a step did nothing');
    assert.deepEqual(stub.failures, [], 'editing the route reported a failure');
  }

  // Every letter on this page does something, so a script box is unusable
  // until the keys stay out of it. Delete removes the selected object; pressed
  // while writing it must remove a character instead and leave the canvas be.
  {
    const before = stub.win.__trail.placed();
    assert.ok(before > 0 && stub.win.__trail.posed(), 'nothing is selected to delete');
    stub.press('Delete', box);
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
    assert.equal(stub.win.__trail.placed(), before,
      'a hotkey fired while typing, so the script box cannot be written in');

    // And it must still work when the keyboard is not somebody's typing.
    stub.press('Delete', { tagName: 'CANVAS' });
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
    assert.equal(stub.win.__trail.placed(), before - 1,
      'blocking keys while typing also stopped them working everywhere else');
  }

  // A rigged model is one entry in the library, and the poses it holds are
  // reached on the placed object. Place it, step it forward, and the object
  // must come out standing in a different pose than it started in.
  filter.value = 'mannequin';
  filter.listeners.get('input')?.[0]?.();
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));

  const rigTile = stub.element('library').children.find((c) => c.title === 'mannequin');
  assert.ok(rigTile, 'the rigged model is not in the library to place');
  {
    rigTile.listeners.get('click')?.[0]?.();
    for (let i = 0; i < 60; i++) await new Promise((r) => setTimeout(r, 0));

    const rows = stub.element('poses').children;
    assert.ok(rows.length, 'a rigged model offered no poses at all');
    const next = rows.flatMap((r) => r.children).find((c) => c.textContent === 'next pose');
    assert.ok(next, 'there is no way to step to the next pose');

    const before = stub.win.__trail.posed();
    next.listeners.get('click')?.[0]?.();
    for (let i = 0; i < 60; i++) await new Promise((r) => setTimeout(r, 0));
    const after = stub.win.__trail.posed();
    assert.ok(before && after && before !== after,
      `the pose did not change: it was ${before} and is ${after}`);
    assert.deepEqual(stub.failures, [], 'changing the pose reported a failure');
  }

  // Browsing converts every model it previews, and a converted model is its
  // geometry - about half a megabyte each, so the whole library at once was a
  // hundred megabytes that was never given back. Page through enough of it to
  // go past the cap and check that something was actually released.
  for (let turn = 0; turn < 4; turn++) {
    stub.allowFrames(80);
    stub.element('b-next').listeners.get('click')?.[0]?.();
    for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 0));
  }
  const held = stub.win.__trail.held();
  assert.ok(held.converted <= 48,
    `${held.converted} converted models are being held and nothing is released`);
  assert.ok(held.previews <= 48 + 60,
    `${held.previews} previews are being held`);

  // The library is meant to be there when the page opens, not dragged in.
  const manifest = JSON.parse(
    readFileSync(new URL('../models/index.json', import.meta.url), 'utf8')
  );
  assert.ok(stub.requested.includes('models/index.json'), 'the manifest was never read');
  for (const name of manifest.recipes) {
    assert.ok(stub.requested.includes(`models/${name}.json`), `${name} was never fetched`);
  }
  // A canvas may name models from a pack, and those are only *listed* in the
  // manifest until something asks for them. If nothing reads them, opening a
  // canvas silently drops every one of them as "not in the library".
  //
  // The app opens empty now, so the arrangement that has to be readable is the
  // one a test opens rather than one the app carries.
  const named = SCENE().objects.map((o) => o.model);
  const fromPacks = manifest.meshes.filter((m) => named.includes(m.name));
  assert.ok(fromPacks.length, 'the test canvas names no pack models at all');
  // Decoded, because a pack folder has spaces in it and `new URL` escapes them
  // on the way out. Comparing the raw path against the escaped one fails for a
  // reason that has nothing to do with what is being tested.
  const asked = stub.requested.map((path) => decodeURIComponent(path));
  for (const mesh of fromPacks) {
    assert.ok(asked.includes(`models/${mesh.file}`),
      `${mesh.name} is in the opening arrangement and was never read, so it was dropped`);
  }

  for (const pack of manifest.packs) {
    assert.ok(stub.requested.includes(`models/${pack.file}`),
      `${pack.file} was never fetched, so the library did not load on open`);
    if (pack.names) {
      assert.ok(stub.requested.includes(`models/${pack.names}`),
        `${pack.names} was never fetched, so the pack would arrive unnamed`);
    }
  }
  stub.close();
});

test('a control that is not in the markup is reported by name', async () => {
  // Removing a control and leaving code that reaches for it is ordinary work
  // gone slightly wrong, and it used to surface as "cannot read properties of
  // null" naming nothing. This checks the complaint, not just the crash.
  const ids = declaredIds();
  ids.delete('b-play');

  const stub = stubBrowser({ ids });
  await runApp();

  assert.equal(stub.failures.length, 1, 'a missing control should stop the page');
  const said = stub.failures[0];
  assert.match(said, /b-play/, 'the failure must name the id that is missing');
  assert.match(said, /markup/i, 'and say where to look for it');
});

test('nothing in the app runs on the way down; it all runs in begin()', () => {
  // The structural fix for a bug that happened four times. A statement part way
  // down a two thousand line function runs while the declarations below it are
  // still in their dead zone, which is how `rebuild()` kept reaching `state`,
  // `keyFor` and `slider` before any of them existed.
  //
  // So the rule is: everything above `begin` is a declaration, and `begin` is
  // the only thing that runs. Code added anywhere above it cannot run early,
  // because nothing up there runs at all.
  const body = app();
  const from = body.indexOf('async function main()');
  const to = body.indexOf('\n  function begin()');
  assert.ok(from >= 0 && to > from, 'main() and begin() are not where this expects them');

  const offenders = [];
  for (const [i, line] of body.slice(from, to).split('\n').entries()) {
    // Statements at main()'s own indent, ignoring declarations and anything
    // that only registers a callback to be run later.
    if (!/^ {2}[a-zA-Z_$]/.test(line)) continue;
    if (/^ {2}(const|let|var|function|async|return|import|export)\b/.test(line)) continue;
    if (/addEventListener|__trail\./.test(line)) continue;
    offenders.push(`${i}: ${line.trim()}`);
  }
  assert.deepEqual(offenders, [],
    'these run on the way down and will read a declaration below them one day');

  assert.ok(/\n {2}begin\(\);\n}/.test(body),
    'begin() is not the last thing main does');
});

test('every element the page reaches for exists in its own markup', () => {
  // The other half of the same class of bug: renaming a panel row and leaving
  // something reading the old id.
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const declared = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const used = new Set(
    [...html.matchAll(/getElementById\('([^']+)'\)|\bel\('([^']+)'\)/g)]
      .map((m) => m[1] ?? m[2])
  );
  const missing = [...used].filter((id) => !declared.has(id));
  assert.deepEqual(missing, [], `the page reads ids that do not exist: ${missing.join(', ')}`);
});

test('every pack named in the manifest has the right number of names', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../models/index.json', import.meta.url), 'utf8')
  );
  for (const pack of manifest.packs) {
    if (!pack.names) continue;
    const names = JSON.parse(
      readFileSync(new URL(`../models/${pack.names}`, import.meta.url), 'utf8')
    ).names;
    // Names applied off by one would mislabel the whole pack, so the count has
    // to match exactly or they are refused at load.
    const bytes = new Uint8Array(readFileSync(new URL(`../models/${pack.file}`, import.meta.url)));
    const models = readVoxCount(bytes);
    assert.equal(names.length, models,
      `${pack.names} has ${names.length} names for ${models} models`);
    assert.equal(new Set(names).size, names.length, `${pack.names} repeats a name`);
  }
});

test('every recipe the manifest lists exists', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../models/index.json', import.meta.url), 'utf8')
  );
  for (const name of manifest.recipes) {
    const at = new URL(`../models/${name}.json`, import.meta.url);
    const recipe = JSON.parse(readFileSync(at, 'utf8'));
    assert.equal(recipe.id, name, `models/${name}.json calls itself "${recipe.id}"`);
  }
});

test('the manifest records where every pack came from', () => {
  // The packs are not in the repository, so this is what makes them
  // replaceable. A pack with no download recorded is a library that cannot be
  // rebuilt on another machine.
  const manifest = JSON.parse(
    readFileSync(new URL('../models/index.json', import.meta.url), 'utf8')
  );
  assert.ok(Array.isArray(manifest.downloads), 'the manifest records no downloads');
  for (const download of manifest.downloads) {
    assert.ok(download.folder, 'a download has no folder');
    assert.ok(!String(download.from).startsWith('UNKNOWN'),
      `${download.folder} has no download URL recorded`);
  }
});

test('anything not established as CC0 is held back rather than offered', () => {
  // The output is monetised video and the rule is CC0 only. A model whose
  // licence has not been established must not appear in the library at all: one
  // that cannot be seen cannot be placed in a video by accident.
  const manifest = JSON.parse(
    readFileSync(new URL('../models/index.json', import.meta.url), 'utf8')
  );
  const entries = [...manifest.packs, ...(manifest.meshes ?? [])];

  // Every licence is either CC0 or an explicit admission that it is not known.
  for (const entry of entries) {
    assert.ok(entry.licence === 'CC0' || entry.licence.startsWith('UNKNOWN'),
      `${entry.file} claims a licence of "${entry.licence}", which is neither`);
  }

  // And the page must gate on it, not merely record it.
  assert.match(app(), /mesh\.licence !== 'CC0'/,
    'the page lists meshes without checking their licence');
});

test('a licence established by hand carries the evidence that established it', () => {
  // Some packs simply shipped without a licence file. Writing CC0 in the
  // manifest is how they become usable, and the rule is that the reason is
  // written down beside it - otherwise a later reader cannot tell an
  // established licence from a guess, and the whole rule quietly rots.
  const manifest = JSON.parse(
    readFileSync(new URL('../models/index.json', import.meta.url), 'utf8')
  );
  const root = new URL('../models/', import.meta.url);
  for (const download of manifest.downloads ?? []) {
    if (download.licence !== 'CC0') continue;
    const folder = new URL(`./${download.folder}/`, root);
    if (!existsSync(folder)) continue;      // Not downloaded on this machine.
    // A licence file sits at the top of a pack, or one folder in when the
    // download wrapped it. Looking only there keeps this off the thousands of
    // model files underneath.
    const licenceIn = (where) => readdirSync(where, { withFileTypes: true })
      .some((entry) => entry.isFile() && /^licen[cs]e[^/\\]*\.txt$/i.test(entry.name));
    const inside = readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => new URL(`./${entry.name}/`, folder));
    if (licenceIn(folder) || inside.some(licenceIn)) continue;
    assert.ok(download.established,
      `${download.folder} is recorded as CC0 with no licence file and no `
      + '"established" note saying how that was determined');
  }
});

test('an exclusion says what it dropped and why, and actually drops it', () => {
  // A pattern that quietly matches more than it meant to would remove models
  // nobody decided to remove, and the manifest would look correct. Both halves
  // are checked: the reason is written down, and nothing listed matches.
  const manifest = JSON.parse(
    readFileSync(new URL('../models/index.json', import.meta.url), 'utf8')
  );
  for (const download of manifest.downloads ?? []) {
    if (!download.exclude?.length) continue;
    assert.ok(download.excluded,
      `${download.folder} excludes models with no note saying why`);

    const patterns = download.exclude.map((p) => new RegExp(p));
    const listed = (manifest.meshes ?? []).filter((m) => m.file.startsWith(`${download.folder}/`));
    for (const mesh of listed) {
      const base = mesh.file.split('/').pop().replace(/\.(obj|gltf|glb)$/i, '');
      const hit = patterns.find((p) => p.test(base));
      assert.ok(!hit, `${mesh.file} matches the exclusion ${hit} yet is still in the library`);
    }
    // And it must not have swallowed the whole pack.
    assert.ok(listed.length > 0,
      `${download.folder} is excluded down to nothing, which is a pattern gone wrong`);
  }
});

test('every mesh listed is in a format the page can actually read', () => {
  // A pack arriving as FBX and being listed anyway would put models in the
  // library that fail the moment they are placed. This is the check that
  // failed to exist when nine packs of OBJ were scanned and two packs of glTF
  // were silently skipped.
  const manifest = JSON.parse(
    readFileSync(new URL('../models/index.json', import.meta.url), 'utf8')
  );
  const kinds = new Set();
  for (const mesh of manifest.meshes ?? []) {
    const kind = mesh.file.split('.').pop().toLowerCase();
    assert.ok(['obj', 'gltf', 'glb'].includes(kind),
      `${mesh.file} is a .${kind}, which nothing here reads`);
    kinds.add(kind);
  }
  // And the page must handle each format the manifest actually uses.
  for (const kind of kinds) {
    assert.match(app(), new RegExp(`'${kind}'`),
      `the manifest lists .${kind} models and the page never mentions that kind`);
  }
});

test('one model of every listed format loads all the way to a grid', async () => {
  // The manifest can name a format the reader mishandles, which no amount of
  // listing catches. This takes the first model of each format and runs it
  // through the real path, and it is skipped for a format whose pack is not
  // downloaded on this machine.
  const manifest = JSON.parse(
    readFileSync(new URL('../models/index.json', import.meta.url), 'utf8')
  );
  const { readObj, readMtl, voxeliseMesh } = await import('../lib/obj.js');
  const { readGltf, readGlb, externalBuffers } = await import('../lib/gltf.js');
  const at = (file) => new URL(`../models/${file}`, import.meta.url);

  const seen = new Set();
  for (const mesh of manifest.meshes ?? []) {
    const kind = mesh.file.split('.').pop().toLowerCase();
    if (seen.has(kind) || !existsSync(at(mesh.file))) continue;
    seen.add(kind);

    let triangles;
    if (kind === 'obj') {
      const mtl = at(mesh.file.replace(/\.obj$/i, '.mtl'));
      triangles = readObj(
        readFileSync(at(mesh.file), 'utf8'),
        readMtl(existsSync(mtl) ? readFileSync(mtl, 'utf8') : '')
      );
    } else if (kind === 'glb') {
      const { json, binary } = readGlb(new Uint8Array(readFileSync(at(mesh.file))));
      triangles = readGltf(json, [binary], { name: mesh.name });
    } else {
      const json = JSON.parse(readFileSync(at(mesh.file), 'utf8'));
      const folder = mesh.file.slice(0, mesh.file.lastIndexOf('/') + 1);
      triangles = readGltf(
        json,
        externalBuffers(json).map((uri) => (uri ? new Uint8Array(readFileSync(at(folder + uri))) : null)),
        { name: mesh.name }
      );
    }

    const grid = voxeliseMesh(triangles, { id: mesh.name, cells: 34 });
    assert.ok(grid.dims.every((d) => d > 0), `${mesh.name} voxelised to nothing`);
    assert.ok(grid.palette.length > 0, `${mesh.name} came out with no colours at all`);
  }
});

test('a model whose colour is in a texture is painted from it, not from its name', async () => {
  // 184 of the library's models keep their colour only in a texture. Before
  // this they were painted from a guess at the material name, which is how the
  // Zombie kit's four named characters came out as one flat colour each - Matt
  // was purple. The failure mode is silent, so this checks the colours rather
  // than the absence of an error.
  const manifest = JSON.parse(
    readFileSync(new URL('../models/index.json', import.meta.url), 'utf8')
  );
  const at = (file) => new URL(`../models/${file}`, import.meta.url);
  const textured = new Set(
    (manifest.downloads ?? []).filter((d) => d.images).map((d) => d.folder)
  );

  // The smallest textured model there is, so this stays a test rather than a
  // measurement. Skipped entirely when no textured pack is downloaded here.
  const candidates = (manifest.meshes ?? [])
    .filter((m) => textured.has(m.file.split('/')[0]) && m.file.endsWith('.obj') && existsSync(at(m.file)))
    .map((m) => ({ ...m, size: statSync(at(m.file)).size }))
    .sort((a, b) => a.size - b.size);
  if (!candidates.length) return;
  const model = candidates[0];

  const { readObj, readMtl, textureRefs } = await import('../lib/obj.js');
  const { readPng, reduce } = await import('../lib/png.js');
  const { paint } = await import('../lib/texture.js');

  const mtl = at(model.file.replace(/\.obj$/i, '.mtl'));
  const mtlText = existsSync(mtl) ? readFileSync(mtl, 'utf8') : '';
  const read = readObj(
    readFileSync(at(model.file), 'utf8'),
    readMtl(mtlText, { model: model.name }),
    textureRefs(mtlText)
  );

  assert.ok(read.images.length, `${model.name} is in a textured pack and names no image`);
  const index = (manifest.downloads ?? []).find((d) => d.folder === model.file.split('/')[0]).images;
  const pictures = read.images.map((image) => {
    const path = index[String(image.uri).toLowerCase()];
    assert.ok(path, `nothing in the manifest says where ${image.uri} is`);
    return reduce(readPng(new Uint8Array(readFileSync(at(path))), { name: image.name }), 512);
  });

  const done = paint(read, pictures);
  assert.ok(done.painted > 0, `${model.name} has a texture and none of it reached a face`);
  assert.notDeepEqual(done.colours, read.colours,
    `${model.name} came out the same colours its material names would have given`);
});

test('placing a textured model makes the app read its texture', async () => {
  // The modules above are pure and tested on their own. This is the wiring:
  // that the page finds the image the manifest points at, decodes it, and holds
  // on to it - which is what makes browsing a pack of sixty models one decode
  // rather than sixty.
  const manifest = JSON.parse(
    readFileSync(new URL('../models/index.json', import.meta.url), 'utf8')
  );
  const at = (file) => new URL(`../models/${file}`, import.meta.url);
  const textured = new Set(
    (manifest.downloads ?? []).filter((d) => d.images).map((d) => d.folder)
  );
  const candidates = (manifest.meshes ?? [])
    .filter((m) => textured.has(m.file.split('/')[0]) && existsSync(at(m.file)))
    .map((m) => ({ ...m, size: statSync(at(m.file)).size }))
    .sort((a, b) => a.size - b.size);
  if (!candidates.length) return;
  const model = candidates[0];

  const stub = stubBrowser({ ids: declaredIds(), tags: declaredTags(), frames: 60 });
  await runApp();
  stub.allowFrames(200);
  stub.element('b-library').listeners.get('click')?.[0]?.();

  const filter = stub.element('filter');
  filter.value = model.name;
  filter.listeners.get('input')?.[0]?.();
  for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 0));

  const tile = stub.element('library').children.find((c) => c.title === model.name);
  assert.ok(tile, `searching the library for "${model.name}" did not find it`);
  tile.listeners.get('click')?.[0]?.();
  for (let i = 0; i < 200; i++) await new Promise((r) => setTimeout(r, 0));

  assert.deepEqual(stub.failures, [], 'placing a textured model reported a failure');
  const held = stub.win.__trail.held();
  assert.ok(held.textures > 0,
    `placing ${model.name} decoded no texture, so it was painted from its material name`);
  assert.ok(held.textureBytes > 0, 'a texture was counted but weighs nothing');
});

test('the new controls reach the canvas: a name, an hour, a move and a place', async () => {
  // Five features landed at once and every one of them is a control writing to
  // the canvas file. The modules under them are pure and tested on their own;
  // what this checks is that the panel is actually wired to them, which is the
  // half that has broken before.
  const stub = stubBrowser({ ids: declaredIds(), tags: declaredTags(), frames: 60 });
  await runApp();
  // The app opens empty, so this test brings its own film.
  await openCanvas(stub);
  stub.allowFrames(120);
  assert.deepEqual(stub.failures, [], 'the page reported a startup failure');

  // A name tag. The layer that draws these has existed since the first build
  // and there was never a way to set one.
  const library = stub.element('b-library').listeners.get('click')?.[0];
  library();
  const filter = stub.element('filter');
  filter.value = 'person';
  filter.listeners.get('input')?.[0]?.();
  for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0));
  const tile = stub.element('library').children.find((c) => c.title === 'person');
  assert.ok(tile, 'the figure was not in the library');
  tile.listeners.get('click')?.[0]?.();
  for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 0));

  const label = stub.element('o-label');
  assert.equal(label.disabled, false, 'the name field should be live once something is selected');
  label.value = 'Marla';
  label.listeners.get('input')?.[0]?.();
  assert.equal(stub.win.__trail.canvas().objects.at(-1).label, 'Marla',
    'the name never reached the canvas');

  // The hour. The opening route carries times, because a step is named by its
  // hour now, so this checks the slider changes it rather than creates it.
  assert.equal(typeof stub.win.__trail.canvas().steps[0].hour, 'number',
    'the opening route should carry times, since a step is named by its hour');
  // When a step happens is set by dragging its mark along the bar. The slider
  // that used to do it went with the step tab: the bar is the route editor now.
  const mark = stub.element('ticks').children[0];
  const track = stub.element('track');
  track.getBoundingClientRect = () => ({ left: 0, top: 0, width: 240, height: 26 });
  mark.setPointerCapture = () => {};
  mark.hasPointerCapture = () => false;
  mark.listeners.get('pointerdown')?.[0]?.({ pointerId: 1, clientX: 90 });
  // Three quarters along a 240-wide day is six in the evening.
  mark.listeners.get('pointermove')?.[0]?.({ pointerId: 1, clientX: 180 });
  mark.listeners.get('pointerup')?.[0]?.({ pointerId: 1, clientX: 180 });
  for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0));
  const hours = stub.win.__trail.canvas().steps.map((s) => s.hour);
  assert.ok(hours.includes(18), `dragging a mark did not move when a step happens: ${hours}`);
  // And the route follows the clock. It is walked in array order and read in
  // time order, so a step dragged earlier has to move in the route as well or
  // it would show earlier on the bar and still play in its old place.
  assert.deepEqual(hours, [...hours].sort((a, b) => a - b),
    `the route is not in the order it happens: ${hours}`);

  // The two camera moves are switches on the camera, not something a step
  // carries: nothing the clock does may take the view from whoever composes it.
  stub.element('b-orbit').listeners.get('click')?.[0]?.();
  assert.equal(stub.win.__trail.at().orbit, 1, 'orbiting never reached the camera');
  assert.equal(stub.win.__trail.canvas().steps[0].orbit, undefined,
    'a camera move must not be saved on a step any more');
  stub.element('b-orbit').listeners.get('click')?.[0]?.();
  assert.equal(stub.win.__trail.at().orbit, 0, 'it could not be turned off');

  assert.deepEqual(stub.failures, [], 'one of the new controls reported a failure');
});

test('a step is named by its hour, and moving one drags its references with it', async () => {
  const stub = stubBrowser({ ids: declaredIds(), tags: declaredTags(), frames: 60 });
  await runApp();
  // The app opens empty, so this test brings its own film.
  await openCanvas(stub);
  stub.allowFrames(120);
  assert.deepEqual(stub.failures, [], 'the page reported a startup failure');

  // The strip is named by the clock rather than by 1, 2, 3.
  const labels = stub.element('steps').children.map((b) => b.textContent);
  assert.ok(labels.every((l) => /^\d{2}:\d{2}$/.test(l)),
    `the step strip should read as times, and reads ${labels.join(', ')}`);

  const before = stub.win.__trail.canvas();
  assert.ok(before.steps.length >= 3, 'this test needs a route to rearrange');
  const wasLast = before.steps.at(-1).hour;
  // Something in the opening arrangement points at the last step, which is what
  // makes this worth checking at all.
  // A saved canvas leaves out defaults, so "appears at the first step" is an
  // absent `from` rather than a zero. Reading it as a zero finds nothing and
  // makes a working rearrangement look broken.
  const startsAt = (o) => o.from ?? 0;
  const pointing = before.objects.filter((o) => startsAt(o) === before.steps.length - 1);
  assert.ok(pointing.length, 'nothing in the opening scene appears at the last step');

  // Pin the last step, by clicking its mark on the bar.
  const marks = stub.element('ticks').children;
  marks[marks.length - 1].listeners.get('click')?.[0]?.();
  assert.equal(stub.win.__trail.at().step, before.steps.length - 1,
    'clicking the last mark did not select it');
  assert.ok(typeof wasLast === 'number', 'the last step should happen at a time');

  // Removing it must not leave anything pointing past the end of the route.
  stub.element('b-step-remove').listeners.get('click')?.[0]?.();
  const shorter = stub.win.__trail.canvas();
  assert.equal(shorter.steps.length, before.steps.length - 1, 'the step was not removed');
  for (const object of shorter.objects) {
    assert.ok(startsAt(object) < shorter.steps.length,
      `${object.model} appears at a step that is no longer there`);
  }
  assert.deepEqual(stub.failures, [], 'rearranging the route reported a failure');
});

test('the clock bar moves through the day, and the panel gets out of the way', async () => {
  const stub = stubBrowser({ ids: declaredIds(), tags: declaredTags(), frames: 60 });
  await runApp();
  // The app opens empty, so this test brings its own film.
  await openCanvas(stub);
  stub.allowFrames(120);
  assert.deepEqual(stub.failures, [], 'the page reported a startup failure');

  // A mark on the bar for every step that has a time.
  const marks = stub.element('ticks').children;
  const timed = stub.win.__trail.route().filter((s) => typeof s.hour === 'number');
  assert.equal(marks.length, timed.length,
    'the bar should carry one mark per step that happens at a time');
  assert.ok(marks.length >= 2, 'this test needs a day with something in it');

  // Clicking a mark lands on that step exactly.
  marks[marks.length - 1].listeners.get('click')?.[0]?.();
  const last = stub.win.__trail.route().length - 1;
  assert.equal(stub.win.__trail.at().step, last, 'clicking the last mark did not go there');

  // Stepping back through the day, by time rather than by number.
  stub.element('b-time-prev').listeners.get('click')?.[0]?.();
  assert.ok(stub.win.__trail.at().step < last, 'the previous step was never reached');

  // And the panel hides and comes back.
  const hud = stub.element('hud');
  const toggle = stub.element('b-panel').listeners.get('click')?.[0];
  assert.ok(toggle, 'there is no way to hide the panel');
  let hidden = false;
  hud.classList.toggle = (name, on) => { if (name === 'hidden') hidden = on; };
  hud.classList.contains = () => hidden;
  toggle();
  assert.equal(hidden, true, 'the panel did not hide');
  toggle();
  assert.equal(hidden, false, 'the panel did not come back');

  assert.deepEqual(stub.failures, [], 'the clock reported a failure');
});

test('remove everything clears the canvas and gives the memory back', async () => {
  // Asked for because a canvas keeps what has been placed on it whether or not
  // there are any steps - that is what makes an empty day a playground - so
  // objects outlive the steps they were put there for.
  const stub = stubBrowser({ ids: declaredIds(), tags: declaredTags(), frames: 3000 });
  await runApp();
  // The app opens empty, so this test brings its own film.
  await openCanvas(stub);
  const settle = async () => {
    for (let i = 0; i < 25; i++) await new Promise((r) => setTimeout(r, 0));
  };

  // **Let startup finish first.** The packs load and the last canvas is
  // restored in a deferred frame, and that frame ends by assigning the opening
  // arrangement to `layout` - so clearing while it is still in flight is simply
  // undone. Waited for by watching the canvas stop changing rather than by
  // guessing a number of turns.
  let settled = -1;
  for (let i = 0; i < 40 && settled !== stub.win.__trail.placed(); i++) {
    settled = stub.win.__trail.placed();
    await settle();
  }

  assert.ok(stub.win.__trail.placed() > 0, 'nothing is placed, so there is nothing to clear');
  const before = stub.win.__trail.held();
  assert.ok(before.converted > 0, 'nothing was converted, so there is nothing to give back');

  const clear = stub.element('b-clear-all').listeners.get('click');
  assert.ok(clear?.[0], 'the remove-everything button has no handler');
  clear[0]();
  assert.equal(stub.win.__trail.placed(), 0, 'the handler did not clear the canvas');
  await settle();

  assert.equal(stub.win.__trail.placed(), 0, 'the canvas was not cleared');

  // **The memory has to go with it.** A cache that quietly stops releasing
  // looks exactly like one that works.
  const after = stub.win.__trail.held();
  assert.equal(after.converted, 0, `${after.converted} converted models were kept`);
  assert.equal(after.meshes, 0, `${after.meshes} meshes were kept`);
  assert.equal(after.textures, 0, `${after.textures} decoded images were kept`);
  assert.equal(after.textureBytes, 0, `${after.textureBytes} bytes of images were kept`);

  // The steps are left alone: clearing the canvas is not cutting the film.
  assert.ok(stub.win.__trail.route().length > 0, 'removing the objects removed the steps too');
  assert.deepEqual(stub.failures, [], 'clearing the canvas reported a failure');
});

test('the library never releases a model that is standing on the canvas', async () => {
  // `imported` is keyed by model **and pose** - "Matt@Idle@0" - and the check
  // for what is in use was built from the model name alone, so a posed model on
  // the canvas never matched and was eligible for eviction. Browsing far enough
  // would drop its grid and the next rebuild would take the object off the
  // canvas as "not in the library": a cache evicting the thing it is held for.
  const stub = stubBrowser({ ids: declaredIds(), tags: declaredTags(), frames: 3000 });
  await runApp();
  // The app opens empty, so this test brings its own film.
  await openCanvas(stub);
  const settle = async () => {
    for (let i = 0; i < 25; i++) await new Promise((r) => setTimeout(r, 0));
  };

  const placed = stub.win.__trail.placed();
  // Browsing is what fills the cache, and what used to push the canvas out of it.
  stub.element('b-library').listeners.get('click')?.[0]?.();
  await settle();
  stub.element('b-close').listeners.get('click')?.[0]?.();
  await settle();

  assert.equal(stub.win.__trail.placed(), placed,
    'an object was dropped from the canvas because its model had been released');
  assert.deepEqual(stub.failures, [], 'browsing the library reported a failure');
});

test('inserting a step carries the later pieces and what stands on them', async () => {
  // **Reported by the user:** "i cant add a step in the middle, it just takes
  // the later step and replaces it with the one in the middle and the new one
  // gets pushed to the end."
  //
  // A new piece pushes every later piece's *camera* one place along the strip.
  // If what stands on them does not go too, the contents of step three are left
  // sitting on step two's ground - which reads exactly as the new step having
  // stolen the later one's scene.
  const stub = stubBrowser({ ids: declaredIds(), tags: declaredTags(), frames: 3000 });
  await runApp();
  // The app opens empty, so this test brings its own film.
  await openCanvas(stub);
  const settle = async () => {
    for (let i = 0; i < 25; i++) await new Promise((r) => setTimeout(r, 0));
  };
  const objects = () => stub.win.__trail.canvas().objects.map((o) => ({
    model: o.model, x: o.at[0], from: o.from ?? 0,
  }));

  const before = objects();
  assert.ok(before.length, 'nothing is placed, so there is nothing to carry');
  assert.ok(before.some((o) => o.from > 0), 'everything is on the first piece');

  // Land on the first step, then add one after it.
  stub.element('ticks').children[0].listeners.get('click')?.[0]?.();
  await settle();
  stub.element('b-step-add').listeners.get('click')?.[0]?.();
  await settle();

  const after = objects();
  assert.equal(after.length, before.length, 'objects were lost or duplicated');

  // The join between pieces, read off the app rather than assumed.
  const piece = stub.win.__trail.shot().veil.piece;
  const pitch = piece.width + piece.gap;

  for (let i = 0; i < before.length; i++) {
    if (before[i].from === 0) {
      assert.equal(after[i].x, before[i].x,
        `${before[i].model} was on the first piece and should not have moved`);
      assert.equal(after[i].from, 0);
    } else {
      // One whole piece along, and it says so.
      assert.ok(Math.abs((after[i].x - before[i].x) - pitch) < 1e-6,
        `${before[i].model} moved ${(after[i].x - before[i].x).toFixed(1)}, not one piece (${pitch})`);
      assert.equal(after[i].from, before[i].from + 1,
        `${before[i].model} still says it belongs to piece ${after[i].from}`);
    }
  }
});

test('cutting a step takes what stood on it, and it does not come back', async () => {
  // **Reported by the user:** adding a step "re prints the objects that were in
  // the previously deleted step".
  //
  // Nothing hides an object any more - being elsewhere on the strip is what
  // hiding means - so objects left behind by a deleted step simply sat past the
  // end of a shorter film, and reappeared the moment the strip grew back over
  // them.
  const stub = stubBrowser({ ids: declaredIds(), tags: declaredTags(), frames: 3000 });
  await runApp();
  // The app opens empty, so this test brings its own film.
  await openCanvas(stub);
  const settle = async () => {
    for (let i = 0; i < 25; i++) await new Promise((r) => setTimeout(r, 0));
  };
  const placed = () => stub.win.__trail.placed();

  const before = placed();
  const onLast = stub.win.__trail.canvas().objects
    .filter((o) => (o.from ?? 0) === stub.win.__trail.route().length - 1).length;
  assert.ok(onLast > 0, 'the last piece is empty, so cutting it proves nothing');

  // Cut the last piece.
  stub.element('ticks').children.at(-1).listeners.get('click')?.[0]?.();
  await settle();
  stub.element('b-step-remove').listeners.get('click')?.[0]?.();
  await settle();

  const cut = placed();
  assert.equal(cut, before - onLast,
    `cutting a piece left ${cut - (before - onLast)} of its objects behind`);

  // Growing the strip back must not bring them with it.
  stub.element('b-step-add').listeners.get('click')?.[0]?.();
  await settle();
  assert.equal(placed(), cut, 'the deleted objects came back with the new step');
});

test('a step added between two others lands between them, on the strip and on the clock', async () => {
  // **Reported by the user:** "with 6 steps, if i add one between 1 and 2, the
  // new step becomes 7".
  //
  // A piece stands on the strip by its position in the array, and the camera
  // finds it by its *hour*. The new step took whatever the clock happened to be
  // showing, so the two orders disagreed: the panel said step 2 and the camera
  // went to the far end of the film, because that is where that hour landed.
  const stub = stubBrowser({ ids: declaredIds(), tags: declaredTags(), frames: 3000 });
  await runApp();
  // The app opens empty, so this test brings its own film.
  await openCanvas(stub);
  const settle = async () => {
    for (let i = 0; i < 25; i++) await new Promise((r) => setTimeout(r, 0));
  };
  const add = stub.element('b-step-add').listeners.get('click')?.[0];
  const hours = () => stub.win.__trail.route().map((s) => s.hour);

  // Grow the route, then land on the first step and add one after it.
  for (let i = 0; i < 3; i++) { add(); await settle(); }
  const before = hours();
  assert.ok(before.length >= 4, 'not enough steps to insert between');

  stub.element('ticks').children[0].listeners.get('click')?.[0]?.();
  await settle();
  add();
  await settle();

  const after = hours();
  assert.equal(after.length, before.length + 1, 'the step was never added');

  // It is second in the route...
  assert.equal(after[0], before[0], 'the first step moved');
  assert.equal(after[2], before[1], 'the step it was added in front of did not move down one');
  // ...and second on the clock, which is the half of it that was broken.
  assert.ok(after[1] > after[0] && after[1] < after[2],
    `added at ${after[1]}, which is not between ${after[0]} and ${after[2]}`);

  // The route reads in the same order it plays in, which is what keeps the
  // strip and the bar agreeing about which piece is which.
  const sorted = [...after].sort((a, b) => a - b);
  assert.deepEqual(after, sorted, `the route is out of time order: ${after.join(', ')}`);

  // And the panel is looking at the step that was just added, not at the end.
  assert.equal(stub.win.__trail.at().step, 1,
    'the panel followed the clock to some other piece');
});

test('inserting a step does move what was pointing at a later one', async () => {
  // The other half of the rule, and the reason the fix is "the first copy of a
  // duplicated step wins" rather than "nothing ever moves". An object that
  // arrived at step 2 has to arrive at step 3 once a step is put in front of it,
  // or the video is silently re-timed - which is what `reorder` exists for.
  const stub = stubBrowser({ ids: declaredIds(), tags: declaredTags(), frames: 2000 });
  await runApp();
  // The app opens empty, so this test brings its own film.
  await openCanvas(stub);
  const settle = async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  };

  const rangeOf = () => stub.win.__trail.canvas().objects.map((o) => o.from ?? 0);
  const before = rangeOf();
  assert.ok(before.some((from) => from > 0), 'nothing points past the first step');

  // The opening route is three steps and the panel is on the first, so the new
  // step lands second and everything after it moves down one.
  stub.element('b-step-add').listeners.get('click')?.[0]?.();
  await settle();

  assert.deepEqual(rangeOf(), before.map((from) => (from > 0 ? from + 1 : 0)),
    'a step was inserted and what came after it did not follow');
});

test('going from one step to the next moves the world, not just the weather', async () => {
  // **Reported by the user:** "when i go from step 1 to step 2, its the same
  // step just a different weather. The whole point of the film strip is that
  // the world moves."
  //
  // It did not, because every step framed the same patch of ground: a step
  // carried a framing and nothing put it anywhere. A step is a piece of the
  // film now, and piece k stands at its own place along the strip.
  const stub = stubBrowser({ ids: declaredIds(), tags: declaredTags(), frames: 3000 });
  await runApp();
  // The app opens empty, so this test brings its own film.
  await openCanvas(stub);
  const settle = async () => {
    for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 0));
  };
  // Asked of this page rather than read off the panel: an app instance from an
  // earlier test goes on drawing into the same elements, so a readout says
  // whichever instance drew last.
  const centre = () => stub.win.__trail.shot().x;

  const marks = stub.element('ticks').children;
  assert.ok(marks.length >= 2, 'there are not enough steps to move between');

  marks[0].listeners.get('click')?.[0]?.();
  await settle();
  const first = centre();

  marks[1].listeners.get('click')?.[0]?.();
  await settle();
  const second = centre();

  assert.ok(Number.isFinite(first) && Number.isFinite(second),
    `the camera has no position: ${first} / ${second}`);
  // A whole piece apart, along the strip. Anything less and the two steps are
  // looking at the same ground, which is what was reported.
  const travelled = Math.abs(second - first);
  assert.ok(travelled > 20,
    `step 2 is ${travelled.toFixed(1)} units from step 1, so the world did not move`);

  assert.deepEqual(stub.failures, [], 'moving along the strip reported a failure');
});

test('arrowing along the route can reach every step, including the middle ones', async () => {
  // **Reported by the user:** "when cycling through the stages with the arrow
  // keys and looking at the settings, the THIS MOMENT tab doesnt show step 2
  // but only shows step 1 and 3."
  //
  // `routeAtHour` reports the step being arrived at and the one being left, and
  // standing exactly on a mark counts as both. The panel took the one being
  // left, so a middle step was always reported as its predecessor and could
  // never be edited at all. The first and last steps worked because there is
  // nothing on one side of them.
  const stub = stubBrowser({ ids: declaredIds(), tags: declaredTags(), frames: 3000 });
  await runApp();
  // The app opens empty, so this test brings its own film.
  await openCanvas(stub);
  const settle = async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  };

  const steps = stub.win.__trail.route().length;
  assert.ok(steps >= 3, 'a middle step is needed for this to mean anything');

  // Back to the start of the day, then forward through every step in turn.
  const back = stub.element('b-time-prev').listeners.get('click')?.[0];
  const forward = stub.element('b-time-next').listeners.get('click')?.[0];
  for (let i = 0; i < steps + 2; i++) { back(); await settle(); }

  const reached = new Set([stub.win.__trail.at().step]);
  for (let i = 0; i < steps + 1; i++) {
    forward();
    await settle();
    reached.add(stub.win.__trail.at().step);
  }

  for (let i = 0; i < steps; i++) {
    assert.ok(reached.has(i),
      `step ${i + 1} was never reached: got ${[...reached].map((s) => s + 1).join(', ')}`);
  }
});

test('the overview can always be left, even with no film to look at', async () => {
  // **Reported by the user:** "the overview is bugged, its not returning to a
  // step, if there is no step it just stays stuck in overview mode."
  //
  // Two faults. The framing was floored at the shot it was called from, so on
  // an empty canvas - or any short film seen from a wide shot - it returned
  // exactly what was already on screen: pressing the button changed nothing,
  // and neither did pressing it again. And going to a step left the overview
  // on, so asking to be somewhere was ignored.
  const stub = stubBrowser({ ids: declaredIds(), tags: declaredTags(), frames: 3000 });
  await runApp();
  const settle = async () => {
    for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0));
  };
  const shot = () => stub.win.__trail.shot();

  // Nothing placed and no steps, which is how the app opens.
  await settle();
  assert.equal(stub.win.__trail.route().length, 0);

  // Zoom out past the size of the film, which is where it used to seize.
  const wheel = stub.element('stage').listeners.get('wheel')?.[0];
  assert.ok(wheel, 'there is no way to zoom');
  for (let i = 0; i < 12; i++) wheel({ deltaY: 1, preventDefault: () => {} });
  await settle();
  const wideOpen = shot().w;

  const overview = stub.element('b-overview').listeners.get('click')?.[0];
  overview();
  await settle();
  assert.ok(shot().overview, 'the overview never turned on');
  assert.notEqual(shot().w, wideOpen, 'the overview framed exactly what was already on screen');

  overview();
  await settle();
  assert.ok(!shot().overview, 'the overview could not be turned off');
  assert.equal(shot().w, wideOpen, 'leaving the overview did not give the shot back');

  assert.deepEqual(stub.failures, [], 'the overview reported a failure');
});

test('the sky is lit by the clock from the first frame', async () => {
  // **Reported by the user:** "when the app loads, the canvas is black, then
  // when i click next scene it turns blue."
  //
  // The app opened *playing*, and the hour is applied to the sky inside the
  // branch that runs while paused - so on load the sky was lit by a bare
  // weather preset carrying no time of day, which against a space-black sky is
  // a black screen. Any interaction paused it and the sky came right, which is
  // why touching anything appeared to fix it.
  const stub = stubBrowser({ ids: declaredIds(), tags: declaredTags(), frames: 3000 });
  await runApp();
  // **A film with pieces in it is the case that tells the two apart.** With an
  // empty one there is nothing to play, so playback stops itself on the first
  // frame and the sky comes right whatever it opened as.
  await openCanvas(stub);

  const at = stub.win.__trail.at();
  assert.equal(at.hour, 12, 'the clock should open at noon');
  // Asked of the expression the frame draws with, not read back off a frame.
  assert.ok(at.sun[1] > 0.9,
    `at noon the sun should be overhead, and it is at ${at.sun[1].toFixed(2)}`
    + ' - the hour never reached the sky');

  // **The defect itself.** The sky above is worked out on demand and is right
  // either way; what only the app can answer is which branch of the frame it
  // would have been worked out in, and that is decided by this.
  assert.equal(stub.win.__trail.shot().playing, false,
    'the app opened playing, so the hour never reaches the sky');

  assert.deepEqual(stub.failures, [], 'opening reported a failure');
});

test('the example canvas opens, and every model in it is in the library', async () => {
  // A canvas built out of the library rather than described in a document:
  // three pieces of one street corner, twenty minutes apart. It is a file to be
  // opened rather than something the app carries, because the app opens empty.
  const canvas = JSON.parse(readFileSync(`${root}examples/the-corner.json`, 'utf8'));
  const manifest = JSON.parse(readFileSync(`${root}models/index.json`, 'utf8'));
  const known = new Set([
    ...(manifest.meshes ?? []).map((m) => m.name),
    ...(manifest.recipes ?? []),
  ]);

  const missing = [...new Set(canvas.objects.map((o) => o.model))].filter((n) => !known.has(n));
  assert.deepEqual(missing, [],
    `the example names models the library does not have: ${missing.join(', ')}`);

  const stub = stubBrowser({ ids: declaredIds(), tags: declaredTags(), frames: 3000 });
  await runApp();
  await openCanvas(stub, canvas);

  assert.equal(stub.win.__trail.placed(), canvas.objects.length,
    'the example lost objects on the way in');
  assert.equal(stub.win.__trail.route().length, canvas.steps.length);
  assert.deepEqual(stub.failures, [], 'opening the example reported a failure');
});

test('the film can be switched between film stock and a plain plate', async () => {
  // Every look decision in this app has been reversed the first time it was
  // seen - the cubes, the reveal's angle, what the overview frames. So the
  // plain plate stays one click away rather than being argued about.
  const stub = stubBrowser({ ids: declaredIds(), tags: declaredTags(), frames: 3000 });
  await runApp();
  await openCanvas(stub);
  const settle = async () => {
    for (let i = 0; i < 25; i++) await new Promise((r) => setTimeout(r, 0));
  };

  assert.equal(stub.win.__trail.shot().stock, 1, 'the film should open as film');

  const pick = (value) => stub.element('stock').listeners.get('click')?.[0]?.({
    target: { closest: () => ({ dataset: { v: value } }) },
  });

  pick('0');
  await settle();
  assert.equal(stub.win.__trail.shot().stock, 0, 'it could not be made a plain plate');

  pick('1');
  await settle();
  assert.equal(stub.win.__trail.shot().stock, 1, 'it could not be made film again');

  assert.deepEqual(stub.failures, [], 'switching the film reported a failure');
});

test('the ground can be made grass or concrete, and the room can be darkened', async () => {
  // Two switches and nothing else, but a control that silently does nothing is
  // worse than one that is not there - which this app has already shipped once,
  // when the weather picker wrote to a step that did not exist.
  const stub = stubBrowser({ ids: declaredIds(), tags: declaredTags(), frames: 3000 });
  await runApp();
  await openCanvas(stub);
  const settle = async () => {
    for (let i = 0; i < 25; i++) await new Promise((r) => setTimeout(r, 0));
  };
  const pick = (id, value) => stub.element(id).listeners.get('click')?.[0]?.({
    target: { closest: () => ({ dataset: { v: value } }) },
  });

  assert.equal(stub.win.__trail.shot().ground, 0, 'the ground should open bare');
  assert.equal(stub.win.__trail.shot().room, 0, 'the room should open lit');

  for (const [id, value, name] of [['ground', '1', 'grass'], ['ground', '2', 'concrete'],
    ['ground', '0', 'bare'], ['room', '1', 'dark'], ['room', '0', 'lit']]) {
    pick(id, value);
    await settle();
    assert.equal(stub.win.__trail.shot()[id], Number(value), `the ${id} could not be made ${name}`);
  }

  assert.deepEqual(stub.failures, [], 'changing the ground or the room reported a failure');
});

test('the light is pointed at what is selected, and sized from it', async () => {
  /**
   * The slider turns the light on; pointing it is a separate act, because where
   * it shines and how hard are different decisions.
   *
   * The property worth holding is that the pool is **sized from the object's own
   * box**, so the light falls on the thing rather than sitting under it as a
   * disc. That is why this points at two objects of very different sizes rather
   * than checking one number: a fixed radius passes the first half of this test
   * and fails the second.
   */
  const stub = stubBrowser({ ids: declaredIds(), tags: declaredTags(), frames: 3000 });
  await runApp();
  await openCanvas(stub);
  const settle = async () => {
    for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 0));
  };
  const point = () => stub.element('b-spot-here').listeners.get('click')?.[0]?.();
  const spot = () => stub.win.__trail.shot().spot;

  // Nothing is selected when a canvas opens, so pointing the light must refuse
  // rather than reach into boxes[-1].
  assert.equal(spot()[3], 0, 'the light was on before anything asked for it');
  point();
  await settle();
  assert.equal(spot()[3], 0, 'the light came on with nothing selected to point it at');
  assert.deepEqual(stub.failures, [], 'pointing the light at nothing threw');

  // Placing a model selects it, which is the shortest route to a selection.
  const place = async (name) => {
    stub.allowFrames(80);
    stub.element('b-library').listeners.get('click')?.[0]?.();
    const filter = stub.element('filter');
    filter.value = name;
    filter.listeners.get('input')?.[0]?.();
    await settle();
    const tile = stub.element('library').children.find((c) => c.title === name);
    assert.ok(tile, `the library has no ${name} to place`);
    tile.listeners.get('click')?.[0]?.();
    await settle();
    return stub.win.__trail.canvas().objects.at(-1);
  };

  const figure = await place('person');
  point();
  await settle();

  const onFigure = spot();
  assert.ok(onFigure[3] > 0, 'pointing the light at something left it switched off');
  assert.ok(Number(stub.element('r-spot').value) > 0,
    'the light is on and the slider still reads off');
  assert.ok(Math.abs(onFigure[0] - figure.at[0]) < 2 && Math.abs(onFigure[1] - figure.at[2]) < 2,
    `the light landed at ${onFigure[0].toFixed(1)}, ${onFigure[1].toFixed(1)}`
    + ` and the figure is at ${figure.at[0].toFixed(1)}, ${figure.at[2].toFixed(1)}`);

  // A house is far wider than a person, so a pool sized from what it is pointed
  // at has to grow. This is the half that fails if the radius is a constant.
  await place('house1');
  point();
  await settle();

  const onHouse = spot();
  assert.ok(onHouse[2] > onFigure[2],
    `the pool is ${onHouse[2].toFixed(1)} across on a house and ${onFigure[2].toFixed(1)} on a`
    + ' figure, so it is not sized from what it is pointed at');
  assert.deepEqual(stub.failures, [], 'pointing the light reported a failure');
});

test('a canvas opened with pieces already in it has ground under them', async () => {
  // **Reported by the user:** with steps and objects already there, the floor
  // was wrong until a step was added, and "when a new step gets added the
  // floors get reset".
  //
  // Opening a canvas rebuilt the world and never told the renderer how many
  // pieces there were, so the film kept whatever count it had from an empty
  // startup - none. Adding a step went through the one path that did refresh
  // it, which is why that appeared to fix it.
  const stub = stubBrowser({ ids: declaredIds(), tags: declaredTags(), frames: 3000 });
  await runApp();
  await openCanvas(stub);

  const pieces = stub.win.__trail.route().length;
  assert.ok(pieces > 0, 'the canvas brought no pieces');
  assert.equal(stub.win.__trail.shot().pieces, pieces,
    'the renderer was never told how many pieces the film has, so it has no ground');

  assert.deepEqual(stub.failures, [], 'opening a canvas reported a failure');
});

test('the film list says what is on each piece, and cutting one asks first', async () => {
  // Asked for: a small list in the corner showing where the objects are and at
  // what time, with a button to go to a piece and one to cut it. The clock bar
  // turns the ring; this is where the film is changed.
  const stub = stubBrowser({ ids: declaredIds(), tags: declaredTags(), frames: 3000 });
  await runApp();
  await openCanvas(stub);
  const settle = async () => {
    for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0));
  };

  const rows = () => stub.element('reel-list').children;
  assert.equal(rows().length, stub.win.__trail.route().length,
    'the list does not have a row per piece');

  // Each row says what stands on that piece.
  const said = rows().map((row) => row.children.map((c) => c.textContent).join(' '));
  assert.ok(said.some((text) => /house1|Marla|tree/.test(text)),
    `no row named anything standing on it: ${said.join(' | ')}`);

  // **Cutting asks first.** There is no undo, and a cut takes what stands on
  // the piece with it.
  const pieces = stub.win.__trail.route().length;
  const placed = stub.win.__trail.placed();
  const cut = () => rows()[1].children[0].children.find((c) => c.className?.includes('cut'));

  cut().listeners.get('click')?.[0]?.();
  await settle();
  assert.equal(stub.win.__trail.route().length, pieces,
    'the first press cut the piece instead of asking');
  assert.match(cut().textContent, /sure/i, 'it never asked');

  cut().listeners.get('click')?.[0]?.();
  await settle();
  assert.equal(stub.win.__trail.route().length, pieces - 1, 'the second press did not cut it');
  assert.ok(stub.win.__trail.placed() < placed, 'the things standing on it were left behind');

  assert.deepEqual(stub.failures, [], 'the film list reported a failure');
});

test('the film is rolled into a ring, and the overview unrolls it', async () => {
  // The two views are one geometry: Halo mode is the strip rolled into a loop
  // with the piece being looked at at the top, and the overview is the same
  // strip lying flat. So the overview is not a second view - it is the roll
  // easing to nought, and the ball opening into a long straight piece.
  const stub = stubBrowser({ ids: declaredIds(), tags: declaredTags(), frames: 3000 });
  await runApp();
  await openCanvas(stub);
  // The unfurl is eased over about a second, so this waits for the animation
  // rather than for a single frame.
  const settle = async () => {
    for (let i = 0; i < 160; i++) await new Promise((r) => setTimeout(r, 0));
  };

  // **What is asserted here is what the app was asked for, not the eased
  // value.** By this point in the file about thirty app instances from earlier
  // tests are still asking this stub for frames - nothing stops them - so the
  // instance under test is starved of them, and the stub's clock only advances
  // per frame so a time-based ease cannot finish either. The curve itself is
  // arithmetic and is tested in `timeline.test.js`; what only the page can
  // answer is whether the button asks for the right thing.
  assert.equal(stub.win.__trail.shot().rollTo, 1, 'the film did not open rolled');

  stub.element('b-overview').listeners.get('click')?.[0]?.();
  await settle();
  assert.equal(stub.win.__trail.shot().rollTo, 0, 'the overview did not unroll the film');

  stub.element('b-overview').listeners.get('click')?.[0]?.();
  await settle();
  assert.equal(stub.win.__trail.shot().rollTo, 1, 'it did not roll back up');

  // And going to a step rolls it back up too, rather than leaving the film flat.
  stub.element('b-overview').listeners.get('click')?.[0]?.();
  await settle();
  stub.element('ticks').children[1].listeners.get('click')?.[0]?.();
  await settle();
  assert.equal(stub.win.__trail.shot().rollTo, 1, 'going to a step left the film unrolled');

  assert.deepEqual(stub.failures, [], 'rolling the film reported a failure');
});

test('turning the overview while in it does not disturb the shot underneath', async () => {
  // **Reported by the user:** "when i click in and out of the overview, it stays
  // in overview mode so id have to zoom in to get back to the step."
  //
  // Adjusting the camera wrote whatever was on screen back into the one rig, so
  // turning or zooming while pulled back banked the overview's width - the
  // width of the whole film - into the shot being composed. Coming back out
  // then left you as wide as the overview had been, which reads as never having
  // left it.
  const stub = stubBrowser({ ids: declaredIds(), tags: declaredTags(), frames: 3000 });
  await runApp();
  await openCanvas(stub);
  const settle = async () => {
    for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0));
  };
  const shot = () => stub.win.__trail.shot();

  await settle();
  const working = shot().w;

  const overview = stub.element('b-overview').listeners.get('click')?.[0];
  overview();
  await settle();
  const wide = shot().w;
  assert.ok(wide > working, 'the overview did not pull back');

  // Turn and zoom while pulled back, which is what poisoned the rig.
  const wheel = stub.element('stage').listeners.get('wheel')?.[0];
  for (let i = 0; i < 6; i++) wheel({ deltaY: -1, preventDefault: () => {} });
  await settle();

  overview();
  await settle();
  assert.equal(shot().w, working,
    'leaving the overview did not give the shot back the way it was');

  assert.deepEqual(stub.failures, [], 'the overview reported a failure');
});

test('going to a step leaves the overview', async () => {
  const stub = stubBrowser({ ids: declaredIds(), tags: declaredTags(), frames: 3000 });
  await runApp();
  await openCanvas(stub);
  const settle = async () => {
    for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0));
  };

  stub.element('b-overview').listeners.get('click')?.[0]?.();
  await settle();
  assert.ok(stub.win.__trail.shot().overview, 'the overview never turned on');

  // Asking to be at a step is asking to be somewhere, and the overview is not
  // a place.
  stub.element('ticks').children[1].listeners.get('click')?.[0]?.();
  await settle();
  assert.ok(!stub.win.__trail.shot().overview, 'clicking a step left the camera pulled back');
  assert.equal(stub.win.__trail.at().step, 1, 'and it did not go to that step');
});

test('the overview pulls back far enough to hold the whole film', async () => {
  // The ending: "at the waaaay end we add a button called overview that shows
  // the whole film from a far away view showing how the transition went".
  const stub = stubBrowser({ ids: declaredIds(), tags: declaredTags(), frames: 3000 });
  await runApp();
  const settle = async () => {
    for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 0));
  };
  const width = () => stub.win.__trail.shot().w;

  await settle();
  const close = width();
  assert.ok(close > 0, 'nothing was drawn, so there is no shot to widen');

  stub.element('b-overview').listeners.get('click')?.[0]?.();
  await settle();
  const wide = width();

  const steps = stub.win.__trail.route().length;
  assert.ok(wide > close, `the overview did not pull back: ${close} then ${wide}`);
  // Wide enough to hold every piece, or it is not an overview of anything.
  assert.ok(wide > steps * 30,
    `${steps} pieces need more than ${(steps * 30)} units and the shot was ${wide}`);

  // And it lets go again, putting the camera back on the strip.
  stub.element('b-overview').listeners.get('click')?.[0]?.();
  await settle();
  assert.ok(width() < wide, 'the overview would not turn off');

  assert.deepEqual(stub.failures, [], 'the overview reported a failure');
});

test('the clock says where you are, not how many steps have a time', async () => {
  // Reported: "in the bar, when i cycle through the steps, it always says 2 of
  // 2 steps on the clock". It was a count of how many steps carry an hour, so
  // it never changed while reading exactly like a position.
  const stub = stubBrowser({ ids: declaredIds(), tags: declaredTags(), frames: 2000 });
  await runApp();
  // The app opens empty, so this test brings its own film.
  await openCanvas(stub);
  const settle = async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  };

  const marks = stub.element('ticks').children;
  assert.ok(marks.length >= 2, 'the bar has no marks to cycle through');

  const said = [];
  for (const mark of marks) {
    mark.listeners.get('click')?.[0]?.();
    await settle();
    said.push(stub.element('now-what').textContent);
  }

  assert.equal(new Set(said).size, said.length,
    `the bar said the same thing on every step: ${said.join(' | ')}`);
  assert.ok(said.every((text) => /step \d+ of \d+/.test(text)),
    `the bar never said which step it was on: ${said.join(' | ')}`);
});

test('with every step removed it is still a place at a time of day', async () => {
  // Reported: "i removed all the steps and now i cant cycle the time and the
  // weather doesnt change". The clock had nothing to interpolate and the
  // weather control had no step to write to, so both went quietly dead.
  //
  // Frames are generous here because this test reads back what was actually
  // drawn. The loop only continues while frames are allowed, and once it stops
  // nothing restarts it - so what would be read is the sky from before the
  // clock was touched.
  const stub = stubBrowser({ ids: declaredIds(), tags: declaredTags(), frames: 4000 });
  await runApp();

  // Take every step away.
  const remove = stub.element('b-step-remove').listeners.get('click')?.[0];
  for (let i = 0; i < 12 && stub.win.__trail.route().length; i++) {
    remove();
    for (let n = 0; n < 5; n++) await new Promise((r) => setTimeout(r, 0));
  }
  assert.equal(stub.win.__trail.route().length, 0, 'the last step could not be removed');
  assert.deepEqual(stub.failures, [], 'emptying the route reported a failure');

  // The clock still moves, and the sun with it.
  const track = stub.element('track');
  track.getBoundingClientRect = () => ({ left: 0, top: 0, width: 240, height: 26 });
  track.setPointerCapture = () => {};
  track.hasPointerCapture = () => false;
  track.listeners.get('pointerdown')?.[0]?.({ pointerId: 1, clientX: 60 });
  assert.equal(stub.win.__trail.at().hour, 6, 'a quarter along the day is six in the morning');
  // Frames have to actually run after the clock moves, or what is read back is
  // the sky from before it was dragged.
  const settle = async () => {
    for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 0));
  };
  await settle();
  const dawn = stub.win.__trail.at().sun;
  assert.ok(dawn, 'nothing was drawn, so the sky cannot be judged');
  assert.ok(Math.abs(dawn[1]) < 0.25, `at six the sun should be near the horizon, was ${dawn[1]}`);

  track.listeners.get('pointermove')?.[0]?.({ pointerId: 1, clientX: 120 });
  track.listeners.get('pointerup')?.[0]?.({ pointerId: 1, clientX: 120 });
  await settle();
  assert.equal(stub.win.__trail.at().hour, 12, 'the clock stopped moving without steps');
  // The proof that the clock still lights the world with no steps in it: the
  // sun has to have climbed, not just the number changed.
  assert.ok(stub.win.__trail.at().sun[1] > 0.9,
    'at noon the sun should be overhead, so the hour never reached the sky');

  track.listeners.get('pointerdown')?.[0]?.({ pointerId: 1, clientX: 180 });
  track.listeners.get('pointerup')?.[0]?.({ pointerId: 1, clientX: 180 });
  await settle();

  // And the weather still changes: with no step to write to, it is the
  // playground's own.
  const storm = stub.element('step-weather');
  storm.listeners.get('click')?.[0]?.({
    target: { closest: () => ({ dataset: { v: 'storm' } }) },
  });
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  assert.equal(stub.win.__trail.at().weather, 'storm',
    'the weather control did nothing because there was no step to write to');

  // Adding a step takes the day as it stands rather than replacing it.
  stub.element('b-step-add').listeners.get('click')?.[0]?.();
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  const route = stub.win.__trail.route();
  assert.equal(route.length, 1, 'the first step was never added');
  assert.equal(route[0].hour, 18, 'the step did not take the time on the clock');
  assert.equal(route[0].weather, 'storm', 'nor the weather on screen');
  assert.deepEqual(stub.failures, [], 'the empty day reported a failure');
});
