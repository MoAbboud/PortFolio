import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { SHADERS } from '../lib/render.js';

// A shader compile error costs a round trip through a browser to find, and most
// of them are catchable by reading the text. `half` is a reserved word in GLSL
// and cost exactly one such round trip, which is why this file exists.

// GLSL ES 3.00, section 3.7: identifiers reserved for future use.
const RESERVED = [
  'common', 'partition', 'active', 'asm', 'class', 'union', 'enum', 'typedef',
  'template', 'this', 'resource', 'goto', 'inline', 'noinline', 'public',
  'static', 'extern', 'external', 'interface', 'long', 'short', 'half', 'fixed',
  'unsigned', 'superp', 'input', 'output', 'filter', 'sizeof', 'cast',
  'namespace', 'using', 'attribute', 'varying', 'volatile',
  'hvec2', 'hvec3', 'hvec4', 'fvec2', 'fvec3', 'fvec4', 'sampler3DRect',
];

/** Comments may say anything, including "static" and "output". Code may not. */
const stripComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/\/\/[^\n]*/g, '');

for (const [name, source] of Object.entries(SHADERS)) {
  test(`the ${name} shader uses no reserved word`, () => {
    const code = stripComments(source);
    for (const word of RESERVED) {
      const found = new RegExp(`\\b${word}\\b`).test(code);
      assert.ok(!found, `"${word}" is reserved in GLSL and cannot be an identifier`);
    }
  });

  test(`the ${name} shader declares its version first`, () => {
    // #version must be the very first line, before even a comment.
    assert.ok(source.startsWith('#version 300 es\n'),
      `${name} must open with "#version 300 es"`);
  });

  test(`the ${name} shader has balanced braces and parentheses`, () => {
    const code = stripComments(source);
    for (const [open, close] of [['{', '}'], ['(', ')']]) {
      const opened = (code.match(new RegExp(`\\${open}`, 'g')) ?? []).length;
      const closed = (code.match(new RegExp(`\\${close}`, 'g')) ?? []).length;
      assert.equal(opened, closed, `unbalanced ${open}${close}`);
    }
  });

  test(`the ${name} shader has a main`, () => {
    assert.match(stripComments(source), /void\s+main\s*\(\s*\)/);
  });
}

test('a fragment shader states its precision and its output', () => {
  for (const [name, source] of Object.entries(SHADERS)) {
    if (!name.includes('fragment')) continue;
    assert.match(source, /precision\s+(highp|mediump|lowp)\s+float;/,
      `${name} must declare a float precision`);
    assert.match(source, /\bout\s+vec4\s+\w+;/,
      `${name} must declare an output`);
  }
});

test('a fragment shader states its precision before it declares anything', () => {
  /**
   * **A fragment shader has no default precision for float**, so a declaration
   * above the `precision` line is an error - one per float, naming a line the
   * author did not write.
   *
   * This is an *ordering* rule, and it is the hole the check above left: it
   * asked whether the precision line existed, which it did. A shared block was
   * injected between the version and the precision, and every float in it
   * failed. The whole point of these tests is that a shader error costs a round
   * trip through a browser, and this one made the round trip.
   *
   * Vertex shaders are exempt: float is highp there by default.
   */
  for (const [name, source] of Object.entries(SHADERS)) {
    if (!name.includes('fragment')) continue;
    const lines = stripComments(source).split('\n');
    const precision = lines.findIndex((l) => /^\s*precision\s+\w+\s+float\s*;/.test(l));
    const declared = lines.findIndex((l) => /^\s*(uniform|in|out)\s+/.test(l));
    assert.ok(precision >= 0, `${name} never states a precision`);
    assert.ok(precision < declared,
      `${name} declares something on line ${declared + 1} before stating its precision on`
      + ` line ${precision + 1} - every float above that line is a compile error`);
  }
});

test('what a vertex shader sends out, its fragment shader takes in', () => {
  // `area` was missing from this list, so its pair was never checked at all.
  const pairs = [['cube', 'cube'], ['mesh', 'mesh'], ['shadow', 'shadow'],
    ['area', 'area'], ['rain', 'rain'], ['sky', 'sky'], ['strip', 'strip']];
  // The type is captured as well as the name. A varying declared `float` on one
  // side and `vec2` on the other links no better than one that is missing, and
  // reads as a name that is present so the mismatch is easy to look past.
  const declared = (source, keyword) => {
    const found = new Map();
    const pattern = new RegExp(`^\\s*${keyword}\\s+(\\w+)\\s+(\\w+)\\s*;`, 'gm');
    for (const [, type, name] of stripComments(source).matchAll(pattern)) found.set(name, type);
    return found;
  };
  for (const [vs, fs] of pairs) {
    const out = declared(SHADERS[`${vs} vertex`], 'out');
    const into = declared(SHADERS[`${fs} fragment`], 'in');
    // Every varying the fragment shader reads must be produced by its vertex
    // shader. The reverse is allowed: a vertex shader may compute more.
    for (const [name, type] of into) {
      assert.ok(out.has(name),
        `${fs} fragment reads "${name}", which ${vs} vertex does not send`);
      assert.equal(out.get(name), type,
        `"${name}" is ${type} in the ${fs} fragment shader and ${out.get(name)} in ${vs} vertex`);
    }
  }
});

/**
 * A shader has to be self-contained: it is compiled on its own.
 *
 * **This is the check that was missing.** Shared blocks are injected into the
 * shaders that need them, and the spotlight's block went into the vertex
 * shaders while the *ground's fragment* shader was the one calling it. Every
 * other check passed - the text is balanced, the version is first, no reserved
 * words, the varyings line up - and it would have failed to compile in a
 * browser, which is the round trip this whole file exists to avoid.
 */
for (const [name, source] of Object.entries(SHADERS)) {
  test(`the ${name} shader declares every uniform it mentions`, () => {
    const code = stripComments(source);
    const declared = new Set(
      [...code.matchAll(/uniform\s+\w+\s+(\w+)\s*;/g)].map((m) => m[1]),
    );
    const used = new Set([...code.matchAll(/\bu[A-Z]\w*/g)].map((m) => m[0]));
    for (const u of used) {
      assert.ok(declared.has(u),
        `${u} is used but never declared - a block it lives in was not injected here`);
    }
  });

  test(`the ${name} shader defines every helper it calls`, () => {
    const code = stripComments(source);
    const defined = new Set(
      [...code.matchAll(/^\s*\w+\s+(\w+)\s*\([^)]*\)\s*\{/gm)].map((m) => m[1]),
    );
    // The ones this app injects rather than the whole GLSL standard library.
    for (const fn of ['veilOf', 'spotAt', 'bend', 'bendNormal', 'grain', 'sprockets',
      'solidity', 'travelled', 'turned', 'hash']) {
      const calls = new RegExp(`\\b${fn}\\s*\\(`).test(code);
      if (!calls) continue;
      assert.ok(defined.has(fn),
        `${fn} is called but never defined - the block it lives in was not injected here`);
    }
  });
}

test('every program that draws part of the world is handed the world it draws', () => {
  /**
   * **Declaring a shared uniform and never being given it is silent.**
   *
   * A uniform nobody sets is nought, so a shader that takes the roll block and
   * calls `bend` draws the flat position for ever and reports nothing. That is
   * what places were doing: `AREA_VS` turns with the piece it is on by design,
   * `veil(area)` was never called, and every place stayed lying in the plane
   * while the ring turned out from under it. Nothing caught it because nothing
   * on the canvas had used a place since the ring landed.
   *
   * The checks above ask whether a shader is self-contained. This one asks
   * whether the renderer holds up its half of the bargain.
   */
  const source = readFileSync(new URL('../lib/render.js', import.meta.url), 'utf8');
  const shared = ['uRoll', 'uRadius', 'uFocusX', 'uPitch', 'uRoom', 'uSpot'];

  const programs = new Map();
  for (const [name, code] of Object.entries(SHADERS)) {
    const program = name.split(' ')[0];
    const takes = shared.filter((u) => new RegExp(`uniform\\s+\\w+\\s+${u}\\s*;`).test(code));
    programs.set(program, [...(programs.get(program) ?? []), ...takes]);
  }

  for (const [program, takes] of programs) {
    if (!takes.length) continue;
    assert.match(source, new RegExp(`veil\\(${program}\\)`),
      `the ${program} program declares ${[...new Set(takes)].join(', ')} and is never handed`
      + ` them - add veil(${program}) where it is drawn, or it draws an unrolled world`);
  }
});

test('every uniform the renderer sets is declared by some shader', () => {
  // A guard against a rename in one place and not the other.
  const all = Object.values(SHADERS).join('\n');
  const used = [
    'uViewProj', 'uTime', 'uFlip', 'uShimmer', 'uTint', 'uSelected',
    'uStep', 'uStepT', 'uAmbient',
    'uSun', 'uSky', 'uFogNear', 'uFogFar',
    'uHorizon', 'uSunColour', 'uFloor',
    'uScars', 'uScarExtent', 'uStrength', 'uSmooth',
    'uRain', 'uBox', 'uScale', 'uColour',
    // The world's shape, shared by every program that draws part of it.
    'uRoll', 'uRadius', 'uFocusX', 'uVeilNear', 'uVeilFar',
    'uPitch', 'uPlate', 'uSolid', 'uSpace', 'uStock', 'uEye',
    'uGround', 'uRoom', 'uSpot',
  ];
  for (const name of used) {
    assert.match(all, new RegExp(`uniform\\s+\\w+\\s+${name}\\s*;`),
      `${name} is set by render.js but declared by no shader`);
  }
});

test('every instance attribute the renderer binds is declared by the cube shader', () => {
  const vertex = SHADERS['cube vertex'];
  for (const name of ['aPos', 'aNormal', 'aOffset', 'aColour', 'aSeed', 'aSize',
    'aObject', 'aFrom', 'aUntil']) {
    assert.match(vertex, new RegExp(`in\\s+\\w+\\s+${name}\\s*;`),
      `${name} is bound by render.js but declared by no shader`);
  }
});

test('every vertex attribute the mesh path binds is declared by the mesh shader', () => {
  const vertex = SHADERS['mesh vertex'];
  for (const name of ['aPos', 'aNormal', 'aColour', 'aSeed', 'aObject', 'aFrom',
    'aUntil', 'aAo', 'aPivot', 'aMotion']) {
    assert.match(vertex, new RegExp(`in\\s+\\w+\\s+${name}\\s*;`),
      `${name} is bound by render.js but declared by no shader`);
  }
});

test('every attribute the shadow pass binds is declared by the shadow shader', () => {
  const vertex = SHADERS['shadow vertex'];
  for (const name of ['aCorner', 'aCentre', 'aRadius', 'aFrom', 'aUntil']) {
    assert.match(vertex, new RegExp(`in\\s+\\w+\\s+${name}\\s*;`),
      `${name} is bound by render.js but declared by no shader`);
  }
});

test('the two ways of drawing an object are lit by the same fragment shader', () => {
  // If these ever differ, cubes and meshes will disagree about fog, ghosting
  // and highlighting, and the roundness dial will change more than roundness.
  assert.equal(SHADERS['cube fragment'], SHADERS['mesh fragment']);
});
