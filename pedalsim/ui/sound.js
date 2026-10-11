// The engine sound, from the page's side: starts the audio worklet on the first key press or
// click (browsers allow no sound before one), gives it the engine's one-cycle table, and sets
// its parameters once a frame. The parameters glide over a few milliseconds, so a frame's
// worth of change is never a step the ear can hear.

import { engineTable } from './sound-table.js';

const GLIDE = 0.012; // seconds

export class EngineSound {
  constructor() {
    this.ctx = null;
    this.node = null;
    this.on = true;
    this.volume = 0.5;
    this.engine = null;
    this.failed = false;
  }

  // Call from inside a key press or click.
  async start() {
    if (this.ctx || this.failed) return;
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Context();
      await this.ctx.audioWorklet.addModule(new URL('./engine-worklet.js', import.meta.url));
      this.node = new AudioWorkletNode(this.ctx, 'engine-voice', { outputChannelCount: [2] });
      this.node.connect(this.ctx.destination);
      if (this.engine) this.setEngine(this.engine);
      this.applyVolume();
    } catch {
      // No Web Audio, or no worklets: the page works without sound.
      this.failed = true;
      this.ctx = null;
      this.node = null;
    }
  }

  setEngine(engine) {
    this.engine = engine;
    if (this.node) this.node.port.postMessage({ table: engineTable(engine).table });
  }

  toggle() {
    this.on = !this.on;
    this.applyVolume();
    return this.on;
  }

  applyVolume() {
    if (!this.node) return;
    this.node.parameters.get('volume').setTargetAtTime(this.on ? this.volume : 0, this.ctx.currentTime, 0.05);
  }

  // Pause the audio when the page is hidden, resume when it is back.
  visible(yes) {
    if (!this.ctx) return;
    if (yes) this.ctx.resume();
    else this.ctx.suspend();
  }

  // Once a frame, from the simulation's state.
  update({ rpm, load, firing, starter, grind }) {
    if (!this.node || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const p = this.node.parameters;
    p.get('rpm').setTargetAtTime(Math.max(0, rpm), t, GLIDE);
    p.get('load').setTargetAtTime(load, t, GLIDE);
    p.get('firing').setValueAtTime(firing ? 1 : 0, t);
    p.get('starter').setValueAtTime(starter ? 1 : 0, t);
    p.get('grind').setValueAtTime(grind ? 1 : 0, t);
  }
}
