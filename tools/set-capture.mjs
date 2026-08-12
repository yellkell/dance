#!/usr/bin/env node
/**
 * Photograph THE SET headlessly — the full-VR raid through the real app
 * (IWER emulated XR): the foyer's void, the live wedge HUD, and THE
 * ROUTINE's falling blocks, dropped on demand through the
 * `__gdr.choreo.dropRoutine()` dev hook.
 *
 *   npm run dev                      # terminal 1
 *   node tools/set-capture.mjs [outDir]
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const out = resolve(process.argv[2] ?? 'shots');
const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
mkdirSync(out, { recursive: true });

async function launch() {
  try {
    return await chromium.launch();
  } catch {
    return chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  }
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => page.goto(base));
await page.waitForTimeout(1200);
await page.click('#enter-vr');
await page.waitForFunction(() => document.body.classList.contains('app-entered'), {
  timeout: 15000,
  polling: 200,
});
await page.waitForTimeout(2500); // textures, fog, first frames

// Hide the IWER emulator's DOM chrome (the Quest/controller panels) —
// review shots want the world. Canvases all stay: one is the app, one is
// the emulator's small in-world gizmo overlay.
await page.evaluate(() => {
  for (const el of document.body.children) {
    if (el.tagName !== 'DIV' || el.id === 'scene-container' || el.className) continue;
    if (el.querySelector('canvas')) {
      for (const kid of el.children) {
        if (kid.tagName !== 'CANVAS') kid.style.display = 'none';
      }
    } else {
      el.style.display = 'none';
    }
  }
});

const shot = async (name) => {
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`  ${name}.png`);
};
const rig = (x, z, yaw, y = 0) =>
  page.evaluate(([px, pz, pyaw, py]) => window.__gdr.rig(px, pz, pyaw, py), [x, z, yaw, y]);

// ── the FOYER: full VR — the void IS the backdrop, opaque everywhere ─────
console.log('foyer:');
await rig(0, 0.6, 0);
await page.waitForTimeout(900);
await shot('vr-foyer');

// ── the SET: a full ring, live ────────────────────────────────────────────
console.log('set:');
await page.evaluate(() => window.__gdr.startRaid({ seats: 24 }));
// The count-in card, at eye level, while the record cues.
await page
  .waitForFunction(
    () => window.__gdr.match.screen === 'countdown' && Number.isFinite(window.__gdr.match.beat) && window.__gdr.match.beat < -0.6,
    { timeout: 30000, polling: 100 },
  )
  .then(async () => {
    await page.waitForTimeout(150);
    await shot('vr-countin');
  })
  .catch(() => console.log('  (count-in too quick to catch)'));
await page.waitForFunction(
  () => window.__gdr.match.screen === 'raid' && Number.isFinite(window.__gdr.match.beat) && window.__gdr.match.beat > 1,
  { timeout: 90000, polling: 200 },
);
await page.waitForTimeout(400);

// A capture player stands perfectly still and gets clipped out of a live
// set in under a minute, which ends the tour early. Keep it on its feet
// for the shot list; `__keepAlive = false` hands it back to the judge.
await page.evaluate(() => {
  window.__keepAlive = true;
  const m = window.__gdr.match;
  setInterval(() => {
    if (!window.__keepAlive) return;
    const d = m.players.find((p) => p.kind === 'local');
    if (d) {
      d.missChain = 0;
      d.alive = true;
      d.elimAtBeat = -1;
    }
  }, 80);
});

await rig(0, 0.4, 0);
await shot('vr-set-live'); // the void, the ring, the show

// The wedge HUD: turn toward it (it rides off the left shoulder).
await rig(0, 0.2, 0.5);
await page.waitForTimeout(400);
await shot('vr-hud-wedge');

// The groove row winding up, then running with its ledger. (The emulator
// pins controller poses, so the streak is injected rather than danced.)
for (const [streak, score, name] of [
  [2, 13, 'vr-hud-groove-start'],
  [26, 402, 'vr-hud-groove-run'],
]) {
  await page.evaluate(([s, sc]) => {
    window.__gdr.match.grooveStreak = s;
    window.__gdr.match.grooveScore = sc;
  }, [streak, score]);
  await page.waitForTimeout(350);
  await shot(name);
}
await page.evaluate(() => {
  window.__gdr.match.grooveStreak = 0;
  window.__gdr.match.grooveScore = 0;
});

// The sparkles: three hot bursts off the right stick, shot mid-flight so
// the glints and their twins in the deck's polish are both in frame.
await rig(0, 0.35, 0.35, 0);
await page.evaluate(() => {
  window.__gdr.sparkle(1);
  setTimeout(() => window.__gdr.sparkle(0.8), 120);
  setTimeout(() => window.__gdr.sparkle(1), 240);
});
await page.waitForTimeout(280);
await shot('vr-sparkles');

// The chain warning: two clipped landings back to back, one to go.
// Freeze the judge first: left running, the very next clean landing wipes
// the chain before the shutter — which is exactly the rule (a dodge is an
// eraser, not a bandage), but it makes the state impossible to photograph.
await page.evaluate(() => {
  window.__keepAlive = false;
  window.__gdr.match.playing = false;
  const d = window.__gdr.match.players.find((p) => p.kind === 'local');
  d.hits = 2;
  d.missChain = 2;
});
await page.waitForTimeout(300);
await shot('vr-chain-warning');
// Restore in ONE evaluate: zeroing the injected chain in a separate call
// left a frame where playing was live with missChain at 2 — one judged
// landing in that gap and the whole shot list game-overs.
await page.evaluate(() => {
  const d = window.__gdr.match.players.find((p) => p.kind === 'local');
  d.hits = 0;
  d.missChain = 0;
  d.alive = true;
  d.elimAtBeat = -1;
  window.__gdr.match.playing = true;
  window.__keepAlive = true;
});
await rig(0, 0.4, 0, 0);

// ── THE ROUTINE's blocks, on demand ──────────────────────────────────────
console.log('routine:');
// If an earlier race ended the set (podium → lobby), start a fresh one.
await page.evaluate(() => {
  if (window.__gdr.match.screen !== 'raid') window.__gdr.startRaid({ seats: 24 });
});
await page.waitForFunction(
  () => window.__gdr.match.screen === 'raid' && Number.isFinite(window.__gdr.match.beat) && window.__gdr.match.beat > 1,
  { timeout: 90000, polling: 200 },
);
await page.evaluate(() => window.__gdr.choreo.dropRoutine());
// Wait for the first block set to go visible (the beat-locked drop began).
try {
  await page.waitForFunction(
    () => window.__gdr.choreo.zones.some((z) => z.blocks && z.blocks.root.visible),
    { timeout: 30000, polling: 100 },
  );
} catch (err) {
  console.error('no blockfall:', JSON.stringify(await page.evaluate(() => ({
    screen: window.__gdr.match.screen,
    playing: window.__gdr.match.playing,
    beat: window.__gdr.match.beat,
    alive: window.__gdr.match.players.filter((p) => p.alive).length,
    zones: window.__gdr.choreo.zones.length,
  }))));
  throw err;
}
await page.waitForTimeout(450); // roughly a beat into the two-beat fall
await shot('vr-blockfall-mid');
await page.waitForTimeout(700); // the landing + crush
await shot('vr-blockfall-crush');

// One wide look from the deck's rear rim — the architecture shot. Freeze
// the judge first: a strike landing at point-blank is meant to blind you,
// and it does, which makes for a useless review frame.
await page.evaluate(() => {
  window.__keepAlive = false;
  window.__gdr.match.playing = false;
});
await rig(0, 1.3, 0);
await page.waitForTimeout(900);
await shot('vr-set-wide');
await page.evaluate(() => {
  window.__gdr.match.playing = true;
  window.__keepAlive = true;
});

// ── THE GRADE ────────────────────────────────────────────────────────────
console.log('grade:');
// A clean finish: end the record early and read the letter. (A capture
// player stands perfectly still, so it may well have been clipped out of
// the live set by now — put it back on its feet first.)
await page.evaluate(() => {
  const m = window.__gdr.match;
  const d = m.players.find((p) => p.kind === 'local');
  d.alive = true;
  d.elimAtBeat = -1;
  d.dodges = 48;
  d.perfects = 14;
  d.hits = 0;
  d.missChain = 0;
  if (m.screen === 'podium') m.screen = 'raid';
  window.__gdr.endSet();
});
await page.waitForFunction(() => window.__gdr.match.screen === 'podium', { timeout: 15000, polling: 100 });
await rig(0, 0.4, 0);
await page.waitForTimeout(900);
await shot('vr-grade-card');

await browser.close();

const bad = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
if (bad.length) {
  console.error('console errors:');
  for (const l of bad) console.error(`  ${l}`);
  process.exit(1);
}
console.log('clean console.');
