// The gearbox: which ratio joins the engine to the wheels, and through what.
//
// A manual takes its gear from the stick and joins through the dry clutch, whose grip the
// clutch pedal sets. An automatic picks its own gear from speed and throttle and joins through
// the torque converter, with a lock-up clutch that closes in the higher gears.
//
// The ratio G is overall - gearbox times final drive - and negative in reverse, so that
// engine speed = G * wheel speed holds in every gear.

import { clamp } from './curves.js';
import { PEDAL_MAX } from './inputs.js';
import { RPM_PER_RAD_S, STEPS_PER_SECOND } from './clock.js';

// Clutch pedal travel, as a fraction pressed: grip starts as the pedal comes up past the bite
// point and is full well before the pedal is all the way up.
const BITE_TOP = 0.6;
const BITE_FULL = 0.1;

// An automatic waits this long after a shift before it will shift again.
const SHIFT_HOLD_STEPS = Math.round(0.5 * STEPS_PER_SECOND);

// A parking pawl locks the output. It is modelled as a brake far stronger than anything else
// in the chain, engaged only below walking pace.
const PAWL_FORCE = 1e7;
const PAWL_MAX_SPEED = 1.0; // m/s

export function overallRatio(gearing, gear) {
  if (gear > 0) return gearing.ratios[gear - 1] * gearing.finalDrive;
  if (gear < 0) return -gearing.reverse * gearing.finalDrive;
  return 0;
}

// How much torque the clutch can carry for a pedal position, 0 to the clutch's maximum.
export function clutchCapacity(gearing, clutchPedal) {
  const pressed = clutchPedal / PEDAL_MAX;
  const grip = clamp((BITE_TOP - pressed) / (BITE_TOP - BITE_FULL), 0, 1);
  return grip * grip * gearing.clutchMaxNm;
}

// The speed (m/s) on a shift line for a throttle from 0 to 1: a light foot shifts early, a
// heavy one late. up[g - 1] is where gear g goes up to g + 1; down[g - 1] is where gear g + 1
// comes back down to g. The down line sits well below the up line, so the box holds a gear
// across a band of speeds instead of hunting between two.
function shiftSpeed(line, gear, throttle) {
  const [light, full] = line[gear - 1];
  return light + (full - light) * throttle;
}

function automatic(engine, state, throttle) {
  const auto = engine.auto;
  let gear = state.autoGear;
  let hold = state.shiftHold > 0 ? state.shiftHold - 1 : 0;
  const v = state.v;
  const wheelRpm = (v / engine.gearing.wheelRadius) * RPM_PER_RAD_S;

  if (hold === 0) {
    let next = gear;
    if (throttle >= auto.kickdown) {
      // Kickdown: the lowest gear that keeps the engine under its shift point.
      for (let g = 1; g < gear; g++) {
        if (wheelRpm * overallRatio(engine.gearing, g) < engine.coach.upshiftRpm[g - 1] * 0.95) {
          next = g;
          break;
        }
      }
    }
    if (next === gear && gear < auto.up.length + 1 && v > shiftSpeed(auto.up, gear, throttle)) next = gear + 1;
    else if (next === gear && gear > 1 && v < shiftSpeed(auto.down, gear - 1, throttle)) next = gear - 1;
    if (next !== gear) {
      gear = next;
      hold = SHIFT_HOLD_STEPS;
    }
  }

  const G = overallRatio(engine.gearing, gear);
  const turbineRpm = wheelRpm * G;
  const lockup = gear >= auto.lockupFromGear && hold === 0 && throttle < auto.kickdown
    && turbineRpm > engine.idleRpm * 1.6;
  return { G, gear, autoGear: gear, shiftHold: hold, lockup };
}

// Everything the drivetrain needs to know about the gearbox this step.
export function gearbox(engine, state, inputs) {
  const throttle = inputs.thr / PEDAL_MAX;
  if (state.box === 'manual') {
    const gear = typeof inputs.gear === 'number' ? inputs.gear : 0;
    return {
      G: overallRatio(engine.gearing, gear),
      gear,
      clutchNm: clutchCapacity(engine.gearing, inputs.clutch),
      converter: false,
      pawlN: 0,
      autoGear: state.autoGear,
      shiftHold: 0,
    };
  }

  const selector = typeof inputs.gear === 'string' ? inputs.gear : 'D';
  if (selector === 'P' || selector === 'N') {
    return {
      G: 0,
      gear: 0,
      clutchNm: 0,
      converter: false,
      pawlN: selector === 'P' && Math.abs(state.v) < PAWL_MAX_SPEED ? PAWL_FORCE : 0,
      autoGear: 1,
      shiftHold: 0,
    };
  }
  if (selector === 'R') {
    return {
      G: overallRatio(engine.gearing, -1),
      gear: -1,
      clutchNm: 0,
      converter: true,
      pawlN: 0,
      autoGear: 1,
      shiftHold: 0,
    };
  }
  const d = automatic(engine, state, throttle);
  return {
    G: d.G,
    gear: d.gear,
    clutchNm: d.lockup ? engine.gearing.clutchMaxNm : 0,
    converter: true,
    pawlN: 0,
    autoGear: d.autoGear,
    shiftHold: d.shiftHold,
  };
}
