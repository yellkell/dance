#!/usr/bin/env node
/**
 * Walk the club headlessly and photograph it — the club's fixed
 * review views, captured through the real app (IWER emulated XR):
 *
 *   npm run dev        # terminal 1
 *   npm run server     # terminal 2 (the relay — the club needs a room)
 *   node tools/club-capture.mjs [outDir]
 *
 * Shots: the foyer (menu place), then a hosted room's club floor (social
 * place) from the spawn, the bar, the booths, the terrace, the still room,
 * and under the chandelier. Uses fake-media flags so the voice path runs
 * without a real microphone.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const out = resolve(process.argv[2] ?? 'shots');
const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
mkdirSync(out, { recursive: true });

async function launch() {
  const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];
  try {
    return await chromium.launch({ args });
  } catch {
    return chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args });
  }
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()} — ${r.failure()?.errorText}`));

await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => page.goto(base));
await page.waitForTimeout(1200);

// Through the front door: the landing button starts the emulated XR session.
await page.click('#enter-vr');
await page.waitForFunction(() => document.body.classList.contains('app-entered'), { timeout: 15000 });
await page.waitForTimeout(2200); // let textures, fog and the first frames settle

const shot = async (name) => {
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`  ${name}.png`);
};

const rig = (x, z, yaw, y = 0) => page.evaluate(([px, pz, pyaw, py]) => window.__gdr.rig(px, pz, pyaw, py), [x, z, yaw, y]);

// ── the FOYER (menu place — a piece of the void) ─────────────────────────
console.log('foyer:');
await rig(0, 0.6, 0);
await shot('foyer-desk');
await rig(-1.6, 1.8, 0.75);
await shot('foyer-void-wide');

// ── host a room → the portal opens on the CLUB (social place) ────────────
console.log('club:');
await page.evaluate(() => window.__gdr.net.host());
await page.waitForFunction(() => window.__gdr.net.state.phase === 'hosting', { timeout: 8000 }).catch(() => {
  console.log('  (relay unreachable — club shots will show the foyer)');
});
await page.waitForTimeout(800);

await rig(0, 0.4, 0);
await shot('club-arrival');
await rig(0, -1.6, 0);
await shot('club-floor-to-stage');
await rig(4.6, -2.6, -1.35);
await shot('club-bar');
await rig(-5.2, -1.2, 1.9);
await shot('club-booths');
await rig(0, 4.0, 0, 0.45);
await shot('club-terrace-overview');
await rig(-6.6, -9.6, 2.6);
await shot('club-still-room');
await rig(0.4, -4.0, -0.5);
await shot('club-under-eclipse');
// THE MIRROR: from across the hall (asleep, black glass)…
await rig(6.6, -6.2, 0);
await shot('club-mirror-asleep');
// …then close enough to wake it — my own reflection in the glass.
await rig(6.6, -9.7, 0);
await page.waitForTimeout(700); // the smoke thins on approach
await shot('club-mirror-awake');

// ── THE BALL, hanging on the floor ───────────────────────────────────────
await rig(0, -0.4, 0);
await page.evaluate(() => window.__gdr.club.call([0, 1.5, -1.9]));
await page.waitForFunction(() => window.__gdr.net.state.ball !== null, { timeout: 5000, polling: 200 }).catch(() => {});
await shot('club-ball-up');
await page.evaluate(() => window.__gdr.club.cancel());

// ── THE SET inside the void ──────────────────────────────────────────────
console.log('the set:');
await page.evaluate(() => window.__gdr.net.leave());
await page.waitForTimeout(600);
await page.evaluate(() => window.__gdr.startRaid({ seats: 12 }));
await page.waitForTimeout(6500);
await shot('set-void');
await page.evaluate(() => window.__gdr.toLobby());

await browser.close();

const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
console.log(errors.length ? 'console errors:' : 'console clean.');
for (const e of errors.slice(0, 14)) console.log('  ' + e);
process.exitCode = errors.some((e) => e.includes('pageerror')) ? 2 : 0;
