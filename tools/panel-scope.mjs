#!/usr/bin/env node
/**
 * Where does right Ⓐ belong?
 *
 *   npm run dev      # terminal 1
 *   npm run server   # terminal 2
 *   node tools/panel-scope.mjs
 *
 * The SOCIAL panel is the CLUB's menu. At the foyer board — no room open —
 * the button must do nothing at all, and a panel left open when you walk
 * out of a room must close itself rather than follow you back to the menu.
 *
 * The A press can't be synthesised headlessly (no gamepad), so this drives
 * the panel through socialView.show() — the same setShown the button hits —
 * and checks what the system does with it on the next frame.
 */

import { chromium } from 'playwright';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';

async function launch() {
  const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];
  try {
    return await chromium.launch({ args });
  } catch {
    return chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args });
  }
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));

await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => page.goto(base));
await page.waitForTimeout(1100);
await page.click('#enter-vr');
await page.waitForFunction(() => document.body.classList.contains('app-entered'), { timeout: 15000 });
await page.waitForTimeout(1600);

/** Ask for the panel, let a few frames run, then see if it stuck. */
async function tryOpen() {
  await page.evaluate(() => window.__gdr.menu.show(true));
  await page.waitForTimeout(500);
  return page.evaluate(() => ({
    shown: window.__gdr.menu.shown(),
    phase: window.__gdr.net.state.phase,
  }));
}

const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

console.log('\n=== at the foyer board, no room ===');
let s = await tryOpen();
check('the panel refuses to open at the main menu', s.shown === false, `phase ${s.phase}, shown ${s.shown}`);

console.log('\n=== on the club floor ===');
await page.evaluate(() => window.__gdr.net.host());
await page.waitForFunction(() => window.__gdr.net.state.phase === 'hosting', { timeout: 8000 });
await page.waitForTimeout(800);
s = await tryOpen();
check('the panel opens in the social area', s.shown === true, `phase ${s.phase}, shown ${s.shown}`);

console.log('\n=== walking back out ===');
await page.evaluate(() => window.__gdr.net.leave());
await page.waitForTimeout(900);
s = await page.evaluate(() => ({
  shown: window.__gdr.menu.shown(),
  phase: window.__gdr.net.state.phase,
}));
check('leaving the room closes the panel behind you', s.shown === false, `phase ${s.phase}, shown ${s.shown}`);

s = await tryOpen();
check('and it stays shut back at the board', s.shown === false, `phase ${s.phase}, shown ${s.shown}`);

const bad = results.filter((r) => !r).length;
console.log(`\n${results.length - bad}/${results.length} checks passed`);
await browser.close();
process.exit(bad ? 1 : 0);
