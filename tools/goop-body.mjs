#!/usr/bin/env node
/**
 * YOUR BODY, EMBODIED — does the dancer-driven goop hold together, are the
 * gel fists actually where the hands are, and do the wearer's eyes stay
 * clear of their own body?
 *
 *   npm run dev                      # terminal 1
 *   node tools/goop-body.mjs
 *
 * The vendored cohesion law was proven for AUTHORED poses (the boss's
 * dance vocabulary — tools/goop-cohesion.mjs); the solo/tour experiment
 * adds a driver the authors never met: a real player's head and hands,
 * pinned and derived (goopliath/embody.ts). This battery drives the REAL
 * creature + EmbodyRig through the poses a raid actually asks for:
 *
 *   groove swaps on the beat · sidestep dash · duck-and-hold (the sweep) ·
 *   cross-the-deck dash · a whip 180 read · getting CLIPPED (the dent) ·
 *   the eliminated slump and the stand-back-up
 *
 * and after every sim step checks (a) the bridge graph over the actual
 * field — one component = one body (paused only while a dent deliberately
 * carves it, then demanded again once the gel flows back) — (b) PIN
 * TRUTH: each fist blob within 1 cm of the tracked hand (glowstick hands
 * that aren't your hands read as someone else's body), (c) first-person
 * DAYLIGHT, two layers: the rendered pack (head/neck masked) never
 * swallows the wearer's eye point, and the cockpit fade is armed so
 * anything transient that DOES brush the lens (spring-lag wake mid-dash,
 * elbow overshoot) dissolves instead of smearing it, and (d) the NaN
 * poison law: one bad tracking frame is shrugged off, not inherited.
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
const page = await browser.newPage({ viewport: { width: 320, height: 240 } });
page.on('pageerror', (e) => fails.push(`[pageerror] ${e.message}`));
await page.goto(base + '/avatar-preview.html?still=1', { waitUntil: 'load', timeout: 30000 });

const result = await page.evaluate(async () => {
  const { GelCreature } = await import('/src/goopliath/GelCreature.ts');
  const { EmbodyRig } = await import('/src/goopliath/embody.ts');
  const { A, ANCHOR_COUNT } = await import('/src/goopliath/poses.ts');
  const { CREATURE } = await import('/src/goopliath/goopConfig.ts');

  const NAME = Object.fromEntries(Object.entries(A).map(([k, v]) => [v, k]));
  const CORE = ANCHOR_COUNT;

  const fx = { splat() {}, burst() {}, update() {}, flash() {}, group: null };
  const creature = new GelCreature(fx, { firstPerson: true });
  creature.setFormTarget(1);
  const rig = new EmbodyRig(creature);
  // Bare 'three' can't resolve from an inline evaluate — borrow the
  // classes off live objects instead (the vendored tools' trick).
  const Vector3 = creature.position.constructor;
  const Quaternion = creature.group.quaternion.constructor;

  const pose = {
    head: new Vector3(0, 1.62, 0),
    headQuat: new Quaternion(),
    handL: new Vector3(-0.2, 1.3, -0.35),
    handR: new Vector3(0.22, 1.25, -0.32),
    speedL: 0,
    speedR: 0,
  };

  /* ---- ONE PIECE: bridge graph over the actual CPU field ---- */
  const _p = new Vector3();
  const blob = (sim, i, out) => {
    // The render pack masks the head — walk the SIM cores for physics
    // truth (corePos is the live blob, mask or no mask).
    sim.corePos(i, out);
    return out;
  };
  const _a = new Vector3();
  const _b = new Vector3();
  const solidBridge = (sim, i, j, eps) => {
    blob(sim, i, _a);
    blob(sim, j, _b);
    const gap = _a.distanceTo(_b);
    if (gap > 1.2) return false; // nowhere near — skip the sampling
    let worst = -1e5;
    for (let s = 1; s <= 9; s++) {
      const t = s / 10;
      _p.set(_a.x + (_b.x - _a.x) * t, _a.y + (_b.y - _a.y) * t, _a.z + (_b.z - _a.z) * t);
      const f = sim.fieldAt(_p);
      if (f > worst) worst = f;
    }
    return worst <= -eps;
  };
  const pieces = (sim, eps) => {
    const parent = Array.from({ length: CORE }, (_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < CORE; i++) {
      for (let j = i + 1; j < CORE; j++) {
        if (solidBridge(sim, i, j, eps)) parent[find(i)] = find(j);
      }
    }
    const groups = new Map();
    for (let i = 0; i < CORE; i++) {
      const r = find(i);
      groups.set(r, (groups.get(r) ?? []).concat(NAME[i]));
    }
    if (groups.size === 1) return null;
    return [...groups.values()].sort((a, b) => a.length - b.length)[0].join('+');
  };

  const DT = 1 / 60;
  const lookWorld = new Vector3(0, 1.6, 2);
  const fist = new Vector3();
  const stats = {
    frames: 0,
    splits: 0,
    worstSplit: '',
    worstPinErr: 0,
    minEyeField: 1e9,
    headRendered: 0,
    nanEscaped: 0,
    reFormed: false,
  };

  // First-person DAYLIGHT: nearest RENDERED blob surface to the eyes —
  // this is exactly what the shader marches, mask applied.
  let eyeWorst = null;
  const eyeField = () => {
    const sim = creature.sim;
    creature.group.updateMatrixWorld();
    _p.copy(pose.head);
    creature.group.worldToLocal(_p);
    let d = 1e9;
    let at = -1;
    for (let i = 0; i < sim.packedCount; i++) {
      const dx = _p.x - sim.packed[i * 4];
      const dy = _p.y - sim.packed[i * 4 + 1];
      const dz = _p.z - sim.packed[i * 4 + 2];
      const di = Math.hypot(dx, dy, dz) - sim.packed[i * 4 + 3];
      if (di < d) { d = di; at = i; }
    }
    if (d < (eyeWorst?.d ?? 1e9)) {
      eyeWorst = {
        d, at, seg: segment,
        blob: [sim.packed[at * 4], sim.packed[at * 4 + 1], sim.packed[at * 4 + 2], sim.packed[at * 4 + 3]],
        eye: [_p.x, _p.y, _p.z],
      };
    }
    return d;
  };

  // The render pack must never carry the wearer's head: with HEAD+NECK
  // masked the pack is 2 short of the sim cores (plus transients). Any
  // packed blob CENTRED inside the head sphere is the mask failing.
  const headLeaked = () => {
    const sim = creature.sim;
    sim.corePos(A.HEAD, _a);
    for (let i = 0; i < sim.packedCount; i++) {
      const d = Math.hypot(
        _a.x - sim.packed[i * 4],
        _a.y - sim.packed[i * 4 + 1],
        _a.z - sim.packed[i * 4 + 2],
      );
      if (d < 0.02) return true;
    }
    return false;
  };

  let segment = 'warmup';
  // While a dent is live the field is DELIBERATELY carved — the ONE PIECE
  // law there is that the gel flows back, so the bridge graph pauses for
  // the crater and is demanded again after the heal.
  let craterHold = false;
  stats.perSegment = {};
  const step = (judge = true) => {
    rig.drive(pose);
    creature.update(DT, lookWorld);
    stats.frames++;
    for (let i = 0; i < creature.sim.packedCount * 4; i++) {
      if (!Number.isFinite(creature.sim.packed[i])) stats.nanEscaped++;
    }
    if (!judge || creature.formValue < 0.95) return;
    const seg = (stats.perSegment[segment] ??= { splits: 0, minEye: 1e9, stray: '' });
    if (!craterHold) {
      const s = pieces(creature.sim, 0.02);
      if (s) {
        stats.splits++;
        seg.splits++;
        if (!seg.stray) seg.stray = s;
        if (!stats.worstSplit) stats.worstSplit = s;
      }
    }
    for (const [hand, anchor] of [
      [pose.handL, A.FIST_L],
      [pose.handR, A.FIST_R],
    ]) {
      creature.group.updateMatrixWorld();
      _p.copy(hand);
      creature.group.worldToLocal(_p);
      creature.sim.corePos(anchor, fist);
      const err = fist.distanceTo(_p);
      if (err > stats.worstPinErr) stats.worstPinErr = err;
    }
    const eye = eyeField();
    stats.minEyeField = Math.min(stats.minEyeField, eye);
    seg.minEye = Math.min(seg.minEye, eye);
    if (headLeaked()) stats.headRendered++;
  };

  // Warm up: form up from the glob (the count-in pour).
  for (let i = 0; i < 200; i++) step();

  const runPose = (frames, fn) => {
    for (let f = 0; f < frames; f++) {
      fn(f / frames, f);
      step();
    }
  };
  const yawq = (yaw) => new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);

  /* ---- THE BATTERY: a night's verbs ---- */
  segment = 'groove';
  // Groove: one hand up, one down, swapping on the beat (110 BPM).
  runPose(180, (t, f) => {
    const swap = Math.sin(f * ((Math.PI * 2) / 33)); // ~0.55 s a side
    pose.head.set(0, 1.62, 0);
    pose.handL.set(-0.22, 1.35 + swap * 0.45, -0.2);
    pose.handR.set(0.22, 1.35 - swap * 0.45, -0.2);
    pose.speedL = pose.speedR = Math.abs(Math.cos(f * 0.19)) * 2.2;
  });
  segment = 'sidestep';
  // Sidestep dash: a beam answer — head crosses half the deck and back.
  runPose(140, (t) => {
    const k = Math.sin(t * Math.PI * 2);
    pose.head.set(k * 0.6, 1.6, 0);
    pose.handL.set(k * 0.6 - 0.2, 1.25, -0.25);
    pose.handR.set(k * 0.6 + 0.2, 1.22, -0.25);
    pose.speedL = pose.speedR = Math.abs(Math.cos(t * Math.PI * 2)) * 2.4;
  });
  segment = 'duck';
  // Duck-and-hold: the sweep answer — down fast, HELD low, then up.
  runPose(160, (t) => {
    const k = Math.min(1, Math.min(t, 1 - t) * 5);
    pose.head.set(0, 1.62 - k * 0.65, 0.04 * k);
    pose.handL.set(-0.2, 1.4 - k * 0.65, -0.22);
    pose.handR.set(0.2, 1.36 - k * 0.65, -0.2);
    pose.speedL = pose.speedR = 0;
  });
  segment = 'cross';
  // Cross the deck: the seesaw answer, front-to-back with a lean.
  runPose(140, (t) => {
    const k = Math.sin(t * Math.PI * 2);
    pose.head.set(0.05, 1.58, k * 0.55);
    pose.handL.set(-0.22, 1.28, k * 0.55 - 0.22);
    pose.handR.set(0.2, 1.3, k * 0.55 - 0.2);
  });
  segment = 'whip180';
  // The whip 180: reading a routine corner behind you.
  runPose(120, (t) => {
    const yaw = t * Math.PI;
    pose.headQuat.copy(yawq(yaw));
    pose.head.set(Math.sin(yaw) * 0.15, 1.62, 0);
    pose.handL.set(-0.18 * Math.cos(yaw), 1.4, -0.24 * Math.cos(yaw) + Math.sin(yaw) * -0.18);
    pose.handR.set(0.18 * Math.cos(yaw), 1.36, -0.22 * Math.cos(yaw) + Math.sin(yaw) * 0.18);
  });
  segment = 'settle';
  runPose(60, () => {
    pose.headQuat.copy(yawq(Math.PI));
    pose.speedL = pose.speedR = 0;
  });

  /* ---- CLIPPED: the dent carves, then the gel must flow back whole ---- */
  creature.group.updateMatrixWorld();
  _p.copy(pose.head);
  _p.y -= 0.45;
  const hitDir = new Vector3(0.7, -0.6, 0.4).normalize();
  segment = 'hit-crater';
  craterHold = true; // the crater is deliberate carving — see craterHold
  const hit = creature.receivePunchWorld(_p, hitDir, 2.3);
  stats.hitLanded = hit.hit;
  runPose(60, () => {}); // dentLife ~0.62 s — ride the whole crater out
  segment = 'hit-healed';
  craterHold = false;
  runPose(60, () => {});

  /* ---- POISON: one NaN tracking frame, shrugged off ---- */
  pose.head.set(NaN, NaN, NaN);
  step(false);
  pose.head.set(0, 1.62, 0);
  segment = 'poison-heal';
  runPose(90, () => {});

  /* ---- THE SLUMP: eliminated → glob → stand back up ---- */
  segment = 'slump';
  creature.setFormTarget(0);
  runPose(160, () => {});
  const slumped = creature.formValue < 0.3;
  segment = 'standup';
  creature.setFormTarget(1);
  runPose(220, () => {});
  stats.reFormed = slumped && creature.formValue > 0.95;
  segment = 'reformed';
  runPose(60, () => {});

  stats.eyeWorst = eyeWorst;

  /* ---- the cockpit fade is armed (and only on the body you inhabit) ---- */
  const fadeOf = (c) => {
    let v = null;
    c.group.traverse((o) => {
      const u = o.material?.uniforms?.uNearFade;
      if (u) v = u.value;
    });
    return v;
  };
  stats.bodyNearFade = fadeOf(creature);
  const bystander = new GelCreature(fx, {});
  stats.bossNearFade = fadeOf(bystander);

  return stats;
});

console.log('GOOP BODY —', JSON.stringify(result));
check(result.frames > 1300, `battery ran (${result.frames} frames)`);
check(
  result.splits === 0,
  `ONE PIECE on every formed frame (splits: ${result.splits}${result.worstSplit ? ' first stray: ' + result.worstSplit : ''})`,
);
check(result.worstPinErr < 0.005, `fists live on the hands (worst pin error ${(result.worstPinErr * 100).toFixed(2)} cm)`);
// The hard law: the eye POINT itself is never swallowed on honest
// choreography. Transient sub-fade brushes (the trunk's oozy wake swept
// through mid-dash, an elbow's spring overshoot) are the cockpit fade's
// job — checked armed below — so the point threshold is a floor, not 10 cm.
check(result.minEyeField > 0.005, `the eye point stays outside the rendered gel (min clearance ${(result.minEyeField * 100).toFixed(1)} cm)`);
check(
  typeof result.bodyNearFade === 'number' && result.bodyNearFade > 0.05,
  `the cockpit fade is armed on the worn body (${result.bodyNearFade})`,
);
check(result.bossNearFade === 0, `…and only on the worn body (bystander fade ${result.bossNearFade})`);
check(result.headRendered === 0, `the wearer's head is never in the render pack (${result.headRendered} leaks)`);
check(result.hitLanded === true, `a clipped landing actually dents the body`);
check(result.nanEscaped === 0, `NaN poison shrugged off (${result.nanEscaped} escaped)`);
check(result.reFormed === true, `the slump collapses and the body pours back up`);

/* ══════════════════ THE GATE: the real app, the real flow ══════════════════
 * The physics above ran the modules; this boots the SHIPPING world and
 * checks where the body is allowed to exist: a solo set and a tour night
 * wear it, an online set and the menu rooms never do. (The club floor has
 * no raid screens at all without a relay, so match.online IS the club
 * raid gate.)
 */
console.log('\nTHE GATE —');
const appPage = await browser.newPage({ viewport: { width: 800, height: 600 } });
appPage.on('pageerror', (e) => fails.push(`[app pageerror] ${e.message}`));
await appPage.goto(base, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => appPage.goto(base));
await appPage.waitForTimeout(1200);
await appPage.click('#enter-vr');
await appPage.waitForFunction(() => document.body.classList.contains('app-entered'), { timeout: 15000 });
await appPage.waitForTimeout(2000);

const bodyState = () =>
  appPage.evaluate(() => {
    const c = window.__gdr.body.creature;
    return c
      ? { exists: true, firstPerson: c.firstPerson, mode: c.mode, form: c.formValue, quality: c.qualityOverride }
      : { exists: false };
  });
const startAndSettle = async (opts) => {
  await appPage.evaluate((o) => window.__gdr.startRaid(o), opts);
  await appPage.waitForTimeout(2500); // count-in: the pour
  return bodyState();
};

const solo = await startAndSettle({ seats: 8 });
check(solo.exists && solo.firstPerson && solo.mode === 'puppet', `a SOLO set wears the body (puppet, first person)`);
check(solo.exists && solo.form > 0.5, `…and it pours up through the count-in (form ${solo.form?.toFixed(2)})`);

const tour = await startAndSettle({ seats: 8, tour: { set: 0, song: 2 } });
check(tour.exists && tour.firstPerson, `a TOUR finale wears it too`);
check(tour.exists && tour.quality < solo.quality, `…leaner when the GOOP shares the frame (${tour.quality} vs ${solo.quality})`);

const online = await startAndSettle({ seats: 8, online: true });
check(online.exists === false, `an ONLINE set never builds it (club models stay the mannequins)`);

await appPage.evaluate(() => window.__gdr.toLobby());
await appPage.waitForTimeout(600);
const lobby = await bodyState();
check(lobby.exists === false, `the menu rooms are body-free (the boss's own law)`);

await browser.close();
if (fails.length) {
  console.error(`\n${fails.length} failure(s)`);
  process.exit(1);
}
console.log('\nthe experiment holds — one piece, honest hands, clear eyes');
