// The one car every engine is put in, so that the engine is the only thing that changes.
//
// A rear-drive two-door of about the size and shape of a sports coupe. The numbers are
// typical for the class rather than any one car's. Plain constants: the step reads them, and
// tools/build-engines.js reads them to work out each engine's gearing.

export const CHASSIS = {
  massWithoutEngine: 1250, // kg, with a driver; each engine adds its own mass
  wheelRadius: 0.33, // m, rolling radius of a 19 inch performance tyre
  cdA: 0.70, // m^2, drag coefficient 0.34 times about 2.06 m^2 of frontal area
  crr: 0.012, // rolling resistance coefficient
  airDensity: 1.2, // kg/m^3
  g: 9.81,
  wheelbase: 2.6, // m
  cgHeight: 0.5, // m, centre of mass above the road
  rearWeightFraction: 0.52, // at rest; acceleration moves weight back onto the driven wheels
  muStatic: 1.15, // tyre grip while gripping
  muKinetic: 0.9, // tyre grip while spinning: why wheelspin is slower than grip
  wheelInertia: 2.4, // kg m^2, both rear wheels, tyres, axles and differential
  // Brakes on all four wheels, with a simple ABS: the most they can do is what the tyres can
  // hold, about one g, so the wheels never lock.
  brakeDecelMax: 1.0, // in g
};
