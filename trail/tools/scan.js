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

// Mesh packs ship one OBJ per model, often hundreds, so each is listed by path
// and given a name from its filename. They are read only when first wanted.
const slug = (name) => name
  .replace(/\.obj$/i, '')
  .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
  .replace(/[^a-z0-9]+/gi, '-')
  .replace(/^-+|-+$/g, '')
  .toLowerCase();

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
  return 'UNKNOWN - check before publishing';
};

const previous = existsSync(MANIFEST)
  ? JSON.parse(readFileSync(MANIFEST, 'utf8'))
  : { recipes: [], packs: [], downloads: [] };

const taken = new Set(recipes);
const meshes = files
  .filter((f) => f.toLowerCase().endsWith('.obj'))
  .sort()
  .map((file) => {
    let name = slug(file.split('/').pop());
    if (taken.has(name)) {
      let n = 2;
      while (taken.has(`${name}-${n}`)) n++;
      name = `${name}-${n}`;
    }
    taken.add(name);
    return { file, name, licence: licenceNear(file) };
  });

// Keep what someone has already said about each pack.
const known = new Map((previous.packs ?? []).map((p) => [p.file, p]));

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
}));

const manifest = {
  note: 'What the library holds when the page opens. Written by tools/scan.js;'
    + ' run it after adding models. The packs themselves are not in the repository:'
    + ' re-download them from `downloads` below and run the tool again.',
  downloads,
  recipes: recipes.sort(),
  meshes,
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
