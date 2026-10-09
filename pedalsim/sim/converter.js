// The automatic's torque converter: two fans in oil, one turned by the engine (the pump), one
// turning the gearbox (the turbine).
//
// The standard capacity-factor model. With the speed ratio SR = turbine / pump:
//
//   pump torque     = (pump rpm / K(SR))^2       what the converter takes from the engine
//   turbine torque  = TR(SR) * pump torque       what it gives the gearbox
//
// K is the converter's "looseness" and TR its torque multiplication: about 2 with the car
// stopped, falling to 1 at the coupling point. That is why a car in Drive creeps at idle, and
// why flooring it with the brake held settles the engine at one rpm - the stall speed - where
// what the converter takes equals what the engine makes.
//
// When the wheels drive the engine (coasting), the turbine turns faster than the pump and
// the converter passes torque backwards, without multiplication and through the same
// looseness: an automatic's weak engine braking.

import { lookup } from './curves.js';

export function converterTorque(converter, pumpRpm, turbineRpm) {
  if (turbineRpm <= pumpRpm) {
    if (pumpRpm <= 0) return { pump: 0, turbine: 0 };
    const ratio = turbineRpm / pumpRpm;
    const t = pumpRpm / lookup(converter.K, ratio);
    const pump = t * t;
    return { pump, turbine: pump * lookup(converter.TR, ratio) };
  }
  const ratio = pumpRpm > 0 ? pumpRpm / turbineRpm : 0;
  const t = turbineRpm / lookup(converter.K, ratio);
  return { pump: -t * t, turbine: -t * t };
}
