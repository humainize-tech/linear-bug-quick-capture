/**
 * Generate the extension's PNG icons with no external dependencies.
 * Usage: node scripts/generate-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'icons');
const SIZES = [16, 32, 48, 128];

const BG = [94, 106, 210, 255]; // #5e6ad2
const FG = [255, 255, 255, 255];

/** @param {number} size */
function pixels(size) {
  const radius = size * 0.22;
  const bar = Math.max(1, Math.round(size * 0.08));
  const inset = Math.round(size * 0.22);
  const mid = size / 2;
  const rows = [];

  for (let y = 0; y < size; y++) {
    const row = [0]; // PNG filter type 0 for each scanline
    for (let x = 0; x < size; x++) {
      const inRounded =
        insideRoundedRect(x + 0.5, y + 0.5, size, radius);
      if (!inRounded) {
        row.push(0, 0, 0, 0);
        continue;
      }
      const onVertical =
        Math.abs(x + 0.5 - mid) < bar / 2 && y >= inset && y <= size - inset;
      const onHorizontal =
        Math.abs(y + 0.5 - mid) < bar / 2 && x >= inset && x <= size - inset;
      row.push(...(onVertical || onHorizontal ? FG : BG));
    }
    rows.push(Buffer.from(row));
  }
  return Buffer.concat(rows);
}

function insideRoundedRect(x, y, size, r) {
  // Clamping to the inner rect makes dx/dy zero everywhere except the four
  // corner zones, so this single distance test covers the whole shape.
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/** @param {string} type @param {Buffer} data */
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

let TABLE = null;
function crc32(buf) {
  if (!TABLE) {
    TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABLE[n] = c;
    }
  }
  let c = -1;
  for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

/** @param {number} size */
function png(size) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(pixels(size))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const size of SIZES) {
  writeFileSync(join(OUT, `icon-${size}.png`), png(size));
  console.log(`wrote icon-${size}.png`);
}
