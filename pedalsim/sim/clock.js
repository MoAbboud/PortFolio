// The simulation's clock. Its own module so that every part of sim/ can read it without
// importing the step that imports them.

// 1000 steps a second. The clutch and the tyres are friction couplings that either stick
// or slip, and with a light flywheel a longer step makes them chatter.
export const STEPS_PER_SECOND = 1000;
export const DT = 1 / STEPS_PER_SECOND;

// rad/s to rpm. A constant, not a function call: the determinism rules allow Math.PI.
export const RPM_PER_RAD_S = 30 / Math.PI;
