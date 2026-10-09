// Engine to road: the chain sim/couplings.js moves, assembled for one step.
//
//   engine --clutch--> rear wheels --tyres--> car body --brakes--> road
//
// The clutch's grip comes from the pedal (manual) or the lock-up clutch (automatic); an
// automatic's torque converter adds its own torques to the engine and the wheels on top. The
// tyres grip by the weight on the rear wheels, which grows as the car accelerates. The
// brakes and, in Park, the parking pawl hold the car to the road.

import { advance } from './couplings.js';
import { converterTorque } from './converter.js';
import { clamp } from './curves.js';
import { DT, RPM_PER_RAD_S } from './clock.js';
import { PEDAL_MAX } from './inputs.js';

// Rolling resistance fades in over the first few centimetres a second, as static friction
// does, so a stopped car is not pushed backwards by it.
const ROLL_FADE = 0.05; // m/s

// A free engine that is not running and has all but stopped is stopped.
const STOPPED_RPM = 5;

// A spinning tyre does not drop straight to its sliding grip: just past the limit it pulls
// nearly as hard as a gripping one, falling to sliding grip as the spin grows to this speed
// (wheel surface against road, m/s). Without this, a tyre that broke loose could only grip
// again by stopping its spin entirely, and a car that spun its wheels in first would spin
// them through every gear.
const SPIN_FADE = 4;

export function drivetrain(engine, chassis, state, inputs, control, box) {
  const { we, ww, v } = state;
  const r = chassis.wheelRadius;
  const mass = chassis.massWithoutEngine + engine.mass;
  const weight = mass * chassis.g;

  let engineTorque = control.torque;
  let wheelTorque = 0;
  if (box.converter) {
    const c = converterTorque(engine.auto.converter, we * RPM_PER_RAD_S, ww * box.G * RPM_PER_RAD_S);
    engineTorque -= c.pump;
    wheelTorque += box.G * c.turbine;
  }

  const drag = 0.5 * chassis.airDensity * chassis.cdA * v * (v < 0 ? -v : v);
  const rolling = chassis.crr * weight * clamp(v / ROLL_FADE, -1, 1);

  // Weight moves back as the car accelerates, by m * a * h / L. Last step's acceleration is
  // used: the change over one millisecond is nothing, and it avoids solving for it.
  const rearShare = clamp(
    chassis.rearWeightFraction + (state.a * chassis.cgHeight) / (chassis.g * chassis.wheelbase), 0.1, 1);
  const rearLoad = rearShare * weight;
  const spin = ww * r - v;
  const spinGrip = chassis.muKinetic
    + (chassis.muStatic - chassis.muKinetic) * clamp(1 - (spin < 0 ? -spin : spin) / SPIN_FADE, 0, 1);
  const brakeN = (inputs.brake / PEDAL_MAX) * chassis.brakeDecelMax * weight + box.pawlN;

  const bodies = [
    { inertia: engine.inertia, vel: we, force: engineTorque },
    { inertia: chassis.wheelInertia, vel: ww, force: wheelTorque },
    { inertia: mass, vel: v, force: -drag - rolling },
    { inertia: Infinity, vel: 0, force: 0 },
  ];
  // In neutral nothing joins the engine to the wheels, whatever the clutch pedal says.
  const clutchNm = box.G === 0 ? 0 : box.clutchNm;
  const joints = [
    // A gear change breaks the clutch's grip: the two sides are suddenly at different speeds.
    { k: box.G, static: clutchNm, kinetic: clutchNm, stuck: state.clutchStuck && box.G === state.G },
    { k: 1 / r, static: chassis.muStatic * rearLoad * r, kinetic: spinGrip * rearLoad * r, stuck: state.tyreStuck },
    { k: 1, static: brakeN, kinetic: brakeN, stuck: state.brakeStuck },
  ];

  const moved = advance(bodies, joints, DT);
  let [weNext, wwNext, vNext] = moved.vel;
  if (!moved.stuck[0] && !control.running && inputs.key !== 1
    && Math.abs(weNext * RPM_PER_RAD_S) < STOPPED_RPM) {
    weNext = 0;
  }

  return {
    we: weNext,
    ww: wwNext,
    v: vNext,
    a: moved.acc[2],
    G: box.G,
    clutchStuck: moved.stuck[0],
    tyreStuck: moved.stuck[1],
    brakeStuck: moved.stuck[2],
    clutchNm: moved.lambda[0],
  };
}
