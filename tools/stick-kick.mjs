#!/usr/bin/env node
/**
 * The glowsticks' answer to a scoring swap, and the controllers' absence
 * during a song — both read off the live scene graph.
 *
 *   npm run dev
 *   node tools/stick-kick.mjs
 *
 * Samples the right stick every frame while `__gdr.sparkle()` plays a
 * rewarded swap, so the flash, the shake and the return to rest are
 * measured rather than eyeballed at 8 frames a second.
 */

import { chromium } from 'playwright';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
let browser;
try { browser = await chromium.launch(); }
catch { browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }); }
const page = await browser.newPage();
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1000);
await page.click('#enter-vr');
await page.waitForFunction(() => document.body.classList.contains('app-entered'), { timeout: 15000 });
await page.waitForTimeout(2000);
await page.evaluate(() => window.__gdr.startRaid({ seats: 1 }));
await page.waitForFunction(() => window.__gdr.match.playing === true, { timeout: 25000 });
await page.waitForTimeout(1200);

const out = await page.evaluate(async () => {
  const sticks = [];
  window.__gdr.scene().traverse((o) => {
    if (o.name === 'live-glowstick') sticks.push(o);
  });
  if (!sticks.length) return { error: 'no glowsticks in the scene' };

  // The right stick is the one __gdr.sparkle() plays.
  const read = () => {
    let best = null;
    for (const s of sticks) {
      const mesh = s.children.find((c) => c.material && c.material.color && c.material.transparent);
      const c = mesh ? mesh.material.color : { r: 0, g: 0, b: 0 };
      const row = {
        rx: s.rotation.x, rz: s.rotation.z,
        sx: s.scale.x,
        lum: (c.r + c.g + c.b) / 3,
      };
      if (!best || Math.abs(row.rz) > Math.abs(best.rz)) best = row;
    }
    return best;
  };

  const rest = read();
  window.__gdr.sparkle(1);
  const frames = [];
  await new Promise((done) => {
    let n = 0;
    const tick = () => {
      frames.push(read());
      if (++n > 60) return done();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return { rest, frames };
});

if (out.error) {
  console.log('FAIL ' + out.error);
  await browser.close();
  process.exit(1);
}

const problems = [];
const maxRz = Math.max(...out.frames.map((f) => Math.abs(f.rz)));
const rxSwing = Math.max(...out.frames.map((f) => Math.abs(f.rx - out.rest.rx)));
const maxScale = Math.max(...out.frames.map((f) => f.sx));
const maxLum = Math.max(...out.frames.map((f) => f.lum));
const last = out.frames[out.frames.length - 1];

console.log(`rest pose:  rx ${out.rest.rx.toFixed(3)}  rz ${out.rest.rz.toFixed(3)}  scale ${out.rest.sx.toFixed(3)}  lum ${out.rest.lum.toFixed(3)}`);
console.log(`peak kick:  rz ±${maxRz.toFixed(3)} rad (${((maxRz * 180) / Math.PI).toFixed(1)}°)`);
console.log(`            rx swing ${((rxSwing * 180) / Math.PI).toFixed(1)}°, scale ${maxScale.toFixed(3)}, lum ${maxLum.toFixed(3)}`);
console.log(`settled:    rx ${last.rx.toFixed(3)}  rz ${last.rz.toFixed(3)}  scale ${last.sx.toFixed(3)}`);

if (maxRz < 0.01) problems.push('the stick never shook (no roll about the grip)');
if (maxRz > 0.25) problems.push(`the shake is wild (${((maxRz * 180) / Math.PI).toFixed(1)}° — meant to be a rattle)`);
if (rxSwing < 0.005) problems.push('the stick never nodded (no pitch wobble)');
if (maxLum <= out.rest.lum + 0.01) problems.push('the neon never flashed toward white');
if (maxScale <= out.rest.sx + 0.01) problems.push('the stick never popped in scale');
if (Math.abs(last.rz) > 0.005 || Math.abs(last.rx - out.rest.rx) > 0.005) {
  problems.push(`the shake did not return to rest (rz ${last.rz.toFixed(4)})`);
}

/* ── the controllers ───────────────────────────────────────────────────── */

// NOT VERIFIABLE HERE, and this says so rather than inventing a pass. Plain
// Chromium ships no controller glTF, so `visual.model` never exists off a
// headset and there is nothing for the hide to act on. (An earlier version
// of this check diffed the visibility of everything under the rig, found
// four unrelated objects that happened to hide, and reported success while
// the headset still showed controllers all the way through a song.)
//
// On-device the one-liner is `__gdr.pads()` — `inRig` is the field that
// decides what draws.
const ctrl = await page.evaluate(() => window.__gdr.pads());
const withModel = ctrl.filter((c) => c.hasVisual);
if (!withModel.length) {
  console.log(`\ncontrollers: no glTF in this browser — nothing to hide, check skipped`);
  console.log(`  (on a headset: __gdr.pads() during a song, expect inRig false)`);
} else {
  const stillUp = withModel.filter((c) => c.inRig).map((c) => c.hand);
  if (stillUp.length) problems.push(`controller model still in the rig during the song: ${stillUp.join(', ')}`);
  else console.log(`\ncontrollers: ${withModel.length} model(s) lifted out of the rig for the song`);
}

if (problems.length) {
  console.log('\nPROBLEMS:');
  for (const p of problems) console.log('  ' + p);
} else {
  console.log('\nno problems: the stick flashes, rattles, pops and returns to rest');
}
await browser.close();
process.exit(problems.length ? 1 : 0);
