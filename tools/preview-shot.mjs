#!/usr/bin/env node
/**
 * Screenshot a dev-server page headlessly — the iteration loop for visual
 * work (the dancer catwalk, the club) without a headset:
 *
 *   npm run dev                                       # in another terminal
 *   node tools/preview-shot.mjs                       # → shots/preview.png
 *   node tools/preview-shot.mjs "/avatar-preview.html?still=1&cam=close" close.png
 *   node tools/preview-shot.mjs "/?club=1&cam=bar" club-bar.png
 *
 * Uses the repo's playwright with the system chromium (falls back to the
 * PLAYWRIGHT_BROWSERS_PATH install; never downloads).
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const path = process.argv[2] ?? '/avatar-preview.html?still=1';
const out = resolve(process.argv[3] ?? 'shots/preview.png');
const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
const url = path.startsWith('http') ? path : base + path;

mkdirSync(dirname(out), { recursive: true });

async function launch() {
  try {
    return await chromium.launch();
  } catch {
    // Version-pinned browser dir missing — use the container's chromium.
    return chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  }
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(async () => {
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
});
await page.waitForTimeout(2500); // let the scene settle (decode, first frames)
await page.screenshot({ path: out });
await browser.close();

console.log(`shot: ${out}`);
const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
if (errors.length) {
  console.log('console errors:');
  for (const e of errors.slice(0, 12)) console.log('  ' + e);
  process.exitCode = 2;
} else {
  console.log('console clean.');
}
