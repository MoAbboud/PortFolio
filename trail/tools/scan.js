// Find what is in models/ and write the manifest.
//
//   node tools/scan.js          rewrite models/index.json
//   node tools/scan.js --check  report what is missing, change nothing
//
// A static server cannot be asked what is in a folder, so the library has to be
// listed somewhere. This walks `models/` and writes that list, which means
// adding a pack is dropping a file in and running one command rather than
// editing JSON by hand.
//
// Anything already written about a pack - its licence, its author, the file
// naming its models - is kept. Only the list of files is rediscovered.

import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';

const MODELS = fileURLToPath(new URL('../models/', import.meta.url));
const MANIFEST = join(MODELS, 'index.json');
const check = process.argv.includes('--check');

/** Everything under models/, as paths relative to it. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(relative(MODELS, full).split(sep).join('/'));
  }
  return out;
}

const files = walk(MODELS);

// A recipe is any .json that describes a model. The manifest and the name files
// live alongside them and are not models themselves.
const recipes = [];
for (const file of files) {
  if (!file.endsWith('.json')) continue;
  if (file === 'index.json' || file.startsWith('names/')) continue;
  try {
    const recipe = JSON.parse(readFileSync(join(MODELS, file), 'utf8'));
    if (!recipe.id || !Array.isArray(recipe.parts)) continue;
    const name = file.replace(/\.json$/, '');
    if (recipe.id !== name.split('/').pop()) {
      console.warn(`  ${file} calls itself "${recipe.id}"; the manifest will use "${name}"`);
    }
    recipes.push(name);
  } catch (error) {
    console.warn(`  ${file} is not readable as a recipe: ${error.message}`);
  }
}

const packs = files.filter((f) => f.toLowerCase().endsWith('.vox')).sort();

// Mesh packs ship one file per model, often hundreds, so each is listed by path
// and given a name from its filename. They are read only when first wanted.
//
// Three formats, because the packs disagree: the older Quaternius sets are OBJ,
// everything since about 2019 is glTF, and a `.glb` is the same document with
// its buffer inside it.
const MESH = /\.(obj|gltf|glb)$/i;
const slug = (name) => name
  .replace(MESH, '')
  .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
  .replace(/[^a-z0-9]+/gi, '-')
  .replace(/^-+|-+$/g, '')
  .toLowerCase();

const previous = existsSync(MANIFEST)
  ? JSON.parse(readFileSync(MANIFEST, 'utf8'))
  : { recipes: [], packs: [], downloads: [] };

// Where each pack came from. The packs themselves are not in the repository -
// they are hundreds of megabytes of somebody else's models - so this is what
// makes them replaceable on a fresh clone.
const folders = [...new Set(files
  .filter((f) => f.includes('/'))
  .map((f) => f.split('/')[0])
  .filter((f) => f !== 'names'))].sort();

const knownSources = new Map(
  (previous.downloads ?? []).map((d) => [d.folder, d])
);
const downloads = folders.map((folder) => ({
  folder,
  from: knownSources.get(folder)?.from ?? 'UNKNOWN - record where this came from',
  licence: knownSources.get(folder)?.licence
    ?? (files.some((f) => f.startsWith(`${folder}/`) && /licen[cs]e/i.test(f))
      ? 'CC0' : 'UNKNOWN - check before publishing'),
  ...(knownSources.get(folder)?.established
    ? { established: knownSources.get(folder).established } : {}),
  ...(knownSources.get(folder)?.exclude
    ? { exclude: knownSources.get(folder).exclude } : {}),
  ...(knownSources.get(folder)?.excluded
    ? { excluded: knownSources.get(folder).excluded } : {}),
}));

/**
 * Models a pack ships that are not objects.
 *
 * A modular kit is mostly parts: wall panels, cornices, road markings, window
 * sections. They are meaningful only assembled into a building, which is level
 * design rather than placing a thing in a scene, and a hundred of them buries
 * the thirty models that are objects.
 *
 * Written as patterns against the filename, per download, so that it survives
 * both a rescan and a re-download of the pack. A list of a hundred names would
 * not survive either, and would have to be rebuilt by hand every time.
 */
const excluders = new Map(downloads.map((d) => [d.folder, (d.exclude ?? []).map((pattern) => {
  try {
    return new RegExp(pattern);
  } catch (error) {
    console.warn(`  ${d.folder}: "${pattern}" is not a pattern (${error.message}); ignored`);
    return null;
  }
}).filter(Boolean)]));

const excluded = (file) => {
  const patterns = excluders.get(file.split('/')[0]) ?? [];
  const base = file.split('/').pop().replace(MESH, '');
  return patterns.some((pattern) => pattern.test(base));
};

const declared = new Map(downloads.map((d) => [d.folder, d.licence]));

const licenceNear = (file) => {
  // A pack's licence sits in its own folder, so walk back up looking for one.
  const parts = file.split('/');
  while (parts.length > 1) {
    parts.pop();
    const folder = parts.join('/');
    const found = files.find((f) => f.startsWith(`${folder}/`)
      && /^licen[cs]e[^/]*\.txt$/i.test(f.slice(folder.length + 1)));
    if (found) {
      const text = readFileSync(join(MODELS, found), 'utf8');
      if (/CC0/i.test(text)) return 'CC0';
      return 'UNKNOWN - check before publishing';
    }
  }
  // No file in the pack, so fall back to what has been established about the
  // download itself. Some packs simply shipped without one, and establishing
  // the licence by hand - with the evidence recorded in `downloads` - is the
  // answer to that rather than leaving the models unreachable forever. This
  // is also the only reason a rescan does not undo that work.
  return declared.get(file.split('/')[0]) ?? 'UNKNOWN - check before publishing';
};

// A pack that ships several formats of the same model would otherwise arrive
// twice, numbered, which doubles the library with nothing new in it. One entry
// per model, and OBJ wins because it is the format with the most tested path.
const RANK = { obj: 0, gltf: 1, glb: 2 };
const best = new Map();
let skipped = 0;
for (const file of files.filter((f) => MESH.test(f)).sort()) {
  if (excluded(file)) { skipped++; continue; }
  const key = `${file.split('/')[0]}/${slug(file.split('/').pop())}`;
  const rank = RANK[file.split('.').pop().toLowerCase()];
  if (!best.has(key) || rank < best.get(key).rank) best.set(key, { file, rank });
}

// Anything written by hand about a model, kept across a rescan. Only the real
// height so far, and only the file list is ever rediscovered - a pack that
// needed its scale corrected should not need correcting again every time a new
// pack is dropped in.
const saidBefore = new Map((previous.meshes ?? []).map((m) => [m.file, m]));

const taken = new Set(recipes);
const meshes = [...best.values()]
  .map((m) => m.file)
  .sort()
  .map((file) => {
    let name = slug(file.split('/').pop());
    if (taken.has(name)) {
      let n = 2;
      while (taken.has(`${name}-${n}`)) n++;
      name = `${name}-${n}`;
    }
    taken.add(name);
    const height = saidBefore.get(file)?.height;
    return {
      file,
      name,
      licence: licenceNear(file),
      ...(height ? { height } : {}),
    };
  });

// Keep what someone has already said about each pack.
const known = new Map((previous.packs ?? []).map((p) => [p.file, p]));

const manifest = {
  note: 'What the library holds when the page opens. Written by tools/scan.js;'
    + ' run it after adding models. The packs themselves are not in the repository:'
    + ' re-download them from `downloads` below and run the tool again.',
  downloads,
  recipes: recipes.sort(),
  meshes,
  // Poses are written by hand, never discovered. A rigged character is one
  // file holding dozens of them, so each is a library entry naming the clip
  // and the moment it is frozen at - which is data, exactly like a model.
  poses: previous.poses ?? [],
  packs: packs.map((file) => {
    const before = known.get(file) ?? {};
    // A names file beside the pack, if one exists, under the pack's own name.
    const base = file.split('/').pop().replace(/\.vox$/i, '');
    const guess = `names/${base}.json`;
    const names = before.names ?? (files.includes(guess) ? guess : undefined);
    return {
      file,
      ...(names ? { names } : {}),
      ...(before.title ? { title: before.title } : {}),
      ...(before.author ? { author: before.author } : {}),
      licence: before.licence ?? 'UNKNOWN - check before publishing',
      ...(before.source ? { source: before.source } : {}),
    };
  }),
};

// --- report -----------------------------------------------------------------

console.log(`models/  ${recipes.length} recipes, ${packs.length} voxel packs, ${meshes.length} meshes`);
for (const name of manifest.recipes) console.log(`  recipe  ${name}`);
for (const pack of manifest.packs) {
  const names = pack.names ? `named by ${pack.names}` : 'unnamed';
  console.log(`  pack    ${pack.file}  ${pack.licence}  ${names}`);
}

const byLicence = {};
for (const m of meshes) byLicence[m.licence] = (byLicence[m.licence] ?? 0) + 1;
for (const [licence, n] of Object.entries(byLicence)) {
  console.log(`  meshes  ${String(n).padStart(4)}  ${licence}`);
}

// Said out loud rather than dropped quietly. A tool that silently shows less
// than what is on disk is the thing that hid two whole packs for a fortnight.
if (skipped) {
  console.log(`  held    ${String(skipped).padStart(4)}  excluded by pattern, see "exclude" in the manifest`);
}

if (manifest.poses.length) {
  console.log(`  poses   ${String(manifest.poses.length).padStart(4)}  kept from the manifest`);
}

const unlicensed = [...manifest.packs, ...meshes].filter((p) => p.licence.startsWith('UNKNOWN'));
if (unlicensed.length) {
  console.log('');
  console.log('These have no licence recorded. Trail publishes monetised video, so');
  console.log('fill each one in before using it, and remember the rule is CC0 only:');
  for (const pack of unlicensed.slice(0, 12)) console.log(`  ${pack.file}`);
  if (unlicensed.length > 12) console.log(`  ...and ${unlicensed.length - 12} more`);
}

const unsourced = downloads.filter((d) => d.from.startsWith('UNKNOWN'));
if (unsourced.length) {
  console.log('');
  console.log('These packs are not in the repository and have no download recorded.');
  console.log('Add a "from" URL in models/index.json so a fresh clone can get them:');
  for (const d of unsourced) console.log(`  ${d.folder}`);
}

const unnamed = manifest.packs.filter((p) => !p.names);
if (unnamed.length) {
  console.log('');
  console.log('These have no names, so their models arrive numbered. To name them:');
  for (const pack of unnamed) {
    const base = pack.file.split('/').pop().replace(/\.vox$/i, '');
    console.log(`  node tools/sheet.js models/${pack.file} sheets/${base}`);
    console.log(`  then write models/names/${base}.json`);
  }
}

if (check) {
  const same = JSON.stringify(manifest) === JSON.stringify({
    ...previous, note: manifest.note,
  });
  console.log('');
  console.log(same ? 'The manifest is up to date.' : 'The manifest is out of date; run without --check.');
  process.exitCode = same ? 0 : 1;
} else {
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log('');
  console.log('Wrote models/index.json');
}
