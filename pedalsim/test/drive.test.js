import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function drive(...args) {
  return execFileSync(process.execPath, ['tools/drive.js', ...args], { cwd: ROOT, encoding: 'utf8' });
}

test('drive.js writes a CSV trace, one row every 10 ms by default', () => {
  const rows = drive('test/scripts/idle.json').trim().split('\n');
  assert.equal(rows[0], 't,rpm,mph,wheel_mph,gear,running,load,cut,tc,thr,brake,clutch');
  // 6000 steps sampled every 10: 600 rows after the header, the first at 0.010 s.
  assert.equal(rows.length, 601);
  assert.match(rows[1], /^0\.010,/);
  assert.match(rows.at(-1), /^6\.000,/);
});

test('--engine runs an engine: the key starts it and it idles', () => {
  const rows = drive('test/scripts/idle.json', '--engine', 'v8').trim().split('\n');
  const last = rows.at(-1).split(',');
  // t, rpm, mph, wheel_mph, gear, running ...
  assert.equal(last[5], '1');
  assert.ok(Math.abs(Number(last[1]) - 650) < 60, `idling at ${last[1]}`);
});

test('--every 1 samples every step', () => {
  const rows = drive('test/scripts/idle.json', '--every', '1').trim().split('\n');
  assert.equal(rows.length, 6001);
});

test('--out writes plain UTF-8 and makes the folder, whatever the shell', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pedalsim-'));
  try {
    const file = join(dir, 'nested', 'idle.csv');
    drive('test/scripts/idle.json', '--out', file);
    const bytes = readFileSync(file);
    // No byte-order mark: the file starts with the header's own first characters.
    assert.equal(bytes.subarray(0, 2).toString('latin1'), 't,');
    assert.equal(bytes.toString('utf8'), drive('test/scripts/idle.json'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the script can come after the flags', () => {
  const rows = drive('--every', '100', 'test/scripts/idle.json').trim().split('\n');
  assert.equal(rows.length, 61);
});

test('drive.js says how to use it instead of failing obscurely', () => {
  for (const args of [[], ['test/scripts/idle.json', '--out'], ['test/scripts/idle.json', '--every', '0'],
    ['test/scripts/idle.json', '--engine', 'v7']]) {
    const run = spawnSync(process.execPath, ['tools/drive.js', ...args], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(run.status, 2, `exit status for ${args.join(' ')}`);
    assert.match(run.stderr, /usage: node tools\/drive\.js/);
  }
});
