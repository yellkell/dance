#!/usr/bin/env node
/**
 * THE COUPE TOWER — can you build one, does it hold, does it fall?
 *
 *   npm run dev
 *   npm run server          # the drinks only simulate inside a room
 *   node tools/glass-stack.mjs
 *
 * Free stacking has no sockets and no snap: a rim is a surface, a glass
 * resting on a glass is stuck to it, and glasses only shove each other
 * apart when they share a level (see PROP_PHYS's stack block). That is
 * easy to state and easy to get subtly wrong, so this builds the two
 * shapes a bar actually asks for — a three-high tower and a bridging
 * pyramid — then pulls the bottom out and checks the thing collapses.
 *
 * Exits non-zero if any of it fails.
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
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
page.on('pageerror', (e) => fails.push(`[pageerror] ${e.message}`));
await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => page.goto(base));
await page.waitForTimeout(1200);
await page.click('#enter-vr');
await page.waitForFunction(() => document.body.classList.contains('app-entered'), { timeout: 15000 });
await page.waitForTimeout(2200);
await page.evaluate(() => window.__gdr.net.host());
await page
  .waitForFunction(() => window.__gdr.net.state.phase === 'hosting', { timeout: 8000 })
  .catch(() => {
    console.log('  (relay unreachable — the drinks never simulate; run `npm run server`)');
  });
await page.waitForTimeout(1000);

// The still room's low table: a flat shelf away from the bar's traffic.
const TABLE = { x: -6.8, z: -9.28, y: 0.36 };
const RIM = await page.evaluate(async () => (await import('/src/club/props.ts')).PROP_PHYS.rimY);

// THE HOUSE IS ALSO USING THESE GLASSES. The dumbwaiter puts one coupe on
// its plate and holds it there until somebody takes it, so the pool always
// has one slot that is not ours to play with. Pick the free ones by asking
// rather than assuming ids, or the test spends its time fighting the bar.
const free = (await page.evaluate(() => window.__gdr.props.glasses()))
  .filter((g) => g.mode !== 'pedestal' && g.mode !== 'held')
  .map((g) => g.id);
const [A, B, C] = free;
if (free.length < 3) {
  console.log('  (fewer than three free glasses — is the pool full?)');
  process.exit(1);
}

/** Drop a glass from 30 cm up and WAIT FOR IT TO REST. A coupe bounces
 *  before it settles, so a fixed timer samples whatever the bounce happens
 *  to be doing — poll the real mode instead. */
async function place(id, x, y, z, timeout = 6000) {
  await page.evaluate(([i, p]) => window.__gdr.props.launch(i, p, [0, -0.35, 0]), [id, [x, y, z]]);
  const t0 = Date.now();
  for (;;) {
    await page.waitForTimeout(120);
    const m = await page.evaluate((i) => window.__gdr.props.glasses()[i].mode, id);
    if (m === 'rest') return true;
    if (Date.now() - t0 > timeout) return false;
  }
}
const glasses = () => page.evaluate(() => window.__gdr.props.glasses());

console.log('THE TOWER — three coupes, each set on the one below:');
await place(A, TABLE.x, TABLE.y + 0.3, TABLE.z);
await place(B, TABLE.x, TABLE.y + RIM + 0.3, TABLE.z);
await place(C, TABLE.x, TABLE.y + 2 * RIM + 0.3, TABLE.z);
let g = await glasses();
const tower = [g[A], g[B], g[C]];
tower.forEach((t, i) => console.log(`     level ${i}: y=${t.pos[1].toFixed(3)} clearance=${t.clearance.toFixed(4)} ${t.mode}`));
check(tower.every((t) => t.mode === 'rest'), 'all three came to rest');
check(
  Math.abs(tower[1].pos[1] - (tower[0].pos[1] + RIM)) < 0.01 &&
    Math.abs(tower[2].pos[1] - (tower[1].pos[1] + RIM)) < 0.01,
  'each stands exactly on the rim below it',
);
check(tower.every((t) => Math.abs(t.clearance) < 0.005), 'every level is seated (no float, no sink)');

// It has to HOLD — the old attempt's piles slid apart on their own.
const before = (await glasses()).map((x) => x.pos);
await page.waitForTimeout(3000);
const after = (await glasses()).map((x) => x.pos);
let drift = 0;
for (const i of [A, B, C]) {
  drift = Math.max(drift, Math.hypot(after[i][0] - before[i][0], after[i][1] - before[i][1], after[i][2] - before[i][2]));
}
check(drift < 0.005, `the tower stands still (max drift ${drift.toFixed(5)} m over 3 s)`);

// The same three coupes, re-thrown into the other shape a bar builds.
//
// The base pair's spacing is bounded at both ends and the window is not
// wide: two coupes cannot stand closer than their bowls allow (0.144 m,
// or they shove each other apart), and a bridging glass reaches only
// PROP_PHYS.stackReach (0.108) from each axis, so the pair must be under
// 0.216 apart for its foot to catch both rims. 0.18 sits in the middle of
// that window — which is, satisfyingly, about where you would set two
// glasses down by hand.
console.log('THE PYRAMID — one coupe bridging two below:');
await place(A, TABLE.x + 0.25, TABLE.y + 0.3, TABLE.z);
await place(B, TABLE.x + 0.25 + 0.18, TABLE.y + 0.3, TABLE.z);
g = await glasses();
const [a, b] = [g[A], g[B]];
const gap = Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2]);
check(a.mode === 'rest' && b.mode === 'rest', `two neighbours at rest, ${gap.toFixed(3)} m apart`);
await place(C, (a.pos[0] + b.pos[0]) / 2, TABLE.y + RIM + 0.3, (a.pos[2] + b.pos[2]) / 2);
const top = (await glasses())[C];
console.log(`     bridge: y=${top.pos[1].toFixed(3)} clearance=${top.clearance.toFixed(4)} ${top.mode}`);
check(top.mode === 'rest', 'the bridging coupe came to rest');
check(
  Math.abs(top.pos[1] - (TABLE.y + RIM)) < 0.02,
  'it rides the pair\'s rims, not the table between them',
);

console.log('PULL THE BOTTOM OUT — what is held up must come down:');
const heldUp = (await glasses())[C].pos[1];
await page.evaluate(([i]) => window.__gdr.props.launch(i, [-6.0, 1.1, -8.9], [0, 0, 0]), [A]);
await page.waitForTimeout(2500);
const fell = (await glasses())[C];
check(fell.pos[1] < heldUp - 0.05, `the bridging coupe came down (${heldUp.toFixed(3)} → ${fell.pos[1].toFixed(3)})`);
check(fell.clearance > -0.005, 'and did not end up inside the furniture');

await browser.close();
if (fails.length) {
  console.log(`\n${fails.length} problem(s)`);
  process.exit(1);
}
console.log('\nthe tower stands.');
process.exit(0);
