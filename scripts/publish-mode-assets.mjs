// Publish the recorded demo screenshots + videos into the landing site.
//
// Source : demo/screenshots/<NN-mode>/<name>.png  and  demo/videos/<NN-mode>.mp4
// Target : public/landing/modes-assets/<mode>/01.png..NN.png + video.mp4
//
// The PNG order is given explicitly per mode so that, e.g., the manual-scroll
// frames stay in the right sequence (alphabetical sort would mis-order them).
// The video is already MP4 from the recorder, so we just copy it.
//
// Run with: node scripts/publish-mode-assets.mjs

import { copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve('.');
const SRC = path.join(ROOT, 'demo');
const DEST = path.join(ROOT, 'public/landing/modes-assets');

// demo-folder -> { mode key, ordered screenshot filenames }
const MODES = [
  {
    demo: '01-region', mode: 'region',
    shots: ['01-page-loaded', '02-toolbar', '03-highlight', '04-captured', '05-result'],
  },
  {
    demo: '02-element', mode: 'element',
    shots: ['01-page-loaded', '02-toolbar', '03-highlight', '04-captured', '05-result'],
  },
  {
    demo: '03-focus', mode: 'focus',
    shots: ['01-page-loaded', '02-toolbar', '03-highlight', '04-captured', '05-result'],
  },
  {
    demo: '04-fullPage', mode: 'fullPage',
    shots: ['01-page-loaded', '02-toolbar-root-highlight', '03-captured', '05-result'],
  },
  {
    demo: '05-custom', mode: 'custom',
    shots: [
      '01-page-loaded', '02-toolbar', '03-highlight', '04-manual-mode',
      '05-scroll-1', '05-scroll-2', '05-scroll-3', '06-captured', '05-result',
    ],
  },
  {
    demo: '06-allScrollable', mode: 'allScrollable',
    shots: ['01-page-loaded', '02-multi-highlight', '03-after-deselect', '04-captured', '05-final-page'],
  },
];

function two(n) {
  return String(n).padStart(2, '0');
}

async function main() {
  await rm(DEST, { recursive: true, force: true });
  await mkdir(DEST, { recursive: true });

  for (const { demo, mode, shots } of MODES) {
    const modeDir = path.join(DEST, mode);
    await mkdir(modeDir, { recursive: true });

    for (let i = 0; i < shots.length; i += 1) {
      const from = path.join(SRC, 'screenshots', demo, `${shots[i]}.png`);
      const to = path.join(modeDir, `${two(i + 1)}.png`);
      await copyFile(from, to);
    }

    const mp4Src = path.join(SRC, 'videos', `${demo}.mp4`);
    await copyFile(mp4Src, path.join(modeDir, 'video.mp4'));

    console.log(`✓ ${mode}: ${shots.length} shots + video.mp4`);
  }
  console.log(`\nAssets published → ${path.relative(ROOT, DEST)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
