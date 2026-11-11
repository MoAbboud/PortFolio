// A run log, packed into as few bytes as it will go, for a share link.
//
// The log is the run's inputs and nothing else: which engine (and which build of it), which
// gearbox, traction control, the SIM_VERSION it was driven on, how many steps, and every input
// change. No time and no score - the page that opens a link re-drives the inputs and works
// both out for itself, so a link cannot be edited into a better time.
//
// Packed as unsigned variable-length integers (seven bits a byte, the high bit saying another
// byte follows), each event as the steps since the last one, a channel and a value. ui/share.js
// deflates the bytes and writes them into the link. In sim/ because a link has to unpack to
// exactly the log that was packed, on every machine.

export const FORMAT = 1;
const CHANNELS = ['thr', 'brake', 'clutch', 'gear', 'key'];
const LEVER = ['P', 'R', 'N', 'D'];
const BOXES = ['manual', 'auto'];
const MODES = ['zero-to-sixty', 'free'];
// A link carries the first eight hex digits of the engine's hash: enough to tell two builds
// of an engine apart.
const HASH_DIGITS = 8;

// A gear as a whole number from 0: reverse to sixth are 0 to 7, the lever's P R N D 8 to 11.
function gearCode(value) {
  if (typeof value === 'number') return value + 1;
  return 8 + LEVER.indexOf(value);
}

function gearValue(code) {
  return code >= 8 ? LEVER[code - 8] : code - 1;
}

function writer() {
  const bytes = [];
  return {
    bytes,
    uint(n) {
      if (!Number.isInteger(n) || n < 0) throw new Error(`cannot pack ${n}`);
      let rest = n;
      while (rest >= 128) {
        bytes.push((rest % 128) + 128);
        rest = Math.floor(rest / 128);
      }
      bytes.push(rest);
    },
  };
}

function reader(bytes) {
  let at = 0;
  return {
    uint() {
      let n = 0;
      let scale = 1;
      for (;;) {
        if (at >= bytes.length) throw new Error('the run ends too soon');
        const b = bytes[at++];
        n += (b % 128) * scale;
        if (b < 128) return n;
        scale *= 128;
        if (scale > 34359738368) throw new Error('a number in the run is too long'); // 128^5
      }
    },
    get done() {
      return at === bytes.length;
    },
  };
}

export function pack(log) {
  const w = writer();
  w.uint(FORMAT);
  w.uint(log.simVersion);
  w.uint(log.engine.length);
  for (let i = 0; i < log.engine.length; i++) w.uint(log.engine.charCodeAt(i));
  w.uint(parseInt(log.engineHash.slice(0, HASH_DIGITS), 16));
  w.uint(BOXES.indexOf(log.gearbox));
  w.uint(log.tractionControl ? 1 : 0);
  w.uint(MODES.indexOf(log.mode));
  w.uint(log.steps);
  w.uint(log.events.length);
  let last = 0;
  for (const [at, channel, value] of log.events) {
    w.uint(at - last);
    last = at;
    const c = CHANNELS.indexOf(channel);
    w.uint(c);
    w.uint(channel === 'gear' ? gearCode(value) : value);
  }
  return Uint8Array.from(w.bytes);
}

// The log back. engineHash comes back as its first eight digits; compare with hashMatches().
export function unpack(bytes) {
  const r = reader(bytes);
  const format = r.uint();
  if (format !== FORMAT) throw new Error(`a run of format ${format}, not ${FORMAT}`);
  const simVersion = r.uint();
  const idLength = r.uint();
  if (idLength > 16) throw new Error('not an engine');
  let engine = '';
  for (let i = 0; i < idLength; i++) engine += String.fromCharCode(r.uint());
  const engineHash = r.uint().toString(16).padStart(HASH_DIGITS, '0');
  const gearbox = BOXES[r.uint()];
  const tractionControl = r.uint() === 1;
  const mode = MODES[r.uint()];
  const steps = r.uint();
  const count = r.uint();
  if (!gearbox || !mode) throw new Error('not a run');
  const events = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    at += r.uint();
    const channel = CHANNELS[r.uint()];
    if (!channel) throw new Error('not an input');
    const raw = r.uint();
    events.push([at, channel, channel === 'gear' ? gearValue(raw) : raw]);
  }
  if (!r.done) throw new Error('the run has bytes left over');
  return { format, simVersion, engine, engineHash, gearbox, tractionControl, mode, steps, events };
}

export function hashMatches(short, full) {
  return typeof short === 'string' && typeof full === 'string' && full.slice(0, HASH_DIGITS) === short.slice(0, HASH_DIGITS);
}
