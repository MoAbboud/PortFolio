import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
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
  constructor(id = '') {
    this.id = id;
    this.textContent = '';
    this.innerHTML = '';
    this.value = '0';
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
  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() { return false; }
  focus() {}
}

const fake2d = () => new Proxy({}, {
  get: (_, name) => (name === 'measureText' ? () => ({ width: 40 }) : () => {}),
});

/**
 * A WebGL2 context that says yes to everything.
 *
 * Constants are ALL_CAPS and get a distinct number each; anything else is a
 * method and does nothing. The two calls whose answers matter are answered.
 */
function fakeGl() {
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
      return () => ({});
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

function stubBrowser({ frames = 3, ids = new Set() } = {}) {
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
    if (!byId.has(id)) byId.set(id, new FakeElement(id));
    return byId.get(id);
  };

  const store = new Map();
  const requested = [];
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
      createElement: () => new FakeElement(),
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
    performance: { now: () => (clock += 16) },
    requestAnimationFrame: (fn) => {
      // A handful of frames, then stop, so the draw path runs without looping.
      // A closed stub schedules nothing: a page from an earlier test keeps
      // asking for frames forever, and it must not touch this test's counters.
      if (!closed && drawn++ < frames) queueMicrotask(() => fn(clock += 16));
      return drawn;
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    URL: globalThis.URL,
    Blob: class { constructor() {} },
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
    frames: () => drawn,
    close: () => { closed = true; },
  };
}

const page = () => readFileSync(new URL('../index.html', import.meta.url), 'utf8');

/** Pull the page's module out of index.html so Node can evaluate it. */
function extractModule() {
  const match = /<script type="module">([\s\S]*?)<\/script>/.exec(page());
  assert.ok(match, 'index.html has no module script');
  return match[1];
}

/** Every id the markup actually declares. Nothing else will resolve. */
const declaredIds = () => new Set([...page().matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

test('the page starts, loads its models, and draws', async () => {
  const stub = stubBrowser({ ids: declaredIds() });
  const scratch = new URL('../.startup-test.mjs', import.meta.url);
  writeFileSync(scratch, extractModule());

  try {
    await import(`${scratch.href}?t=${Date.now()}`);
    // The module's own startup is async, so let its promises settle.
    for (let i = 0; i < 80; i++) await new Promise((r) => setTimeout(r, 0));
  } finally {
    rmSync(scratch, { force: true });
  }

  assert.deepEqual(stub.failures, [], 'the page reported a startup failure');
  assert.equal(stub.win.__trail.started, true, 'the module never reached its first line');
  assert.ok(stub.frames() > 1, 'the page never drew a frame');

  // The library is meant to be there when the page opens, not dragged in.
  const manifest = JSON.parse(
    readFileSync(new URL('../models/index.json', import.meta.url), 'utf8')
  );
  assert.ok(stub.requested.includes('models/index.json'), 'the manifest was never read');
  for (const name of manifest.recipes) {
    assert.ok(stub.requested.includes(`models/${name}.json`), `${name} was never fetched`);
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
  const scratch = new URL('../.startup-missing.mjs', import.meta.url);
  writeFileSync(scratch, extractModule());
  try {
    await import(`${scratch.href}?t=${Date.now()}`);
    for (let i = 0; i < 80; i++) await new Promise((r) => setTimeout(r, 0));
  } finally {
    rmSync(scratch, { force: true });
  }

  assert.equal(stub.failures.length, 1, 'a missing control should stop the page');
  const said = stub.failures[0];
  assert.match(said, /b-play/, 'the failure must name the id that is missing');
  assert.match(said, /markup/i, 'and say where to look for it');
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
