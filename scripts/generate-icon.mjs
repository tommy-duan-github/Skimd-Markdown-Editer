import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '..', 'assets', 'skimd.ico');

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mixColor(bg, fg, alpha) {
  const k = clamp(alpha, 0, 1);
  return [
    Math.round(lerp(bg[0], fg[0], k)),
    Math.round(lerp(bg[1], fg[1], k)),
    Math.round(lerp(bg[2], fg[2], k)),
    Math.round(lerp(bg[3] ?? 255, fg[3] ?? 255, k))
  ];
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / lenSq, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Signed distance to axis-aligned rounded rectangle centered at (cx, cy)
function sdRoundedBox(px, py, cx, cy, halfW, halfH, r) {
  const qx = Math.abs(px - cx) - (halfW - r);
  const qy = Math.abs(py - cy) - (halfH - r);
  const out = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return out + inside - r;
}

// Distance to upper S-arc stroke centerline: M 184 64 H 96 A 23 23 0 0 0 73 87 A 23 23 0 0 0 96 110 H 152
function distUpperArc(x, y) {
  const dTop = distToSegment(x, y, 96, 64, 184, 64);
  const dBot = distToSegment(x, y, 96, 110, 152, 110);
  // Left semicircle centered at (96, 87), radius 23, x <= 96
  let dSemi;
  if (x <= 96) {
    dSemi = Math.abs(Math.hypot(x - 96, y - 87) - 23);
  } else {
    dSemi = Math.min(Math.hypot(x - 96, y - 64), Math.hypot(x - 96, y - 110));
  }
  return Math.min(dTop, dBot, dSemi);
}

// Distance to lower S-arc stroke centerline: M 72 192 H 160 A 23 23 0 0 0 183 169 A 23 23 0 0 0 160 146 H 104
function distLowerArc(x, y) {
  const dBot = distToSegment(x, y, 72, 192, 160, 192);
  const dTop = distToSegment(x, y, 104, 146, 160, 146);
  // Right semicircle centered at (160, 169), radius 23, x >= 160
  let dSemi;
  if (x >= 160) {
    dSemi = Math.abs(Math.hypot(x - 160, y - 169) - 23);
  } else {
    dSemi = Math.min(Math.hypot(x - 160, y - 192), Math.hypot(x - 160, y - 146));
  }
  return Math.min(dBot, dTop, dSemi);
}

const BADGE_BG = [24, 24, 24, 255];
const WHITE = [255, 255, 255, 255];
const SILVER = [168, 168, 168, 255];

function sampleIcon(nx, ny) {
  const x = nx * 256;
  const y = ny * 256;

  // Flat rounded square (x=16..240, y=16..240, rx=56)
  const badgeDist = sdRoundedBox(x, y, 128, 128, 112, 112, 56);
  if (badgeDist > 1.2) {
    return [0, 0, 0, 0];
  }
  const badgeAlpha = clamp(1 - badgeDist / 1.2, 0, 1);

  let col = [...BADGE_BG];

  const halfStroke = 13;
  const dUp = distUpperArc(x, y) - halfStroke;
  if (dUp < 1.0) {
    const a = clamp(1 - dUp / 1.0, 0, 1);
    col = mixColor(col, WHITE, a);
  }

  const dLow = distLowerArc(x, y) - halfStroke;
  if (dLow < 1.0) {
    const a = clamp(1 - dLow / 1.0, 0, 1);
    col = mixColor(col, SILVER, a);
  }

  col[3] = Math.round(255 * badgeAlpha);
  return col;
}

function renderRgba(size) {
  const ss = size <= 32 ? 6 : 4;
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const nx = (px + (sx + 0.5) / ss) / size;
          const ny = (py + (sy + 0.5) / ss) / size;
          const c = sampleIcon(nx, ny);
          const alpha = c[3] / 255;
          r += c[0] * alpha;
          g += c[1] * alpha;
          b += c[2] * alpha;
          a += c[3];
        }
      }
      const samples = ss * ss;
      const outA = a / samples;
      const idx = (py * size + px) * 4;
      if (outA > 0.001) {
        const norm = outA / 255;
        buf[idx] = clamp(Math.round(r / samples / norm), 0, 255);
        buf[idx + 1] = clamp(Math.round(g / samples / norm), 0, 255);
        buf[idx + 2] = clamp(Math.round(b / samples / norm), 0, 255);
        buf[idx + 3] = clamp(Math.round(outA), 0, 255);
      }
    }
  }
  return buf;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(size, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function buildIco(sizes) {
  const images = sizes.map((size) => ({
    size,
    png: encodePng(size, renderRgba(size))
  }));

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const dirEntries = Buffer.alloc(images.length * 16);
  let offset = 6 + dirEntries.length;

  images.forEach((img, idx) => {
    const entryOffset = idx * 16;
    dirEntries[entryOffset] = img.size >= 256 ? 0 : img.size;
    dirEntries[entryOffset + 1] = img.size >= 256 ? 0 : img.size;
    dirEntries[entryOffset + 2] = 0;
    dirEntries[entryOffset + 3] = 0;
    dirEntries.writeUInt16LE(1, entryOffset + 4);
    dirEntries.writeUInt16LE(32, entryOffset + 6);
    dirEntries.writeUInt32LE(img.png.length, entryOffset + 8);
    dirEntries.writeUInt32LE(offset, entryOffset + 12);
    offset += img.png.length;
  });

  return Buffer.concat([header, dirEntries, ...images.map((i) => i.png)]);
}

mkdirSync(dirname(outPath), { recursive: true });
const icoBuffer = buildIco([16, 32, 48, 256]);
writeFileSync(outPath, icoBuffer);
console.log(`Generated ${outPath} (${icoBuffer.length} bytes)`);
