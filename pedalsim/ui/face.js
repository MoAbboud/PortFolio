// Paints a finished gauge face, once per engine, onto a canvas. The reveal (ui/reveal.js)
// decides how much of it shows.
//
// Two layers: the face itself - ticks, numerals, unit - and the redline arc, which is kept
// apart because it only appears once the engine has reached it. Everything is placed from the
// layout's numbers. Lines glow the way the pen's do: a bright core colour with a soft halo in
// the edge colour, added onto the dark.

import { angleOf, START_ANGLE, SWEEP } from './layout.js';
import { rgb } from './palette.js';

export const NUMERAL_FONT = '"Boldonse", "Arial Black", sans-serif';
export const LABEL_FONT = 'italic "Bodoni Moda", Georgia, serif';

function glow(ctx, colours, size, strength = 1) {
  ctx.strokeStyle = rgb(colours.core);
  ctx.fillStyle = rgb(colours.core);
  ctx.shadowColor = rgb(colours.edge, 0.9);
  ctx.shadowBlur = size * 0.018 * strength;
}

function canvasOf(size) {
  const c = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(size, size) : document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

// scale: one of layout.tach or layout.speed. colours: palette roles. size: pixels square.
export function paintFace(scale, colours, accent, size) {
  const face = canvasOf(size);
  const ctx = face.getContext('2d');
  const c = size / 2;
  ctx.translate(c, c);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';

  // The track the needle runs along.
  ctx.save();
  glow(ctx, accent, size, 0.6);
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = size * 0.004;
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.455, START_ANGLE, START_ANGLE + SWEEP);
  ctx.stroke();
  ctx.restore();

  // Ticks: every minor step; the majors longer, heavier, numbered.
  const eps = scale.minor / 1000;
  for (let v = 0; v <= scale.max + eps; v += scale.minor) {
    const major = Math.abs(v / scale.step - Math.round(v / scale.step)) < 1e-6;
    const a = angleOf(scale, v);
    const outer = size * 0.44;
    const inner = outer - size * (major ? 0.075 : 0.035);
    ctx.save();
    glow(ctx, accent, size, major ? 1 : 0.5);
    ctx.lineWidth = size * (major ? 0.012 : 0.005);
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
    ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
    ctx.stroke();
    ctx.restore();

    if (major) {
      const r = size * 0.3;
      ctx.save();
      ctx.fillStyle = rgb(colours.type);
      ctx.shadowColor = rgb(accent.edge, 0.6);
      ctx.shadowBlur = size * 0.01;
      ctx.font = `${Math.round(size * 0.058)}px ${NUMERAL_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(scale.label(Math.round(v)), Math.cos(a) * r, Math.sin(a) * r);
      ctx.restore();
    }
  }

  // The unit, small and italic, below the centre.
  ctx.save();
  ctx.fillStyle = rgb(colours.type, 0.75);
  ctx.font = `${Math.round(size * 0.05)}px ${LABEL_FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(scale.unit, 0, size * 0.25);
  ctx.restore();

  return face;
}

// The redline arc, on its own layer: from the redline to the end of the dial.
export function paintRedline(scale, colours, size) {
  const layer = canvasOf(size);
  const ctx = layer.getContext('2d');
  ctx.translate(size / 2, size / 2);
  // Drawn plainly rather than added as light: red added to its own glow washes out to pink.
  ctx.lineCap = 'butt';
  glow(ctx, colours.red, size, 1.4);
  ctx.lineWidth = size * 0.022;
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.452, angleOf(scale, scale.redline), angleOf(scale, scale.max));
  ctx.stroke();
  return layer;
}
