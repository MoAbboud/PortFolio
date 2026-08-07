// Reading a PNG, so a model can be painted the colours its artist chose.
//
// Pure module, and the inverse of the writer in `tools/sheet.js`. It exists for
// one reason: 184 of the library's models keep their colour in a texture and
// nowhere else, so without this they are painted by guessing at a material
// name - which is why the Zombie kit's Matt came out purple.
//
// This is a decoder for the PNGs that are actually here, not a general one.
// Measured across every image the library references: 8-bit RGB and 8-bit RGBA,
// no interlacing, no palette, no 16-bit channels. Anything else is refused by
// name rather than half-read, because a texture that decodes into nonsense
// paints a model a confident wrong colour, and that is worse than the guess it
// replaced.
//
// The inflate is written out here rather than taken from the platform. Node has
// `zlib` and a browser has `DecompressionStream`, and using either would split
// this module's behaviour across two environments and make it asynchronous, for
// something that is a hundred lines and is the same everywhere.

// --- inflate ----------------------------------------------------------------
//
// RFC 1951, decoded a bit at a time in the manner of Mark Adler's `puff`.
// Chosen for being obviously correct rather than for being quick: a Huffman
// table built for speed is the kind of code that is wrong in one rare branch,
// and this runs once per image at import and never during a take.

const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
  35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
  3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
  257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
  7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];
// The order the code lengths of the code-length alphabet are written in, which
// puts the ones most likely to be zero last so they can be left out entirely.
const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** A canonical Huffman code, as counts per length and symbols in order. */
function huffman(lengths, n) {
  const counts = new Int32Array(16);
  for (let i = 0; i < n; i++) counts[lengths[i]]++;
  counts[0] = 0;
  const offsets = new Int32Array(16);
  for (let len = 1; len < 16; len++) offsets[len] = offsets[len - 1] + counts[len - 1];
  const symbols = new Int32Array(n);
  for (let i = 0; i < n; i++) if (lengths[i]) symbols[offsets[lengths[i]]++] = i;
  return { counts, symbols };
}

function inflate(bytes, into) {
  let at = 0;           // byte position
  let hold = 0;         // bits read but not yet used
  let held = 0;         // how many of them there are
  let out = 0;          // where the next output byte goes

  const need = (count) => {
    while (held < count) {
      if (at >= bytes.length) throw new Error('the compressed data ends in the middle of a symbol');
      hold |= bytes[at++] << held;
      held += 8;
    }
    const value = hold & ((1 << count) - 1);
    hold >>>= count;
    held -= count;
    return value;
  };

  // Codes are read most-significant-bit-first within a symbol, which is the
  // opposite way round from everything else in the format.
  const decode = (code) => {
    let value = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len < 16; len++) {
      value |= need(1);
      const count = code.counts[len];
      if (value - first < count) return code.symbols[index + (value - first)];
      index += count;
      first = (first + count) << 1;
      value <<= 1;
    }
    throw new Error('a Huffman code in the image is not in the table');
  };

  let fixedLit = null;
  let fixedDist = null;

  for (;;) {
    const last = need(1);
    const type = need(2);

    if (type === 0) {
      // A stored block starts on a byte boundary, so whatever is left of the
      // current byte is discarded.
      hold = 0;
      held = 0;
      if (at + 4 > bytes.length) throw new Error('a stored block has no length');
      const len = bytes[at] | (bytes[at + 1] << 8);
      at += 4;                                    // the length, then its complement
      if (at + len > bytes.length) throw new Error('a stored block runs past the end of the data');
      into.set(bytes.subarray(at, at + len), out);
      at += len;
      out += len;
    } else if (type === 1 || type === 2) {
      let lit;
      let dist;
      if (type === 1) {
        if (!fixedLit) {
          // The fixed tables are written into the format rather than into the file.
          const litLengths = new Uint8Array(288);
          litLengths.fill(8, 0, 144);
          litLengths.fill(9, 144, 256);
          litLengths.fill(7, 256, 280);
          litLengths.fill(8, 280, 288);
          fixedLit = huffman(litLengths, 288);
          fixedDist = huffman(new Uint8Array(30).fill(5), 30);
        }
        lit = fixedLit;
        dist = fixedDist;
      } else {
        const literals = need(5) + 257;
        const distances = need(5) + 1;
        const codes = need(4) + 4;
        const codeLengths = new Uint8Array(19);
        for (let i = 0; i < codes; i++) codeLengths[ORDER[i]] = need(3);
        const lengthCode = huffman(codeLengths, 19);

        const lengths = new Uint8Array(literals + distances);
        let i = 0;
        while (i < lengths.length) {
          const symbol = decode(lengthCode);
          if (symbol < 16) {
            lengths[i++] = symbol;
          } else {
            let repeat;
            let value = 0;
            if (symbol === 16) {
              if (i === 0) throw new Error('the image repeats a code length before stating one');
              value = lengths[i - 1];
              repeat = 3 + need(2);
            } else if (symbol === 17) {
              repeat = 3 + need(3);
            } else {
              repeat = 11 + need(7);
            }
            if (i + repeat > lengths.length) throw new Error('a run of code lengths runs past the end');
            lengths.fill(value, i, i + repeat);
            i += repeat;
          }
        }
        lit = huffman(lengths.subarray(0, literals), literals);
        dist = huffman(lengths.subarray(literals), distances);
      }

      for (;;) {
        const symbol = decode(lit);
        if (symbol === 256) break;
        if (symbol < 256) {
          into[out++] = symbol;
        } else {
          const n = symbol - 257;
          if (n >= LENGTH_BASE.length) throw new Error('the image asks for a length that does not exist');
          const length = LENGTH_BASE[n] + need(LENGTH_EXTRA[n]);
          const d = decode(dist);
          if (d >= DIST_BASE.length) throw new Error('the image asks for a distance that does not exist');
          const back = DIST_BASE[d] + need(DIST_EXTRA[d]);
          if (back > out) throw new Error('the image refers to data from before the start');
          // Copied one byte at a time on purpose: a run may overlap itself,
          // which is how the format writes a repeating pattern.
          let from = out - back;
          for (let k = 0; k < length; k++) into[out++] = into[from++];
        }
      }
    } else {
      throw new Error('the image uses a compression block type that does not exist');
    }

    if (last) break;
  }
  return out;
}

// --- the file ---------------------------------------------------------------

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const KIND = { 0: 'greyscale', 2: 'colour', 3: 'a palette', 4: 'greyscale with alpha', 6: 'colour with alpha' };

/**
 * A PNG as straightforward RGBA pixels.
 *
 * `name` is only used in refusals, and it is worth passing: an image that
 * cannot be read is always one of hundreds in a pack, and a message that does
 * not say which one costs an afternoon.
 */
export function readPng(bytes, { name = 'image' } = {}) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data.length < 8 || SIGNATURE.some((b, i) => data[i] !== b)) {
    throw new Error(`${name} is not a PNG`);
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let header = null;
  const parts = [];
  let total = 0;
  let at = 8;

  while (at + 8 <= data.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(data[at + 4], data[at + 5], data[at + 6], data[at + 7]);
    const from = at + 8;
    if (from + length > data.length) throw new Error(`${name} ends in the middle of its ${type} chunk`);

    if (type === 'IHDR') {
      header = {
        width: view.getUint32(from),
        height: view.getUint32(from + 4),
        depth: data[from + 8],
        colour: data[from + 9],
        interlace: data[from + 12],
      };
    } else if (type === 'IDAT') {
      // The pixels may be split across any number of IDAT chunks, and the
      // compressed stream continues across the joins rather than restarting.
      parts.push(data.subarray(from, from + length));
      total += length;
    } else if (type === 'IEND') {
      break;
    }
    at = from + length + 4;             // the chunk, then its checksum
  }

  if (!header) throw new Error(`${name} has no header chunk`);
  const { width, height, depth, colour, interlace } = header;
  if (!(width > 0 && height > 0)) throw new Error(`${name} has no size`);

  // Refused rather than approximated. Every one of these is readable in
  // principle and none of them is in this library, so writing the code would be
  // writing something nothing exercises.
  if (depth !== 8) throw new Error(`${name} is ${depth}-bit, and only 8-bit channels are read`);
  if (colour !== 2 && colour !== 6) {
    throw new Error(`${name} is ${KIND[colour] ?? `colour type ${colour}`}, and only colour and colour with alpha are read`);
  }
  if (interlace) throw new Error(`${name} is interlaced, which is not read`);

  const channels = CHANNELS[colour];
  const stride = width * channels;

  let compressed;
  if (parts.length === 1) {
    compressed = parts[0];
  } else {
    compressed = new Uint8Array(total);
    let put = 0;
    for (const part of parts) { compressed.set(part, put); put += part.length; }
  }
  if (!compressed.length) throw new Error(`${name} holds no pixel data`);

  // A zlib stream, so two bytes of header and four of checksum wrap the
  // deflate data. The checksum is not verified: the size below is a stronger
  // statement about the result and costs nothing.
  const raw = new Uint8Array(height * (stride + 1));
  const wrote = inflate(compressed.subarray(2), raw);
  if (wrote !== raw.length) {
    throw new Error(`${name} decoded to ${wrote} bytes where its size says ${raw.length}`);
  }

  return { width, height, pixels: unfilter(raw, width, height, channels), name };
}

/**
 * Undo the per-row filters, and hand back RGBA.
 *
 * Each row states how it was written: as itself, or as the difference from the
 * pixel to its left, the row above, the average of those two, or Paeth's
 * predictor. Every one of them refers to the row above *after* it has been
 * undone, so this cannot be done out of order or in parallel.
 */
function unfilter(raw, width, height, channels) {
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const line = new Uint8Array(stride);
  const above = new Uint8Array(stride);

  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    const filter = raw[start];
    const row = raw.subarray(start + 1, start + 1 + stride);

    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? line[i - channels] : 0;
      const up = above[i];
      const upLeft = i >= channels ? above[i - channels] : 0;
      let value = row[i];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) value += paeth(left, up, upLeft);
      else if (filter !== 0) throw new Error(`row ${y} uses filter ${filter}, which does not exist`);
      line[i] = value & 0xff;
    }

    const put = y * width * 4;
    if (channels === 4) {
      out.set(line, put);
    } else {
      for (let x = 0; x < width; x++) {
        out[put + x * 4] = line[x * 3];
        out[put + x * 4 + 1] = line[x * 3 + 1];
        out[put + x * 4 + 2] = line[x * 3 + 2];
        out[put + x * 4 + 3] = 255;
      }
    }
    above.set(line);
  }
  return out;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * The same picture, smaller, by averaging square blocks of it.
 *
 * A pack's textures are up to 2048 square, and holding a dozen of those is
 * forty megabytes of pixels for a question - what colour is this triangle -
 * that a much smaller picture answers identically. Averaging rather than
 * dropping pixels is what makes that true: the average of a block is exactly
 * the representative colour a face wants, where a sampled pixel can land on a
 * mortar line and paint a whole brick wall grey.
 *
 * `most` is a limit rather than a size, so an atlas that is already small is
 * returned untouched. That matters: an atlas packs unrelated colours side by
 * side, and shrinking one bleeds a neighbour's colour across an island edge.
 */
export function reduce(image, most = 512) {
  const { width, height } = image;
  const longest = Math.max(width, height);
  if (!(most > 0) || longest <= most) return image;

  const factor = Math.ceil(longest / most);
  const w = Math.max(1, Math.floor(width / factor));
  const h = Math.max(1, Math.floor(height / factor));
  const pixels = new Uint8Array(w * h * 4);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      const toY = Math.min(height, (y + 1) * factor);
      const toX = Math.min(width, (x + 1) * factor);
      for (let sy = y * factor; sy < toY; sy++) {
        for (let sx = x * factor; sx < toX; sx++) {
          const p = (sy * width + sx) * 4;
          r += image.pixels[p];
          g += image.pixels[p + 1];
          b += image.pixels[p + 2];
          a += image.pixels[p + 3];
          n++;
        }
      }
      const put = (y * w + x) * 4;
      pixels[put] = Math.round(r / n);
      pixels[put + 1] = Math.round(g / n);
      pixels[put + 2] = Math.round(b / n);
      pixels[put + 3] = Math.round(a / n);
    }
  }
  return { width: w, height: h, pixels, name: image.name };
}
