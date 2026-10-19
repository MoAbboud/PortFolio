// A run in a link: the packed run log (sim/runlog.js), deflated, in base64url, after #run= in
// the address. The part after # never leaves the browser - no server ever sees it - and the
// page that opens it re-drives the inputs to find the time and the score for itself.
//
// Uses the browser's CompressionStream, which Node has too, so the tests check the round trip.

import { pack, unpack } from '../sim/runlog.js';

const PREFIX = '#run=';

async function through(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

function toBase64url(bytes) {
  let text = '';
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(text) {
  const plain = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(plain, (c) => c.charCodeAt(0));
}

export async function encodeRun(log) {
  return toBase64url(await through(pack(log), new CompressionStream('deflate-raw')));
}

export async function decodeRun(code) {
  return unpack(await through(fromBase64url(code), new DecompressionStream('deflate-raw')));
}

// The run in an address's fragment, or null if there is none. Throws on one that is broken.
export async function runFromHash(hash) {
  if (!hash.startsWith(PREFIX)) return null;
  return decodeRun(hash.slice(PREFIX.length));
}

export async function linkFor(log, base) {
  return `${base}${PREFIX}${await encodeRun(log)}`;
}
