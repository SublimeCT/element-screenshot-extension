// Remove the recording scratch directory.
//
// `demo/` is intermediate: it holds the raw recorder output. The published,
// deployed copy lives in public/landing/modes-assets/ (produced by
// publish-mode-assets.mjs). `demo/` is fully regenerable via `pnpm record`,
// which also wipes it at the start of every run.
//
// Run with:  node scripts/clean.mjs   (or `pnpm clean`)

import { rm } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve('.');
const targets = ['demo'];

for (const rel of targets) {
  await rm(path.join(ROOT, rel), { recursive: true, force: true });
  console.log(`removed ${rel}/`);
}
