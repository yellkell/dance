#!/usr/bin/env node
/**
 * Glass physics check — the coupe's contact model and flight behaviour,
 * run against the REAL exported code (vite serves the TypeScript).
 *
 *   npm run dev
 *   node tools/glass-physics.mjs
 *
 * The headline property is that the drink never goes through the floor: a
 * surface of revolution has an exact lowest point at any tilt, so this can
 * be checked against the geometry rather than eyeballed.
 */

import { chromium } from 'playwright';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
let browser;
try { browser = await chromium.launch(); }
catch { browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }); }
const page = await browser.newPage();
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });

const out = await page.evaluate(async () => {
  const { COUPE_PROFILE, coupeBottomOffset, PROP_PHYS } = await import('/src/club/props.ts');
  const problems = [];
  const rows = [];

  const RIM = Math.max(...COUPE_PROFILE.map((p) => p.r));
  const TOP = Math.max(...COUPE_PROFILE.map((p) => p.y));

  // Sample every tilt from upright to fully inverted.
  for (let deg = 0; deg <= 180; deg += 5) {
    const t = (deg * Math.PI) / 180;
    const cos = Math.cos(t);
    const off = coupeBottomOffset(cos);
    // Brute force the true minimum over the whole surface of revolution,
    // independent of the closed form under test.
    let brute = Infinity;
    const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
    for (const p of COUPE_PROFILE) {
      for (let a = 0; a < 360; a += 2) {
        const th = (a * Math.PI) / 180;
        // Lowest y of the ring point under a tilt of `t` about a horizontal axis.
        const y = p.y * cos - p.r * sin * Math.cos(th);
        if (y < brute) brute = y;
      }
    }
    if (Math.abs(off - brute) > 1e-6) {
      problems.push(`tilt ${deg}°: closed form ${off.toFixed(5)} vs brute ${brute.toFixed(5)}`);
    }
    // The glass sits at surfaceY - off; nothing may end up below surfaceY.
    if (off > 1e-9) problems.push(`tilt ${deg}°: lowest point is ABOVE the origin (${off}) — glass would float`);
    if (deg % 45 === 0) rows.push({ deg, off, sits: -off });
  }

  // Named checks with known answers.
  const upright = coupeBottomOffset(1);
  if (Math.abs(upright) > 1e-9) problems.push(`upright should touch at the origin, got ${upright}`);
  const onSide = coupeBottomOffset(0);
  if (Math.abs(onSide + RIM) > 1e-9) problems.push(`on its side should rest on the rim (-${RIM}), got ${onSide}`);
  const upsideDown = coupeBottomOffset(-1);
  if (Math.abs(upsideDown + TOP) > 1e-9) problems.push(`inverted should rest on the rim plane (-${TOP}), got ${upsideDown}`);

  return {
    problems, rows, RIM, TOP,
    phys: {
      maxStep: PROP_PHYS.maxStep,
      slideStop: PROP_PHYS.slideStop,
      slideFriction: PROP_PHYS.slideFriction,
      bodyR: PROP_PHYS.bodyR,
    },
    // How many substeps a capped throw needs at 90 Hz.
    substeps: Math.ceil((PROP_PHYS.maxThrowSpeed / 90) / PROP_PHYS.maxStep),
  };
});

console.log(`coupe: rim radius ${out.RIM} m, height ${out.TOP} m`);
for (const r of out.rows) {
  console.log(`  tilt ${String(r.deg).padStart(3)}°  origin sits ${(r.sits * 1000).toFixed(1)} mm above the surface`);
}
console.log(`\ncapped throw needs ${out.substeps} substeps at 90 Hz (cap ${out.phys.maxStep} m/step)`);
console.log(`slide: friction ${out.phys.slideFriction}/s, settles under ${out.phys.slideStop} m/s`);
if (out.problems.length) {
  console.log('\nPROBLEMS:');
  for (const p of out.problems) console.log('  ' + p);
} else {
  console.log('\nno problems: contact height matches brute force at every tilt, and the glass never sinks');
}

/* ── the dynamics, in a live club ──────────────────────────────────────── */

await page.waitForTimeout(800);
await page.click('#enter-vr');
await page.waitForFunction(() => document.body.classList.contains('app-entered'), { timeout: 15000 });
await page.waitForTimeout(2000);
await page.evaluate(() => window.__gdr.net.host());
await page.waitForFunction(() => window.__gdr.net.state.phase === 'hosting', { timeout: 8000 });
await page.waitForTimeout(1500);

const settle = async (ms) => { await page.waitForTimeout(ms); };
const read = () => page.evaluate(() => window.__gdr.props.glasses());
const launch = (id, at, vel) =>
  page.evaluate(([i, a, v]) => window.__gdr.props.launch(i, a, v), [id, at, vel]);

const dyn = [];
const fail = (m) => dyn.push('FAIL ' + m);
const pass = (m) => dyn.push('ok   ' + m);

// Run the ballistic tests INSIDE the page, driven by real frames and a
// settle condition. Wall-clock waits are useless here: the tab throttles
// between round-trips, so a second of wall time can be a handful of
// simulated frames.
const ballistic = await page.evaluate(async () => {
  const P = window.__gdr.props;
  const run = (id, until, cap = 900) =>
    new Promise((done) => {
      let frames = 0;
      const seen = { minClearance: Infinity, maxTravel: 0 };
      const start = P.glasses()[id].pos.slice();
      const tick = () => {
        const g = P.glasses()[id];
        if (g.mode !== 'idle') seen.minClearance = Math.min(seen.minClearance, g.clearance);
        seen.maxTravel = Math.max(seen.maxTravel, Math.hypot(g.pos[0] - start[0], g.pos[2] - start[2]));
        if (until(g) || ++frames > cap) return done({ ...seen, g, frames });
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

  // A HARD drop straight onto the bar counter: never dips below the top.
  P.launch(0, [7.0, 2.2, -2.0], [0, -14, 0]);
  const drop = await run(0, (g) => g.mode === 'rest');

  // A flat SKID along the bar: it should carry, then stop.
  P.launch(1, [6.85, 1.12, -5.5], [0, -0.2, 2.6]);
  const skid = await run(1, (g) => g.mode === 'rest');

  return { drop, skid };
});

if (ballistic.drop.minClearance < -0.005) {
  fail(`hard drop sank through the bar (dipped ${ballistic.drop.minClearance.toFixed(3)} m)`);
} else {
  pass(`hard drop never broke the bar top (min clearance ${ballistic.drop.minClearance.toFixed(4)} m)`);
}
if (ballistic.drop.g.mode !== 'rest') fail(`hard drop never settled (${ballistic.drop.g.mode})`);
else pass(`hard drop settled at y=${ballistic.drop.g.pos[1].toFixed(3)}`);

if (ballistic.skid.maxTravel < 0.25) fail(`skid barely moved (${ballistic.skid.maxTravel.toFixed(2)} m)`);
else if (ballistic.skid.g.mode !== 'rest') fail(`skid never settled (${ballistic.skid.g.mode})`);
else pass(`skid carried ${ballistic.skid.maxTravel.toFixed(2)} m along the bar and settled`);
if (ballistic.skid.minClearance < -0.005) fail(`skid dug into the bar (${ballistic.skid.minClearance.toFixed(3)} m)`);

// 3. TWO GLASSES, head on. Launched close together and level so they meet
// in the air, and sampled INSIDE the page every frame — polling over the
// wire at 35 ms strides past a 4 m/s closing pair without seeing contact.
const hit = await page.evaluate(async () => {
  const P = window.__gdr.props;
  P.launch(2, [0, 1.4, -0.4], [0, 0, 2.0]);
  P.launch(3, [0, 1.4, 0.4], [0, 0, -2.0]);
  const startGap = 0.8;
  let closest = Infinity;
  let crossed = false;
  let bounced = false;
  await new Promise((done) => {
    let frames = 0;
    const tick = () => {
      const g = P.glasses();
      const a = g[2];
      const b = g[3];
      const d = Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]);
      if (d < closest) closest = d;
      // a started BEHIND b in z; if it ends up in front, it went through.
      if (a.pos[2] > b.pos[2]) crossed = true;
      // Either one reversing along z means the contact actually pushed back.
      if (a.vel[2] < -0.05 || b.vel[2] > 0.05) bounced = true;
      if (++frames > 150) return done();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return { closest, crossed, bounced, startGap };
});
if (hit.closest < 0.05) fail(`glasses interpenetrated (closest ${hit.closest.toFixed(3)} m)`);
else pass(`glasses kept clear of each other (closest ${hit.closest.toFixed(3)} m)`);
if (hit.crossed) fail('glasses passed through each other (they swapped sides)');
else pass('neither glass passed through the other');
if (!hit.bounced) fail('contact never pushed either glass back — no impulse exchanged');
else pass('the contact reversed them: they traded momentum');

// 4. Nothing anywhere ends up inside the floor.
const finals = await read();
const sunk = finals.filter((f) => f.mode !== 'idle' && f.mode !== 'held' && f.clearance < -0.005);
if (sunk.length) fail(`${sunk.length} glass(es) resting inside the floor`);
else pass('no glass is inside the floor');

console.log('\ndynamics:');
for (const d of dyn) console.log('  ' + d);
const bad = dyn.filter((d) => d.startsWith('FAIL')).length;

await browser.close();
process.exit(out.problems.length || bad ? 1 : 0);
