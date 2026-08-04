import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
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
    addEventListener: () => {},
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
    frames: () => drawn,
    drew: (name) => drawn2d.filter((c) => c[0] === name).length,
    // The page asks for a frame every frame, so a fixed budget is spent by the
    // render loop long before a test can interact. This hands back some more.
    allowFrames: (n) => { drawn = Math.max(0, drawn - n); },
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
  const stub = stubBrowser({ ids: declaredIds(), frames: 60 });
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
  assert.match(page(), /mesh\.licence !== 'CC0'/,
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
    assert.match(page(), new RegExp(`'${kind}'`),
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
