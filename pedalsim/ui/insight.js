// The maths panel: what the simulation worked out on its last step, shown as it happens.
//
// explain() runs the last step's pieces again - the engine, the gearbox, the drivetrain - from
// the state it started from and the inputs it was given. sim/ is deterministic, so this is
// exactly what the car just did, not an estimate of it, and nothing here is fed back.

import { engineControl } from '../sim/engine.js';
import { gearbox } from '../sim/gearbox.js';
import { drivetrainParts } from '../sim/drivetrain.js';
import { lookup } from '../sim/curves.js';
import { CHASSIS } from '../sim/chassis.js';
import { RPM_PER_RAD_S } from '../sim/clock.js';
import { PEDAL_MAX } from '../sim/inputs.js';

const MPH = 2.23694;
// Under this, a joint is not carrying anything worth calling gripping or slipping.
const IDLE_FORCE = 0.5;

// Every number the panel shows, for the step taken from `before` with `inputs`.
export function explain(engine, before, inputs) {
  const car = CHASSIS;
  const control = engineControl(engine, before, inputs);
  const box = gearbox(engine, before, inputs);
  const parts = drivetrainParts(engine, car, before, inputs, control, box);
  const { moved, r } = parts;
  const rpm = before.we * RPM_PER_RAD_S;
  const clutchCarries = moved.lambda[0];
  const tyreForce = moved.lambda[1] / r;
  const brakeForce = moved.lambda[2];
  const tyreLimit = (moved.stuck[1] ? car.muStatic : parts.spinGrip) * parts.rearLoad;
  const converter = box.converter
    ? { pump: control.torque - parts.engineTorque, turbine: box.G ? parts.wheelTorque / box.G : 0 }
    : null;
  return {
    step: before.step,
    box: before.box,
    gear: box.gear,
    rpm,
    mph: before.v * MPH,
    pedal: inputs.thr / PEDAL_MAX,
    throttle: control.throttle,
    tractionControl: before.tractionControl,
    load: control.load,
    target: control.target,
    running: control.running,
    cut: control.cut,
    combustionTable: lookup(engine.combustion, rpm),
    combustion: control.combustion,
    friction: lookup(engine.friction, Math.abs(rpm)),
    pumpingNm: engine.pumpingNm,
    starter: control.starter,
    losses: control.losses,
    torque: control.torque,
    kw: (control.torque * rpm) / RPM_PER_RAD_S / 1000,
    clutchCap: parts.clutchNm,
    clutchCarries,
    clutchState: box.G === 0 || (parts.clutchNm === 0 && !converter) ? 'open' : moved.stuck[0] ? 'gripping' : 'slipping',
    clutchSlipRpm: (before.we - box.G * before.ww) * RPM_PER_RAD_S,
    converter,
    lockup: box.converter && box.clutchNm > 0,
    G: box.G,
    ratio: box.gear > 0 ? engine.gearing.ratios[box.gear - 1] : null,
    finalDrive: engine.gearing.finalDrive,
    wheelTorque: parts.wheelTorque + box.G * clutchCarries,
    a: moved.acc[2],
    rearShare: parts.rearShare,
    rearLoad: parts.rearLoad,
    weight: parts.weight,
    mass: parts.mass,
    muStatic: car.muStatic,
    muKinetic: car.muKinetic,
    spinGrip: parts.spinGrip,
    tyreLimit,
    tyreForce,
    tyreState: Math.abs(tyreForce) < IDLE_FORCE && moved.stuck[1] ? 'idle' : moved.stuck[1] ? 'gripping' : 'spinning',
    spin: parts.spin,
    drag: parts.drag,
    rolling: parts.rolling,
    brakeCap: parts.brakeN,
    brakeForce,
    brakeState: parts.brakeN === 0 ? 'off' : moved.stuck[2] ? 'holding' : 'slowing',
    pawl: box.pawlN > 0, // Park: the gearbox's pawl, modelled as a brake far stronger than any other
    v: before.v,
    cgHeight: car.cgHeight,
    wheelbase: car.wheelbase,
    g: car.g,
    rearWeightFraction: car.rearWeightFraction,
    cdA: car.cdA,
    airDensity: car.airDensity,
    crr: car.crr,
  };
}

const fmt = (x, digits = 0) => {
  if (!Number.isFinite(x)) return '-';
  const v = Math.abs(x) < 0.5 * 10 ** -digits ? 0 : x; // no "-0"
  return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
};
const pct = (x) => `${fmt(x * 100)}%`;

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

// The chain's boxes, left to right. Joints are the friction: they grip or slip.
function chain(x) {
  const clutch = x.converter
    ? { title: x.lockup ? 'CONVERTER, LOCKED' : 'CONVERTER', state: x.G === 0 ? 'open' : x.lockup ? x.clutchState : 'slipping',
      lines: [`takes ${fmt(x.converter.pump)} Nm`, `gives ${fmt(x.converter.turbine)} Nm`] }
    : { title: 'CLUTCH', state: x.clutchState,
      lines: [`holds up to ${fmt(x.clutchCap)} Nm`, `carries ${fmt(x.clutchCarries)} Nm`] };
  return [
    { title: 'ENGINE', lines: [`${fmt(x.rpm)} rpm`, `${fmt(x.torque)} Nm`, `${fmt(x.kw)} kW`] },
    { joint: true, ...clutch },
    { title: 'GEARBOX', lines: [x.gear === 0 ? 'neutral' : `gear ${x.gear === -1 ? 'R' : x.gear}`, `x ${fmt(Math.abs(x.G), 2)} overall`, `${fmt(x.wheelTorque)} Nm at the wheels`] },
    { joint: true, title: 'TYRES', state: x.tyreState,
      lines: [`grip up to ${fmt(x.tyreLimit)} N`, `pushing ${fmt(x.tyreForce)} N`, `spin ${fmt(x.spin, 1)} m/s`] },
    { title: 'CAR', lines: [`${fmt(x.mph)} mph`, `${fmt(x.a / x.g, 2)} g`, `air ${fmt(x.drag)} N`] },
    x.pawl
      ? { joint: true, title: 'PARK', state: x.brakeState, lines: ['the pawl locks the wheels', `${fmt(x.brakeForce)} N`] }
      : { joint: true, title: 'BRAKES', state: x.brakeState, lines: [`up to ${fmt(x.brakeCap)} N`, `${fmt(x.brakeForce)} N`] },
  ];
}

// The sums, with this step's numbers in them.
export function equations(x) {
  const lines = [];
  const add = (name, formula, worked, note = '') => lines.push({ name, formula, worked, note });
  add('throttle', 'air in each cylinder = r / (1 + r^8)^(1/8), r = throttle flow / engine demand',
    `pedal ${pct(x.pedal)}${x.tractionControl ? ' (traction control may trim it)' : ''} -> throttle ${pct(x.throttle)} -> manifold filling toward ${pct(x.target)}, now ${pct(x.load)}`);
  add('torque', 'T = load x combustion(rpm) - friction(rpm) - pumping x (1 - load)',
    `${x.combustion ? `${fmt(x.load, 2)} x ${fmt(x.combustionTable)}` : '0 (no fuel)'} - ${fmt(x.friction)} - ${fmt(x.pumpingNm)} x ${fmt(1 - x.load, 2)}${x.starter ? ` + starter ${fmt(x.starter)}` : ''} = ${fmt(x.torque)} Nm`,
    x.cut ? 'limiter: fuel cut' : x.running ? '' : 'not firing');
  add('power', 'P = T x rpm / 9549', `${fmt(x.torque)} x ${fmt(x.rpm)} / 9549 = ${fmt(x.kw)} kW`);
  if (x.converter) {
    add('converter', 'pump = (rpm / K(slip))^2, turbine = TR(slip) x pump',
      `takes ${fmt(x.converter.pump)} Nm from the engine, gives ${fmt(x.converter.turbine)} Nm${x.lockup ? '; lock-up clutch closed' : ''}`);
  } else {
    add('clutch', 'grips while the torque it must carry <= what the pedal lets it hold',
      x.clutchState === 'gripping' ? `needs ${fmt(Math.abs(x.clutchCarries))} Nm <= ${fmt(x.clutchCap)} Nm -> gripping`
        : x.clutchState === 'slipping' ? `would need more than ${fmt(x.clutchCap)} Nm, so it slips, carrying all it can: ${fmt(Math.abs(x.clutchCarries))} Nm`
          : 'pedal down or no gear: carries nothing',
      x.clutchState === 'slipping' ? `${fmt(Math.abs(x.clutchSlipRpm))} rpm across it, ${fmt(Math.abs(x.clutchCarries * x.clutchSlipRpm / RPM_PER_RAD_S) / 1000, 1)} kW turning to heat` : '');
  }
  add('gearbox', 'wheel torque = clutch torque x gear ratio x final drive',
    x.ratio ? `${fmt(x.wheelTorque / Math.abs(x.G))} x ${fmt(x.ratio, 3)} x ${fmt(x.finalDrive, 2)} = ${fmt(x.wheelTorque)} Nm` : 'not in a forward gear');
  add('weight', 'rear share = static share + a x CG height / (g x wheelbase)',
    `${fmt(x.rearWeightFraction, 2)} + ${fmt(x.a, 2)} x ${fmt(x.cgHeight, 2)} / (${fmt(x.g, 2)} x ${fmt(x.wheelbase, 1)}) = ${fmt(x.rearShare, 3)} -> ${fmt(x.rearLoad)} N on the rear tyres`);
  add('tyres', 'grip = mu x rear load; mu falls from 1.15 to 0.90 as the tyres spin',
    x.tyreState === 'spinning'
      ? `${fmt(x.spinGrip, 2)} x ${fmt(x.rearLoad)} = ${fmt(x.tyreLimit)} N - spinning, so the tyres push all they can: ${fmt(x.tyreForce)} N`
      : `needs ${fmt(Math.abs(x.tyreForce))} N <= ${fmt(x.muStatic, 2)} x ${fmt(x.rearLoad)} = ${fmt(x.tyreLimit)} N -> gripping`,
    x.tyreState === 'spinning' ? `wheels ${fmt(x.spin, 1)} m/s faster than the car` : '');
  add('air', 'drag = 1/2 x air density x CdA x v^2', `0.5 x ${fmt(x.airDensity, 1)} x ${fmt(x.cdA, 2)} x ${fmt(x.v, 1)}^2 = ${fmt(x.drag)} N`);
  add('rolling', 'rolling = crr x weight', `${fmt(x.crr, 3)} x ${fmt(x.weight)} = ${fmt(Math.abs(x.rolling))} N`);
  add('car', 'a = (tyres - air - rolling - brakes) / mass',
    `(${fmt(x.tyreForce)} - ${fmt(x.drag)} - ${fmt(x.rolling)} - ${fmt(x.brakeForce)}) / ${fmt(x.mass)} = ${fmt(x.a, 2)} m/s^2 (${fmt(x.a / x.g, 2)} g)`);
  return lines;
}

export class MathsPanel {
  constructor(host) {
    this.host = host;
    this.chainEl = el('div', 'mx-chain');
    this.listEl = el('div', 'mx-list');
    this.footEl = el('p', 'mx-foot');
    host.replaceChildren(
      el('div', 'card-title', 'under the hood - the last millisecond the car was solved for'),
      this.chainEl, this.listEl, this.footEl);
  }

  get open() {
    return !this.host.hidden;
  }

  toggle() {
    this.host.hidden = !this.host.hidden;
    return this.open;
  }

  update(x) {
    this.chainEl.replaceChildren(...chain(x).flatMap((node, i) => {
      const box = el('div', node.joint ? `mx-node mx-joint ${node.state}` : 'mx-node');
      box.append(el('b', '', node.title));
      if (node.joint) box.append(el('i', '', node.state));
      for (const line of node.lines) box.append(el('span', '', line));
      return i === 0 ? [box] : [el('span', 'mx-arrow', '>'), box];
    }));
    this.listEl.replaceChildren(...equations(x).map((q) => {
      const row = el('div', 'mx-row');
      row.append(el('b', '', q.name), el('span', 'mx-formula', q.formula), el('span', 'mx-worked', q.worked));
      if (q.note) row.append(el('span', 'mx-note', q.note));
      return row;
    }));
    this.footEl.textContent = `Step ${fmt(x.step)}: the car is solved 1000 times a second. The clutch, the tyres `
      + 'and the brakes are three friction joints solved together each step - each grips until the force it would '
      + 'have to carry is more than it can hold, then slips. The numbers here are that step run again.';
  }
}
