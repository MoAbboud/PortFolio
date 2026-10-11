// How a pedal moves, whatever is pressing it.
//
// A pedal is a position from 0 to 1. A keyboard key is on or off, so a held key ramps the
// pedal toward the floor and a released one lets it back up, at rates that make a key usable
// for feathering: a tap is a little throttle, a hold is all of it. A mouse or a finger drags
// the pedal to a position directly; a controller trigger reads one. Whichever is pressing
// hardest wins, as it would with two feet on one pedal.
//
// The simulation never sees these fractions: ui/main.js rounds them to whole numbers once, at
// the step boundary, with sim/inputs.js quantise().

// Per second, pressing and releasing. A held throttle reaches the floor in 0.4 s and comes
// back in 0.25 s; the brake goes on a little quicker. Holding Shift halves both, for a gentle
// foot.
export const RATES = {
  thr: { press: 2.5, release: 4 },
  brake: { press: 3, release: 5 },
  clutch: { press: 6, release: 1.2 },
};

export function createPedal(name) {
  return { name, key: 0, held: false, pointer: null, pad: 0 };
}

// Moves the keyboard part of the pedal for dt seconds. `gentle` halves the rates.
export function rampPedal(pedal, dt, gentle = false) {
  const rate = RATES[pedal.name];
  const scale = gentle ? 0.5 : 1;
  if (pedal.held) pedal.key = Math.min(1, pedal.key + rate.press * scale * dt);
  else pedal.key = Math.max(0, pedal.key - rate.release * scale * dt);
  return pedal;
}

// Where the pedal is: the hardest of keyboard, pointer and controller.
export function pedalPosition(pedal) {
  return Math.max(pedal.key, pedal.pointer ?? 0, pedal.pad ?? 0);
}

// A pointer dragged down a pedal: how far down it is, as a share of the pedal's travel.
export function dragPosition(startY, nowY, travel) {
  const v = (nowY - startY) / travel;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
