#!/usr/bin/env node
/**
 * Photograph THE STEP and the course behind it — the west door's review
 * views, captured through the real app:
 *
 *   npm run dev        # terminal 1
 *   npm run server     # terminal 2 (the relay — the club needs a room)
 *   node tools/step-shots.mjs [outDir]
 *
 * The club half is shot the way club-capture.mjs shoots the hall: park the
 * rig, wait for the frame to settle, take the picture. The course half
 * can't be — out there the rig belongs to whatever platform you're standing
 * on — so the BODY is moved instead (`__gdr.course.head`) and the rig is
 * used only to aim the view. The circuit is ridden on autopilot to reach
 * the skywalk, because a photograph of the set piece has to be taken from
 * the set piece.
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
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => Boolean(window.__gdr?.course?.state), null, { timeout: 30000 });

// Get the landing page out of the way WITHOUT opening a session: the title
// card is cued by entering, and an emulated headset would fight every hand
// placement below for the camera.
await page.evaluate(() => document.body.classList.add('app-entered'));

const shot = async (name) => {
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`  ${name}.png`);
};
/** Park the rig (the club) or just aim the view (the course). */
const look = (x, z, yaw, y = 0, pitch = 0) =>
  page.evaluate(([px, pz, pyaw, py, ppitch]) => window.__gdr.rig(px, pz, pyaw, py, ppitch), [x, z, yaw, y, pitch]);
/** …aimed at a place rather than at an angle. Two of the club's views were
 *  pointed at the wrong wall by hand; a bearing is not a thing to guess. */
const bearing = (fromX, fromZ, toX, toZ) => Math.atan2(-(toX - fromX), -(toZ - fromZ));
const at = (x, z, tx, tz, y = 0, pitch = 0) => look(x, z, bearing(x, z, tx, tz), y, pitch);
const head = (x, z, y = 1.65) =>
  page.evaluate(([hx, hz, hy]) => window.__gdr.course.head(hx, hz, hy), [x, z, y]);
const evalp = (fn, arg) => page.evaluate(fn, arg);

const S = await page.evaluate(async () => (await import('/src/club/config.ts')).CLUB.step);

// ── the club: a room open, and the west corner ──────────────────────────
await page.evaluate(() => window.__gdr.net.host());
await page
  .waitForFunction(() => window.__gdr.net.state.phase === 'hosting', { timeout: 8000 })
  .catch(() => console.log('  (relay unreachable — the club will not open)'));
await page.evaluate(() => {
  window.__gdr.match.holdFoyer = false;
});
await page.waitForTimeout(1600);

console.log('the club:');
await at(-3.6, -0.6, S.portalX + 0.6, S.minZ + 0.4);
await shot('step-01-the-corner-from-the-floor');
await look((S.doorX0 + S.doorX1) / 2, S.minZ - 1.6, Math.PI, 0, 0.06);
await shot('step-02-the-doorway');
await look(S.portalX, 2.5, Math.PI);
await shot('step-03-the-room');
await look(S.portalX + 0.15, 3.55, Math.PI - 0.06);
await shot('step-04-the-frame');
await at(S.portalX + 1.15, 2.95, S.portalX, S.portalZ - S.reach / 2, 0, -0.45);
await shot('step-05-the-threshold');
await at(-1.4, 4.1, S.maxX - 0.6, 3.2);
await shot('step-06-the-arcade-s-twin-across-the-way-in');

// ── through it ──────────────────────────────────────────────────────────
console.log('the crossing:');
await look(S.portalX, S.portalZ - S.reach / 2, Math.PI);
await page.waitForTimeout(300);
await shot('step-07-going-through');
await page.waitForTimeout(1400); // the black falls, the world swaps, it lifts

// ── the course ──────────────────────────────────────────────────────────
console.log('the course:');
await head(0, 0);
await look(0, 0, 0);
await shot('course-01-arrival-room-check');
await look(0, 0, 0.35, 0, -0.95);
await shot('course-02-the-home-pad');
await look(0, 0, -1.35);
await shot('course-03-the-runner-docked');

// Take the first step, so the card turns over into the route.
await head(0.66, 0);
await page.waitForTimeout(700);
await look(0, 0, 0);
await shot('course-04-the-route-card');
await look(0, 0, -0.9, 0, -0.15);
await shot('course-05-riding-out');

// Wait for the runner to be well into its travel — ground in motion is red.
await page.waitForFunction(
  () => {
    const s = window.__gdr.course.state();
    return s.ground.moving && Math.abs(s.rig.x) > 0.8;
  },
  { timeout: 25000 },
).catch(() => {});
await look(0, 0, -2.4, 0, -0.25);
await shot('course-06-the-void-from-a-moving-deck');

// THE WAY OUT card. It plants itself where you are LOOKING when it goes
// up — so aim first, then ask for it, or you photograph the back of your
// own head's worth of void.
await look(0, 0, 0, 0, -0.1);
await page.waitForTimeout(200);
await evalp(() => window.__gdr.course.menu());
await page.waitForTimeout(700);
await shot('course-07-the-way-out');
await evalp(() => window.__gdr.course.press('ride'));
await page.waitForTimeout(400);

// ── ride to the skywalk, and photograph the set piece from it ───────────
console.log('the skywalk (riding there — a couple of minutes):');
await page.evaluate(async () => {
  const g = window.__gdr;
  const score = await import('/src/course/score.ts');
  const { G } = await import('/src/course/state.ts');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const t0 = performance.now();
  while (performance.now() - t0 < 200000 && score.PLATFORMS[G.tracked].id !== 'skywalk') {
    const tgt = G.wayfind.targetIndex;
    if (tgt >= 0 && tgt !== G.tracked) {
      const st = G.platforms[tgt];
      if (st.aligned && !st.moving) {
        let best = null;
        let bd = Infinity;
        for (const sq of score.PLATFORMS[tgt].claim) {
          const o = score.sqOffset(sq);
          const x = st.anchor.x - G.rig.x + o.x;
          const z = st.anchor.z - G.rig.z + o.z;
          const d = Math.hypot(x - G.body.x, z - G.body.z);
          if (d < bd) {
            bd = d;
            best = { x, z };
          }
        }
        if (best) g.course.head(best.x, best.z);
      }
    }
    await sleep(40);
  }
});
const where = await page.evaluate(() => window.__gdr.course.state());
console.log(`  standing on ${where.tracked} at y ${where.rig.y.toFixed(1)}`);
// Look DOWN at the deck you are standing on: the point of the skywalk is
// that there is a floor under you and a storey and a half of nothing under
// that, and a level camera photographs neither.
// Along the crossing, with the deck's near edge in shot: the skywalk is a
// floor with a storey and a half of nothing under it, and a level camera
// photographs neither the floor nor the drop.
await head(0.33, 0.33);
await look(0, 0, Math.PI / 2, 0, -0.42);
await shot('course-08-on-the-skywalk');
await look(0, 0, Math.PI / 2 + 0.5, 0, -1.0);
await shot('course-09-the-void-below');
await look(0, 0, -0.5, 0, -0.2);
await shot('course-10-the-crossing-at-height');

// ── and out ─────────────────────────────────────────────────────────────
console.log('back through:');
await evalp(() => window.__gdr.course.menu());
await page.waitForTimeout(500);
await evalp(() => window.__gdr.course.press('quit'));
await page.waitForTimeout(2200);
await look(S.portalX, 2.6, 0);
await shot('step-08-back-out-facing-the-hall');

console.log(`\n${out}`);
await browser.close();
