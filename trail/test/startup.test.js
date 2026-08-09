import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { readVox } from '../lib/vox.js';

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
  getContext(kind) { return kind === 'webgl2' ? fakeGl() : fake2d(); }
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

test('the page starts, loads its models, and draws', async () => {
  const stub = stubBrowser({ ids: declaredIds(), tags: declaredTags(), frames: 60 });
  await runApp();

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
  // The opening arrangement may name models from a pack, and those are only
  // listed until something asks for them. If nothing reads them the scene
  // silently drops every one and opens emptier than it should.
  const fromPacks = manifest.meshes.filter((m) => PLACED.includes(m.name));
  assert.ok(fromPacks.length, 'the opening arrangement names no pack models at all');
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

test('adding a step leaves the objects already on the canvas alone', async () => {
  // **Reported by the user:** "i add a step one at 8 am, i add an object, works
  // fine, then i fast forward to 11 am ... then i add a step, the object now is
  // assigned to step 2 ... if i go back to step one, the object turns blue".
  //
  // Blue is the ghost: the object's `from` had been moved forward to the step
  // that was just added, so at the step it was placed on it was not there yet.
  // The cause was in `reorder`, and this is the same failure driven through the
  // page rather than through the module.
  const stub = stubBrowser({ ids: declaredIds(), tags: declaredTags(), frames: 2000 });
  await runApp();
  const settle = async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  };

  const add = stub.element('b-step-add').listeners.get('click')?.[0];
  const remove = stub.element('b-step-remove').listeners.get('click')?.[0];
  const rangeOf = () => stub.win.__trail.canvas().objects.map((o) => o.from ?? 0);

  // Clear every step, which is where the user's sequence starts.
  for (let i = 0; i < 12 && stub.win.__trail.route().length; i++) {
    remove();
    await settle();
  }
  assert.equal(stub.win.__trail.route().length, 0, 'the steps could not be cleared');

  // One step, and everything on the canvas belongs to it.
  add();
  await settle();
  assert.equal(stub.win.__trail.route().length, 1);
  const before = rangeOf();
  assert.ok(before.length, 'there is nothing placed, so there is nothing to check');
  assert.ok(before.every((from) => from === 0),
    `everything should belong to the only step there is, was ${before.join()}`);

  // A second step. Nothing was pointing past the first, so nothing may move.
  add();
  await settle();
  assert.equal(stub.win.__trail.route().length, 2, 'the second step was never added');

  assert.deepEqual(rangeOf(), before,
    'adding a step reassigned the objects already placed to it, so they ghost on step one');
});

test('inserting a step does move what was pointing at a later one', async () => {
  // The other half of the rule, and the reason the fix is "the first copy of a
  // duplicated step wins" rather than "nothing ever moves". An object that
  // arrived at step 2 has to arrive at step 3 once a step is put in front of it,
  // or the video is silently re-timed - which is what `reorder` exists for.
  const stub = stubBrowser({ ids: declaredIds(), tags: declaredTags(), frames: 2000 });
  await runApp();
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
