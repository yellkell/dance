#!/usr/bin/env node
/**
 * THE ARMS — does the motion layer behave, and does the rig read?
 *
 *   npm run dev                      # terminal 1
 *   node tools/arm-motion.mjs
 *
 * Drives the REAL modules (game/poseMotion.ts + game/avatars.ts) headlessly
 * and checks the claims the figures now stand on:
 *
 *  - poison immunity: a NaN / −Infinity target channel is ignored, and an
 *    already-poisoned pose heals on the next step (the exact failure that
 *    kept the MC invisible — an exponential ease never recovers from NaN);
 *  - follow-through exists: underdamped hands measurably overshoot a step
 *    target and then settle — bots and the MC swing THROUGH their marks;
 *  - tracking never invents bounce: critically damped hands (remote
 *    humans) close on the same target with no overshoot at all;
 *  - yaw turns the short way across ±π, never the long way round;
 *  - the elbow pole adapts: a hand crossed to the far shoulder tucks its
 *    elbow instead of chicken-winging it outward through the chest;
 *  - the stick is a pointer: thrust a hand forward and the blade aims
 *    forward, raise it and the blade stands up — and it turns with the
 *    body's yaw instead of gripping one fixed patch of sky.
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

let browser;
try {
  browser = await chromium.launch();
} catch {
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
}
const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
page.on('pageerror', (e) => fails.push(`[pageerror] ${e.message}`));
await page.goto(base + '/avatar-preview.html?still=1', { waitUntil: 'load', timeout: 30000 });

const r = await page.evaluate(async () => {
  const { PoseMotion } = await import('/src/game/poseMotion.ts');
  const { buildDancer } = await import('/src/game/avatars.ts');

  const DT = 1 / 60;
  const neutral = () => ({
    hx: 0, hy: 1.52, hz: 0, yaw: 0, pitch: 0, roll: 0,
    lx: -0.3, ly: 1.0, lz: -0.1, rx: 0.3, ry: 1.0, rz: -0.1,
    slump: 0,
  });
  const out = {};

  /* ── poison immunity ── */
  {
    const m = new PoseMotion();
    const pose = neutral();
    const tgt = neutral();
    tgt.ly = NaN;
    tgt.yaw = -Infinity;
    for (let i = 0; i < 30; i++) m.step(pose, tgt, DT, { headRate: 9, handHz: 3.2, zeta: 0.62 });
    out.poisonIgnored = Number.isFinite(pose.ly) && Number.isFinite(pose.yaw);

    const sick = neutral();
    sick.ly = NaN;
    sick.yaw = NaN;
    m.step(sick, neutral(), DT, { headRate: 9, handHz: 3.2, zeta: 0.62 });
    out.poisonHeals = Number.isFinite(sick.ly) && Number.isFinite(sick.yaw);
  }

  /* ── follow-through vs tracking: step the left hand up 0.6 m ── */
  const settleRun = (zeta) => {
    const m = new PoseMotion();
    const pose = neutral();
    const tgt = neutral();
    tgt.ly = pose.ly + 0.6;
    let peak = -1e9;
    for (let i = 0; i < 240; i++) {
      m.step(pose, tgt, DT, { headRate: 9, handHz: 3.2, zeta });
      peak = Math.max(peak, pose.ly);
    }
    return { peak, over: peak - tgt.ly, settledErr: Math.abs(pose.ly - tgt.ly) };
  };
  {
    const springy = settleRun(0.62);
    out.overshoot = springy.over;
    out.overshootSettles = springy.settledErr < 0.01;
    const tracked = settleRun(1);
    out.trackedOver = tracked.over;
    out.trackedSettles = tracked.settledErr < 0.01;
  }

  /* ── yaw wraps the short way across ±π ── */
  {
    const m = new PoseMotion();
    const pose = neutral();
    pose.yaw = Math.PI - 0.05;
    const tgt = neutral();
    tgt.yaw = -Math.PI + 0.05;
    m.step(pose, tgt, DT, { headRate: 9, handHz: 3.2, zeta: 1 });
    // Short way = onward THROUGH π (yaw increases); the long way would
    // swing it back down through zero.
    out.yawWraps = pose.yaw > Math.PI - 0.05;
  }

  /* ── the rig: elbow pole + stick direction, read off named meshes ── */
  const rig = buildDancer(0.5);
  const V3 = rig.root.position.constructor;
  const find = (n) => rig.root.getObjectByName(n);
  const stickDir = (hand) => new V3(0, 1, 0).applyQuaternion(find(hand).quaternion);
  {
    // Left hand crossed to the RIGHT shoulder: the elbow must tuck (stay
    // at or inside its own shoulder's line), not flare further out left.
    const p = neutral();
    p.lx = 0.16;
    p.ly = 1.3;
    p.lz = -0.12;
    rig.pose(p);
    const elbow = find('elbow-l').position;
    const shoulder = find('shoulder-l').position;
    out.crossedElbowTucks = elbow.x >= shoulder.x - 0.03;

    // And at rest it still bends outward like an arm at ease.
    rig.pose(neutral());
    out.restElbowOut = find('elbow-l').position.x < find('shoulder-l').position.x - 0.05;
  }
  {
    // Thrust forward → the blade points forward (−z); raise → it stands up.
    const p = neutral();
    p.rx = 0.18;
    p.ry = 1.15;
    p.rz = -0.62;
    rig.pose(p);
    out.thrustAims = stickDir('hand-r').z < -0.45;
    const q = neutral();
    q.ry = 1.75;
    q.rx = 0.32;
    rig.pose(q);
    out.raisedStands = stickDir('hand-r').y > 0.75;
  }
  {
    // The grip turns with the body: same raised pose, figure spun about —
    // the stick's lean must spin with it (x flips sign with the yaw).
    const p = neutral();
    p.ry = 1.75;
    p.rx = 0.32;
    rig.pose(p);
    const front = stickDir('hand-r');
    p.yaw = Math.PI;
    p.rx = -0.32; // the same raise, in the turned body's own frame
    rig.pose(p);
    const back = stickDir('hand-r');
    out.gripTurns = Math.sign(front.x) !== Math.sign(back.x) && back.y > 0.7;
  }
  rig.dispose();
  return out;
});

console.log('ARM MOTION — the physics layer and the rig, checked live');
check(r.poisonIgnored, 'a NaN / −Infinity target never reaches the pose');
check(r.poisonHeals, 'an already-poisoned pose heals on the next step');
check(r.overshoot > 0.02 && r.overshootSettles, `underdamped hands follow through (peak +${(r.overshoot * 100).toFixed(1)} cm) and settle`);
check(r.trackedOver < 0.002 && r.trackedSettles, 'critically damped hands track with zero invented bounce');
check(r.yawWraps, 'yaw crosses ±π the short way round');
check(r.crossedElbowTucks, 'a crossed hand tucks its elbow instead of chicken-winging');
check(r.restElbowOut, 'an arm at ease still bends outward');
check(r.thrustAims, 'a forward thrust aims the glowstick forward');
check(r.raisedStands, 'a raised stick stands up like a torch');
check(r.gripTurns, "the grip turns with the body's yaw");

await browser.close();
if (fails.length) {
  console.error(`\n${fails.length} failed.`);
  process.exit(1);
}
console.log('\nthe arms hold up.');
