// One gauge on the page: the pixelating face underneath, and a crisp layer on top that is
// there from the start - the empty circle, the needle, its hub - so a newcomer can always
// read it. The face is earned; the needle is not.

import { paintFace, paintRedline } from './face.js';
import { createReveal } from './reveal.js';
import { angleOf, START_ANGLE } from './layout.js';
import { createNeedle, chase } from './needle.js';
import { rgb } from './palette.js';

export class Gauge {
  constructor(host, kind, spring) {
    this.kind = kind;
    this.host = host;
    this.faceCanvas = document.createElement('canvas');
    this.top = document.createElement('canvas');
    for (const c of [this.faceCanvas, this.top]) host.appendChild(c);
    const { reveal, pixelated } = createReveal(this.faceCanvas);
    this.reveal = reveal;
    this.pixelated = pixelated;
    this.needle = createNeedle(spring, START_ANGLE);
    this.size = 0;
  }

  // Lay the gauge out for an engine: repaint the face for its scale and colours.
  setEngine(scale, colours, accent) {
    this.scale = scale;
    this.colours = colours;
    this.accent = accent;
    this.resize(true);
  }

  resize(force = false) {
    const css = this.host.clientWidth;
    const size = Math.max(64, Math.round(css * Math.min(window.devicePixelRatio || 1, 2)));
    if (!force && size === this.size) return;
    this.size = size;
    for (const c of [this.faceCanvas, this.top]) {
      c.width = size;
      c.height = size;
    }
    if (!this.scale) return;
    const face = paintFace(this.scale, this.colours, this.accent, size);
    const event = this.scale.redline ? paintRedline(this.scale, this.colours, size) : null;
    this.reveal.setFace(face, event, this.scale);
  }

  // value: what the needle should show. bins, mean, eventLevel: the development.
  draw({ value, dt, bins, mean, eventLevel = 0, time, marks = [], needle = true }) {
    if (!this.scale) return;
    this.reveal.draw(bins, mean, eventLevel, time);
    const angle = chase(this.needle, angleOf(this.scale, value), dt);

    const ctx = this.top.getContext('2d');
    const s = this.size;
    const c = s / 2;
    ctx.clearRect(0, 0, s, s);
    ctx.save();
    ctx.translate(c, c);

    // The empty circle: always there, the first thing on the page.
    ctx.strokeStyle = rgb(this.accent.core, 0.35);
    ctx.lineWidth = Math.max(1, s * 0.004);
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.485, 0, Math.PI * 2);
    ctx.stroke();

    // Shift marks the engine has passed, small and crisp, on the outside of the track.
    for (const rpm of marks) {
      const a = angleOf(this.scale, rpm);
      ctx.strokeStyle = rgb(this.colours.type, 0.9);
      ctx.lineWidth = s * 0.01;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * s * 0.462, Math.sin(a) * s * 0.462);
      ctx.lineTo(Math.cos(a) * s * 0.495, Math.sin(a) * s * 0.495);
      ctx.stroke();
    }

    // The needle: a glowing line from just behind the hub to the ticks.
    if (needle) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      ctx.strokeStyle = rgb(this.accent.core);
      ctx.shadowColor = rgb(this.accent.edge);
      ctx.shadowBlur = s * 0.03;
      ctx.lineWidth = s * 0.012;
      ctx.beginPath();
      ctx.moveTo(-Math.cos(angle) * s * 0.06, -Math.sin(angle) * s * 0.06);
      ctx.lineTo(Math.cos(angle) * s * 0.43, Math.sin(angle) * s * 0.43);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.fillStyle = rgb(this.accent.edge, 0.9);
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.03, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
