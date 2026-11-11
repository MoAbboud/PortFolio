// Writes the published copy of every look: looks-src/<look>/ -> looks/<look>/.
//
//   npm run publish-looks              every look
//   npm run publish-looks -- <look>    one look
//
// looks-src/ holds the readable source and is its own private repository, gitignored here
// (P36). looks/ holds what visitors load and what is committed: the JavaScript obfuscated,
// the CSS minified, everything else copied as it is. Nothing a browser shows can be hidden
// from it; this makes the published code hard to read and reuse, not secret.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JavaScriptObfuscator from 'javascript-obfuscator';
import { minify as minifyCss } from 'csso';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'looks-src');
const OUT = path.join(ROOT, 'looks');

// Kept light enough not to slow animation code: no self-defending or debug traps, which cost
// time on every frame. Exported names (render) must survive, so globals are not renamed.
const OBFUSCATION = {
  compact: true,
  sourceType: 'module',
  target: 'browser',
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  splitStrings: true,
  splitStringsChunkLength: 8,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  selfDefending: false,
  debugProtection: false,
  transformObjectKeys: false,
  // A fixed seed: the same source always gives the same output, so an unchanged look does not
  // show up as changed in git after every publish.
  seed: 20261025,
};

if (!fs.existsSync(SRC)) {
  console.error('No looks-src/ folder. The readable look source lives there (see requirements/03-architecture.md).');
  process.exit(1);
}

const only = process.argv[2];
const looks = fs.readdirSync(SRC, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
  .map((d) => d.name)
  // A look is a folder with a look.json; anything else (a stray empty folder) is not one.
  .filter((name) => fs.existsSync(path.join(SRC, name, 'look.json')))
  .filter((name) => !only || name === only);

if (only && looks.length === 0) {
  console.error(`No look called ${only} in looks-src/.`);
  process.exit(1);
}

for (const look of looks) {
  const from = path.join(SRC, look);
  const to = path.join(OUT, look);
  fs.rmSync(to, { recursive: true, force: true });
  let before = 0;
  let after = 0;
  for (const entry of fs.readdirSync(from, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const abs = path.join(entry.parentPath, entry.name);
    const rel = path.relative(from, abs);
    // The private repository's own files are never published.
    if (rel.split(path.sep)[0].startsWith('.') || entry.name === 'README.md') continue;
    const dest = path.join(to, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const ext = path.extname(entry.name).toLowerCase();
    const source = fs.readFileSync(abs);
    let output = source;
    if (ext === '.js' || ext === '.mjs') {
      output = Buffer.from(JavaScriptObfuscator.obfuscate(source.toString('utf8'), OBFUSCATION).getObfuscatedCode());
    } else if (ext === '.css') {
      output = Buffer.from(minifyCss(source.toString('utf8')).css);
    }
    fs.writeFileSync(dest, output);
    before += source.length;
    after += output.length;
  }
  console.log(`  ${look}: ${(before / 1024).toFixed(1)} KB source -> ${(after / 1024).toFixed(1)} KB published`);
}
console.log(`published ${looks.length} look(s) into looks/`);
