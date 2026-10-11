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

// Per second, pressing and releasing. A held throttle reaches the floor in 0.4 s and is off in
// an eighth of a second - a foot lifts faster than it presses, and a slow lift with the clutch
// already down revs the engine up during a shift. The brake goes on a little quicker. Holding
// Shift halves the rates, for a gentle foot.
//
// The clutch comes up slowly from a standstill, so a keyboard can find the bite point and pull
// away, and quickly once the car is moving, as a driver does in a shift. Slow in a shift, the
// clutch is still slipping when the gas goes back on, and the engine flares far above the gear
// before the clutch drags it down.
export const RATES = {
  thr: { press: 2.5, release: 8 },
  brake: { press: 3, release: 5 },
  clutch: { press: 6, release: 1.2, releaseMoving: 5 },
};

export function createPedal(name) {
  return { name, key: 0, held: false, pointer: null, pad: 0 };
}

// Moves the keyboard part of the pedal for dt seconds. `gentle` halves the rates; `moving`
// says the car is rolling, which lets the clutch come up at shift speed.
export function rampPedal(pedal, dt, gentle = false, moving = false) {
  const rate = RATES[pedal.name];
  const scale = gentle ? 0.5 : 1;
  const release = moving && rate.releaseMoving ? rate.releaseMoving : rate.release;
  if (pedal.held) pedal.key = Math.min(1, pedal.key + rate.press * scale * dt);
  else pedal.key = Math.max(0, pedal.key - release * scale * dt);
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
