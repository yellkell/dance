#!/usr/bin/env node
/**
 * THE STEP — the club's west door and the course behind it, walked
 * headlessly.
 *
 *   npm run dev        # terminal 1
 *   npm run server     # terminal 2 (the relay — the club needs a room)
 *   node tools/step-door.mjs [--lap]
 *
 * Four things are checked, in the order a player meets them:
 *
 *  1. THE ROOM — the corner reads as a room the way the arcade does: you
 *     can arc in through its door, you cannot arc through its walls, and
 *     the terrace stops at its wall instead of running past it.
 *  2. THE CROSSING — standing in the threshold takes you. The black falls,
 *     the club packs away, the void comes up, the rig plants on the home
 *     pad, the clock starts at the top of the score, and the club's
 *     teleport is off the whole time you're out there.
 *  3. THE LAWS — a clean handover moves the rig by nothing at all; the
 *     world moves ONLY on frames where the ground under you is travelling
 *     (NO SLIDING — checked frame by frame across a dwell and a departure);
 *     riding carries the world past a body that never moved; and a miss is
 *     a SLIP that holds the frame to the micron rather than correcting it.
 *     The way home puts you back outside the doorway.
 *  4. THE BILL — draw calls and triangles on the far side, against the same
 *     budgets the set is held to (≤ 60 draws, ≤ 100 k triangles).
 *
 * With `--lap` it also rides the WHOLE circuit on autopilot (step onto the
 * route's next platform the moment its ground is docked) and waits for the
 * ledger to close — about four minutes headless, so it's opt-in.
 */

import { chromium } from 'playwright';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
const RIDE_LAP = process.argv.includes('--lap');
const LAP_CAP_MS = 330_000;

async function launch() {
  try {
    return await chromium.launch();
  } catch {
    return chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  }
}

const browser = await launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => Boolean(window.__gdr?.course?.state), null, { timeout: 30000 });

const out = await page.evaluate(
  async ({ rideLap, lapCap }) => {
    const checks = [];
    const ok = (name, pass, detail = '') => checks.push({ name, pass, detail });
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const frames = async (n) => {
      for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r));
    };

    const g = window.__gdr;
    // Only CONSTANTS are imported: a dynamic import from here is not always
    // the same module instance the app is running (Vite hands out a fresh
    // one once HMR has stamped the app's copy), so live state is read back
    // through the game's own dev window — `__gdr.course` — and never
    // through a module singleton that might be a dead twin.
    const cfg = await import('/src/club/config.ts');
    const { CLUB, TELEPORT_AREAS, crossesWall, floorYAt } = cfg;
    const { GRID } = await import('/src/course/config.ts');
    const S = CLUB.step;
    const st = () => g.course.state();

    /* ── 1. the room ─────────────────────────────────────────────────── */
    const areaAt = (x, z) => {
      for (const a of TELEPORT_AREAS) {
        if (x >= a.minX && x <= a.maxX && z >= a.minZ && z <= a.maxZ) return a;
      }
      return null;
    };
    const canHop = (from, to) => {
      const area = areaAt(to[0], to[1]);
      if (!area) return false;
      const y = Math.max(floorYAt(from[0], from[1]), area.y);
      return !crossesWall(from[0], from[1], to[0], to[1], y);
    };
    const doorMid = [(S.doorX0 + S.doorX1) / 2, S.minZ - 0.4];
    const inRoom = [S.portalX, 3.0];
    const threshold = [S.portalX, S.portalZ - S.reach / 2];

    ok('the hall reaches the west door', canHop([-4.0, 1.0], doorMid));
    ok('the door leads into the room', canHop(doorMid, inRoom));
    ok('the threshold takes an arc like any other floor', Boolean(areaAt(threshold[0], threshold[1])));
    ok('no hop through the room’s east wall', !canHop([-3.5, 3.4], inRoom));
    ok('no hop through its north wall beside the door', !canHop([-8.0, 1.0], [-8.0, 3.4]));
    ok(
      'the room is the arcade, mirrored about the way in',
      S.maxX - S.minX === CLUB.arcade.maxX - CLUB.arcade.minX &&
        S.minZ === CLUB.arcade.minZ &&
        S.maxZ === CLUB.arcade.maxZ &&
        S.doorX1 - S.doorX0 === CLUB.arcade.doorX1 - CLUB.arcade.doorX0,
      `${(S.maxX - S.minX).toFixed(2)} m wide`,
    );
    const T = CLUB.terrace;
    const wings = TELEPORT_AREAS.filter(
      (a) => Math.abs(a.y - T.h) < 1e-6 && a.minZ > T.z0 && a.maxZ < T.z1 + 0.01,
    );
    const spans = wings.map((a) => +(a.maxX - a.minX).toFixed(3));
    ok(
      'both terrace wings now stop at a corner room',
      wings.length === 2 && spans[0] === spans[1],
      `wings ${spans.join(' / ')} m`,
    );

    /* ── 2. the crossing ─────────────────────────────────────────────── */
    const scene = g.scene();
    const clubUp = () => Boolean(scene.getObjectByName('the-club')?.visible);
    const courseUp = () => Boolean(scene.getObjectByName('the-course')?.visible);

    // Host, then walk through the doors. `holdFoyer` is set by the menu
    // when the room opens (the host reads their code off the board before
    // going in) and it lands whenever the relay answers — so hold it down
    // until the hall has actually been standing for a few frames, rather
    // than clearing it once and racing the socket.
    g.net.host();
    let waited = 0;
    let steady = 0;
    while (waited < 8000 && steady < 4) {
      g.match.holdFoyer = false;
      await frames(1);
      steady = clubUp() ? steady + 1 : 0;
      waited += 16;
    }
    if (g.net.state.phase !== 'hosting') {
      ok('the relay is up (npm run server)', false, `phase ${g.net.state.phase}`);
      return { checks, budget: null };
    }
    ok('the club is the room to start with', clubUp() && !courseUp());
    const clubBudget = g.info();

    // The head is the whole interface: stand in the doorway.
    g.rig(threshold[0], threshold[1], 0, 0);
    for (let i = 0; i < 60 && st().phase === 'off'; i++) await frames(1);
    ok('standing in the threshold starts the crossing', st().phase === 'in', `phase ${st().phase}`);

    for (let i = 0; i < 200 && st().phase === 'in'; i++) await frames(1);
    await frames(4);
    ok('the void has the room, the hall is gone', st().active && courseUp() && !clubUp());
    ok('you land on the home pad', st().tracked === 'home', st().tracked);
    ok('the clock starts at the top of the score', st().bars < 2, `bar ${st().bars.toFixed(2)}`);
    ok('the ledger starts empty', st().handovers === 0 && st().slips === 0);
    const courseBudget = g.info();

    /* ── 3. the laws ─────────────────────────────────────────────────── */
    const rigBefore = st().rig;
    g.course.head(GRID.pitch, 0); // one square east — the runner, docked
    await frames(10);
    ok('stepping east boards the runner', st().tracked === 'runner-out', st().tracked);
    // A micron is the tolerance: positions round-trip through float32 on
    // the way to the GPU, so "nothing" cannot honestly mean zero bits.
    const rigNow = st().rig;
    const moved = Math.hypot(rigNow.x - rigBefore.x, rigNow.z - rigBefore.z, rigNow.y - rigBefore.y);
    ok('the handover moves the world by nothing', moved < 1e-6, `${moved.toExponential(1)} m`);
    ok('and it is a clean one — no slip charged', st().slips === 0);

    /* ── NO SLIDING ────────────────────────────────────────────────────
     * The claim, exactly: the world moves ONLY on frames where the ground
     * you are standing on is travelling. Nothing eases, nothing corrects,
     * nothing catches up. Ride the runner from its dwell at home through
     * its departure and check every single frame — a slide would be a rig
     * that moved while its own deck was parked. */
    const boarded = st().rig;
    let prev = st();
    let violations = 0;
    let worst = 0;
    let sawDwell = false;
    let sawTravel = false;
    let t0 = performance.now();
    while (performance.now() - t0 < 60000 && st().bars < 7) {
      await frames(1);
      const now = st();
      const d = Math.hypot(now.rig.x - prev.rig.x, now.rig.y - prev.rig.y, now.rig.z - prev.rig.z);
      // Parked at BOTH ends of the frame: the one frame that straddles a
      // dwell's last instant and a departure's first is the ride starting,
      // not a slide, and sampling can only ever see it as one or the other.
      if (prev.ground.moving || now.ground.moving) sawTravel = true;
      else {
        sawDwell = true;
        if (d > 1e-6) {
          violations++;
          worst = Math.max(worst, d);
        }
      }
      prev = now;
    }
    ok(
      'the world moves only while your ground is travelling',
      violations === 0,
      violations ? `${violations} frames slid, worst ${worst.toExponential(1)} m` : 'no frame slid',
    );
    ok('…and both a dwell and a departure were watched', sawDwell && sawTravel);

    t0 = performance.now();
    let ridingBudget = g.info();
    while (performance.now() - t0 < 40000 && Math.abs(st().rig.x - boarded.x) < 2.0) {
      await sleep(100);
      // The bill mid-ride, not just on a lucky frame at the start line:
      // keep the worst draw count seen while the world is actually moving.
      const b = g.info();
      if (b && b.calls > ridingBudget.calls) ridingBudget = b;
    }
    ok('the runner carries the world past you', Math.abs(st().rig.x - boarded.x) > 2.0, `rig x ${st().rig.x.toFixed(2)}`);
    ok(
      'the bill holds mid-ride, not just at the start line',
      ridingBudget.calls <= 60 && ridingBudget.triangles <= 100000,
      `${ridingBudget.calls} draws, ${ridingBudget.triangles} triangles`,
    );
    // …and YOU didn't move: the body's play-area coordinates are exactly
    // where the step left them. That is the whole inversion.
    const drift = Math.hypot(st().body.x - GRID.pitch, st().body.z);
    ok('and you never moved — the world did', drift < 1e-6, `body drift ${drift.toExponential(1)} m`);

    /* ── THE SLIP — the miss that replaced the slide ──────────────────
     * Ride in to the east landing, step off onto the static deck, then
     * stand back on the runner AFTER it has pulled out. Departing ground
     * under an untracked body is charged as a miss, and the frame must
     * hold to the micron: there is no correction term to drain. */
    for (let i = 0; i < 200 && st().tracked !== 'east-step'; i++) {
      g.course.head(0, 0);
      await frames(1);
    }
    ok('stepping off at the landing boards the east deck', st().tracked === 'east-step', st().tracked);
    const slipsBefore = st().slips;
    // The runner pulls out of the east berth at bar 14. The window to be
    // caught standing on it is narrow by construction — before ~14.11 its
    // anchor still agrees with the rig and boarding is a CLEAN handover;
    // after ~14.4 the deck has slid out from under the head altogether and
    // there is nothing left to be standing on — so poll by frame, not by
    // clock, and step on the moment it stops being a legal board.
    while (st().bars < 14.15) await frames(1);
    const held = st().rig;
    g.course.head(GRID.pitch, 0); // stand where it was
    await sleep(900);
    const after = st();
    ok('ground that has left under you is a slip', after.slips === slipsBefore + 1, `${after.slips} slip(s)`);
    const slid = Math.hypot(after.rig.x - held.x, after.rig.y - held.y, after.rig.z - held.z);
    ok('and a slip slides the world by nothing', slid < 1e-6, `${slid.toExponential(1)} m`);
    ok('the frame stays with the deck you are actually on', after.tracked === 'east-step', after.tracked);
    g.course.head(0, 0); // back onto the route
    await frames(6);

    /* ── the whole lap, on autopilot ─────────────────────────────────── */
    let trail = null;
    if (rideLap) {
      trail = [];
      let last = '';
      const lapSlips = st().slips;
      t0 = performance.now();
      // The autopilot is the INVITATION, obeyed: whenever the route's next
      // ground is actually here, stand on the tile the circle of light is
      // sitting on. Nothing else — no clock, no route table, no cheating
      // ahead of the wayfinding a player is reading too.
      while (performance.now() - t0 < lapCap && st().laps < 1) {
        const now = st();
        if (now.tracked !== last) {
          trail.push(`${now.tracked}@${now.bars.toFixed(1)}`);
          last = now.tracked;
        }
        const step = g.course.nextStep();
        if (step) g.course.head(step.x, step.z);
        await sleep(40);
      }
      ok('the circuit closes — the lap ends where it began', st().laps === 1, trail.join(' → '));
      ok('and it closed without a further slip', st().slips === lapSlips, `${st().handovers} handovers`);
      // The lap's own bell holds for a beat and a half, then the door goes.
      t0 = performance.now();
      while (performance.now() - t0 < 20000 && st().phase !== 'off') await sleep(100);
      ok('closing the lap hands you back to the club', clubUp() && !courseUp() && !st().active);
      const backAt = { x: g.match.headX, z: g.match.headZ };
      ok(
        'and puts you down outside the door you went in by',
        Math.abs(backAt.x - S.portalX) < 0.4 && backAt.z < S.portalZ - S.reach && backAt.z > S.minZ,
        `x ${backAt.x.toFixed(2)} z ${backAt.z.toFixed(2)}`,
      );
    } else {
      g.course.leave();
      await frames(6);
      ok('stepping back out gives the club back', clubUp() && !courseUp() && !st().active);
    }

    return { checks, clubBudget, courseBudget, ridingBudget, trail };
  },
  { rideLap: RIDE_LAP, lapCap: LAP_CAP_MS },
);

let pass = 0;
for (const c of out.checks) {
  console.log(`${c.pass ? '  ok  ' : ' FAIL '} ${c.name}${c.detail ? `  — ${c.detail}` : ''}`);
  if (c.pass) pass++;
}
console.log(`\n${pass}/${out.checks.length} checks`);
if (out.clubBudget) console.log(`the club:   ${out.clubBudget.calls} draws, ${out.clubBudget.triangles} triangles`);
if (out.courseBudget) console.log(`the course: ${out.courseBudget.calls} draws, ${out.courseBudget.triangles} triangles  (at the start line)`);
if (out.ridingBudget) console.log(`  mid-ride: ${out.ridingBudget.calls} draws, ${out.ridingBudget.triangles} triangles  (budget ≤ 60 / ≤ 100000)`);
if (!RIDE_LAP) console.log('(run with --lap to ride the whole circuit)');

await browser.close();
process.exit(pass === out.checks.length ? 0 : 1);
