import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  tokenise, buildLookup, resolve, splitStep, mergeStep, scriptOf,
} from '../lib/script.js';

const LIBRARY = ['normal-car1', 'sports-car', 'house1', 'couch', 'guitar', 'husky',
  'shiba-inu', 'street-straight', 'characters-matt', 'mannequin', 'traffic-light-1'];
const SYNONYMS = { dog: ['husky', 'shiba-inu'], road: ['street-straight'], sofa: ['couch'] };
const LOOKUP = buildLookup(LIBRARY, SYNONYMS);

// --- reading the words -------------------------------------------------------

test('a script is split on anything that is not a letter', () => {
  const words = tokenise("Marla's car - the red one! - stopped.");
  assert.deepEqual(words.map((w) => w.word), ['marla', 'car', 'the', 'red', 'one', 'stopped']);
});

test('a word knows whether it began a sentence', () => {
  const words = tokenise('Devon waited. Marla left.');
  const opens = words.filter((w) => w.opens).map((w) => w.raw);
  assert.deepEqual(opens, ['Devon', 'Marla']);
});

test('a possessive is read as the name it belongs to', () => {
  const [word] = tokenise("Marla's");
  assert.equal(word.word, 'marla');
});

// --- the dictionary is the noun detector -------------------------------------

test('a model can be reached by any part of its name', () => {
  assert.deepEqual(LOOKUP.get('car'), ['normal-car1', 'sports-car']);
  assert.deepEqual(LOOKUP.get('couch'), ['couch']);
  assert.ok(LOOKUP.get('normal-car1'), 'a whole model name should resolve too');
});

test('a number a pack used to tell two models apart is not a word', () => {
  assert.equal(LOOKUP.has('1'), false);
  assert.ok(LOOKUP.has('house'), 'house1 should still answer to "house"');
});

test('synonyms cover what model names never will', () => {
  // Nobody writes "husky" when they mean a dog, and this is the entire reason
  // coverage measured 43 per cent on names alone.
  assert.deepEqual(LOOKUP.get('dog'), ['husky', 'shiba-inu']);
  assert.deepEqual(LOOKUP.get('road'), ['street-straight']);
});

test('a synonym pointing at a model this library lacks is dropped', () => {
  const lookup = buildLookup(['couch'], { cat: ['tabby'] });
  assert.equal(lookup.has('cat'), false, 'an unplaceable word must not be offered');
});

// --- what a script asks for --------------------------------------------------

// Names sit mid-sentence here on purpose. A capital that opens a sentence says
// nothing, and the test below states that limitation outright.
const SCRIPT = `After midnight Marla arrived at the house. Her car was parked on the
road outside, and Devon waited on the couch with a guitar. Then Marla saw the dog.`;

test('words the library can build come back as objects', () => {
  const { objects } = resolve(SCRIPT, LOOKUP);
  const words = objects.map((o) => o.word);
  assert.ok(words.includes('house'), 'house was not found');
  assert.ok(words.includes('car'), 'car was not found');
  assert.ok(words.includes('couch') && words.includes('guitar') && words.includes('dog'));
});

test('the tray reads in the order the story introduces things', () => {
  const { objects } = resolve(SCRIPT, LOOKUP);
  assert.deepEqual(objects.map((o) => o.word), ['house', 'car', 'road', 'couch', 'guitar', 'dog']);
});

test('a word mentioned twice is counted, not repeated', () => {
  const { objects } = resolve('The car stopped. The car left.', LOOKUP);
  assert.equal(objects.length, 1);
  assert.equal(objects[0].count, 2);
});

test('a capitalised word the library cannot build is offered as cast', () => {
  const { cast } = resolve(SCRIPT, LOOKUP);
  assert.deepEqual(cast.map((c) => c.name), ['Marla', 'Devon']);
  assert.equal(cast[0].count, 2, 'Marla is named twice');
});

test('a name that only ever opens a sentence is missed, and that is known', () => {
  // A stated limitation of the heuristic rather than a bug: a capital at the
  // start of a sentence means nothing, so there is nothing to go on.
  const { cast } = resolve('Marla left. Marla returned.', LOOKUP);
  assert.deepEqual(cast, [], 'this failure is expected and is fixed by clicking in the panel');
});

test('a sentence opener is not mistaken for a person', () => {
  const { cast } = resolve('The car stopped. Then it left.', LOOKUP);
  assert.deepEqual(cast.map((c) => c.name), []);
});

test('a word that resolves to a model is never read as a name', () => {
  const { cast, objects } = resolve('She drove the Car home.', LOOKUP);
  assert.deepEqual(cast, []);
  assert.equal(objects[0].word, 'car');
});

test('everything else is a gap, kept visible rather than dropped', () => {
  const { gaps } = resolve(SCRIPT, LOOKUP);
  const words = gaps.map((g) => g.word);
  assert.ok(words.includes('midnight'), 'an abstract word should be visible as a gap');
  assert.ok(!words.includes('car'), 'a word that resolved is not a gap');
  assert.ok(!words.includes('marla'), 'a name is cast, not a gap');
});

test('gaps are ordered by how often they come up', () => {
  const { gaps } = resolve('rain rain rain fog', LOOKUP);
  assert.equal(gaps[0].word, 'rain');
  assert.equal(gaps[0].count, 3);
});

test('an empty script asks for nothing and does not throw', () => {
  const empty = resolve('', LOOKUP);
  assert.deepEqual(empty.objects, []);
  assert.deepEqual(empty.cast, []);
  assert.equal(empty.words, 0);
  assert.deepEqual(resolve(null, LOOKUP).objects, []);
});

// --- the script lives split across the steps ---------------------------------

test('the script is only ever the steps read in order', () => {
  const steps = [{ text: 'She arrived.' }, { text: 'She left.' }];
  assert.equal(scriptOf(steps), 'She arrived.\n\nShe left.');
});

test('splitting a step cuts its words in two and keeps everything else', () => {
  const steps = [{ text: 'She arrived. She left.', hold: 4000, framing: { x: 1 } }];
  const cut = splitStep(steps, 0, 13);
  assert.equal(cut.length, 2);
  assert.equal(cut[0].text, 'She arrived. ');
  assert.equal(cut[1].text, 'She left.');
  assert.equal(cut[1].hold, 4000, 'the new step should be a real step immediately');
  assert.notEqual(cut[1].framing, steps[0].framing, 'the framing must be copied, not shared');
});

test('splitting at either end would make an empty step, so it does not', () => {
  const steps = [{ text: 'She left.' }];
  assert.equal(splitStep(steps, 0, 0).length, 1);
  assert.equal(splitStep(steps, 0, 9).length, 1);
});

test('merging puts a step back together with the one after it', () => {
  const steps = [{ text: 'She arrived.' }, { text: 'She left.' }, { text: 'It rained.' }];
  const joined = mergeStep(steps, 0);
  assert.equal(joined.length, 2);
  assert.equal(joined[0].text, 'She arrived. She left.');
  assert.equal(joined[1].text, 'It rained.');
});

test('merging the last step does nothing, because there is nothing after it', () => {
  const steps = [{ text: 'She left.' }];
  assert.equal(mergeStep(steps, 0).length, 1);
});

test('splitting and merging return the script unchanged', () => {
  const steps = [{ text: 'She arrived. She left.' }];
  const round = mergeStep(splitStep(steps, 0, 13), 0);
  assert.equal(scriptOf(round), scriptOf(steps));
});

// --- against the library that actually exists --------------------------------

test('the real library resolves a real paragraph', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../models/index.json', import.meta.url), 'utf8')
  );
  const names = [
    ...manifest.recipes,
    ...manifest.meshes.map((m) => m.name),
    ...(manifest.rigs ?? []).map((r) => r.name),
  ];
  let synonyms = {};
  try {
    synonyms = JSON.parse(
      readFileSync(new URL('../models/synonyms.json', import.meta.url), 'utf8')
    ).words ?? {};
  } catch { /* the file is optional */ }

  const lookup = buildLookup(names, synonyms);
  const { objects, cast } = resolve(
    `After midnight Marla arrived at the house. Her car was parked on the road
     outside, and Devon waited on the couch with a guitar. Then Marla saw the dog.`,
    lookup,
  );
  const found = objects.map((o) => o.word);
  for (const word of ['house', 'car', 'road', 'couch', 'guitar', 'dog']) {
    assert.ok(found.includes(word), `"${word}" did not resolve against the real library`);
  }
  assert.deepEqual(cast.map((c) => c.name), ['Marla', 'Devon']);
});
