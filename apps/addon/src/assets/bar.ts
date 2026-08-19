import { deflateSync } from 'node:zlib';

/**
 * A solid-color PNG bar, generated in-process.
 *
 * Cards v2 has no background color, no border, no box, and no control over the
 * hairline Gmail draws between sections — that rule is fixed weight, fixed
 * color, fixed inset. The one surface that accepts an arbitrary appearance is
 * the IMAGE widget, which renders any URL we serve and scales it to the column
 * width. So a colored band is a picture of a colored band.
 *
 * This is deliberately not the chart rasterizer that was deleted in ADR-004.
 * That encoder failed because it drew DATA — ten points on a three-level axis,
 * rendered at 334x100 and upscaled to a blur on HiDPI, through an
 * unauthenticated public endpoint that leaked per-customer sentiment sequences
 * in its query string. A solid rectangle has none of those properties: it
 * carries no information, scales without artifacts at any density because every
 * pixel is identical, and its URL says nothing except a color.
 *
 * Wide and short — 600x8 — because Cards v2 fits an image to the column width
 * and keeps its aspect ratio. A 1x1 image would stretch to a 300px-tall square
 * of color; this lands as a band a few pixels high.
 */

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** `rrggbb` (no `#`) to a PNG of that color. Invalid input yields grey. */
export function solidBarPng(hex: string, width = 600, height = 8): Buffer {
  const m = /^[0-9a-fA-F]{6}$/.test(hex) ? hex : '9aa0a6';
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);

  // Raw scanlines: one filter byte (0 = None) then RGB per pixel.
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x += 1) {
    row[1 + x * 3] = r;
    row[2 + x * 3] = g;
    row[3 + x * 3] = b;
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  // 10..12 = compression, filter, interlace — all 0.

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
