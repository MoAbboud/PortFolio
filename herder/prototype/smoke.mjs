// Execute the generated page's script against a stub DOM and check what it renders.
//
//   node prototype/smoke.mjs
//
// The parity tests prove the ported pipeline agrees with Python. They say nothing about whether
// the page around it works - and the UI is where a typo produces a blank panel and no error the
// author will see. So this pulls the inlined script out of index.html, runs it with just enough
// DOM to satisfy it, clicks "Load a sample", and asserts the brief came out with real content.
//
// Exits non-zero with a message on any failure. Driven by tests/test_parity.py.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(HERE, 'index.html'), 'utf8');

const match = html.match(/<script>\n(\/\/ GENERATED[\s\S]*?)<\/script>/);
if (!match) throw new Error('index.html has no generated script block - run generate.py');

// --- the smallest DOM the page will accept -------------------------------------------------
const elements = new Map();
const listeners = new Map();

// The stub models elements, not attributes, so an input's starting `value=` has to come from the
// document or the page reads an empty string. Taken from the HTML rather than hardcoded, so the
// test keeps matching the slider's real default if it changes.
const attrValue = (id) => {
  const tag = html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`));
  return tag ? (tag[0].match(/value="([^"]*)"/) ?? [, ''])[1] : '';
};

function element(id) {
  const el = {
    id,
    value: attrValue(id),
    textContent: '',
    innerHTML: '',
    dataset: {},
    classes: new Set(['results', 'changed', 'notice'].includes(id) ? ['hidden'] : []),
    classList: {
      add: (...c) => c.forEach((x) => el.classes.add(x)),
      remove: (...c) => c.forEach((x) => el.classes.delete(x)),
      contains: (c) => el.classes.has(c),
    },
    addEventListener: (event, fn) => listeners.set(`${id}:${event}`, fn),
    focus: () => {},
  };
  return el;
}

const sandbox = {
  document: {
    getElementById: (id) => {
      if (!elements.has(id)) elements.set(id, element(id));
      return elements.get(id);
    },
  },
  navigator: { clipboard: { writeText: async () => {} } },
  setTimeout: () => {},
  console,
};
sandbox.window = sandbox;

vm.createContext(sandbox);
new vm.Script(match[1], { filename: 'index.html#script' }).runInContext(sandbox);

// --- drive it ------------------------------------------------------------------------------
const fail = (message) => {
  console.error(`smoke: ${message}`);
  process.exit(1);
};

const sample = listeners.get('sample:click');
if (!sample) fail('the "Load a sample" handler was never registered');
sample();

const brief = elements.get('brief');
const results = elements.get('results');
const stats = elements.get('stats');
const changed = elements.get('changed');

if (results.classList.contains('hidden')) fail('results stayed hidden after deriving the sample');
if (!brief || !brief.innerHTML) fail('the brief panel is empty');
if (!brief.dataset.text) fail('the brief text was not stored for the copy button');

// The sample is written to exercise the ordering and the reversal flag, so all of this must show.
for (const needed of ['constraint', 'decision', 'open_thread']) {
  if (!brief.innerHTML.includes(needed.replace('_', ' '))) fail(`no ${needed} in the rendered brief`);
}
if (!brief.dataset.text.includes('## Stable')) fail('the brief has no Stable section');
if (changed.classList.contains('hidden')) fail('the sample announces a change but nothing was flagged');
if (!/\d/.test(stats.innerHTML)) fail('the stat cards carry no numbers');

// Nothing the assistant said may reach the brief. The rule that outranks every other rule,
// asserted on what a visitor actually sees.
for (const line of ['Happy to help', 'That’s sensible', "That's sensible", 'I can sketch the schema']) {
  if (brief.dataset.text.includes(line)) fail(`assistant text reached the brief: ${line}`);
}

const atDefault = brief.dataset.text.split('\n').length;

const budget = elements.get('budget');
budget.value = '200';
const slide = listeners.get('budget:input');
if (!slide) fail('the budget slider has no handler');
slide();
if (!brief.dataset.text) fail('the brief went empty at a small budget');
const cut = elements.get('excludedWrap');
if (cut.innerHTML === '') fail('nothing reported as cut for space at 200 tokens');
if (cut.classList.contains('hidden')) fail('the "cut for space" disclosure stayed hidden at 200 tokens');
if (!cut.innerHTML.includes('<summary>')) fail('what was cut is not behind a clickable title');

// Lowering the budget has to drop something, or the budget is not being applied at all - which
// would make the whole render step look like it works while doing nothing.
const atSmall = brief.dataset.text.split('\n').length;
if (atSmall >= atDefault) fail(`200 tokens kept ${atSmall} lines against ${atDefault} at the default`);

// The strip has to name the models the full system runs, or the page reads as the whole product.
for (const id of ['m-extract', 'm-embed', 'm-nli', 'm-nli2']) {
  if (!elements.get(id)?.textContent) fail(`the pipeline strip has no model name in #${id}`);
}
if (elements.get('m-nli').textContent.includes('/')) fail('the NLI model is shown with its hub namespace');

// Real pastes, the way people actually copy a chat. The sample is labelled by hand; visitors' chats
// are not, and this is where the assistant's advice used to arrive in the brief as the user's.
const paste = elements.get('paste');
const run = listeners.get('run:click');
const notice = elements.get('notice');
budget.value = '500';

paste.value = [
  'You said:',
  "We're going with Postgres. No cloud services.",
  'ChatGPT said:',
  'Great choice. You should always use connection pooling and never store secrets in the repo.',
  'You said:',
  'Amounts are always decimal, never floats.',
  'ChatGPT said:',
  "Sounds good. I'd recommend using Redis for caching.",
].join('\n');
run();
if (results.classList.contains('hidden')) fail('a copied ChatGPT page produced no brief');
for (const line of ['connection pooling', 'Redis', 'Great choice', 'ChatGPT said']) {
  if (brief.dataset.text.includes(line)) fail(`assistant text from a "said:" paste reached the brief: ${line}`);
}
if (!brief.dataset.text.includes('decimal, never floats')) fail('the user\'s constraint was lost from a "said:" paste');

paste.value = "We're going with Postgres.\n\nGreat choice. You should always use connection pooling.";
run();
if (notice.classList.contains('hidden')) fail('an unlabelled paste was read instead of refused');
if (!results.classList.contains('hidden')) fail('an unlabelled paste still shows a brief');

console.log(`smoke ok - ${atDefault} lines at the default budget, ${atSmall} at 200; real pastes handled`);
