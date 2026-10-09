// Drive the simulation from a script and print what the gauges would have shown.
//
//   node tools/drive.js test/scripts/idle.json                          every 10 ms, to the screen
//   node tools/drive.js test/scripts/idle.json --out traces/idle.csv    to a file
//   node tools/drive.js test/scripts/idle.json --every 1                every step
//
// The script is a run log without the run: { "steps": n, "events": [[step, channel, value]] }.
// The output is CSV, one row per sample, so a trace can be opened in a spreadsheet, read by
// a test, or - from stage 3 - played through the gauges before there is any live input.
//
// Use --out rather than > in Windows PowerShell 5.1: its > can write UTF-16 or a byte-order
// mark. --out writes plain UTF-8 and creates the folder.
//
// This is the maths workbench: until the page exists, it is the only way to see the car.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { replay } from '../sim/replay.js';
import { STEPS_PER_SECOND } from '../sim/step.js';

const RAD_S_TO_RPM = 60 / (2 * Math.PI);
const MS_TO_MPH = 3600 / 1609.344;

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] ?? '' : null;
};
const every = flag('--every') === null ? 10 : Number(flag('--every'));
const out = flag('--out');
// The script is the first argument that is neither a flag nor a flag's value.
const path = args.find((a, i) => !a.startsWith('--') && !(args[i - 1] ?? '').startsWith('--'));

if (!path || !Number.isInteger(every) || every < 1 || out === '') {
  console.error('usage: node tools/drive.js <script.json> [--every <steps>] [--out <file.csv>]');
  process.exit(2);
}

const script = JSON.parse(readFileSync(path, 'utf8'));

// No engine and no chassis yet: stage 1 adds the engine files and an --engine option.
const rows = ['t,rpm,mph,gear,running,thr,brake,clutch'];
replay(null, null, script, (state, inputs) => {
  if (state.step % every !== 0) return;
  rows.push([
    (state.step / STEPS_PER_SECOND).toFixed(3),
    (state.we * RAD_S_TO_RPM).toFixed(0),
    (state.v * MS_TO_MPH).toFixed(2),
    state.gear,
    state.running ? 1 : 0,
    inputs.thr,
    inputs.brake,
    inputs.clutch,
  ].join(','));
});

const csv = rows.join('\n') + '\n';
if (out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, csv, 'utf8');
  console.error(`${rows.length - 1} rows to ${out}`);
} else {
  process.stdout.write(csv);
}
