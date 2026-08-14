var gap = 40;
var radiusVmin = 30;
var speedIn = 0.5;
var speedOut = 0.6;
var restScale = 0.09;
var minHoverScale = 1;
var maxHoverScale = 3;
var waveSpeed = 1200;
var waveWidth = 180;

var PALETTE = [
  { type: 'solid', value: '#22c55e' },
  { type: 'solid', value: '#06b6d4' },
  { type: 'solid', value: '#f97316' },
  { type: 'solid', value: '#ef4444' },
  { type: 'solid', value: '#facc15' },
  { type: 'solid', value: '#ec4899' },
  { type: 'solid', value: '#9ca3af' },
  { type: 'solid', value: '#a78bfa' },
  { type: 'solid', value: '#60a5fa' },
  { type: 'solid', value: '#34d399' },
  { type: 'gradient', stops: ['#6366f1', '#3b82f6'] },
  { type: 'gradient', stops: ['#06b6d4', '#6366f1'] },
  { type: 'gradient', stops: ['#22c55e', '#06b6d4'] },
  { type: 'gradient', stops: ['#f97316', '#ef4444'] },
  { type: 'gradient', stops: ['#8b5cf6', '#06b6d4'] },
  { type: 'gradient', stops: ['#3b82f6', '#8b5cf6'] },
  { type: 'gradient', stops: ['#34d399', '#3b82f6'] },
];

var SHAPE_TYPES = ['circle', 'pill', 'star', 'star'];

var canvas = document.querySelector('canvas');
var ctx = canvas.getContext('2d');

var grid = null;
var rafId = null;
var pointer = null;
var activity = 0;
var waves = [];
var maskRects = [];
var frameCount = 0;
var maskOverride = false;

function rnd(min, max) { return Math.random() * (max - min) + min; }
function rndInt(min, max) { return Math.floor(rnd(min, max + 1)); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function smoothstep(t) {
  var c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

function durationToFactor(seconds) {
  if (seconds <= 0) return 1;
  return 1 - Math.pow(0.05, 1 / (60 * seconds));
}

function drawCircle(ctx, size) {
  ctx.beginPath();
  ctx.arc(0, 0, size, 0, Math.PI * 2);
  ctx.fill();
}

function drawPill(ctx, size) {
  var w = size * 0.48;
  var h = size;
  ctx.beginPath();
  ctx.roundRect(-w, -h, w * 2, h * 2, w);
  ctx.fill();
}

function drawStar(ctx, size, points, innerRatio) {
  ctx.beginPath();
  for (var i = 0; i < points * 2; i++) {
    var angle = (i * Math.PI) / points - Math.PI / 2;
    var r = i % 2 === 0 ? size : size * innerRatio;
    var x = Math.cos(angle) * r;
    var y = Math.sin(angle) * r;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

function drawShape(ctx, shape) {
  switch (shape.type) {
    case 'circle': return drawCircle(ctx, shape.size / 1.5);
    case 'pill':   return drawPill(ctx, shape.size / 1.4);
    case 'star':   return drawStar(ctx, shape.size, shape.points, shape.innerRatio);
  }
}

function resolveFill(ctx, colorDef, size) {
  if (colorDef.type === 'solid') return colorDef.value;
  var grad = ctx.createRadialGradient(0, -size * 0.3, 0, 0, size * 0.3, size * 1.5);
  grad.addColorStop(0, colorDef.stops[0]);
  grad.addColorStop(1, colorDef.stops[1]);
  return grad;
}

function randomStarProps() {
  return {
    points: rndInt(4, 10),
    innerRatio: rnd(0.1, 0.5),
  };
}

function buildGrid() {
  var W = window.innerWidth;
  var H = window.innerHeight;
  var cols = Math.floor(W / gap);
  var rows = Math.floor(H / gap);
  var offsetX = (W - (cols - 1) * gap) / 2;
  var offsetY = (H - (rows - 1) * gap) / 2;
  var shapes = [];

  for (var row = 0; row < rows; row++) {
    for (var col = 0; col < cols; col++) {
      var type = pick(SHAPE_TYPES);
      var shape = {
        x: offsetX + col * gap,
        y: offsetY + row * gap,
        type: type,
        color: pick(PALETTE),
        angle: rnd(0, Math.PI * 2),
        size: gap * 0.38,
        scale: restScale,
        maxScale: rnd(minHoverScale, maxHoverScale),
        hovered: false,
      };
      if (type === 'star') Object.assign(shape, randomStarProps());
      shapes.push(shape);
    }
  }

  return { shapes: shapes, width: W, height: H };
}

function init() {
  var W = window.innerWidth;
  var H = window.innerHeight;
  var dpr = window.devicePixelRatio || 1;

  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  grid = buildGrid();
}

function tick() {
  if (!grid) { rafId = requestAnimationFrame(tick); return; }

  var shapes = grid.shapes;
  var width = grid.width;
  var height = grid.height;
  var radius = Math.min(width, height) * (radiusVmin / 100);
  var now = performance.now();

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#080808';
  ctx.fillRect(0, 0, width, height);

  activity *= 0.93;

  frameCount++;
  if (frameCount % 10 === 0) {
    maskRects = Array.from(document.querySelectorAll('[data-shape-mask]'))
      .map(function(el) { return el.getBoundingClientRect(); });
  }

  var maxDist = Math.sqrt(width * width + height * height);
  waves = waves.filter(function(w) {
    return (now - w.startTime) / 1000 * waveSpeed < maxDist + waveWidth;
  });

  for (var i = 0; i < shapes.length; i++) {
    var shape = shapes[i];
    var pad = gap / 2;
    var masked = !maskOverride && maskRects.some(function(r) {
      return shape.x >= r.left - pad && shape.x <= r.right  + pad &&
             shape.y >= r.top  - pad && shape.y <= r.bottom + pad;
    });

    if (masked) {
      shape.scale += (0 - shape.scale) * durationToFactor(speedOut);
      if (shape.scale < 0.005) shape.scale = 0;
      continue;
    }

    var pointerInfluence = 0;
    if (pointer && activity > 0.001) {
      var dx = shape.x - pointer.x;
      var dy = shape.y - pointer.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      pointerInfluence = smoothstep(1 - dist / radius) * activity;

      if (pointerInfluence > 0.05 && !shape.hovered) {
        shape.hovered = true;
        shape.maxScale = rnd(minHoverScale, maxHoverScale);
        shape.angle = rnd(0, Math.PI * 2);
        if (shape.type === 'star') Object.assign(shape, randomStarProps());
      } else if (pointerInfluence <= 0.05) {
        shape.hovered = false;
      }
    } else {
      shape.hovered = false;
    }

    var waveInfluence = 0;
    for (var j = 0; j < waves.length; j++) {
      var wave = waves[j];
      var waveRadius = (now - wave.startTime) / 1000 * waveSpeed;
      var wdx = shape.x - wave.x;
      var wdy = shape.y - wave.y;
      var wdist = Math.sqrt(wdx * wdx + wdy * wdy);
      var t = 1 - Math.abs(wdist - waveRadius) / waveWidth;
      if (t > 0) waveInfluence = Math.max(waveInfluence, Math.sin(Math.PI * t));
    }

    var pointerTarget = restScale + pointerInfluence * (shape.maxScale - restScale);
    var waveTarget = restScale + waveInfluence * (shape.maxScale - restScale);
    var target = Math.max(pointerTarget, waveTarget);

    var factor = target > shape.scale ? durationToFactor(speedIn) : durationToFactor(speedOut);
    shape.scale += (target - shape.scale) * factor;

    if (shape.scale < restScale * 0.15) continue;

    ctx.save();
    ctx.translate(shape.x, shape.y);
    ctx.rotate(shape.angle);
    ctx.scale(shape.scale, shape.scale);
    ctx.fillStyle = resolveFill(ctx, shape.color, shape.size);
    drawShape(ctx, shape);
    ctx.restore();
  }

  rafId = requestAnimationFrame(tick);
}

function onMove(e) {
  pointer = { x: e.clientX, y: e.clientY };
  activity = 1;
}

function onClick(e) {
  triggerWave(e.clientX, e.clientY);
}

function triggerWave(x, y) {
  x = x !== undefined ? x : window.innerWidth / 2;
  y = y !== undefined ? y : window.innerHeight / 2;
  waves.push({ x: x, y: y, startTime: performance.now() });
  maskOverride = true;
  var delay = Math.sqrt(window.innerWidth * window.innerWidth + window.innerHeight * window.innerHeight) / waveSpeed;
  setTimeout(function() { maskOverride = false; }, delay * 1000);
}

init();
rafId = requestAnimationFrame(tick);

window.addEventListener('resize', init);
window.addEventListener('pointermove', onMove);
window.addEventListener('click', onClick);

triggerWave();