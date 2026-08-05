// Reading glTF 2.0 meshes, and turning them into the triangles a voxeliser wants.
//
// Pure module. glTF is what the newer CC0 packs ship in - Quaternius stopped
// exporting OBJ around 2019 - so without this reader those packs are invisible
// no matter how many megabytes of them sit in `models/`.
//
// It carries the same thing an OBJ does: triangles with a material each. Three
// differences, and they are the whole of this file:
//
//   - The numbers live in a companion `.bin` as typed arrays, not as text, so
//     they are read through accessors that say where and in what format.
//   - Meshes sit under a tree of nodes that each carry a transform, so a
//     vertex has to be walked up to world space rather than taken as written.
//   - Colour is usually a `baseColorFactor` per material, and when it is not
//     there at all - because the pack's colour lives in a texture atlas - the
//     material names are read instead, exactly as the OBJ path does.
//
// The output is precisely what `readObj` produces, `{triangles, colours}`, so
// `voxeliseMesh` takes it without knowing which format it came from.

import { multiply } from './mat4.js';
import { fromName, linearHex } from './obj.js';

const GREY = '#bbbbbb';

// How many numbers an element holds, and how each one is stored. MAT4 is here
// only because a skinned mesh's inverse-bind matrices use it; nothing reads it.
const COUNTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const COMPONENTS = {
  5120: { size: 1, read: (view, at) => view.getInt8(at) },
  5121: { size: 1, read: (view, at) => view.getUint8(at) },
  5122: { size: 2, read: (view, at) => view.getInt16(at, true) },
  5123: { size: 2, read: (view, at) => view.getUint16(at, true) },
  5125: { size: 4, read: (view, at) => view.getUint32(at, true) },
  5126: { size: 4, read: (view, at) => view.getFloat32(at, true) },
};

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * The bytes of a base64 data URI.
 *
 * Written out rather than reaching for `atob`, so that the same module runs in
 * Node and in a browser without either of them having to provide anything.
 */
export function fromBase64(text) {
  const clean = String(text).replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array((clean.length * 3) >> 2);
  let bits = 0;
  let held = 0;
  let at = 0;
  for (let i = 0; i < clean.length; i++) {
    bits = (bits << 6) | B64.indexOf(clean[i]);
    held += 6;
    if (held >= 8) {
      held -= 8;
      out[at++] = (bits >> held) & 255;
    }
  }
  return out.subarray(0, at);
}

/**
 * A `.glb`: the same JSON and the same buffer, in one file.
 *
 * A twelve byte header, then chunks. Only the first two matter - the JSON and
 * the binary that goes with it - and anything after them is ignored, which is
 * what the specification asks of a reader that does not know an extension.
 */
export function readGlb(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.byteLength < 12 || view.getUint32(0, true) !== 0x46546c67) {
    throw new Error('this is not a .glb file: it does not start with "glTF"');
  }
  const version = view.getUint32(4, true);
  if (version !== 2) throw new Error(`.glb version ${version} is not glTF 2.0`);

  let json = null;
  let binary = null;
  let at = 12;
  while (at + 8 <= data.byteLength) {
    const length = view.getUint32(at, true);
    const kind = view.getUint32(at + 4, true);
    const body = data.subarray(at + 8, at + 8 + length);
    if (kind === 0x4e4f534a && !json) json = JSON.parse(new TextDecoder().decode(body));
    else if (kind === 0x004e4942 && !binary) binary = body;
    at += 8 + length + ((4 - (length % 4)) % 4);
  }
  if (!json) throw new Error('this .glb carries no JSON chunk');
  return { json, binary };
}

/**
 * The files a glTF needs beside it, in buffer order.
 *
 * A `.gltf` keeps its numbers in a separate `.bin`, and a static server has to
 * be asked for it by name. Buffers that carry their own bytes - a data URI, or
 * the binary chunk of a `.glb` - come back as null, because there is nothing
 * to fetch.
 */
export function externalBuffers(json) {
  return (json.buffers ?? []).map((buffer) => (
    buffer.uri && !buffer.uri.startsWith('data:') ? decodeURIComponent(buffer.uri) : null
  ));
}

/** Every number an accessor describes, flat, whatever it was stored as. */
function readAccessor(json, buffers, index, what) {
  const accessor = json.accessors?.[index];
  if (!accessor) throw new Error(`${what}: accessor ${index} is missing`);
  if (accessor.sparse) throw new Error(`${what}: sparse accessors are not read`);

  const components = COUNTS[accessor.type];
  const component = COMPONENTS[accessor.componentType];
  if (!components || !component) {
    throw new Error(`${what}: unknown accessor format ${accessor.type}/${accessor.componentType}`);
  }

  const count = accessor.count ?? 0;
  const values = new Float64Array(count * components);
  // An accessor with no buffer view is defined to be all zeroes.
  if (accessor.bufferView === undefined) return { values, components, count };

  const bufferView = json.bufferViews?.[accessor.bufferView];
  if (!bufferView) throw new Error(`${what}: buffer view ${accessor.bufferView} is missing`);
  const bytes = buffers[bufferView.buffer ?? 0];
  if (!bytes) throw new Error(`${what}: buffer ${bufferView.buffer ?? 0} was not supplied`);

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const packed = components * component.size;
  // Vertex data may be interleaved with other attributes, in which case the
  // stride is wider than one element and this is the only thing that reads it
  // correctly.
  const stride = bufferView.byteStride || packed;
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);

  for (let i = 0; i < count; i++) {
    for (let c = 0; c < components; c++) {
      const at = start + i * stride + c * component.size;
      if (at + component.size > bytes.byteLength) {
        throw new Error(`${what}: accessor ${index} reads past the end of its buffer`);
      }
      values[i * components + c] = component.read(view, at);
    }
  }
  return { values, components, count };
}

/**
 * A node's own transform, as a column-major matrix.
 *
 * `posed` is what a clip says about this node at the chosen moment, and it
 * replaces whatever the node rests at. A node given an outright matrix cannot
 * be animated - the specification says so - which is why the pose is checked
 * first and the matrix is only used when there is none.
 */
function localMatrix(node, posed = null) {
  if (!posed && Array.isArray(node.matrix) && node.matrix.length === 16) {
    return Float32Array.from(node.matrix);
  }
  const [tx, ty, tz] = posed?.translation ?? node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = posed?.rotation ?? node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = posed?.scale ?? node.scale ?? [1, 1, 1];

  const xx = qx * qx; const yy = qy * qy; const zz = qz * qz;
  const xy = qx * qy; const xz = qx * qz; const yz = qy * qz;
  const wx = qw * qx; const wy = qw * qy; const wz = qw * qz;

  const m = new Float32Array(16);
  m[0] = (1 - 2 * (yy + zz)) * sx;
  m[1] = (2 * (xy + wz)) * sx;
  m[2] = (2 * (xz - wy)) * sx;
  m[4] = (2 * (xy - wz)) * sy;
  m[5] = (1 - 2 * (xx + zz)) * sy;
  m[6] = (2 * (yz + wx)) * sy;
  m[8] = (2 * (xz + wy)) * sz;
  m[9] = (2 * (yz - wx)) * sz;
  m[10] = (1 - 2 * (xx + yy)) * sz;
  m[12] = tx; m[13] = ty; m[14] = tz; m[15] = 1;
  return m;
}

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

const transform = (m, x, y, z) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];

/**
 * A colour per material.
 *
 * `baseColorFactor` is linear light, like an MTL's `Kd`, so it goes through the
 * same conversion; taken literally every material arrives almost black. A pack
 * whose colour is in a texture writes no factor at all, and then the material
 * name is all there is - which is not the loss it sounds like, because artists
 * call them what they are: MI_RedBrick, MI_Concrete, MI_InteriorWall.
 */
export function materialColours(json) {
  const materials = json.materials ?? [];
  const stated = materials.map((material) => {
    const factor = material.pbrMetallicRoughness?.baseColorFactor;
    return Array.isArray(factor) && factor.length >= 3 ? factor.slice(0, 3) : null;
  });

  // The same rule the MTL path uses: one colour shared by every material is
  // not a colour scheme, it is a texture that was not exported.
  const distinct = new Set(stated.filter(Boolean).map((f) => f.join(',')));
  const useless = materials.length > 1 && distinct.size <= 1;

  return materials.map((material, i) => {
    const name = material.name ?? `material-${i}`;
    if (!stated[i] || useless) return fromName(name);
    return linearHex(stated[i][0], stated[i][1], stated[i][2]);
  });
}

/**
 * Triangles and their colours, in world space.
 *
 * `buffers` holds the bytes of each buffer the document declares, in order, as
 * `externalBuffers` asked for them. A data URI is decoded here, so a caller
 * that fetched nothing still gets a mesh out of a self-contained file.
 */
export function readGltf(json, buffers = [], { name = 'model', pose = null, slots = null } = {}) {
  if (!json || typeof json !== 'object') throw new Error(`"${name}" is not a glTF document`);
  const version = json.asset?.version;
  if (version && !String(version).startsWith('2')) {
    throw new Error(`"${name}" is glTF ${version}; only 2.0 is read`);
  }

  const resolved = (json.buffers ?? []).map((buffer, i) => {
    if (buffers[i]) return buffers[i];
    if (buffer.uri?.startsWith('data:')) return fromBase64(buffer.uri.slice(buffer.uri.indexOf(',') + 1));
    return null;
  });

  const colours = materialColours(json);
  const triangles = [];
  const faceColours = [];
  // Which tint slot each face answers to, when the caller has said that a
  // material is one. A character with a body material and a trim material is
  // two slots, and that is the whole of how one model becomes a cast.
  const faceSlots = [];
  let vertices = 0;
  let skipped = 0;

  // A pose is baked in here, once, and never again. Sampling a clip gives each
  // joint a transform; skinning applies them to the vertices; what comes out is
  // an ordinary static model in that shape. Nothing animates at runtime, which
  // is what keeps a posed character the same kind of thing as a parked car.
  const posed = pose ? sampleClip(json, resolved, pose, name) : null;
  const world = worldMatrices(json, posed);

  const visit = (index) => {
    const node = json.nodes?.[index];
    if (!node || node.mesh === undefined || !world[index]) return;

    {
      const mesh = json.meshes?.[node.mesh];
      // A skinned mesh is positioned entirely by its joints. The specification
      // is explicit that the mesh node's own transform is ignored, and obeying
      // that matters: the mannequin's node sits at the origin, so applying it
      // as well would be harmless here and wrong on the next model.
      const skinned = node.skin !== undefined && json.skins?.[node.skin]
        ? jointMatrices(json, resolved, node.skin, world, name)
        : null;

      for (const primitive of mesh?.primitives ?? []) {
        const mode = primitive.mode ?? 4;
        const position = primitive.attributes?.POSITION;
        // Points and lines describe no surface, so there is nothing to fill.
        if (position === undefined || mode < 4) { skipped++; continue; }

        const what = `${name}: mesh ${node.mesh}`;
        const points = readAccessor(json, resolved, position, what);
        vertices += points.count;

        let order;
        if (primitive.indices === undefined) {
          order = Array.from({ length: points.count }, (_, i) => i);
        } else {
          order = Array.from(readAccessor(json, resolved, primitive.indices, what).values);
        }

        const bones = skinned && primitive.attributes.JOINTS_0 !== undefined
          && primitive.attributes.WEIGHTS_0 !== undefined
          ? {
            joints: readAccessor(json, resolved, primitive.attributes.JOINTS_0, what),
            weights: readAccessor(json, resolved, primitive.attributes.WEIGHTS_0, what),
            matrices: skinned,
          }
          : null;

        const colour = colours[primitive.material] ?? GREY;
        const slot = slots?.[json.materials?.[primitive.material]?.name] ?? null;
        const corner = (i) => {
          const v = order[i];
          const at = v * points.components;
          const [x, y, z] = [points.values[at], points.values[at + 1], points.values[at + 2]];
          if (!bones) return transform(world[index], x, y, z);
          return transform(blend(bones, v), x, y, z);
        };

        if (mode === 4) {
          for (let i = 0; i + 2 < order.length; i += 3) {
            triangles.push([corner(i), corner(i + 1), corner(i + 2)]);
            faceColours.push(colour);
            faceSlots.push(slot);
          }
        } else if (mode === 5) {          // strip
          for (let i = 0; i + 2 < order.length; i++) {
            const tri = i % 2 ? [corner(i + 1), corner(i), corner(i + 2)]
              : [corner(i), corner(i + 1), corner(i + 2)];
            triangles.push(tri);
            faceColours.push(colour);
            faceSlots.push(slot);
          }
        } else if (mode === 6) {          // fan
          for (let i = 1; i + 1 < order.length; i++) {
            triangles.push([corner(0), corner(i), corner(i + 1)]);
            faceColours.push(colour);
            faceSlots.push(slot);
          }
        }
      }
    }

  };

  // Every node that ended up with a place in the world. `worldMatrices` has
  // already walked the tree and left anything unreachable without one.
  for (let index = 0; index < (json.nodes?.length ?? 0); index++) visit(index);

  if (!triangles.length) {
    throw new Error(`"${name}" has no triangles`
      + (skipped ? `: its ${skipped} primitives are points or lines` : ''));
  }
  return { triangles, colours: faceColours, slots: faceSlots, vertices };
}

/** A `.glb`, all the way to triangles. */
export function importGlb(bytes, options = {}) {
  const { json, binary } = readGlb(bytes);
  return readGltf(json, [binary], options);
}

/**
 * The names of every pose a document can be put into.
 *
 * A rigged character ships with its animation, and each clip is a bank of poses
 * rather than something to play: `Idle_Talking_Loop` a second in is a person
 * mid-sentence, and that is a still object like any other.
 */
export function clipNames(json) {
  return (json?.animations ?? []).map((clip, i) => clip.name ?? `clip-${i}`);
}

/** Where a rotation is between two others. */
function slerp(a, b, t) {
  let [bx, by, bz, bw] = b;
  let dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  // Two quaternions describe one rotation with opposite signs. Taking the near
  // one is what keeps an arm from swinging the long way round.
  if (dot < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; dot = -dot; }
  if (dot > 0.9995) {
    const out = [
      a[0] + (bx - a[0]) * t, a[1] + (by - a[1]) * t,
      a[2] + (bz - a[2]) * t, a[3] + (bw - a[3]) * t,
    ];
    const length = Math.hypot(...out) || 1;
    return out.map((v) => v / length);
  }
  const theta = Math.acos(Math.min(1, Math.max(-1, dot)));
  const sin = Math.sin(theta) || 1;
  const wa = Math.sin((1 - t) * theta) / sin;
  const wb = Math.sin(t * theta) / sin;
  return [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
}

/**
 * Every joint's transform at one moment of one clip.
 *
 * Only the moment matters. Nothing is played: a time is chosen when the model
 * is imported, the skeleton is put into that shape, the shape is baked into the
 * vertices, and the clip is never looked at again.
 */
function sampleClip(json, buffers, pose, name) {
  const clips = json.animations ?? [];
  const wanted = pose.clip;
  const clip = typeof wanted === 'number'
    ? clips[wanted]
    : clips.find((c, i) => (c.name ?? `clip-${i}`) === wanted);
  if (!clip) {
    throw new Error(`"${name}" has no pose called "${wanted}".`
      + ` It offers: ${clipNames(json).join(', ') || 'none'}`);
  }

  const time = Number.isFinite(pose.time) ? pose.time : 0;
  const posed = new Map();

  for (const channel of clip.channels ?? []) {
    const node = channel.target?.node;
    const path = channel.target?.path;
    if (node === undefined || !['translation', 'rotation', 'scale'].includes(path)) continue;
    const sampler = clip.samplers?.[channel.sampler];
    if (!sampler) continue;

    const what = `${name}: pose ${wanted}`;
    const times = readAccessor(json, buffers, sampler.input, what);
    const values = readAccessor(json, buffers, sampler.output, what);
    if (!times.count) continue;

    // Held at both ends rather than wrapped, so a time past the end of a clip
    // gives its last frame instead of jumping back to the first.
    const first = times.values[0];
    const last = times.values[times.count - 1];
    const at = Math.min(Math.max(time, first), last);

    let i = 0;
    while (i < times.count - 1 && times.values[i + 1] < at) i++;
    const next = Math.min(i + 1, times.count - 1);
    const span = times.values[next] - times.values[i];
    const u = span > 0 ? (at - times.values[i]) / span : 0;

    const mode = sampler.interpolation ?? 'LINEAR';
    const stride = values.components;
    // A cubic sampler stores an in-tangent, the value and an out-tangent for
    // every key. The middle one is the pose; the tangents only smooth the way
    // between poses, which nothing here does.
    const keyAt = (k) => {
      const base = (mode === 'CUBICSPLINE' ? k * 3 + 1 : k) * stride;
      return Array.from(values.values.subarray(base, base + stride));
    };

    const a = keyAt(i);
    const b = keyAt(next);
    let value;
    if (mode === 'STEP') value = a;
    else if (path === 'rotation') value = slerp(a, b, u);
    else value = a.map((v, k) => v + (b[k] - v) * u);

    const entry = posed.get(node) ?? {};
    entry[path] = value;
    posed.set(node, entry);
  }
  return posed;
}

/** Where every node ends up, once its parents have had their say. */
function worldMatrices(json, posed) {
  const nodes = json.nodes ?? [];
  const world = new Array(nodes.length).fill(null);
  const seen = new Set();

  const walk = (index, parent) => {
    const node = nodes[index];
    if (!node || seen.has(index)) return;   // A cycle would otherwise not end.
    seen.add(index);
    world[index] = multiply(parent, localMatrix(node, posed?.get(index)));
    for (const child of node.children ?? []) walk(child, world[index]);
  };

  // A document with no scene is not meant to be drawn, but a pack exported
  // oddly is worth reading anyway rather than refusing over a missing index.
  const roots = json.scenes?.[json.scene ?? 0]?.nodes
    ?? (json.scenes?.length ? json.scenes.flatMap((s) => s.nodes ?? []) : null)
    ?? nodes.map((_, i) => i);
  for (const root of roots) walk(root, IDENTITY);
  return world;
}

/**
 * One matrix per joint, taking a vertex out of its rest shape and into the pose.
 *
 * The inverse bind matrix undoes where the joint rests; the joint's posed place
 * then puts the vertex where the pose wants it.
 */
function jointMatrices(json, buffers, index, world, name) {
  const skin = json.skins[index];
  const bind = skin.inverseBindMatrices !== undefined
    ? readAccessor(json, buffers, skin.inverseBindMatrices, `${name}: skin ${index}`).values
    : null;

  return (skin.joints ?? []).map((joint, j) => {
    const rest = bind ? Float32Array.from(bind.subarray(j * 16, j * 16 + 16)) : IDENTITY;
    return multiply(world[joint] ?? IDENTITY, rest);
  });
}

/**
 * One vertex's share of the joints that move it.
 *
 * Linear blend skinning: add the joint matrices in the proportions the artist
 * painted and use the result as this vertex's own transform. It is the standard
 * method, and it is the one every tool that wrote these files assumed.
 */
function blend({ joints, weights, matrices }, vertex) {
  const out = new Float32Array(16);
  let total = 0;
  for (let i = 0; i < 4; i++) {
    const weight = weights.values[vertex * weights.components + i];
    if (!(weight > 0)) continue;
    const matrix = matrices[joints.values[vertex * joints.components + i]];
    if (!matrix) continue;
    for (let k = 0; k < 16; k++) out[k] += matrix[k] * weight;
    total += weight;
  }
  // Weights are meant to sum to one and usually do. Exporters do get this
  // wrong, and normalising is what keeps the model its own size when they have.
  if (total > 0 && Math.abs(total - 1) > 1e-4) {
    for (let k = 0; k < 16; k++) out[k] /= total;
  }
  return total > 0 ? out : IDENTITY;
}
