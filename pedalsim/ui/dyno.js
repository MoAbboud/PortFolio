// The dyno strip: torque and power against rpm - but only as the engine has measured them.
// Each 100 rpm shows the most torque the engine has actually made there flat out, so a
// full-throttle pull in neutral draws the curve left to right, like a run on a dynamometer.
// A dot marks where the engine is now.

import { rgb } from './palette.js';

export class Dyno {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  setEngine(scale, colours, peakTorque, peakKw) {
    this.scale = scale;
    this.colours = colours;
    this.torqueTop = peakTorque * 1.15;
    this.kwTop = peakKw * 1.15;
  }

  draw({ dyno, rpm, torque }) {
    const { canvas, ctx, scale, colours } = this;
    if (!scale) return;
    const w = canvas.width;
    const h = canvas.height;
    const pad = h * 0.08;
    const x = (r) => pad + (r / scale.max) * (w - 2 * pad);
    const yT = (t) => h - pad - (t / this.torqueTop) * (h - 2 * pad);
    const yP = (kw) => h - pad - (kw / this.kwTop) * (h - 2 * pad);
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = rgb(colours.type, 0.12);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, h - pad);
    ctx.lineTo(w - pad, h - pad);
    ctx.stroke();

    ctx.globalCompositeOperation = 'lighter';
    const curve = (value, y, colour) => {
      ctx.strokeStyle = rgb(colour.core, 0.9);
      ctx.shadowColor = rgb(colour.edge);
      ctx.shadowBlur = h * 0.06;
      ctx.lineWidth = Math.max(1.5, h * 0.025);
      ctx.beginPath();
      let drawing = false;
      for (let i = 0; i < dyno.length; i++) {
        if (!(dyno[i] > 0)) {
          drawing = false;
          continue;
        }
        const r = i * scale.binSize;
        const px = x(r);
        const py = y(value(dyno[i], r));
        if (drawing) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
        drawing = true;
      }
      ctx.stroke();
    };
    curve((t) => t, yT, colours.needle);
    curve((t, r) => (t * r * Math.PI) / 30 / 1000, yP, colours.speed);
    ctx.shadowBlur = 0;

    if (rpm > 0) {
      ctx.fillStyle = rgb(colours.type);
      ctx.beginPath();
      ctx.arc(x(rpm), yT(Math.max(0, torque)), Math.max(2, h * 0.035), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}
