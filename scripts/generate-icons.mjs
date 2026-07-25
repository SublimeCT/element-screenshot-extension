import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const outputDirectory = process.argv[2] ?? 'public/icon';
const sizes = [16, 32, 48, 96, 128];

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type);
  const payload = Buffer.concat([typeBytes, data]);
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  payload.copy(result, 4);
  result.writeUInt32BE(crc32(payload), 8 + data.length);
  return result;
}

/** Test whether (x, y) is inside the rounded rect of size w×h with corner radius r. */
function insideRoundedRect(x, y, w, h, r) {
  // Full-width horizontal band through the middle
  if (y >= r && y < h - r) return true;
  // Full-height vertical band through the middle
  if (x >= r && x < w - r) return true;

  // Determine which corner
  let cx;
  let cy;
  if (x < r && y < r) {
    cx = r;
    cy = r;
  } else if (x >= w - r && y < r) {
    cx = w - r - 1;
    cy = r;
  } else if (x < r && y >= h - r) {
    cx = r;
    cy = h - r - 1;
  } else if (x >= w - r && y >= h - r) {
    cx = w - r - 1;
    cy = h - r - 1;
  } else {
    // Edge band — inside the rect
    return true;
  }

  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/** Render the raw RGBA pixel buffer for the brand icon at the given size. */
function renderPixels(size) {
  const pixels = Buffer.alloc(size * size * 4, 0); // start fully transparent

  const put = (x, y, color) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const index = (y * size + x) * 4;
    pixels[index] = color[0];
    pixels[index + 1] = color[1];
    pixels[index + 2] = color[2];
    pixels[index + 3] = color[3];
  };

  // Colors matching the prototype brand icon
  const bg = [255, 255, 255, 255]; // --surface: white
  const bg2 = [247, 247, 245, 255]; // --surface-2: warm off-white
  const borderColor = [232, 230, 226, 255]; // --border
  const accent = [232, 93, 44, 255]; // --accent: oklch(64% 0.19 38)

  // Rounded corner radius (matching 12px radius at 48px container → 25%)
  const radius = Math.max(1, Math.round(size * 0.25));

  // Fill background with subtle gradient + rounded corners
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!insideRoundedRect(x, y, size, size, radius)) continue; // transparent outside

      // Subtle diagonal gradient: white at top-left → warm off-white at bottom-right
      const t = (x + y) / (2 * size - 2);
      const color = [
        Math.round(bg[0] + (bg2[0] - bg[0]) * t),
        Math.round(bg[1] + (bg2[1] - bg[1]) * t),
        Math.round(bg[2] + (bg2[2] - bg[2]) * t),
        255,
      ];
      put(x, y, color);
    }
  }

  // 1px border on the rounded rect
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!insideRoundedRect(x, y, size, size, radius)) continue;
      // A pixel is "on the border" if any of its 4 neighbours is outside
      const neighbours = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ];
      if (neighbours.some(([nx, ny]) => !insideRoundedRect(nx, ny, size, size, radius))) {
        put(x, y, borderColor);
      }
    }
  }

  // Corner brackets — L-shaped paths
  const inset = Math.max(2, Math.round(size * 0.2)); // ~20% from edge
  const arm = Math.max(2, Math.round(size * 0.24)); // arm length
  const thickness = Math.max(1, Math.round(size * 0.075)); // stroke width (~3px at 48)

  // Each bracket = horizontal stroke + vertical stroke meeting at the corner
  // The "outer" corner (closest to icon corner) gets thickness applied inward
  for (let t = 0; t < thickness; t += 1) {
    for (let a = 0; a < arm; a += 1) {
      // Top-left: h-stroke going right from inset, v-stroke going down from inset
      put(inset + a, inset + t, accent); // horizontal
      put(inset + t, inset + a, accent); // vertical

      // Top-right: h-stroke going left, v-stroke going down
      put(size - inset - 1 - a, inset + t, accent);
      put(size - inset - 1 - t, inset + a, accent);

      // Bottom-left: h-stroke going right, v-stroke going up
      put(inset + a, size - inset - 1 - t, accent);
      put(inset + t, size - inset - 1 - a, accent);

      // Bottom-right: h-stroke going left, v-stroke going up
      put(size - inset - 1 - a, size - inset - 1 - t, accent);
      put(size - inset - 1 - t, size - inset - 1 - a, accent);
    }
  }

  return pixels;
}

/** Encode an RGBA pixel buffer + size as a PNG Buffer. */
function encodePng(size, pixels) {
  // Assemble PNG
  const scanlines = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    scanlines[y * (size * 4 + 1)] = 0; // filter byte
    pixels.copy(scanlines, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(scanlines)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function png(size) {
  return encodePng(size, renderPixels(size));
}

/**
 * Build a multi-resolution .ico from a list of {size, pixels} entries.
 * Embeds each image as PNG (supported by all modern browsers/OSes), which
 * preserves the alpha channel without a separate AND-mask.
 */
function ico(entries) {
  const count = entries.length;
  const dirSize = 6 + count * 16;
  const images = entries.map((e) => encodePng(e.size, e.pixels));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = icon
  header.writeUInt16LE(count, 4);

  let offset = dirSize;
  const dirEntries = [];
  for (let i = 0; i < count; i += 1) {
    const size = entries[i].size;
    const data = images[i];
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size; // width (0 = 256)
    entry[1] = size >= 256 ? 0 : size; // height
    entry[2] = 0; // palette
    entry[3] = 0; // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8); // image size
    entry.writeUInt32LE(offset, 12); // image offset
    dirEntries.push(entry);
    offset += data.length;
  }
  return Buffer.concat([header, ...dirEntries, ...images]);
}

const command = process.argv[2];

if (command === 'favicons') {
  // Landing-page favicon assets: multi-size ICO + Apple Touch PNG (180)
  const outDir = process.argv[3] ?? 'public/landing';
  await mkdir(outDir, { recursive: true });

  const icoSizes = [16, 32, 48];
  const entries = icoSizes.map((size) => ({ size, pixels: renderPixels(size) }));
  const icoBuffer = ico(entries);
  await writeFile(`${outDir}/favicon.ico`, icoBuffer);
  console.log(`  ✓ ${outDir}/favicon.ico (16/32/48)`);

  // Apple Touch Icon — 180×180, opaque background (iOS dislikes transparency)
  const touchSize = 180;
  const touchPixels = renderPixels(touchSize);
  await writeFile(`${outDir}/apple-touch-icon.png`, encodePng(touchSize, touchPixels));
  console.log(`  ✓ ${outDir}/apple-touch-icon.png (180×180)`);

  // Standalone 32×32 favicon PNG
  await writeFile(`${outDir}/favicon-32x32.png`, png(32));
  console.log(`  ✓ ${outDir}/favicon-32x32.png (32×32)`);
  console.log('Done — favicons generated.');
} else {
  // Default: extension toolbar icons
  const outputDirectory = command ?? 'public/icon';
  const sizes = [16, 32, 48, 96, 128];
  await mkdir(outputDirectory, { recursive: true });
  for (const size of sizes) {
    const filePath = `${outputDirectory}/${size}.png`;
    await writeFile(filePath, png(size));
    console.log(`  ✓ ${filePath}`);
  }
  console.log('Done — icons generated.');
}
