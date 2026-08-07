import test from 'node:test';
import assert from 'node:assert/strict';

import { splitStep, mergeStep, scriptOf } from '../lib/script.js';

// Reading a script was cancelled - no tokenising, no dictionary, no tray. What
// a step carries now is a note about what happens in it, which nothing reads.
// These are the tests for cutting one note into stages and putting it back.

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
