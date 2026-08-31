#!/usr/bin/env node
/**
 * THE GROOVE ROW's pips — four points and a glint riding the wedge, off
 * the canvas, hopping on the SWAP.
 *
 *   npm run dev
 *   node tools/groove-row.mjs
 *
 * What this holds:
 *   THE CURVE   pipHop() as maths (a container's software GL runs ~3 fps,
 *               so the shape can't be sampled off the live row): a jump
 *               that peaks mid-arc, lands, and gives one small rebound.
 *   THE WIRING  the pips exist as the named Points on the strip, read the
 *               streak (slate → lit), keep the [meter][tally] centring,
 *               and the glint answers a streak bump.
 *   THE LEDGER  with the streak HELD and no swaps landing, the row stands
 *               still — the old row bounced on the beat clock whether you
 *               were dancing or not, and that lie is the regression this
 *               tool exists to catch.
 */

import { chromium } from 'playwright';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
let browser;
try { browser = await chromium.launch(); }
catch { browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }); }
const page = await browser.newPage({ viewport: { width: 320, height: 240 } });
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => page.goto(base));
await page.waitForTimeout(1000);

const problems = [];
const note = (m) => { problems.push(m); console.log(`  FAIL ${m}`); };
const ok = (m) => console.log(`  ok   ${m}`);

/* ── the curve, as maths ─────────────────────────────────────────────── */
console.log('the hop curve:');
const curve = await page.evaluate(async () => {
  const { pipHop } = await import('/src/systems/HudSystem.ts');
  const s = [];
  for (let i = 0; i <= 100; i++) s.push(+pipHop(i / 100).toFixed(4)); // one beat
  return s;
});
const peak = Math.max(...curve.slice(0, 51));
const peakAt = curve.indexOf(peak) / 100;
const atLand = curve[50];
const rebound = Math.max(...curve.slice(51, 81));
const after = Math.max(...curve.slice(81));
console.log(
  `  jump peaks ${peak} at ${peakAt.toFixed(2)} beats, lands ${atLand}, rebound ${rebound}, after ${after}`,
);
if (curve[0] !== 0) note(`the hop does not start on the ground (${curve[0]})`);
if (peak < 0.98) note(`the jump never reaches full height (${peak})`);
if (Math.abs(peakAt - 0.25) > 0.05) note(`the jump peaks at ${peakAt} beats, not mid-arc`);
if (atLand > 0.05) note(`the dot is still airborne at the landing (${atLand})`);
if (!(rebound > 0.1 && rebound < 0.45)) note(`the rebound is ${rebound} — meant to be a small bounce, not a second jump`);
if (after > 0.001) note(`the hop never dies (${after} past the rebound)`);
if (curve[0] === 0 && peak >= 0.98 && atLand <= 0.05 && rebound < 0.45 && after <= 0.001) {
  ok('up, over, land, one small rebound, done');
}

/* ── the live row ────────────────────────────────────────────────────── */
console.log('the live row:');
await page.click('#enter-vr');
await page.waitForFunction(() => document.body.classList.contains('app-entered'), { timeout: 15000 });
await page.waitForTimeout(1500);
await page.evaluate(() => window.__gdr.startRaid({ seats: 1 }));
await page.waitForFunction(
  () => window.__gdr.match.screen === 'raid' && Number.isFinite(window.__gdr.match.beat) && window.__gdr.match.beat > 0,
  { timeout: 90000, polling: 200 },
);
// A capture player stands still and gets clipped; keep it judged alive so
// the row stays on show (same trick set-capture uses).
await page.evaluate(() => {
  const m = window.__gdr.match;
  setInterval(() => {
    const d = m.players.find((p) => p.kind === 'local');
    if (d) { d.missChain = 0; d.alive = true; d.elimAtBeat = -1; }
  }, 80);
});

const read = () =>
  page.evaluate(() => {
    let pips = null;
    let glint = null;
    window.__gdr.scene().traverse((o) => {
      if (o.name === 'groove-pips') pips = o;
      if (o.name === 'groove-glint') glint = o;
    });
    if (!pips || !glint) return { missing: true };
    const pos = pips.geometry.getAttribute('position');
    const col = pips.geometry.getAttribute('color');
    const size = pips.geometry.getAttribute('aSize');
    const rows = [];
    for (let i = 0; i < pos.count; i++) {
      rows.push({
        x: +pos.getX(i).toFixed(4),
        y: +pos.getY(i).toFixed(4),
        g: +col.getY(i).toFixed(3), // the groove colour is green-heavy; slate is not
        s: +size.getX(i).toFixed(3),
      });
    }
    return { rows, visible: pips.visible, glintOn: glint.visible };
  });

const frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
await frame();
await frame();

const cold = await read();
if (cold.missing) {
  console.log('FAIL the named pips/glint are not in the scene');
  await browser.close();
  process.exit(1);
}
if (cold.rows.length !== 4) note(`the row has ${cold.rows.length} pips, not 4`);
if (!cold.visible) note('the cold row is hidden — it is meant to stand as an invitation');
if (cold.rows.some((r) => r.g > 0.5)) note('a cold pip is already lit');
if (cold.glintOn) note('the glint is up with nobody dancing');
const coldMid = (cold.rows[0].x + cold.rows[3].x) / 2;
if (Math.abs(coldMid) > 0.002) note(`the cold row is off centre (${coldMid})`);
if (problems.length === 0) ok('cold: four slate pips, centred, glint down');

// Winding up: three swaps in.
await page.evaluate(() => {
  window.__gdr.match.grooveStreak = 3;
  window.__gdr.match.grooveScore = 17;
});
await frame();
await frame();
const wind = await read();
const litCount = wind.rows.filter((r) => r.g > 0.5).length;
if (litCount !== 3) note(`streak 3 lights ${litCount} pips`);
const windMid = (wind.rows[0].x + wind.rows[3].x) / 2;
if (!(windMid < coldMid - 0.02)) {
  note(`the row did not give the tally its ground (mid ${coldMid} → ${windMid})`);
}
if (litCount === 3 && windMid < coldMid - 0.02) ok('winding up: three lit, row re-centred beside the tally');

// Running: the turn pip answers a swap with a hop — the glint rides it.
// At ~3 fps the whole hop can live inside one frame, so this polls the
// glint's visible flag (it holds until the next HUD frame) and bumps the
// streak a few times before calling it missed.
let answered = false;
for (let tries = 0; tries < 6 && !answered; tries++) {
  await page.evaluate(() => {
    window.__gdr.match.grooveStreak = 26 + (window.__t = (window.__t ?? 0) + 1);
    window.__gdr.match.grooveScore += 31;
  });
  answered = await page
    .waitForFunction(
      () => {
        let g = null;
        window.__gdr.scene().traverse((o) => { if (o.name === 'groove-glint') g = o; });
        return g?.visible === true;
      },
      { timeout: 2500, polling: 40 },
    )
    .then(() => true)
    .catch(() => false);
}
if (answered) ok('a paid swap threw the hop — the glint came up on the turn pip');
else note('six streak bumps and the glint never came up');
const run = await read();
if (run.rows.some((r) => r.g <= 0.5)) note('a running pip is unlit');

// THE LEDGER STANDS STILL: hold the streak, let the hop die, then watch —
// nothing on the row may move or sparkle while no swap lands.
await page.waitForTimeout(1500);
const still0 = await read();
let moved = false;
let sparkled = false;
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(250);
  const s = await read();
  sparkled ||= s.glintOn;
  moved ||= s.rows.some((r, j) => Math.abs(r.y - still0.rows[j].y) > 1e-4 || Math.abs(r.s - still0.rows[j].s) > 1e-3);
}
if (moved) note('the row kept dancing after the swaps stopped');
if (sparkled) note('the glint kept firing after the swaps stopped');
if (!moved && !sparkled) ok('streak held, no swaps: the row stands still (the old beat-clock bounce is gone)');

// The streak dying takes the row with it.
await page.evaluate(() => {
  window.__gdr.match.grooveStreak = 0;
  window.__gdr.match.grooveScore = 0;
});
await frame();
await frame();
const dead = await read();
if (dead.rows.some((r) => r.g > 0.5)) note('a pip stayed lit after the streak died');
if (dead.glintOn) note('the glint survived the streak dying');
if (dead.rows.every((r) => r.g <= 0.5) && !dead.glintOn) ok('streak dead: back to the slate invitation');

const info = await page.evaluate(() => window.__gdr.info());
if (info) console.log(`  (scene: ${info.calls} draw calls, ${info.triangles} triangles)`);

await browser.close();
if (problems.length) {
  console.log(`\n${problems.length} problem(s).`);
  process.exit(1);
}
console.log('\nthe row dances when you do and only then, at frame rate, for a 160-byte write.');
