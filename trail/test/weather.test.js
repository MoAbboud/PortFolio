import test from 'node:test';
import assert from 'node:assert/strict';

import { PRESETS, resolve, lerpWeather, stampsUpTo } from '../lib/weather.js';
import { scarMap, sample, toTexel, CHANNELS } from '../lib/scars.js';

const near = (a, b, tolerance = 1e-6) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} is not near ${b}`);

// --- weather ----------------------------------------------------------------

test('every preset carries a full set of numbers', () => {
  const required = ['sky', 'horizon', 'floor', 'sun', 'sunColour', 'ambient',
    'fogNear', 'fogFar', 'rain'];
  for (const [name, preset] of Object.entries(PRESETS)) {
    for (const key of required) {
      assert.ok(key in preset, `${name} is missing ${key}`);
    }
    for (const key of ['sky', 'horizon', 'floor', 'sun', 'sunColour']) {
      assert.equal(preset[key].length, 3, `${name}.${key} should be three numbers`);
      assert.ok(preset[key].every(Number.isFinite));
    }
    assert.ok(preset.fogFar > preset.fogNear, `${name} fog is inside out`);
    assert.ok('scar' in preset, `${name} must say whether it marks the ground`);
  }
});

test('a step can name a preset or give numbers directly', () => {
  assert.deepEqual(resolve('storm'), PRESETS.storm);
  assert.deepEqual(resolve(null), PRESETS.clear);
  const nudged = resolve({ fogFar: 42 });
  assert.equal(nudged.fogFar, 42);
  assert.deepEqual(nudged.sky, PRESETS.clear.sky, 'unnamed values fall back to clear');
});

test('an unknown weather is refused by name rather than silently ignored', () => {
  assert.throws(() => resolve('drizzle'), /unknown weather "drizzle"/);
});

test('a cross-fade begins and ends exactly on its two weathers', () => {
  const start = lerpWeather('clear', 'storm', 0);
  const end = lerpWeather('clear', 'storm', 1);
  assert.deepEqual(start.sky, PRESETS.clear.sky);
  assert.deepEqual(end.sky, PRESETS.storm.sky);
  near(end.fogFar, PRESETS.storm.fogFar);
});

test('a cross-fade passes through the middle rather than jumping', () => {
  const middle = lerpWeather('clear', 'storm', 0.5);
  for (let i = 0; i < 3; i++) {
    const [a, b] = [PRESETS.clear.sky[i], PRESETS.storm.sky[i]];
    assert.ok(middle.sky[i] > Math.min(a, b) && middle.sky[i] < Math.max(a, b),
      'the sky should be between the two, not at either');
  }
});

test('a cross-fade is clamped outside its range', () => {
  assert.deepEqual(lerpWeather('clear', 'storm', -3).sky, PRESETS.clear.sky);
  assert.deepEqual(lerpWeather('clear', 'storm', 9).sky, PRESETS.storm.sky);
});

test('a mark on the ground does not fade in; it belongs to the step it came with', () => {
  assert.equal(lerpWeather('clear', 'storm', 0.2).scar, null);
  assert.equal(lerpWeather('clear', 'storm', 0.8).scar, 'wet');
});

test('only the weathers that should rain do', () => {
  assert.equal(PRESETS.storm.rain, 1);
  assert.ok(PRESETS.fog.rain > 0 && PRESETS.fog.rain < 0.5, 'fog should be a drift, not a downpour');
  for (const name of ['clear', 'overcast', 'dusk', 'night']) {
    assert.equal(PRESETS[name].rain, 0, `${name} should be dry`);
  }
});

test('rain arrives gradually rather than switching on', () => {
  const quarter = lerpWeather('clear', 'storm', 0.25);
  assert.ok(quarter.rain > 0 && quarter.rain < 1, `rain jumped to ${quarter.rain}`);
  assert.equal(lerpWeather('clear', 'storm', 0).rain, 0);
  assert.equal(lerpWeather('clear', 'storm', 1).rain, 1);
});

test('only the weathers that should mark the ground do', () => {
  assert.equal(PRESETS.storm.scar, 'wet');
  assert.equal(PRESETS.fog.scar, 'pale');
  for (const name of ['clear', 'overcast', 'dusk', 'night']) {
    assert.equal(PRESETS[name].scar, null, `${name} should leave nothing behind`);
  }
});

const ROUTE = [
  { framing: { x: -10, z: -10, w: 20, d: 20 }, weather: 'clear' },
  { framing: { x: 0, z: 0, w: 20, d: 20 }, weather: 'storm' },
  { framing: { x: 20, z: 20, w: 20, d: 20 }, weather: 'fog' },
  { framing: { x: -40, z: -40, w: 80, d: 80 }, weather: 'dusk' },
];

test('stamps accumulate as the route goes on, and never before their step', () => {
  assert.deepEqual(stampsUpTo(ROUTE, 0), []);
  assert.equal(stampsUpTo(ROUTE, 1).length, 1);
  assert.equal(stampsUpTo(ROUTE, 2).length, 2);
  assert.equal(stampsUpTo(ROUTE, 3).length, 2, 'dusk leaves nothing');
});

test('asking beyond the end of a route is not an error', () => {
  assert.equal(stampsUpTo(ROUTE, 99).length, 2);
});

// --- scars ------------------------------------------------------------------

const MAP = { extent: 60, resolution: 128, feather: 4 };

test('the centre of the world is the centre of the map', () => {
  near(toTexel(0, 60, 128), 64);
  near(toTexel(-60, 60, 128), 0);
  near(toTexel(60, 60, 128), 128);
});

test('a stamp marks where it rained and nowhere else', () => {
  const data = scarMap([{ frame: { x: 0, z: 0, w: 20, d: 20 }, kind: 'wet' }], MAP);
  assert.ok(sample(data, [10, 0, 10], 'wet', MAP) > 0.9, 'the middle should be soaked');
  assert.equal(sample(data, [-40, 0, -40], 'wet', MAP), 0, 'far away should be dry');
});

test('a stamp fades at its edges rather than being a painted rectangle', () => {
  const data = scarMap([{ frame: { x: 0, z: 0, w: 20, d: 20 }, kind: 'wet' }], MAP);
  const middle = sample(data, [10, 0, 10], 'wet', MAP);
  const edge = sample(data, [19.6, 0, 10], 'wet', MAP);
  const outside = sample(data, [24, 0, 10], 'wet', MAP);
  assert.ok(middle > edge, 'the edge should be weaker than the middle');
  assert.ok(edge > outside, 'and stronger than outside');
});

test('the two kinds of mark do not overwrite each other', () => {
  const data = scarMap([
    { frame: { x: 0, z: 0, w: 20, d: 20 }, kind: 'wet' },
    { frame: { x: 0, z: 0, w: 20, d: 20 }, kind: 'pale' },
  ], MAP);
  assert.ok(sample(data, [10, 0, 10], 'wet', MAP) > 0.9);
  assert.ok(sample(data, [10, 0, 10], 'pale', MAP) > 0.9);
});

test('overlapping stamps of the same kind keep the strongest', () => {
  const once = scarMap([{ frame: { x: 0, z: 0, w: 20, d: 20 }, kind: 'wet' }], MAP);
  const twice = scarMap([
    { frame: { x: 0, z: 0, w: 20, d: 20 }, kind: 'wet' },
    { frame: { x: 5, z: 5, w: 20, d: 20 }, kind: 'wet' },
  ], MAP);
  assert.equal(sample(twice, [10, 0, 10], 'wet', MAP), sample(once, [10, 0, 10], 'wet', MAP));
  assert.ok(sample(twice, [22, 0, 22], 'wet', MAP) > 0, 'the second stamp should also land');
});

test('a stamp reaching off the edge of the map does not crash or wrap', () => {
  const data = scarMap([{ frame: { x: -80, z: -80, w: 40, d: 40 }, kind: 'wet' }], MAP);
  assert.equal(data.length, MAP.resolution * MAP.resolution * 4);
  assert.equal(sample(data, [50, 0, 50], 'wet', MAP), 0, 'it must not appear on the far side');
});

test('an empty route leaves the ground clean', () => {
  const data = scarMap([], MAP);
  assert.ok(data.every((v) => v === 0));
});

test('the map is the same every time, so a seek looks like a playthrough', () => {
  const build = () => scarMap(stampsUpTo(ROUTE, 3).map((s) => ({ ...s, frame: s.frame })), MAP);
  assert.deepEqual([...build()], [...build()]);
});

test('the route the app actually plays leaves marks in the right places', () => {
  const data = scarMap(stampsUpTo(ROUTE, 2), MAP);
  assert.ok(sample(data, [10, 0, 10], 'wet', MAP) > 0.5, 'the storm step should be wet');
  assert.ok(sample(data, [30, 0, 30], 'pale', MAP) > 0.5, 'the fog step should be pale');
  assert.equal(sample(data, [-50, 0, -50], 'wet', MAP), 0, 'the clear step leaves nothing');
});
