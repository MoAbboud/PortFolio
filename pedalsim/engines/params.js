// The engines, as measurements. These are the only engine numbers anyone types.
//
// tools/build-engines.js turns each entry into the tables the simulation reads
// (engines/v4.js ... v12.js). Change a number here, run the build, and every curve, the
// redline, the starter, the idle - all of it - follows. Never edit the generated files.
//
// The dimensions are those of real naturally aspirated engines, and each engine's
// `targets` are that engine's published figures. test/engines.test.js fails if what the
// maths produces falls outside them. The engines are types, not brands: the page never
// names a maker. The references are here so the numbers can be checked.
//
// Units: metres, pascals, kg m^2, rpm. Pressures are mean effective pressures (MEP): a
// torque per unit of displacement, which is how an engine's breathing is compared across
// sizes.

// Shared by every engine, because they are physics or plumbing rather than design.
export const SHARED = {
  // Mechanical friction, as a function of mean piston speed Sp (m/s), in the simplified
  // Chen-Flynn form FMEP = A + C * Sp + D * Sp^2. The coefficients are mid-range textbook
  // values for a modern petrol engine, tuned so the targets below are met.
  frictionA: 0.5e5,
  frictionC: 0.03e5,
  frictionD: 0.002e5,
  // Pumping loss with the throttle shut: the pistons pulling against a near-vacuum. Falls to
  // zero as the throttle opens. This is most of what engine braking is.
  pumpingClosed: 0.9e5,
  // The throttle plate: air passes through a gap that grows as 1 - cos(angle), plus a small
  // leak when shut. throttleFlow is how much air a wide-open plate passes, relative to what
  // the engine swallows at its redline.
  throttleLeak: 0.004,
  throttleFlow: 1.5,
  // Intake manifold volume over displacement. The manifold has to fill before torque arrives,
  // which takes about this many engine cycles - why a blip is not instant.
  manifoldRatio: 1.0,
  // Starter motor torque as a multiple of the engine's own friction when barely turning, and
  // the crank speed past which the starter freewheels.
  starterFactor: 3,
  starterFreeRpm: 400,
  // The crank speed at which the engine first fires on the key.
  fireRpm: 200,
  // Per cylinder: piston, rod and crank throw, as an equivalent spinning inertia.
  inertiaPerCylinder: 0.008,
};

// The cycle order on the page.
export const ENGINES = [
  {
    id: 'v4',
    label: 'V4',
    cylinders: 4,
    bankAngle: 90,
    // A 2.0 litre four with a square bore and stroke, built to rev.
    bore: 0.086,
    stroke: 0.086,
    pistonSpeedMax: 23.3,
    imepPeak: 14.1e5,
    // Where indicated pressure peaks, as a fraction of the redline, and how far it has
    // fallen at one tenth of the redline and at the redline. This is the breathing: cams,
    // ports and intake length.
    shape: { peakAt: 0.91, atIdle: 0.62, atRedline: 0.95 },
    flywheel: 0.112,
    mass: 140,
    idleRpm: 800,
    // Reference: Honda K20A (Type R), 86 x 86 mm, 158-162 kW at 8000 rpm, 202-206 Nm at 7000,
    // redline over 8000; Honda K20C2, 86 x 86 mm, 118 kW. No car uses a V4 of this size, so
    // the V4 is held to what a 2.0 litre four of this build makes.
    targets: {
      peakTorque: [185, 210], peakTorqueRpm: [5500, 7300],
      peakPower: [118, 165], peakPowerRpm: [7400, 8300],
      redline: [7800, 8400],
    },
  },
  {
    id: 'v6',
    label: 'V6',
    cylinders: 6,
    bankAngle: 60,
    bore: 0.094,
    stroke: 0.083,
    pistonSpeedMax: 18.6,
    imepPeak: 14.7e5,
    shape: { peakAt: 0.80, atIdle: 0.74, atRedline: 0.89 },
    flywheel: 0.267,
    mass: 165,
    idleRpm: 700,
    // Reference: Toyota 2GR-FKS, 94 x 83 mm, 207-232 kW at 6000-6400 rpm, 359-380 Nm at
    // 4600-4800 rpm. No published redline was found, so none is tested.
    targets: {
      peakTorque: [355, 385], peakTorqueRpm: [4300, 5100],
      peakPower: [205, 235], peakPowerRpm: [5900, 6600],
    },
  },
  {
    id: 'v8',
    label: 'V8',
    cylinders: 8,
    bankAngle: 90,
    bore: 0.094,
    stroke: 0.0895,
    pistonSpeedMax: 21.5,
    imepPeak: 14.6e5,
    shape: { peakAt: 0.85, atIdle: 0.74, atRedline: 0.91 },
    flywheel: 0.319,
    mass: 200,
    idleRpm: 650,
    // Reference: Lexus 2UR-GSE, 94 x 89.5 mm, 311-351 kW at 6600-7100 rpm, 505-530 Nm at
    // 4800-5600 rpm, redline 6800-7300 rpm.
    targets: {
      peakTorque: [500, 535], peakTorqueRpm: [4600, 5800],
      peakPower: [310, 355], peakPowerRpm: [6400, 7200],
      redline: [6800, 7300],
    },
  },
  {
    id: 'v10',
    label: 'V10',
    cylinders: 10,
    bankAngle: 90,
    // Long stroke, yet the highest piston speed here: a race-derived engine built to take it.
    bore: 0.0845,
    stroke: 0.0928,
    pistonSpeedMax: 25.6,
    imepPeak: 16.0e5,
    shape: { peakAt: 0.95, atIdle: 0.66, atRedline: 0.83 },
    flywheel: 0.228,
    mass: 230,
    idleRpm: 900,
    // Reference: Lamborghini 5.2 V10 (Huracan), 84.5 x 92.8 mm, 449-470 kW at 8000 rpm,
    // 560-600 Nm at 6500 rpm, redline 8250 rpm.
    targets: {
      peakTorque: [555, 605], peakTorqueRpm: [6000, 7000],
      peakPower: [445, 475], peakPowerRpm: [7600, 8300],
      redline: [8200, 8700],
    },
  },
  {
    id: 'v12',
    label: 'V12',
    cylinders: 12,
    bankAngle: 65,
    bore: 0.094,
    stroke: 0.078,
    pistonSpeedMax: 23.1,
    imepPeak: 15.2e5,
    shape: { peakAt: 0.82, atIdle: 0.70, atRedline: 0.91 },
    flywheel: 0.33,
    mass: 270,
    idleRpm: 1000,
    // Reference: Ferrari F140GA (812 Superfast), 94 x 78 mm, 588 kW at 8500 rpm, 718 Nm at
    // 7000 rpm, 8900 rpm maximum; Lamborghini L539 (Aventador), 95 x 76.4 mm, 515 kW at 8250
    // rpm, 690 Nm at 5500 rpm.
    targets: {
      peakTorque: [685, 720], peakTorqueRpm: [5500, 7200],
      peakPower: [510, 590], peakPowerRpm: [8000, 8700],
      redline: [8700, 9000],
    },
  },
];
