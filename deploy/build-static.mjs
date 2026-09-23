// Assembles the static half of the portfolio into deploy/dist/.
//
//   node deploy/build-static.mjs
//
// Everything in the output is copied from an explicit allowlist, never from a folder
// wholesale. The build reads the disk, not git, and the disk holds things that must not be
// published: every requirements/06-context.md, herder's private spec, .env files, local
// databases. An allowlist cannot leak a file nobody named.
//
// GitHub Pages publishes the output (.github/workflows/pages.yml), and it serves as-is from
// any other static host too. No bundler, no minifier: the apps are single files by design.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'deploy', 'dist');

// Most free static hosts refuse single files above 25 MiB (Cloudflare Pages does).
const MAX_FILE = 25 * 1024 * 1024;

// The web-loadable formats trail's loader actually fetches. Everything else in a pack -
// FBX, Blender, Unity packages, preview videos, HDR maps - is for other engines.
const TRAIL_MODEL_EXT = new Set(['.obj', '.mtl', '.gltf', '.glb', '.bin', '.png', '.jpg', '.jpeg', '.json']);

let files = 0;
let bytes = 0;
const oversize = [];

function copyFile(from, to) {
  const size = fs.statSync(from).size;
  if (size > MAX_FILE) oversize.push(`${path.relative(ROOT, from)} (${(size / 1048576).toFixed(1)} MB)`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  files += 1;
  bytes += size;
}

/** Copy one path (file or folder) from the repo to the output. */
function copy(src, dest = src, keep = () => true) {
  const from = path.join(ROOT, src);
  const to = path.join(OUT, dest);
  if (!fs.existsSync(from)) {
    console.warn(`  skip, not found: ${src}`);
    return;
  }
  if (fs.statSync(from).isFile()) {
    copyFile(from, to);
    return;
  }
  for (const entry of fs.readdirSync(from, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const abs = path.join(entry.parentPath, entry.name);
    const rel = path.relative(from, abs);
    if (!keep(rel)) continue;
    copyFile(abs, path.join(to, rel));
  }
}

/**
 * Trail's model folder: its own JSON, and only the pack files the page can ask for.
 *
 * A pack ships every model several times over - OBJ, glTF, FBX, Unity, textures at three
 * sizes - and copying whole folders publishes 700 MB for a page that reads a fraction of
 * it. What the page fetches is exactly what index.json names (meshes, rigs, and each
 * pack's texture index, which `npm run scan` writes), plus what those files pull in
 * themselves: an .obj's .mtl, and a .gltf's external buffers. See loadMesh, picturesFor
 * and the OBJ branch in trail/lib/app.js.
 */
function copyTrailModels() {
  const modelsDir = path.join(ROOT, 'trail', 'models');
  const index = JSON.parse(fs.readFileSync(path.join(modelsDir, 'index.json'), 'utf8'));

  for (const name of fs.readdirSync(modelsDir)) {
    if (name.endsWith('.json')) copy(`trail/models/${name}`);
  }
  copy('trail/models/names');

  // Every string anywhere in the manifest that names a file on disk. Walking the whole
  // document rather than known keys means a new section written by scan.js is covered.
  const wanted = new Set();
  const walk = (value) => {
    if (typeof value === 'string') {
      if (TRAIL_MODEL_EXT.has(path.extname(value).toLowerCase())
          && fs.existsSync(path.join(modelsDir, value))) wanted.add(value);
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(walk);
    }
  };
  walk(index);

  for (const file of [...wanted]) {
    const ext = path.extname(file).toLowerCase();
    if (ext === '.obj') {
      const mtl = file.replace(/\.obj$/i, '.mtl');
      if (fs.existsSync(path.join(modelsDir, mtl))) wanted.add(mtl);
    }
    if (ext === '.gltf') {
      const folder = file.slice(0, file.lastIndexOf('/') + 1);
      const gltf = JSON.parse(fs.readFileSync(path.join(modelsDir, file), 'utf8'));
      for (const buffer of gltf.buffers ?? []) {
        if (!buffer.uri || buffer.uri.startsWith('data:')) continue;
        const bin = folder + decodeURIComponent(buffer.uri);
        if (fs.existsSync(path.join(modelsDir, bin))) wanted.add(bin);
        else console.warn(`  trail: ${file} names a buffer that is not on disk: ${buffer.uri}`);
      }
    }
  }

  for (const file of wanted) copy(`trail/models/${file}`);

  // Each pack's licence file goes out with its models. It sits at the top of the pack or
  // one folder in, the same two places trail's own licence test looks.
  const LICENCE = /^licen[cs]e[^/\\]*\.txt$/i;
  for (const pack of index.downloads ?? []) {
    const top = path.join(modelsDir, pack.folder);
    if (!fs.existsSync(top)) continue;
    const places = [top, ...fs.readdirSync(top, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(top, entry.name))];
    for (const dir of places) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && LICENCE.test(entry.name)) {
          copy(path.relative(ROOT, path.join(dir, entry.name)));
        }
      }
    }
  }

  const missing = (index.downloads ?? [])
    .filter((pack) => !fs.existsSync(path.join(modelsDir, pack.folder)));
  for (const pack of missing) console.warn(`  trail pack missing on disk, re-download it: ${pack.folder}`);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

console.log('Building deploy/dist ...');

// The resume is the front page. It is published twice from one file: at the root, where
// visitors arrive, and at /resume/, so the address that has been shared keeps working.
// Its own links are root-absolute for exactly this reason.
copy('resume/index.html', 'index.html');
copy('resume/index.html');

copy('snowball/index.html');
copy('snowball/css');
copy('snowball/js');

copy('tektak/index.html');
copy('tektak/admin.html');

// The folder name has a space, which makes an ugly URL. Published as story-generator/,
// with the page also at index.html so the folder URL opens it.
copy('story generator/breakdown-takes.html', 'story-generator/breakdown-takes.html');
copy('story generator/breakdown-takes.html', 'story-generator/index.html');

copy('whereyago/index.html');

copy('trail/index.html');
copy('trail/lib');
copy('trail/examples');
copyTrailModels();

// Headers for hosts that read a _headers file (Cloudflare Pages, Netlify). GitHub Pages
// ignores it and sets its own caching. trail's own serve.json says no-store, which is
// right while developing and wrong for 100+ MB of models nobody edits.
fs.writeFileSync(path.join(OUT, '_headers'), [
  '/*',
  '  X-Content-Type-Options: nosniff',
  '  Referrer-Policy: strict-origin-when-cross-origin',
  '',
  '/trail/models/*',
  '  Cache-Control: public, max-age=604800',
  '',
].join('\n'));

console.log(`Done: ${files} files, ${(bytes / 1048576).toFixed(1)} MB in deploy/dist`);
if (oversize.length) {
  console.warn(`\n${oversize.length} file(s) are over 25 MiB. Fine for Caddy on the server,`);
  console.warn('refused by Cloudflare Pages:');
  for (const f of oversize) console.warn(`  ${f}`);
}
