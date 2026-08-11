#!/usr/bin/env node
/**
 * Three headsets walk into a club — the social floor's end-to-end check,
 * BALL edition.
 *
 *   npm run dev                       # terminal 1
 *   node tools/social-check.mjs [outDir]   # spawns its own short-fuse relay
 *
 * Boots THREE emulated-XR pages against a private relay (BALL_MS=4000 so
 * the test isn't a minute of waiting) and walks the whole journey:
 * host → two join → presence both ways → A SENDS THE BALL UP → B touches
 * in, C doesn't → the relay fires → A+B land in the set (online), C HOLDS
 * THE FLOOR (room open, sees who's away) → both players fold home →
 * the floor is whole, and a second ball can rise (then be called off).
 *
 * Exits non-zero if any leg of the journey fails.
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const out = resolve(process.argv[2] ?? 'shots');
const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
const RELAY_PORT = 8790;
const BALL_MS = 9000; // generous: three emulated-XR pages churn a shared CPU
mkdirSync(out, { recursive: true });

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};

// A private short-fuse relay so the ball fires in seconds, not a minute.
const relay = spawn(process.execPath, ['server/index.mjs'], {
  env: { ...process.env, PORT: String(RELAY_PORT), BALL_MS: String(BALL_MS) },
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 700));

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
  const url = `${base}/?server=ws://localhost:${RELAY_PORT}&name=${name}`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => page.goto(url));
  await page.waitForTimeout(1000);
  await page.click('#enter-vr');
  await page.waitForFunction(() => document.body.classList.contains('app-entered'), { timeout: 15000 });
  await page.waitForTimeout(1500);
  return { browser, page };
}

console.log('booting three dancers…');
const A = await boot('AVA');
const B = await boot('BIX');
const C = await boot('CUE');

// ── host + two joins ──────────────────────────────────────────────────────
console.log('the room:');
await A.page.evaluate(() => window.__gdr.net.host());
await A.page.waitForFunction(() => window.__gdr.net.state.phase === 'hosting', { timeout: 8000, polling: 200 });
const code = await A.page.evaluate(() => window.__gdr.net.state.code);
check(code.length === 4, `room opened (${code})`);
for (const P of [B, C]) {
  await P.page.evaluate((c) => window.__gdr.net.join(c), code);
  await P.page.waitForFunction(() => window.__gdr.net.state.phase === 'joined', { timeout: 8000, polling: 200 });
}
check(true, 'two joiners through the portal');
await A.page.waitForFunction(() => window.__gdr.net.state.members.length === 3, { timeout: 5000, polling: 200 });
check(true, 'roster shows all three');

// ── presence ──────────────────────────────────────────────────────────────
await B.page.evaluate(() => window.__gdr.rig(4.2, -2.4, -1.2));
await A.page.waitForFunction(() => window.__gdr.net.poses.size >= 2, { timeout: 6000, polling: 200 }).catch(() => {});
const seen = await A.page.evaluate(() => window.__gdr.net.poses.size);
check(seen >= 2, `host receives club poses from both (${seen})`);

// ── THE BALL: A calls, B touches, C holds the floor ──────────────────────
console.log('the ball:');
await A.page.evaluate(() => window.__gdr.club.call([0, 1.5, -1.5]));
// Checked in PARALLEL with interval polling: serial rAF waits starve when
// three headless XR pages fight for the CPU, and the fuse doesn't pause.
const ups = await Promise.all(
  [A, B, C].map((P) =>
    P.page
      .waitForFunction(() => window.__gdr.net.state.ball !== null, { timeout: 6000, polling: 200 })
      .then(() => true)
      .catch(() => false),
  ),
);
check(ups[0], 'caller sees the ball');
check(ups[1], 'toucher sees the ball');
check(ups[2], 'floor sees the ball');
const callerName = await C.page.evaluate(() => window.__gdr.net.state.ball?.callerName);
check(callerName === 'AVA', `the plate names the caller (${callerName})`);

await B.page.evaluate(() => window.__gdr.club.touch(true));
const joined = await A.page
  .waitForFunction(() => window.__gdr.net.state.ball?.joins.size === 1, { timeout: 4000, polling: 200 })
  .then(() => true)
  .catch(() => false);
check(joined, "B's touch lands on everyone's plate");
await A.page.screenshot({ path: `${out}/ball-up.png` });
console.log('  ball-up.png');

// ── the fire: A+B ride, C stays ──────────────────────────────────────────
console.log('the fire:');
const inSet = (P) =>
  P.page
    .waitForFunction(
      () => window.__gdr.match.screen === 'countdown' || window.__gdr.match.screen === 'raid',
      { timeout: BALL_MS + 8000, polling: 250 },
    )
    .then(() => true)
    .catch(() => false);
const rode = await Promise.all([inSet(A), inSet(B)]);
check(rode[0], 'caller lands in the set');
check(rode[1], 'toucher lands in the set');
const bLive = await B.page.evaluate(() => window.__gdr.match.online && window.__gdr.net.state.phase === 'live');
check(bLive, 'toucher is live online');
const cState = await C.page.evaluate(() => ({
  screen: window.__gdr.match.screen,
  phase: window.__gdr.net.state.phase,
  away: [...window.__gdr.net.state.gamePlayers].length,
  ball: window.__gdr.net.state.ball,
}));
check(cState.phase === 'joined' && cState.screen !== 'countdown' && cState.screen !== 'raid', `C holds the floor (${cState.screen})`);
check(cState.away === 2, `C sees two away on the ring (${cState.away})`);
check(cState.ball === null, "C's ball cleared at the fire");
await C.page.waitForTimeout(1500);
await C.page.screenshot({ path: `${out}/floor-during-set.png` });
console.log('  floor-during-set.png');
await B.page.screenshot({ path: `${out}/set-live.png` });
console.log('  set-live.png');

// ── coming home ──────────────────────────────────────────────────────────
console.log('back to the floor:');
await A.page.evaluate(() => window.__gdr.toLobby());
await B.page.evaluate(() => window.__gdr.toLobby());
await A.page.waitForFunction(() => window.__gdr.net.state.phase === 'hosting', { timeout: 6000, polling: 200 });
await B.page.waitForFunction(() => window.__gdr.net.state.phase === 'joined', { timeout: 6000, polling: 200 });
const floorWhole = await C.page
  .waitForFunction(() => window.__gdr.net.state.gamePlayers.size === 0, { timeout: 6000, polling: 200 })
  .then(() => true)
  .catch(() => false);
check(floorWhole, 'the floor is whole again');
check(await A.page.evaluate(() => window.__gdr.net.state.members.length === 3), 'the room outlived its set');

// A second ball can rise — from ANY member this time — and be called off.
await C.page.evaluate(() => window.__gdr.club.call([1, 1.5, -2]));
const secondBall = await A.page
  .waitForFunction(() => window.__gdr.net.state.ball !== null, { timeout: 4000, polling: 200 })
  .then(() => true)
  .catch(() => false);
check(secondBall, "a joiner's ball rises next (anyone can call)");
await C.page.evaluate(() => window.__gdr.club.cancel());
const cleared = await A.page
  .waitForFunction(() => window.__gdr.net.state.ball === null, { timeout: 4000, polling: 200 })
  .then(() => true)
  .catch(() => false);
check(cleared, "the caller's cancel clears it everywhere");

await A.browser.close();
await B.browser.close();
await C.browser.close();
relay.kill();

console.log(failures.length ? `\nFAILED: ${failures.length}` : '\nall legs clean.');
for (const f of failures) console.log('  ✗ ' + f);
process.exitCode = failures.length ? 1 : 0;
