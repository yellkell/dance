#!/usr/bin/env node
/**
 * THE MUSIC SWITCH — the club floor's music toggle, end to end.
 *
 *   npm run dev                          # terminal 1
 *   node tools/music-switch.mjs [outDir] # spawns its own relay
 *
 * Boots one emulated-XR headset into its own room and presses the SOCIAL
 * panel's MUSIC button through the real click path (socialView.press), then
 * checks the four things the switch promises:
 *
 *   1. OFF silences the floor's record for this headset;
 *   2. the record KEEPS SPINNING — the room's pulse (match.beat, which the
 *      eclipse, the ball and every dancer ride) never stops;
 *   3. the hush is the CLUB's, not the room loop's as a system: walk out to
 *      the foyer and the house rotation plays;
 *   4. it survives the night — a reload comes back hushed.
 *
 * Exits non-zero if any of them fails.
 */

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const out = resolve(process.argv[2] ?? 'shots');
const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
const RELAY_PORT = 8793;
mkdirSync(out, { recursive: true });

const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};

const relay = spawn(process.execPath, ['server/index.mjs'], {
  env: { ...process.env, PORT: String(RELAY_PORT) },
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 700));

async function launch() {
  try {
    return await chromium.launch();
  } catch {
    return await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  }
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => failures.push(`[pageerror] ${e.message}`));

async function enter() {
  const url = `${base}/?server=ws://localhost:${RELAY_PORT}&name=DJ`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => page.goto(url));
  await page.waitForTimeout(800);
  await page.click('#enter-vr');
  await page.waitForFunction(() => document.body.classList.contains('app-entered'), { timeout: 15000 });
  await page.waitForTimeout(1200);
}

/** Take the floor: host a room and wait for the club's record to come on. */
async function takeTheFloor() {
  await page.evaluate(() => window.__gdr.net.host());
  await page.waitForFunction(() => ['hosting', 'joined'].includes(window.__gdr.net.state.phase), { timeout: 15000 });
  await page.waitForFunction(() => window.__gdr.ambient() !== null, { timeout: 20000 });
  await page.waitForTimeout(600);
}

console.log('THE MUSIC SWITCH');
await enter();
await takeTheFloor();

const onAir = await page.evaluate(() => ({
  track: window.__gdr.ambient(),
  muted: window.__gdr.ambientMuted(),
  beat: window.__gdr.match.beat,
}));
check(onAir.track !== null && !onAir.muted, `the floor arrives with a record on (${onAir.track}), unmuted`);
check(Number.isFinite(onAir.beat), 'the room has a pulse to dance to');

// The panel, and the switch on it.
await page.evaluate(() => window.__gdr.menu.show(true));
await page.waitForTimeout(300);
check(await page.evaluate(() => window.__gdr.menu.shown()), 'right Ⓐ raises the SOCIAL panel');
writeFileSync(`${out}/music-on.png`, Buffer.from(
  (await page.evaluate(() => window.__gdr.menu.snapSocial())).split(',')[1], 'base64'));

await page.evaluate(() => window.__gdr.menu.press('music'));
await page.waitForTimeout(700);
const off = await page.evaluate(() => ({
  muted: window.__gdr.ambientMuted(),
  track: window.__gdr.ambient(),
  beat: window.__gdr.match.beat,
  stored: localStorage.getItem('gdr-club-music'),
}));
check(off.muted, 'MUSIC: OFF hushes the floor for this headset');
check(off.track !== null, 'the record keeps spinning — the room is not stopped');
check(Number.isFinite(off.beat), 'the pulse survives the hush (lights, ball, dancers keep time)');
check(off.stored === 'off', 'the choice is written down');
writeFileSync(`${out}/music-off.png`, Buffer.from(
  (await page.evaluate(() => window.__gdr.menu.snapSocial())).split(',')[1], 'base64'));

// The beat must actually ADVANCE while hushed — a frozen clock would read
// as "finite" too, and a frozen club is exactly the failure being guarded.
const b0 = await page.evaluate(() => window.__gdr.match.beat);
await page.waitForTimeout(1200);
const b1 = await page.evaluate(() => window.__gdr.match.beat);
check(b1 > b0 + 0.5, `the hushed floor keeps counting (${b0.toFixed(2)} → ${b1.toFixed(2)})`);

// Leaving the club: a different place, a different record, no hush.
await page.evaluate(() => window.__gdr.menu.press('leave'));
await page.waitForTimeout(1500);
const foyer = await page.evaluate(() => ({
  phase: window.__gdr.net.state.phase,
  muted: window.__gdr.ambientMuted(),
}));
check(foyer.phase !== 'hosting' && foyer.phase !== 'joined', 'left the club');
check(!foyer.muted, 'the foyer plays on — the switch is the CLUB floor\'s');

// The next night: still hushed.
await enter();
await takeTheFloor();
const again = await page.evaluate(() => ({
  muted: window.__gdr.ambientMuted(),
  track: window.__gdr.ambient(),
}));
check(again.muted && again.track !== null, 'a fresh night comes back hushed, record still on');

// And back on, so the tool leaves no state behind.
await page.evaluate(() => window.__gdr.menu.show(true));
await page.evaluate(() => window.__gdr.menu.press('music'));
await page.waitForTimeout(600);
const back = await page.evaluate(() => ({
  muted: window.__gdr.ambientMuted(),
  stored: localStorage.getItem('gdr-club-music'),
}));
check(!back.muted && back.stored === 'on', 'MUSIC: ON brings the floor back up');

await browser.close();
relay.kill();
console.log(failures.length ? `\n${failures.length} FAILED:\n  ${failures.join('\n  ')}` : '\nall good');
process.exit(failures.length ? 1 : 0);
