// The engine's voice, made sample by sample on the browser's audio thread.
//
// It plays the engine's one-cycle table (ui/sound-table.js) at the speed the crank is turning,
// so its pitch is the real firing frequency. The page sets the parameters once a frame and
// they glide between frames, so the note follows the tachometer without stepping.
//
//   rpm       crank speed: how fast the table is played
//   load      how full the cylinders are: louder, and brighter through the filter
//   firing    1 while fuel burns, 0 when stalled or the limiter cuts - the stutter is real
//   starter   1 while the starter motor turns: its whine, and the slow compression thumps
//   grind     1 while a gear refuses to go in: a rough, beating scrape
//   volume    the master level, 0 to mute
//
// Nothing here affects the simulation; the simulation never hears it.

const TABLE_SIZE = 2048;

class EngineVoice extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 0, minValue: 0, maxValue: 20000, automationRate: 'k-rate' },
      { name: 'load', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'firing', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'starter', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'grind', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'volume', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.table = new Float32Array(TABLE_SIZE);
    this.phase = 0; // through the engine cycle, 0 to 1
    this.amp = 0; // the voice's level, eased toward its target so nothing clicks
    this.low = 0; // one-pole low-pass state
    this.noiseLow = 0;
    this.starterPhase = 0;
    this.grindPhase = 0;
    this.grindLow = 0;
    this.seed = 22222;
    this.port.onmessage = (e) => {
      if (e.data.table) this.table = e.data.table;
    };
  }

  noise() {
    // A small fast generator: white noise is all this needs.
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 2147483648 - 1;
  }

  process(inputs, outputs, params) {
    const out = outputs[0][0];
    if (!out) return true;
    const rate = sampleRate;
    const rpm = params.rpm[0];
    const load = params.load[0];
    const firing = params.firing[0];
    const starter = params.starter[0];
    const grind = params.grind[0];
    const volume = params.volume[0];

    // Burning fuel is loud and grows with load; a turning engine with no fuel - the overrun,
    // or the limiter's cut - is a soft whoosh of pumping.
    const target = rpm < 30 ? 0 : firing > 0.5 ? 0.25 + 0.75 * load : 0.06;
    // Brighter with load and revs: the filter opens.
    const cutoff = Math.min(0.45, (200 + rpm * 0.35 + load * 2500) / rate);
    const a = 1 - Math.exp(-2 * Math.PI * cutoff);
    const step = rpm / 120 / rate; // engine cycles per sample
    const starterStep = 180 / rate; // the starter motor's whine
    const intake = load * Math.min(1, rpm / 6000) * 0.12;

    for (let i = 0; i < out.length; i++) {
      this.amp += (target - this.amp) * 0.002;

      this.phase += step;
      if (this.phase >= 1) this.phase -= 1;
      const x = this.phase * TABLE_SIZE;
      const j = x | 0;
      const f = x - j;
      const pulse = this.table[j] + (this.table[(j + 1) % TABLE_SIZE] - this.table[j]) * f;
      this.low += (pulse * this.amp - this.low) * a;

      // Intake and exhaust roar: filtered noise, rising with load and revs.
      this.noiseLow += (this.noise() - this.noiseLow) * 0.08;
      let s = this.low * 0.9 + this.noiseLow * intake;

      if (starter > 0.5) {
        this.starterPhase = (this.starterPhase + starterStep) % 1;
        const whine = this.starterPhase < 0.5 ? 0.12 : -0.12;
        s += whine + pulse * 0.25;
      }

      if (grind > 0.5) {
        // Teeth chattering against each other: harsh noise beating about 40 times a second.
        this.grindPhase = (this.grindPhase + 40 / rate) % 1;
        this.grindLow += (this.noise() - this.grindLow) * 0.35;
        s += this.grindLow * 0.6 * (0.5 + 0.5 * Math.sin(2 * Math.PI * this.grindPhase));
      }

      // A gentle soft clip, so peaks round off rather than crackle.
      out[i] = Math.tanh(s * 1.4) * volume;
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    return true;
  }
}

registerProcessor('engine-voice', EngineVoice);
