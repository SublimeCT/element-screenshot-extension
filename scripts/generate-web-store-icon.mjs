// Generate the 128×128 Chrome Web Store "extension" icon.
//
// Per the Chrome Web Store spec, the ACTUAL icon content is 96×96, centered,
// with 16px of transparent padding on EVERY side (16 + 96 + 16 = 128). The
// visible mark is the same brand icon as the toolbar icon (icon.svg /
// generate-icons.mjs): a white rounded tile with four orange corner brackets.
// Rendered 4× supersampled for crisp edges, then downsampled to 128.
//
// Run with: node scripts/generate-web-store-icon.mjs [output-path]

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

const OUTPUT_PATH = process.argv[2] ?? 'store-assets/chrome-web-store-128.png';
const SIZE = 128;
const SCALE = 4;
const RENDER_SIZE = SIZE * SCALE;

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function encodePng(width, height, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width * 4 + 1);
    scanlines[rowOffset] = 0;
    pixels.copy(scanlines, rowOffset + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(scanlines)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const pixels = Buffer.alloc(RENDER_SIZE * RENDER_SIZE * 4, 0);

function setPixel(x, y, color) {
  if (x < 0 || y < 0 || x >= RENDER_SIZE || y >= RENDER_SIZE) return;
  const offset = (y * RENDER_SIZE + x) * 4;
  pixels[offset] = color[0];
  pixels[offset + 1] = color[1];
  pixels[offset + 2] = color[2];
  pixels[offset + 3] = color[3] ?? 255;
}

function insideRoundedRect(px, py, x, y, width, height, radius) {
  const nearestX = Math.max(x + radius, Math.min(px, x + width - radius));
  const nearestY = Math.max(y + radius, Math.min(py, y + height - radius));
  const dx = px - nearestX;
  const dy = py - nearestY;
  return dx * dx + dy * dy <= radius * radius;
}

function fillRoundedRect(x, y, width, height, radius, colorAt) {
  const scaled = [x, y, width, height, radius].map((value) => value * SCALE);
  const [sx, sy, sw, sh, sr] = scaled;
  for (let py = sy; py < sy + sh; py += 1) {
    for (let px = sx; px < sx + sw; px += 1) {
      if (!insideRoundedRect(px + 0.5, py + 0.5, sx, sy, sw, sh, sr)) continue;
      setPixel(px, py, colorAt((px - sx) / sw, (py - sy) / sh));
    }
  }
}

function fillRect(x, y, width, height, color) {
  for (let py = y * SCALE; py < (y + height) * SCALE; py += 1) {
    for (let px = x * SCALE; px < (x + width) * SCALE; px += 1) {
      setPixel(px, py, color);
    }
  }
}

function fillCircle(cx, cy, radius, color) {
  const scx = cx * SCALE;
  const scy = cy * SCALE;
  const sr = radius * SCALE;
  for (let py = Math.floor(scy - sr); py < Math.ceil(scy + sr); py += 1) {
    for (let px = Math.floor(scx - sr); px < Math.ceil(scx + sr); px += 1) {
      const dx = px + 0.5 - scx;
      const dy = py + 0.5 - scy;
      if (dx * dx + dy * dy <= sr * sr) setPixel(px, py, color);
    }
  }
}

// ---- Brand mark (matches icon.svg / generate-icons.mjs) ----
// Store layout: 96×96 icon centered in the 128 canvas with 16px transparent
// padding on every side. Nothing may touch the canvas edge.
const PAD = 16;
const ICON = 96;

const white = [255, 255, 255, 255];
const offWhite = [247, 247, 245, 255];
const borderColor = [232, 230, 226, 255];
const accent = [232, 93, 44, 255]; // #E85D2C

// Brand-mark geometry from the 96px icon size — same ratios as generate-icons.mjs,
// so it matches the toolbar icon exactly, just scaled down.
const radius = Math.round(ICON * 0.25);              // 24
const inset = Math.round(ICON * 0.2);                // 19
const arm = Math.round(ICON * 0.24);                 // 23
const thick = Math.max(2, Math.round(ICON * 0.075)); // 7

// Rounded tile: 1px border ring, then a diagonal white→off-white gradient fill.
fillRoundedRect(PAD, PAD, ICON, ICON, radius, () => borderColor);
fillRoundedRect(PAD + 1, PAD + 1, ICON - 2, ICON - 2, radius - 1, (nx, ny) => {
  const t = (nx + ny) / 2;
  return [
    Math.round(white[0] + (offWhite[0] - white[0]) * t),
    Math.round(white[1] + (offWhite[1] - white[1]) * t),
    Math.round(white[2] + (offWhite[2] - white[2]) * t),
    255,
  ];
});

// Four orange corner brackets (L-shapes) inside the icon box, with rounded caps.
const bx0 = PAD, by0 = PAD, bx1 = PAD + ICON, by1 = PAD + ICON;
for (const [cx, cy, hdir, vdir] of [
  [bx0 + inset, by0 + inset, 1, 1],
  [bx1 - inset, by0 + inset, -1, 1],
  [bx0 + inset, by1 - inset, 1, -1],
  [bx1 - inset, by1 - inset, -1, -1],
]) {
  const hx = hdir > 0 ? cx : cx - arm;
  fillRect(hx, cy - thick / 2, arm, thick, accent);
  const vy = vdir > 0 ? cy : cy - arm;
  fillRect(cx - thick / 2, vy, thick, arm, accent);
  fillCircle(cx, cy, thick / 2, accent);
}

// Downsample the supersampled buffer to the final 128×128.
const output = Buffer.alloc(SIZE * SIZE * 4, 0);
for (let y = 0; y < SIZE; y += 1) {
  for (let x = 0; x < SIZE; x += 1) {
    const sums = [0, 0, 0, 0];
    for (let sy = 0; sy < SCALE; sy += 1) {
      for (let sx = 0; sx < SCALE; sx += 1) {
        const sourceOffset = (((y * SCALE + sy) * RENDER_SIZE) + x * SCALE + sx) * 4;
        for (let channel = 0; channel < 4; channel += 1) {
          sums[channel] += pixels[sourceOffset + channel];
        }
      }
    }
    const targetOffset = (y * SIZE + x) * 4;
    for (let channel = 0; channel < 4; channel += 1) {
      output[targetOffset + channel] = Math.round(sums[channel] / (SCALE * SCALE));
    }
  }
}

await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, encodePng(SIZE, SIZE, output));
console.log(`Generated ${OUTPUT_PATH} (brand mark, white tile + orange brackets)`);
