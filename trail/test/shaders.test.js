import test from 'node:test';
import assert from 'node:assert/strict';

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

test('what a vertex shader sends out, its fragment shader takes in', () => {
  const pairs = [['cube', 'cube'], ['mesh', 'mesh'], ['shadow', 'shadow'],
    ['rain', 'rain'], ['sky', 'sky'], ['floor', 'floor']];
  const declared = (source, keyword) => {
    const names = [];
    const pattern = new RegExp(`^\\s*${keyword}\\s+\\w+\\s+(\\w+)\\s*;`, 'gm');
    let match;
    while ((match = pattern.exec(stripComments(source)))) names.push(match[1]);
    return names.sort();
  };
  for (const [vs, fs] of pairs) {
    const out = declared(SHADERS[`${vs} vertex`], 'out');
    const into = declared(SHADERS[`${fs} fragment`], 'in');
    // Every varying the fragment shader reads must be produced by its vertex
    // shader. The reverse is allowed: a vertex shader may compute more.
    for (const name of into) {
      assert.ok(out.includes(name),
        `${fs} fragment reads "${name}", which ${vs} vertex does not send`);
    }
  }
});

test('every uniform the renderer sets is declared by some shader', () => {
  // A guard against a rename in one place and not the other.
  const all = Object.values(SHADERS).join('\n');
  const used = [
    'uViewProj', 'uTime', 'uFlip', 'uShimmer', 'uTint', 'uSelected',
    'uStep', 'uStepT', 'uAmbient',
    'uSun', 'uSky', 'uFogNear', 'uFogFar',
    'uHorizon', 'uSunColour', 'uExtent', 'uFloor', 'uEye',
    'uScars', 'uScarExtent', 'uStrength', 'uSmooth',
    'uRain', 'uBox', 'uScale', 'uColour',
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
