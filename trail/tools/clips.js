// What poses a rigged model can be put into.
//
//   node tools/clips.js                      every rigged model in the library
//   node tools/clips.js models/Some.glb      one file
//
// A rigged character ships as one file holding dozens of clips, and a clip is a
// bank of poses rather than something to play. This lists them with their
// lengths, so a pose can be chosen and written into `models/index.json` as a
// library entry - which is the only way Trail ever uses one.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';

import { readGlb, readGltf, clipNames } from '../lib/gltf.js';
import { fromTriangles } from '../lib/mesh.js';

const MODELS = fileURLToPath(new URL('../models/', import.meta.url));

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(relative(MODELS, full).split(sep).join('/'));
  }
  return out;
};

/** A document and its buffer, whichever way round they were stored. */
function open(path) {
  const bytes = new Uint8Array(readFileSync(path));
  if (path.toLowerCase().endsWith('.glb')) return readGlb(bytes);
  const json = JSON.parse(Buffer.from(bytes).toString('utf8'));
  return { json, binary: null };
}

const asked = process.argv.slice(2);
const files = asked.length
  ? asked
  : walk(MODELS)
    .filter((f) => /\.(glb|gltf)$/i.test(f))
    .map((f) => join(MODELS, f));

let rigged = 0;
for (const path of files) {
  if (!existsSync(path)) { console.log(`${path}: not there`); continue; }
  let doc;
  try {
    doc = open(path);
  } catch (error) {
    console.log(`${path}: ${error.message}`);
    continue;
  }

  const names = clipNames(doc.json);
  if (!names.length) continue;    // Not rigged: nothing to choose from.
  rigged++;

  const joints = doc.json.skins?.[0]?.joints?.length ?? 0;
  console.log('');
  console.log(relative(MODELS, path).split(sep).join('/'));
  console.log(`  ${names.length} poses, ${joints} joints`);
  console.log('');

  for (const [i, name] of names.entries()) {
    const clip = doc.json.animations[i];
    // How long the clip runs, from the last key of its longest sampler.
    let length = 0;
    for (const sampler of clip.samplers ?? []) {
      const times = doc.json.accessors?.[sampler.input];
      const end = times?.max?.[0];
      if (Number.isFinite(end) && end > length) length = end;
    }

    // The standing height at the middle of the clip, which is the quickest way
    // to tell a pose apart: sitting is short, lying down is shorter still.
    let height = '';
    try {
      const raw = readGltf(doc.json, [doc.binary], {
        name, pose: { clip: name, time: length / 2 },
      });
      height = `${fromTriangles(raw).size[1].toFixed(2)} tall at the middle`;
    } catch (error) {
      height = `could not be posed: ${error.message}`;
    }

    console.log(`  ${name.padEnd(26)} ${length.toFixed(2)}s   ${height}`);
  }
}

console.log('');
if (!rigged) {
  console.log('No rigged models found. Only a file with animations can be posed.');
} else {
  console.log('To use one, add it to "poses" in models/index.json:');
  console.log('  { "name": "person-waving", "file": "<path>", "clip": "<clip>",');
  console.log('    "time": 0.5, "slots": { "M_Main": "primary" }, "licence": "CC0" }');
  console.log('Then run npm run scan, which keeps poses as they are written.');
}
