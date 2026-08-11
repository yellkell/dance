#!/usr/bin/env node
/**
 * Two headsets walk into a club — the social floor's end-to-end check.
 *
 *   npm run dev && npm run server, then: node tools/social-check.mjs [outDir]
 *
 * Boots TWO emulated-XR pages against the local relay and walks the whole
 * loop: host → join → both on the club floor (each must receive the other's
 * club poses; page A photographs page B's figure + name tag) → the host
 * DROPS THE SET (both must land in the raid, online) → the host bails, the
 * joiner follows → both must be back on the club floor, room intact, host
 * migration untested but the room surviving its set proven. Fake mic
 * devices exercise the voice path (frames ride the same socket).
 *
 * Exits non-zero if any leg of the journey fails.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const out = resolve(process.argv[2] ?? 'shots');
const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
mkdirSync(out, { recursive: true });

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};

async function boot(name) {
  const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];
  let browser;
  try {
    browser = await chromium.launch({ args });
  } catch {
    browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args });
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => failures.push(`[${name} pageerror] ${e.message}`));
  await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => page.goto(base));
  await page.waitForTimeout(1000);
  await page.click('#enter-vr');
  await page.waitForFunction(() => document.body.classList.contains('app-entered'), { timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.evaluate((n) => window.__gdr.net.setName(n), name);
  return { browser, page };
}

console.log('booting two dancers…');
const A = await boot('AVA');
const B = await boot('BIX');

// ── host + join ───────────────────────────────────────────────────────────
console.log('the room:');
await A.page.evaluate(() => window.__gdr.net.host());
await A.page.waitForFunction(() => window.__gdr.net.state.phase === 'hosting', { timeout: 8000 });
const code = await A.page.evaluate(() => window.__gdr.net.state.code);
check(code.length === 4, `room opened (${code})`);

await B.page.evaluate((c) => window.__gdr.net.join(c), code);
await B.page.waitForFunction(() => window.__gdr.net.state.phase === 'joined', { timeout: 8000 });
check(true, 'joiner through the doors');

await A.page.waitForFunction(() => window.__gdr.net.state.members.length === 2, { timeout: 5000 });
check(true, 'roster shows both on the host');

// ── presence: B stands by the bar; A must SEE them ───────────────────────
await B.page.evaluate(() => window.__gdr.rig(4.2, -2.4, -1.2));
await A.page.waitForFunction(() => window.__gdr.net.poses.size >= 1, { timeout: 6000 }).catch(() => {});
const gotPose = await A.page.evaluate(() => {
  const p = [...window.__gdr.net.poses.values()][0];
  return p ? { x: p.hx, z: p.hz } : null;
});
check(!!gotPose && Math.abs(gotPose.x - 4.2) < 0.6, `host receives club poses (saw x≈${gotPose?.x?.toFixed(2)})`);
const bPose = await B.page.evaluate(() => window.__gdr.net.poses.size);
check(bPose >= 1, 'joiner receives club poses too');

// A walks over and photographs B's figure on the floor.
await A.page.evaluate(() => window.__gdr.rig(1.2, -1.0, -1.05));
await A.page.waitForTimeout(1400);
await A.page.screenshot({ path: `${out}/social-two-on-floor.png` });
console.log('  social-two-on-floor.png');

// ── the set drops for the whole room ─────────────────────────────────────
console.log('the set:');
await A.page.evaluate(() => window.__gdr.net.start(8, 'morning'));
await A.page.waitForFunction(() => window.__gdr.match.screen !== 'lobby' && window.__gdr.match.screen !== 'tour', {
  timeout: 10000,
});
const aScreen = await A.page.evaluate(() => window.__gdr.match.screen);
const bScreen = await B.page.evaluate(() => window.__gdr.match.screen);
check(aScreen === 'countdown' || aScreen === 'raid', `host in the set (${aScreen})`);
check(bScreen === 'countdown' || bScreen === 'raid', `joiner in the set (${bScreen})`);
const bOnline = await B.page.evaluate(() => window.__gdr.match.online && window.__gdr.net.state.phase === 'live');
check(bOnline, 'joiner is live online');
await A.page.waitForTimeout(2500);
await A.page.screenshot({ path: `${out}/social-set-live.png` });
console.log('  social-set-live.png');

// ── both bail → the room must SURVIVE its set ────────────────────────────
console.log('back to the floor:');
await A.page.evaluate(() => window.__gdr.toLobby());
await A.page.waitForFunction(() => window.__gdr.net.state.phase === 'hosting', { timeout: 6000 });
check(true, 'host folds back to the club (still hosting)');
await B.page.evaluate(() => window.__gdr.toLobby());
await B.page.waitForFunction(() => window.__gdr.net.state.phase === 'joined', { timeout: 6000 });
check(true, 'joiner folds back to the club (still joined)');
const roomAlive = await A.page.evaluate(() => window.__gdr.net.state.members.length === 2);
check(roomAlive, 'the room outlived its set');

// One more set can be booked (the floor reopened server-side).
await A.page.evaluate(() => window.__gdr.net.start(8, 'morning'));
const reArmed = await A.page
  .waitForFunction(() => window.__gdr.match.screen === 'countdown' || window.__gdr.match.screen === 'raid', {
    timeout: 8000,
  })
  .then(() => true)
  .catch(() => false);
check(reArmed, 'a second set books the same room');
await A.page.evaluate(() => window.__gdr.toLobby());
await B.page.evaluate(() => window.__gdr.toLobby());
await A.page.waitForTimeout(800);
await A.page.screenshot({ path: `${out}/social-back-on-floor.png` });
console.log('  social-back-on-floor.png');

await A.browser.close();
await B.browser.close();

console.log(failures.length ? `\nFAILED: ${failures.length}` : '\nall legs clean.');
for (const f of failures) console.log('  ✗ ' + f);
process.exitCode = failures.length ? 1 : 0;
