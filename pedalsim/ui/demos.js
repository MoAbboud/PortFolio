// Scripted drives for the page to play until it can be driven live (stage 4): the same shape
// as a run log - which gearbox, how many steps, and the input changes - built here in code so
// that nothing outside the page has to be published with it.

const S = 1000; // steps a second

// Whole steps, in order: times like 2.3 * S can land a hair off a whole number, and a run log
// refuses those.
function script(name, gearbox, steps, events) {
  const tidy = events.map(([t, channel, value]) => [Math.round(t), channel, value]);
  tidy.sort((a, b) => a[0] - b[0]);
  return { name, gearbox, steps: Math.round(steps), events: tidy };
}

function clutchOut(events, from, over, steps = 10) {
  for (let i = 1; i <= steps; i++) {
    events.push([from + Math.round((over * i) / steps), 'clutch', Math.round(1023 * (1 - i / steps))]);
  }
}

// Start it, then rev it in neutral: three short blips and four pulls to the limiter. Builds
// the tachometer and draws the dyno curve without the car moving.
export function revIt() {
  const e = [[0, 'key', 1], [0.8 * S, 'key', 0]];
  let t = 2.5 * S;
  for (const pedal of [0.12, 0.2, 0.3]) {
    e.push([t, 'thr', Math.round(pedal * 1023)], [t + 0.6 * S, 'thr', 0]);
    t += 2 * S;
  }
  for (let i = 0; i < 4; i++) {
    e.push([t, 'thr', 1023], [t + 1.4 * S, 'thr', 0]);
    t += 3.5 * S;
  }
  return script('Rev it', 'manual', t + 2 * S, e);
}

// Pull away in first, flat out through four gears, lift, brake to a stop with the clutch down.
export function driveManual() {
  const e = [[0, 'key', 1], [0.8 * S, 'key', 0], [2 * S, 'clutch', 1023], [2.3 * S, 'gear', 1],
    [2.4 * S, 'thr', 220]];
  clutchOut(e, 2.4 * S, 1.4 * S, 20);
  e.push([4.3 * S, 'thr', 1023]);
  let t = 8.5 * S;
  for (const gear of [2, 3, 4]) {
    e.push([t, 'clutch', 1023], [t, 'thr', 0], [t + 0.15 * S, 'gear', gear]);
    clutchOut(e, t + 0.15 * S, 0.25 * S, 5);
    e.push([t + 0.45 * S, 'thr', 1023]);
    t += gear === 4 ? 4 * S : 3 * S;
  }
  e.push([t, 'thr', 0], [t + 0.6 * S, 'clutch', 1023], [t + 0.6 * S, 'brake', 750],
    [t + 0.7 * S, 'gear', 0], [t + 13 * S, 'brake', 0]);
  // Thirteen seconds of braking: the V12 is doing about 150 mph by the end of fourth.
  return script('Drive the manual', 'manual', t + 15 * S, e);
}

// Park, Drive on the brake, creep, flat out through the gears, cruise, kick down, brake to a stop.
export function driveAuto() {
  const e = [[0, 'key', 1], [0, 'gear', 'P'], [0.8 * S, 'key', 0], [2 * S, 'brake', 800],
    [2.2 * S, 'gear', 'D'], [3 * S, 'brake', 0], [6 * S, 'thr', 1023], [16 * S, 'thr', 250],
    [22 * S, 'thr', 1023], [24 * S, 'thr', 0], [26 * S, 'brake', 650], [36 * S, 'gear', 'P'],
    [36 * S, 'brake', 0]];
  return script('Drive the automatic', 'auto', 39 * S, e);
}

export const DEMOS = [revIt, driveManual, driveAuto];
