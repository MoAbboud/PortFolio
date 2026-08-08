import test from 'node:test';
import assert from 'node:assert/strict';

import { atHour, sunAt, clockOf, lerpHour } from '../lib/daylight.js';
import { resolve, lerpWeather, underSky, PRESETS } from '../lib/weather.js';

const near = (a, b, tolerance = 0.02) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} is not near ${b}`);

test('the sun is on the horizon at six, overhead at noon and down at midnight', () => {
  near(sunAt(6)[1], 0, 0.05);
  near(sunAt(18)[1], 0, 0.05);
  assert.ok(sunAt(12)[1] > 0.95, 'the sun should be nearly overhead at noon');
  assert.ok(sunAt(0)[1] < -0.9, 'the sun should be well under the world at midnight');
});

test('the sun crosses the sky rather than jumping across it', () => {
  // It rises on one side and sets on the other, so the horizontal component has
  // to change sign somewhere in between. Without this the sun could satisfy
  // every height check above while never moving sideways at all.
  assert.ok(sunAt(6)[0] < -0.9, 'sunrise is on one side');
  assert.ok(sunAt(18)[0] > 0.9, 'sunset is on the other');
  const morning = sunAt(9)[0];
  const afternoon = sunAt(15)[0];
  assert.ok(morning < 0 && afternoon > 0, 'the sun should pass overhead between them');
});

test('the sun direction is always a unit vector', () => {
  // The shader normalises anyway, but a zero-length direction has no normal and
  // would light the whole world from nowhere.
  for (let h = 0; h < 24; h += 0.25) {
    const [x, y, z] = sunAt(h);
    near(Math.hypot(x, y, z), 1, 1e-6);
  }
});

test('the moon is opposite the sun, so one is up when the other is not', () => {
  for (const hour of [0, 3, 6, 9, 12, 15, 18, 21]) {
    const day = atHour(hour);
    for (let i = 0; i < 3; i++) near(day.moon[i], -day.sun[i], 1e-9);
    assert.ok(day.sunUp < 0.5 || day.moonUp < 0.5,
      `at ${hour} both the sun and the moon are fully up`);
  }
});

test('the moon comes up at night and is gone by the middle of the day', () => {
  assert.equal(atHour(12).moonUp, 0, 'no moon at noon');
  assert.ok(atHour(0).moonUp > 0.9, 'a full moon at midnight');
  assert.ok(atHour(12).sunUp > 0.9, 'and the sun at noon');
  assert.equal(atHour(0).sunUp, 0, 'no sun at midnight');
});

test('neither one snaps on, because a moon appearing at once is worse than none', () => {
  // Both are part way through the handover for about forty minutes either side
  // of six, which is what makes dusk a shot rather than an instant. Measured:
  // at six the sun is 0.45 up against the moon's 0.20, and by half past that is
  // 0.10 against 0.59.
  for (const hour of [18, 18.15, 18.3]) {
    const dusk = atHour(hour);
    assert.ok(dusk.sunUp > 0 && dusk.sunUp < 1, `sun was ${dusk.sunUp} at ${hour}`);
    assert.ok(dusk.moonUp > 0 && dusk.moonUp < 1, `moon was ${dusk.moonUp} at ${hour}`);
  }
  assert.ok(atHour(18).sunUp > atHour(18.3).sunUp, 'the sun should be going down');
  assert.ok(atHour(18).moonUp < atHour(18.3).moonUp, 'and the moon coming up');
});

test('stars arrive after the moon, not with it', () => {
  // A sky with the sun just under the horizon is still bright, and stars in it
  // read as a mistake.
  const setting = atHour(18.3);
  assert.ok(setting.moonUp > 0.5, 'the moon is already well up');
  assert.equal(setting.night, 0, 'and it is not dark enough for stars yet');
  const later = atHour(19).night;
  assert.ok(later > 0.5 && later < 1, `stars come in during the last of it, got ${later}`);
  assert.ok(atHour(23).night > 0.9, 'properly dark by eleven');
});

test('it is brightest at noon and darkest in the small hours', () => {
  assert.ok(atHour(12).ambient > atHour(8).ambient);
  assert.ok(atHour(8).ambient > atHour(6).ambient);
  assert.ok(atHour(6).ambient > atHour(2).ambient);
});

test('the sky is blue by day, orange at the horizon and dark at night', () => {
  const noon = atHour(12);
  assert.ok(noon.sky[2] > noon.sky[0], 'a midday sky is blue');
  const setting = atHour(18);
  assert.ok(setting.horizon[0] > setting.horizon[2], 'the horizon at sunset is warm');
  const midnight = atHour(0);
  assert.ok(Math.max(...midnight.sky) < 0.2, 'midnight is dark');
});

test('the clock reads as a time', () => {
  assert.equal(clockOf(0), '00:00');
  assert.equal(clockOf(6.5), '06:30');
  assert.equal(clockOf(18.25), '18:15');
  assert.equal(clockOf(23.999), '00:00', 'a minute short of midnight rounds to it');
  assert.equal(clockOf(25), '01:00', 'past the end of the clock wraps round');
  assert.equal(clockOf(-1), '23:00', 'and so does before the start of it');
});

test('an hour interpolates the short way round the clock', () => {
  // Going from eleven at night to one in the morning is two hours forward. The
  // long way round would run the sun backwards across the whole sky in the
  // middle of a shot.
  near(lerpHour(23, 1, 0.5), 0, 1e-9);
  near(lerpHour(1, 23, 0.5), 0, 1e-9);
  near(lerpHour(6, 18, 0), 6, 1e-9);
  near(lerpHour(6, 18, 1), 18, 1e-9);
});

// --- how the hour and the weather share the sky ------------------------------

test('a step with no hour resolves to exactly the preset it always did', () => {
  // The line that keeps every canvas built before the clock existed unchanged.
  assert.deepEqual(resolve('storm'), PRESETS.storm);
  assert.deepEqual(resolve({ fogFar: 42 }).sun, PRESETS.clear.sun);
});

test('an hour moves the sun, and the weather decides how much light gets through', () => {
  const morning = resolve({ ...PRESETS.clear, hour: 8 });
  const evening = resolve({ ...PRESETS.clear, hour: 17 });
  assert.notDeepEqual(morning.sun, evening.sun, 'the sun did not move');
  assert.ok(morning.sun[0] < evening.sun[0], 'and it moved the right way');

  // Clear lets the hour through untouched; a storm is a storm at any hour.
  const clearNoon = resolve({ ...PRESETS.clear, hour: 12 });
  const stormNoon = resolve({ ...PRESETS.storm, hour: 12 });
  assert.deepEqual(clearNoon.sky, atHour(12).sky, 'clear takes the hour exactly');
  assert.ok(stormNoon.sky[0] < clearNoon.sky[0], 'a storm pulls the sky back toward its own');
  assert.ok(stormNoon.ambient < clearNoon.ambient, 'and lets less light through');
});

test('ambient light multiplies, so overcast at midnight is darker than either', () => {
  const clearMidnight = resolve({ ...PRESETS.clear, hour: 0 }).ambient;
  const dullMidnight = resolve({ ...PRESETS.overcast, hour: 0 }).ambient;
  assert.ok(dullMidnight < clearMidnight);
  assert.ok(dullMidnight < PRESETS.overcast.ambient);
});

test('a preset with no hour carries no moon, so the sky has nothing to draw', () => {
  for (const [name, preset] of Object.entries(PRESETS)) {
    assert.equal(preset.moonUp, 0, `${name} should not have a moon without an hour`);
    assert.equal(preset.sunUp, 1, `${name} should have its sun fully up`);
    assert.ok(Array.isArray(preset.moon) && preset.moon.length === 3,
      `${name} needs a moon direction even when it is not drawn`);
    assert.ok(typeof preset.dull === 'number', `${name} must say how much it dulls the hour`);
  }
});

test('a flight between two hours travels across the sky, not through the world', () => {
  // Six in the morning and six in the evening are exactly opposite directions.
  // Mixing the vectors passes through the middle, where there is no direction
  // at all and the sun is nowhere.
  const middle = lerpWeather({ ...PRESETS.clear, hour: 6 }, { ...PRESETS.clear, hour: 18 }, 0.5);
  const length = Math.hypot(...middle.sun);
  near(length, 1, 0.01);
  assert.ok(middle.sun[1] > 0.9, 'halfway from sunrise to sunset is noon, overhead');
});

test('a flight lands exactly on the hour it was going to', () => {
  const end = lerpWeather({ ...PRESETS.clear, hour: 6 }, { ...PRESETS.clear, hour: 21 }, 1);
  near(end.hour, 21, 1e-9);
  assert.deepEqual(end.sun, atHour(21).sun);
});

test('a flight from a step with an hour to one without keeps the hour', () => {
  // Rather than snapping to a preset's fixed sun halfway through a shot.
  const out = lerpWeather({ ...PRESETS.clear, hour: 20 }, 'storm', 0.5);
  assert.ok(typeof out.hour === 'number', 'the sun should still be somewhere');
  near(out.hour, 20, 1e-9);
});

test('underSky never invents light where a weather blocks it', () => {
  const dark = underSky({ ...PRESETS.storm }, 12);
  assert.ok(dark.ambient <= PRESETS.storm.ambient,
    'a storm at noon should not be brighter than a storm');
});
