// Unpacks a Claude Design standalone-HTML export so its design can be read and ported.
//
//   npm run unpack-design -- "designs/cocktail-bar/Quillfeather Lounge.html"
//
// The export is a bundle: the page carries its artboards as gzipped, base64 entries in a
// "__bundler/manifest" block, and each artboard is itself a bundle - its markup in a
// "__bundler/template" block, plus Claude's own runtime, React and the fonts in its manifest.
// This writes, next to the export, "unpacked/<export name>/" with one folder per artboard:
// design.html (the markup, fonts referenced by file name) and the packed files beside it.
//
// It only reads the file. Nothing in the export is run. designs/ is gitignored.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const EXT = { 'text/javascript': 'js', 'text/css': 'css', 'text/html': 'html', 'font/woff2': 'woff2', 'font/woff': 'woff', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'video/mp4': 'mp4' };

function block(html, name) {
  const m = html.match(new RegExp(`<script type="__bundler/${name}"[^>]*>([\\s\\S]*?)</script>`));
  return m ? m[1] : null;
}

function entries(html) {
  const raw = block(html, 'manifest');
  if (!raw) return [];
  return Object.entries(JSON.parse(raw)).map(([id, e]) => {
    let data = Buffer.from(e.data, 'base64');
    if (e.compressed) data = zlib.gunzipSync(data);
    return { id, mime: e.mime, data };
  });
}

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error('Give the path of a Claude Design HTML export.');
  process.exit(1);
}
const outer = fs.readFileSync(file, 'utf8');
const stem = path.basename(file, path.extname(file)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const out = path.join(path.dirname(file), 'unpacked', stem);
fs.mkdirSync(out, { recursive: true });

// Artboard titles, from the iframes the outer page lays out ("More motion - Phone 390").
const titles = {};
const template = block(outer, 'template');
if (template) {
  for (const m of JSON.parse(template).matchAll(/<iframe src="about:blank#([0-9a-f-]+)" title="([^"]+)"/g)) titles[m[1]] = m[2];
}

// A whole canvas carries its artboards as HTML entries. A single artboard exported on its own
// is itself the bundle: its markup is the outer page's template.
let boards = entries(outer).filter((e) => e.mime === 'text/html');
if (boards.length === 0 && template) {
  const title = (JSON.parse(template).match(/<title>([^<]+)<\u002Ftitle>|<title>([^<]+)<\/title>/) || [])[1] || 'artboard';
  titles.single = title;
  boards = [{ id: 'single', mime: 'text/html', data: Buffer.from(outer) }];
}
if (boards.length === 0) {
  console.error('No artboards found - is this a Claude Design standalone HTML export?');
  process.exit(1);
}

for (const board of boards) {
  const name = (titles[board.id] ?? board.id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const dir = path.join(out, name);
  fs.mkdirSync(dir, { recursive: true });
  const page = board.data.toString('utf8');
  let markup = JSON.parse(block(page, 'template') ?? '""');
  for (const asset of entries(page)) {
    const fileName = `${asset.id}.${EXT[asset.mime] ?? 'bin'}`;
    fs.writeFileSync(path.join(dir, fileName), asset.data);
    markup = markup.split(`"${asset.id}"`).join(`"${fileName}"`);
  }
  fs.writeFileSync(path.join(dir, 'design.html'), markup);
  console.log(`  ${name}/design.html (${(markup.length / 1024).toFixed(0)} KB)`);
}
console.log(`unpacked ${boards.length} artboard(s) into ${out}`);
