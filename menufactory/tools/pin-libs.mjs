// Copies the third-party libraries the looks use into shared/lib/, at the exact versions in
// package.json.
//
//   npm run pin-libs
//
// The looks load these files from the site itself, never from a CDN, so a look always gets
// the version it was tested with. The folder is shared/lib/, not vendor/: the repository's
// root .gitignore ignores every folder called vendor/.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB = path.join(ROOT, 'shared', 'lib');

// [from inside node_modules, to inside shared/lib]
const FILES = [
  ['gsap/dist/gsap.min.js', 'gsap.min.js'],
  ['gsap/dist/ScrollTrigger.min.js', 'ScrollTrigger.min.js'],
  // three.module.js imports ./three.core.js, so both are needed and must sit side by side.
  ['three/build/three.module.js', 'three/three.module.js'],
  ['three/build/three.core.js', 'three/three.core.js'],
  ['three/LICENSE', 'three/LICENSE'],
];

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const versions = {};
for (const name of ['gsap', 'three']) {
  const installed = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules', name, 'package.json'), 'utf8')).version;
  if (installed !== pkg.devDependencies[name]) {
    throw new Error(`${name}: package.json pins ${pkg.devDependencies[name]} but ${installed} is installed. Run npm install.`);
  }
  versions[name] = installed;
}

for (const [from, to] of FILES) {
  const dest = path.join(LIB, to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'node_modules', from), dest);
  console.log(`  ${to}`);
}

fs.writeFileSync(path.join(LIB, 'versions.json'), JSON.stringify(versions, null, 2) + '\n');
console.log(`pinned gsap ${versions.gsap}, three ${versions.three}`);
