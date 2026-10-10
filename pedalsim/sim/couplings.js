// Bodies in a line, joined by friction that either sticks or slips.
//
// The car is a chain: engine - clutch - rear wheels - tyres - car body - brakes - road. Each
// joint is friction. While it sticks, the two sides move together and the joint carries
// whatever force that takes; once that force would exceed what the friction can hold, it
// slips and carries only its sliding force. A dropped clutch, a stall, wheelspin, engine
// braking and a car held on the brakes are all this one rule, applied to three joints.
//
// Each joint j sits between body j and body j + 1 and relates their speeds by a ratio k:
// sticking means vel[j] = k * vel[j + 1]. For the clutch k is the gear ratio (engine turns G
// times the wheels); for the tyres 1 / radius (wheel turns v / r); for the brakes 1 (the car
// moves with the road, which is still). The joint's force lambda pushes body j back by lambda
// and body j + 1 forward by k * lambda - which is what a gear, a tyre or a brake does.
//
// The last body may be the road: inertia Infinity, speed 0.

// Below this, a slip speed counts as no slip at all.
const STILL = 1e-9;

const sign = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);

function slip(vel, joints, j) {
  return vel[j] - joints[j].k * vel[j + 1];
}

// Runs of bodies joined by sticking joints: each run moves as one.
function clusters(n, stuck) {
  const out = [];
  let from = 0;
  for (let i = 0; i < n; i++) {
    if (i === n - 1 || !stuck[i]) {
      out.push([from, i]);
      from = i + 1;
    }
  }
  return out;
}

// Each body's speed as a multiple of the run's last body: K[last] = 1, K[i] = k[i] * K[i + 1].
function multiples(joints, from, to) {
  const K = [];
  K[to] = 1;
  for (let i = to - 1; i >= from; i--) K[i] = joints[i].k * K[i + 1];
  return K;
}

// Accelerations and joint forces for one step, given which joints stick. Returns the joint
// that would have to slip, if any.
function solve(bodies, joints, stuck, dir) {
  const n = bodies.length;
  const force = bodies.map((b) => b.force);
  const lambda = new Array(n - 1).fill(0);
  for (let j = 0; j < n - 1; j++) {
    if (stuck[j]) continue;
    lambda[j] = joints[j].kinetic * dir[j];
    force[j] -= lambda[j];
    force[j + 1] += joints[j].k * lambda[j];
  }

  const acc = new Array(n).fill(0);
  let worst = -1;
  let worstRatio = 1;
  for (const [from, to] of clusters(n, stuck)) {
    const K = multiples(joints, from, to);
    const grounded = bodies[to].inertia === Infinity;
    let mass = 0;
    let push = 0;
    for (let i = from; i <= to; i++) {
      if (bodies[i].inertia === Infinity) continue;
      mass += bodies[i].inertia * K[i] * K[i];
      push += K[i] * force[i];
    }
    const u = grounded || mass === 0 ? 0 : push / mass;
    for (let i = from; i <= to; i++) acc[i] = K[i] * u;

    // Walk the run from its first body, working out what each sticking joint must carry.
    for (let j = from; j < to; j++) {
      const before = j > from ? joints[j - 1].k * lambda[j - 1] : 0;
      lambda[j] = force[j] + before - bodies[j].inertia * acc[j];
      const ratio = Math.abs(lambda[j]) / joints[j].static;
      if (ratio > worstRatio) {
        worstRatio = ratio;
        worst = j;
      }
    }
  }
  return { acc, lambda, worst };
}

// Advances the chain by dt. bodies: [{ inertia, vel, force }]; joints: [{ k, static,
// kinetic, stuck }]. Returns the new speeds, which joints now stick, and each joint's force.
export function advance(bodies, joints, dt) {
  const n = bodies.length;
  const vel = bodies.map((b) => b.vel);
  const stuck = joints.map((jt, j) => jt.static > 0 && (jt.stuck || Math.abs(slip(vel, joints, j)) < STILL));
  const dir = joints.map((_, j) => sign(slip(vel, joints, j)));

  // A sticking joint asked for more than it can hold lets go, in the direction it was being
  // pulled. Each pass frees at most one, the most overloaded; a chain of three needs few.
  let result = solve(bodies, joints, stuck, dir);
  for (let pass = 0; result.worst >= 0 && pass < joints.length; pass++) {
    const j = result.worst;
    stuck[j] = false;
    dir[j] = sign(result.lambda[j]);
    result = solve(bodies, joints, stuck, dir);
  }

  const next = vel.map((v, i) => (bodies[i].inertia === Infinity ? 0 : v + result.acc[i] * dt));
  const before = joints.map((_, j) => slip(vel, joints, j));

  // A slipping joint whose two sides passed each other during the step locks, rather than
  // letting the speeds chatter back and forth across each other for ever - the classic bug in
  // clutch models. The sides are joined at the speed that keeps their momentum.
  for (let j = 0; j < n - 1; j++) {
    if (stuck[j] || joints[j].static <= 0) continue;
    const after = slip(next, joints, j);
    if (before[j] === 0 || sign(after) === sign(before[j])) continue;
    stuck[j] = true;
    for (const [from, to] of clusters(n, stuck)) {
      if (j < from || j >= to) continue;
      const K = multiples(joints, from, to);
      let mass = 0;
      let momentum = 0;
      let grounded = false;
      for (let i = from; i <= to; i++) {
        if (bodies[i].inertia === Infinity) grounded = true;
        else {
          mass += bodies[i].inertia * K[i] * K[i];
          momentum += bodies[i].inertia * K[i] * next[i];
        }
      }
      const u = grounded || mass === 0 ? 0 : momentum / mass;
      for (let i = from; i <= to; i++) next[i] = bodies[i].inertia === Infinity ? 0 : K[i] * u;
    }
  }

  // Bodies that stick together stay exactly together, not merely nearly.
  for (const [from, to] of clusters(n, stuck)) {
    if (from === to) continue;
    const K = multiples(joints, from, to);
    const u = bodies[to].inertia === Infinity ? 0 : next[to];
    for (let i = from; i < to; i++) next[i] = K[i] * u;
  }

  return { vel: next, stuck, lambda: result.lambda, acc: result.acc };
}
