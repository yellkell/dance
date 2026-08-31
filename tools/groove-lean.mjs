#!/usr/bin/env node
/**
 * THE LEAN — the groove judge reading a swap that isn't going straight up.
 *
 *   npm run dev
 *   node tools/groove-lean.mjs
 *
 * The complaint this answers: mid-dodge you're thrown sideways — a lunge
 * off a beam, a crouch under the blade — and the one-up-one-down swap you
 * are STILL DELIBERATELY DANCING stops registering, because the judge
 * only read the world-vertical split and a tilted throw keeps too little
 * of it. The judge now reads the throw between the hands themselves
 * (tilt-blind) plus enough vertical to name an UP hand
 * (GROOVE.splitLean).
 *
 * The judge's eye is a pure export (grooveSideOf), so this audits the
 * whole pose table as maths — no controllers, no frame rates — through
 * the dev server's own transform of the live source.
 */

import { chromium } from 'playwright';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
let browser;
try { browser = await chromium.launch(); }
catch { browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }); }
const page = await browser.newPage();
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => page.goto(base));
await page.waitForTimeout(800);

const out = await page.evaluate(async () => {
  const { grooveSideOf } = await import('/src/systems/PlayerSystem.ts');
  const { GROOVE } = await import('/src/config.ts');
  // A pose is a throw of `reach` metres tilted `deg` off vertical, left
  // hand at the high end when `led` is 1: dy = ±reach·cos(tilt).
  const pose = (reach, deg, led = 1) =>
    grooveSideOf(led * reach * Math.cos((deg * Math.PI) / 180), reach);
  return {
    split: GROOVE.split,
    splitLean: GROOVE.splitLean,
    upright: pose(0.55, 0),
    uprightRight: pose(0.55, 0, -1),
    // The exact old legal minimum: a dead-vertical split of `split`.
    oldEdge: grooveSideOf(GROOVE.split, GROOVE.split),
    // A hair under it, dead vertical — too small a throw, still refused.
    smallThrow: grooveSideOf(GROOVE.split - 0.02, GROOVE.split - 0.02),
    // THE COMPLAINT: a full-size swap tilted hard by a dodge.
    lean45: pose(0.55, 45),
    lean60: pose(0.55, 60),
    lean70: pose(0.55, 70),
    lean60Right: pose(0.55, 60, -1),
    // Near-horizontal: no up hand to name — not the dance, however wide.
    flat80: pose(0.55, 80),
    tpose: grooveSideOf(0.04, 0.9),
    // Hands close in front, wobbling: vertical without a real throw.
    prayer: grooveSideOf(0.2, 0.24),
    // The widening never narrows: every pose the old vertical-only judge
    // accepted (|dy| ≥ split) must still register, and with the same sign.
    oldStillPay: (() => {
      for (let dy = GROOVE.split; dy <= 1.2; dy += 0.01) {
        for (let extra = 0; extra <= 0.8; extra += 0.05) {
          const reach = Math.hypot(dy, extra);
          if (grooveSideOf(dy, reach) !== 1 || grooveSideOf(-dy, reach) !== -1) {
            return `lost dy=${dy.toFixed(2)} reach=${reach.toFixed(2)}`;
          }
        }
      }
      return 'all held';
    })(),
  };
});
await browser.close();

console.log(`split ${out.split} m between the hands, splitLean ${out.splitLean} m of it vertical\n`);
const problems = [];
const expect = (label, got, want) => {
  const ok = got === want;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}: ${got} (want ${want})`);
  if (!ok) problems.push(label);
};
expect('upright swap, left up', out.upright, 1);
expect('upright swap, right up', out.uprightRight, -1);
expect('the old legal minimum (dead-vertical split)', out.oldEdge, 1);
expect('undersized throw stays silent', out.smallThrow, 0);
expect('45° dodge lean still pays', out.lean45, 1);
expect('60° dodge lean still pays', out.lean60, 1);
expect('70° dodge lean still pays', out.lean70, 1);
expect('60° lean, right hand up', out.lean60Right, -1);
expect('near-horizontal (80°) names no up hand', out.flat80, 0);
expect('level T-pose stays silent', out.tpose, 0);
expect('close-in wobble stays silent', out.prayer, 0);
expect('every old-legal pose still pays', out.oldStillPay, 'all held');
if (out.splitLean >= out.split) {
  problems.push('splitLean >= split (the lean floor must sit under the throw)');
}

if (problems.length) {
  console.log(`\n${problems.length} problem(s).`);
  process.exit(1);
}
console.log('\nthe groove reads the swap, not the compass: tilted throws pay, poses that are not the dance stay silent.');
