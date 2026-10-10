// The engine lines, faint behind the gauges: each bank's power pulses and the two added
// together, against crank angle through one full cycle. The pen's lines danced to a song's
// bass, middle and treble; these dance to the cylinders.
//
// Height follows the load. The pattern drifts along as the crank turns, slowed so the eye can
// follow it. Engine off, the lines lie flat. A gear change or a limiter cut gives them the
// pen's kick: a bounce that dies away.

import { pulses } from './ripple.js';
import { rgb } from './palette.js';

const DRIFT = 1 / 60; // drawn crank angle per real crank angle
const KICK_DECAY = 6; // per second

export class EngineLines {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.phase = 0;
    this.height = 0;
    this.kick = 0;
  }

  setEngine(engine, colours) {
    this.waves = pulses(engine.cylinders, 360);
    this.colours = colours;
  }

  bump() {
    this.kick = 1;
  }

  draw({ rpm, load, running, dt }) {
    const { canvas, ctx, waves, colours } = this;
    if (!waves) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    this.phase = (this.phase + (rpm / 60) * 360 * DRIFT * dt) % 720;
    const target = running ? 0.25 + 0.75 * load : 0;
    this.height += (target - this.height) * Math.min(1, dt * 4);
    this.kick = Math.max(0, this.kick - KICK_DECAY * dt);

    const mid = h * 0.5;
    const amp = h * 0.11 * this.height;
    const bounce = Math.sin(performance.now() / 40) * this.kick * h * 0.02;
    const offset = Math.floor((this.phase / 720) * waves.sum.length);
    const lines = [
      [waves.a, colours.needle, 0.55],
      [waves.b, colours.bankB, 0.55],
      [waves.sum, colours.speed, 0.85],
    ];
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = Math.max(1, h * 0.003);
    for (const [wave, colour, alpha] of lines) {
      ctx.strokeStyle = rgb(colour.core, alpha * 0.5);
      ctx.shadowColor = rgb(colour.edge, alpha);
      ctx.shadowBlur = h * 0.012;
      ctx.beginPath();
      // Each line is centred on its own average: the total averages 1, each bank a half.
      const centre = wave === waves.sum ? 1 : 0.5;
      for (let x = 0; x <= w; x += 3) {
        const i = (offset + Math.floor((x / w) * wave.length)) % wave.length;
        const y = mid + bounce - (wave[i] - centre) * amp;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = 'source-over';
  }
}
