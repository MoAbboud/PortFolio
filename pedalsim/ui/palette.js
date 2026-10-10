// Each engine's colours: one of the colour presets of the CodePen pen the look comes from
// (filipz, dPygJGM), as numbers. The engine cycle is the colour cycle.
//
// Two roles never change with the palette, because they carry meaning: the redline is
// always red, and type is always light grey.

export const FIXED = {
  red: { core: [255, 100, 100], edge: [200, 50, 50] },
  type: [224, 224, 224],
};

export const PALETTES = {
  v4: { name: 'Cool', top: [5, 10, 20], bottom: [10, 20, 30],
    one: { core: [100, 200, 255], edge: [0, 100, 200] },
    two: { core: [100, 255, 200], edge: [0, 150, 100] },
    three: { core: [150, 200, 255], edge: [50, 100, 200] } },
  v6: { name: 'Neon', top: [5, 5, 15], bottom: [10, 10, 20],
    one: { core: [255, 0, 255], edge: [128, 0, 255] },
    two: { core: [0, 255, 255], edge: [0, 128, 255] },
    three: { core: [255, 255, 0], edge: [255, 128, 0] } },
  v8: { name: 'Warm', top: [20, 10, 5], bottom: [40, 20, 10],
    one: { core: [255, 200, 0], edge: [255, 100, 0] },
    two: { core: [255, 100, 100], edge: [200, 50, 50] },
    three: { core: [255, 150, 50], edge: [200, 100, 0] } },
  v10: { name: 'Cyberpunk', top: [0, 20, 40], bottom: [20, 0, 40],
    one: { core: [255, 0, 128], edge: [200, 0, 100] },
    two: { core: [0, 255, 128], edge: [0, 200, 100] },
    three: { core: [255, 255, 0], edge: [200, 200, 0] } },
  v12: { name: 'Monochrome', top: [20, 20, 20], bottom: [10, 10, 10],
    one: { core: [200, 200, 200], edge: [150, 150, 150] },
    two: { core: [255, 255, 255], edge: [100, 100, 100] },
    three: { core: [180, 180, 180], edge: [120, 120, 120] } },
};

export const rgb = ([r, g, b], a = 1) => `rgba(${r}, ${g}, ${b}, ${a})`;

// Roles, so the painter never has to know which preset is which.
export function roles(engineId) {
  const p = PALETTES[engineId];
  return {
    top: p.top,
    bottom: p.bottom,
    needle: p.one, // needle, tach arc, bank A line
    bankB: p.two,
    speed: p.three, // speedometer, shift lights, the summed line
    red: FIXED.red,
    type: FIXED.type,
  };
}
