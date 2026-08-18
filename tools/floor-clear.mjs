#!/usr/bin/env node
/**
 * THE FLOOR CLEARED — who it ends the record for, checked against the real
 * game (vite serves the TypeScript, so this runs the shipping ChoreoSystem):
 *
 *   npm run dev
 *   node tools/floor-clear.mjs
 *
 * Last dancer standing decides the night on THE TOUR and on a club ring, so
 * the record stops there — everyone is waiting on the result. A SOLO set is
 * the exception: you picked that record off the shelf to dance it, and the
 * groupies falling early must never cost you the back half of your chart,
 * your grade or your run at the board. This walks all three, killing every
 * dancer but the local one mid-set and watching what the set does next.
 *
 * Exits non-zero if any case behaves the other way.
 */

import { chromium } from 'playwright';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
const fails = [];
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) fails.push(what);
};

const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];
let browser;
try {
  browser = await chromium.launch({ args });
} catch {
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args });
}
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
page.on('pageerror', (e) => fails.push(`[pageerror] ${e.message}`));
await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => page.goto(base));
await page.waitForTimeout(1200);
await page.click('#enter-vr');
await page.waitForFunction(() => document.body.classList.contains('app-entered'), { timeout: 15000 });
await page.waitForTimeout(2000);

/** Start a set, clear every deck but mine, and report whether it ended. */
async function clearTheFloor(opts, watchMs = 3000) {
  await page.evaluate((o) => window.__gdr.startRaid(o), opts);
  await page.waitForFunction(() => window.__gdr.match.screen === 'raid', { timeout: 25000, polling: 100 });
  await page.evaluate(() => {
    for (const p of window.__gdr.match.players) {
      if (p.kind !== 'local') {
        p.alive = false;
        p.elimAtBeat = window.__gdr.match.beat;
      }
    }
  });
  const t0 = Date.now();
  let ended = false;
  while (Date.now() - t0 < watchMs) {
    if (await page.evaluate(() => window.__gdr.match.screen === 'podium')) {
      ended = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 60));
  }
  const state = await page.evaluate(() => ({
    screen: window.__gdr.match.screen,
    beat: Math.round(window.__gdr.match.beat),
    end: window.__gdr.match.phrases * 32,
    alive: window.__gdr.match.players.filter((p) => p.alive).length,
  }));
  return { ended, ms: Date.now() - t0, ...state };
}

console.log('SOLO free play — the record plays out:');
const solo = await clearTheFloor({ seats: 8 });
check(!solo.ended, `kept playing with the floor cleared (${solo.ms} ms watched)`);
check(solo.screen === 'raid', `still dancing at beat ${solo.beat}/${solo.end}, ${solo.alive} alive`);
// ...and it is still a SET, not an empty room: the chart keeps arriving.
const zones = await page.evaluate(async () => {
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    for (const z of window.__gdr.choreo.zones) seen.add(`${z.moveIdx}:${z.landingIdx}`);
    await new Promise((r) => requestAnimationFrame(r));
  }
  return seen.size;
});
check(zones > 0, `the chart keeps throwing (${zones} live zones after the clear)`);
await page.evaluate(() => window.__gdr.toLobby());
await page.waitForTimeout(500);

console.log('TOUR night — outlasting the room is the win:');
const tour = await clearTheFloor({ seats: 8, tour: { set: 0, song: 0 } });
check(tour.ended, `ended on the clear (${tour.ms} ms)`);
await page.evaluate(() => window.__gdr.toLobby());
await page.waitForTimeout(500);

// online:true with no remote humans is the solo-CALLER club raid — still a
// room standing on the floor waiting for its dancer to come home.
console.log('CLUB ring — the floor is waiting:');
const club = await clearTheFloor({ seats: 8, online: true });
check(club.ended, `ended on the clear (${club.ms} ms)`);

await browser.close();
if (fails.length) {
  console.log(`\n${fails.length} case(s) wrong`);
  process.exit(1);
}
console.log('\nthe floor-clear rule behaves.');
process.exit(0);
