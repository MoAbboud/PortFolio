// The 0 to 60 run's score card, its run log and its share link.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { ENGINES } from '../engines/index.js';
import { PERFECT } from '../engines/perfect/index.js';
import { scoreRun, lostInMs, gentleLimit } from '../sim/score.js';
import { pack, unpack, hashMatches } from '../sim/runlog.js';
import { encodeRun, decodeRun, runFromHash, linkFor } from '../ui/share.js';
import { driveRun, startingPoint } from '../tools/solve.js';
import { SIM_VERSION } from '../sim/step.js';

const byId = (id) => ENGINES.find((e) => e.id === id);

// A run worse than perfect: the solver's own starting point, as a run log.
function ordinaryRun(engine, over = {}) {
  const r = driveRun(engine, { ...startingPoint(engine), ...over }, { record: true });
  return {
    format: 1, simVersion: SIM_VERSION, engine: engine.id, engineHash: engine.hash,
    gearbox: 'manual', tractionControl: false, mode: 'zero-to-sixty', ...r.log,
  };
}

for (const id of ['v4', 'v8', 'v12']) {
  const engine = byId(id);

  test(`${engine.label}: the time lost in each phase adds up to the gap`, () => {
    const card = scoreRun(engine, ordinaryRun(engine), PERFECT[id]);
    assert.equal(card.scored, true);
    assert.ok(card.phases.length >= 3, `${card.phases.length} phases`);
    assert.equal(card.phases[0].phase, 'launch');
    const sum = card.phases.reduce((a, p) => a + p.lost, 0);
    assert.ok(Math.abs(sum - card.gap) < 1e-9, `${sum} against ${card.gap}`);
    assert.ok(card.gap > 0);
    assert.equal(card.score, Math.round((1000 * PERFECT[id].time) / card.time));
    // As printed, in milliseconds, too.
    const ms = lostInMs(card);
    assert.equal(ms.reduce((a, b) => a + b, 0), Math.round(card.time * 1000) - Math.round(card.perfectTime * 1000));
  });

  test(`${engine.label}: the perfect run scores 1000 against itself and loses nothing`, () => {
    const p = PERFECT[id];
    const card = scoreRun(engine, { ...p.log, engine: id, gearbox: 'manual', tractionControl: false }, p);
    assert.equal(card.score, 1000);
    assert.equal(card.gap, 0);
    assert.equal(card.clean, true);
    for (const phase of card.phases) assert.ok(Math.abs(phase.lost) < 1e-12, `${phase.phase} ${phase.lost}`);
  });
}

test('a run that leaves in second is not scored, and says why', () => {
  const engine = byId('v8');
  const card = scoreRun(engine, ordinaryRun(engine, { launchGear: 2 }), PERFECT.v8);
  assert.equal(card.finished, false);
  assert.equal(card.score, null);
  assert.match(card.why, /other than first/);
});

test('the automatic is timed but not scored', () => {
  const engine = byId('v6');
  const events = [[0, 'key', 1], [0, 'gear', 'P'], [800, 'key', 0], [3500, 'brake', 400], [3600, 'gear', 'D'],
    [5000, 'brake', 0], [5000, 'thr', 1023]];
  const card = scoreRun(engine, { simVersion: SIM_VERSION, engine: 'v6', gearbox: 'auto', tractionControl: true, mode: 'zero-to-sixty', steps: 15000, events }, PERFECT.v6);
  assert.equal(card.finished, true);
  assert.equal(card.scored, false);
  assert.equal(card.score, null);
  assert.ok(card.time > 4 && card.time < 6, `${card.time}`);
});

test('gentle on the clutch: twice the perfect run\'s heat, never under 150 kJ', () => {
  assert.equal(gentleLimit({ slipJ: 5000 }), 150000);
  assert.equal(gentleLimit({ slipJ: 90000 }), 180000);
});

test('a run log packs and unpacks to the same inputs, and a link carries it', async () => {
  const engine = byId('v10');
  const log = ordinaryRun(engine);
  const back = unpack(pack(log));
  assert.deepEqual(back.events, log.events);
  assert.equal(back.steps, log.steps);
  assert.equal(back.engine, 'v10');
  assert.ok(hashMatches(back.engineHash, engine.hash));
  assert.equal(back.gearbox, 'manual');

  const code = await encodeRun(log);
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  assert.ok(code.length < 2000, `${code.length} characters`);
  assert.deepEqual((await decodeRun(code)).events, log.events);
  const link = await linkFor(log, 'https://example.test/pedalsim/');
  assert.deepEqual((await runFromHash(new URL(link).hash)).events, log.events);
  assert.equal(await runFromHash(''), null);
  await assert.rejects(runFromHash('#run=AAAA'));
});

test('lever positions survive the trip', () => {
  const log = { simVersion: 3, engine: 'v4', engineHash: 'abcdef0123', gearbox: 'auto', tractionControl: true,
    mode: 'zero-to-sixty', steps: 10, events: [[0, 'gear', 'P'], [3, 'gear', 'D'], [4, 'gear', -1], [5, 'gear', 6]] };
  assert.deepEqual(unpack(pack(log)).events, log.events);
  assert.equal(unpack(pack(log)).tractionControl, true);
});

test('the page keeps nothing: no local storage, session storage, IndexedDB or cookies', () => {
  const root = new URL('../', import.meta.url);
  const files = ['index.html', ...['ui', 'input', 'sim', 'engines'].flatMap((dir) =>
    readdirSync(new URL(`${dir}/`, root), { recursive: true }).filter((f) => f.endsWith('.js')).map((f) => `${dir}/${f}`))];
  for (const f of files) {
    const text = readFileSync(new URL(f, root), 'utf8');
    assert.doesNotMatch(text, /localStorage|sessionStorage|indexedDB|document\.cookie|caches\.open/, f);
  }
});

test('a run recorded in Chrome scores the same in Node, to the last bit', () => {
  const recorded = JSON.parse(readFileSync(new URL('./scripts/chrome-v8-run.json', import.meta.url), 'utf8'));
  const card = scoreRun(byId(recorded.log.engine), recorded.log, PERFECT[recorded.log.engine]);
  assert.equal(card.time, recorded.card.time);
  assert.equal(card.score, recorded.card.score);
});
