// The automatic's lever: P, R, N, D, and the rules a real one has.
//
// - Leaving Park needs the brake pressed: the shift interlock.
// - Park and Reverse cannot be chosen while the car is moving faster than walking pace: a
//   real lever is blocked, and the parking pawl would only ratchet.
//
// Pure, so the tests check it. Returns the gear the lever ends up in, and why, if it refused.

export const POSITIONS = ['P', 'R', 'N', 'D'];

const BRAKE_TO_LEAVE_PARK = 0.3; // share of brake pedal
const WALKING_PACE = 1.5; // m/s

export function moveLever(current, wanted, { brake, speed }) {
  if (!POSITIONS.includes(wanted)) return { gear: current, refused: 'no such position' };
  if (wanted === current) return { gear: current, refused: null };
  if (current === 'P' && brake < BRAKE_TO_LEAVE_PARK) {
    return { gear: current, refused: 'press the brake to leave Park' };
  }
  if ((wanted === 'P' || wanted === 'R') && Math.abs(speed) > WALKING_PACE) {
    return { gear: current, refused: `stop before ${wanted === 'P' ? 'Park' : 'Reverse'}` };
  }
  return { gear: wanted, refused: null };
}

// One notch up or down the gate, as a keyboard or a controller moves it.
export function notch(current, by) {
  const i = POSITIONS.indexOf(current);
  const j = Math.max(0, Math.min(POSITIONS.length - 1, i + by));
  return POSITIONS[j];
}
