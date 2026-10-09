// Every engine's numbers, measured by running it, against the published figures it is
// held to.
//
//   node tools/figures.js
//
// The same measurements test/engines.test.js makes. Run this after changing
// engines/params.js and rebuilding, to see what moved before a test tells you what broke.

import { ENGINES } from '../engines/index.js';
import { ENGINES as PARAMS } from '../engines/params.js';
import { peaks, startUp, freeRev, revTime, autoZeroToSixty } from './measure.js';
import { CHASSIS } from '../sim/chassis.js';

const KW_TO_HP = 1 / 0.7457;
const PEDALS = [0.1, 0.2, 0.3, 0.4];

function mark(value, range) {
  if (!range) return '      ';
  return value >= range[0] && value <= range[1] ? '  ok  ' : ' OUT  ';
}

function line(label, value, unit, range) {
  const shown = `${value}`.padStart(7);
  const target = range ? `${range[0]}-${range[1]}` : 'no published figure';
  return `  ${label.padEnd(18)}${shown} ${unit.padEnd(4)}${mark(value, range)}${target}`;
}

let out = 0;
for (const engine of ENGINES) {
  const t = PARAMS.find((p) => p.id === engine.id).targets;
  const p = peaks(engine);
  const start = startUp(engine);
  const values = {
    peakTorque: Math.round(p.peakTorque),
    peakTorqueRpm: p.peakTorqueRpm,
    peakPower: Math.round(p.peakPower),
    peakPowerRpm: p.peakPowerRpm,
    redline: engine.redlineRpm,
  };
  for (const [k, v] of Object.entries(values)) if (t[k] && (v < t[k][0] || v > t[k][1])) out += 1;

  console.log(`${engine.label}  ${(engine.displacement * 1000).toFixed(2)} litres, ` +
    `${engine.cylinders} cylinders, bore ${engine.bore * 1000} x stroke ${engine.stroke * 1000} mm`);
  console.log(line('peak torque', values.peakTorque, 'Nm', t.peakTorque));
  console.log(line('  at', values.peakTorqueRpm, 'rpm', t.peakTorqueRpm));
  console.log(line('peak power', values.peakPower, 'kW', t.peakPower) +
    `  (${Math.round(p.peakPower * KW_TO_HP)} hp)`);
  console.log(line('  at', values.peakPowerRpm, 'rpm', t.peakPowerRpm));
  console.log(line('redline', values.redline, 'rpm', t.redline));
  console.log(`  limiter ${engine.limiterRpm}, over-rev ${engine.overRevRpm}, idle ${engine.idleRpm}, ` +
    `stall below ${engine.stallRpm}`);
  console.log(`  start: flares to ${Math.round(start.flare)}, settles at ${Math.round(start.idle)} rpm`);
  console.log(`  idle to redline, flat out in neutral: ${revTime(engine).toFixed(2)} s`);
  const free = PEDALS.map((q) => `${q * 100}% ${Math.round(freeRev(engine, q).mean)}`);
  console.log(`  held throttle in neutral -> rpm: ${free.join(', ')}`);
  const g = engine.gearing;
  console.log(`  in the car: ${engine.mass + CHASSIS.massWithoutEngine} kg, gears ${g.ratios.join(' ')} x ${g.finalDrive}, ` +
    `top speed ${Math.round(g.topSpeed * 2.23694)} mph`);
  console.log(`  coach changes up at ${engine.coach.upshiftRpm.join(', ')} rpm`);
  console.log(`  automatic, flat out, traction control on: 0-60 mph in ${autoZeroToSixty(engine).toFixed(2)} s`);
  console.log('');
}
console.log(out ? `${out} figure(s) outside their published range` : 'every figure inside its published range');
process.exitCode = out ? 1 : 0;
