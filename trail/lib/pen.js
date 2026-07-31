// Drawing on the screen.
//
// Marks live on the frame, not in the world: they do not turn with the camera
// and they are not part of the canvas. This is a pointer for talking over a
// shot, so it belongs on the glass rather than on the ground.
//
// Points are kept as fractions of the composed 16:9 frame, so a mark stays on
// the thing it was drawn on when the window resizes or goes fullscreen. Storing
// pixels would slide every mark the moment the frame changed size.

export const COLOURS = [
  '#ff4d4d', '#ffc93f', '#5ad46e', '#54a8ff', '#ffffff', '#12161c',
];

export const WIDTH = { min: 1, max: 12, default: 3 };

/** Below this, a point is the same point, and smoothing has nothing to work on. */
export const MIN_STEP = 0.0016;

export const start = (colour, width) => ({ colour, width, points: [] });

/**
 * Add a point, unless it is on top of the last one.
 *
 * A pointer reports far more often than a line needs, and keeping every event
 * makes a stroke heavy and its curve fitting noisy.
 */
export function extend(stroke, x, y) {
  const last = stroke.points[stroke.points.length - 1];
  if (last && Math.hypot(x - last[0], y - last[1]) < MIN_STEP) return false;
  stroke.points.push([x, y]);
  return true;
}

/** Drop the last stroke. Returns whether there was one. */
export function undo(strokes) {
  if (!strokes.length) return false;
  strokes.pop();
  return true;
}

/** A stroke with one point is a dot, which is a legitimate thing to draw. */
export const isDrawable = (stroke) => stroke.points.length > 0;

/**
 * Paint the marks onto a 2D context sized to the frame.
 *
 * Strokes are drawn as curves through the midpoints of the captured points,
 * which turns a polyline into something that looks handwritten without needing
 * to fit anything.
 */
export function draw(ctx, strokes, width, height) {
  ctx.clearRect(0, 0, width, height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const stroke of strokes) {
    if (!isDrawable(stroke)) continue;
    const points = stroke.points;
    ctx.strokeStyle = stroke.colour;
    ctx.fillStyle = stroke.colour;
    ctx.lineWidth = stroke.width;

    if (points.length === 1) {
      const [x, y] = points[0];
      ctx.beginPath();
      ctx.arc(x * width, y * height, stroke.width / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }

    ctx.beginPath();
    ctx.moveTo(points[0][0] * width, points[0][1] * height);
    for (let i = 1; i < points.length - 1; i++) {
      const [ax, ay] = points[i];
      const [bx, by] = points[i + 1];
      ctx.quadraticCurveTo(
        ax * width, ay * height,
        ((ax + bx) / 2) * width, ((ay + by) / 2) * height,
      );
    }
    const last = points[points.length - 1];
    ctx.lineTo(last[0] * width, last[1] * height);
    ctx.stroke();
  }
}

/** Where a pointer is, as a fraction of the frame rather than in pixels. */
export function toFrame(clientX, clientY, rect) {
  return [
    (clientX - rect.x) / Math.max(1, rect.w),
    (clientY - rect.y) / Math.max(1, rect.h),
  ];
}

export const inFrame = ([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1;
