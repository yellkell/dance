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
 * The battery wears the LIVE dress — ARMS ONLY (BODY.liveDress): the
 * first playtest proved a chest between your eyes and the deck hides the
 * paint the game is made of, so mid-set only the arm chains render. After
 * every sim step it checks (a) the bridge graph over the PHYSICS field —
 * one component = one body (paused only while a dent deliberately carves
 * it, then demanded again once the gel flows back) — (b) THE ARM ROPES:
 * in the RENDERED field (packed blobs only — what the shader marches),
 * each arm's shoulder→elbow→fist chain stays one rope of gel, including
 * hands resting at the chest, where the old trunk-drape exemption used to
 * let a fist bridge to an INVISIBLE belly and float off its own arm as a
 * bead — (c) PIN TRUTH: each fist blob within 1 cm of the tracked hand,
 * (d) THE MASK LAW: a masked core never enters the render pack, (e)
 * first-person DAYLIGHT: the rendered pack never swallows the wearer's
 * eye point, with the cockpit fade armed for anything transient that
 * brushes the lens, and (f) the NaN poison law: one bad tracking frame is
 * shrugged off, not inherited.
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
    maskLeaks: 0,
    armBeads: 0,
    firstBead: '',
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

  // THE MASK LAW: a masked core never enters the render pack. The pack
  // copies core positions verbatim, so a leak is an exact float match
  // against a masked core's live position.
  const maskLeaked = () => {
    const sim = creature.sim;
    for (let c = 0; c < CORE; c++) {
      if (!sim.renderSkip[c]) continue;
      sim.corePos(c, _a);
      for (let i = 0; i < sim.packedCount; i++) {
        if (
          Math.abs(_a.x - sim.packed[i * 4]) < 1e-6 &&
          Math.abs(_a.y - sim.packed[i * 4 + 1]) < 1e-6 &&
          Math.abs(_a.z - sim.packed[i * 4 + 2]) < 1e-6
        ) {
          return true;
        }
      }
    }
    return false;
  };

  // The RENDERED field — smooth-min over the PACKED blobs only, the same
  // maths the shader marches. Physics keeps the whole body; what the
  // wearer SEES is only this.
  const smin = (a, b, k) => {
    const h = Math.min(Math.max(0.5 + (0.5 * (b - a)) / k, 0), 1);
    return b + (a - b) * h - k * h * (1 - h);
  };
  const packedFieldAt = (sim, x, y, z) => {
    const k = CREATURE.blend * sim.blendScale;
    let d = 1e5;
    for (let i = 0; i < sim.packedCount; i++) {
      const dx = x - sim.packed[i * 4];
      const dy = y - sim.packed[i * 4 + 1];
      const dz = z - sim.packed[i * 4 + 2];
      d = smin(d, Math.hypot(dx, dy, dz) - sim.packed[i * 4 + 3], k);
    }
    return d;
  };

  // THE ARM ROPES: in the arms dress each rendered chain must be one
  // piece of the RENDERED field — a fist bridged only to an invisible
  // trunk is a floating bead.
  const ARM_CHAINS = [
    ['L', [A.SHOULDER_L, A.ELBOW_L, A.FIST_L]],
    ['R', [A.SHOULDER_R, A.ELBOW_R, A.FIST_R]],
  ];
  const armBead = () => {
    const sim = creature.sim;
    for (const [side, chain] of ARM_CHAINS) {
      for (let seg = 0; seg + 1 < chain.length; seg++) {
        sim.corePos(chain[seg], _a);
        sim.corePos(chain[seg + 1], _b);
        let worst = -1e5;
        for (let n = 1; n <= 9; n++) {
          const t = n / 10;
          const f = packedFieldAt(
            sim,
            _a.x + (_b.x - _a.x) * t,
            _a.y + (_b.y - _a.y) * t,
            _a.z + (_b.z - _a.z) * t,
          );
          if (f > worst) worst = f;
        }
        if (worst > -0.02) return `${side}:${seg === 0 ? 'shoulder-elbow' : 'elbow-fist'}`;
      }
    }
    return null;
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
    if (maskLeaked()) stats.maskLeaks++;
    if (creature.dress === 'arms' && !craterHold) {
      const bead = armBead();
      if (bead) {
        stats.armBeads++;
        if (!stats.firstBead) stats.firstBead = `${segment} ${bead}`;
      }
    }
  };

  // Warm up: form up from the glob (the count-in pour), in the FULL dress.
  for (let i = 0; i < 200; i++) step();

  // The record drops: shed to the ARMS — the shipping live-set dress the
  // whole battery below is danced in (exactly what GoopBodySystem does).
  creature.setFirstPersonDress('arms');

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
  segment = 'guard-at-chest';
  // Hands resting AT the chest — the old drape-exemption zone: with the
  // trunk invisible, the leash must still rope each fist to its own arm.
  runPose(100, () => {
    pose.head.set(0, 1.62, 0);
    pose.handL.set(-0.12, 1.2, -0.16);
    pose.handR.set(0.12, 1.18, -0.15);
    pose.speedL = pose.speedR = 0;
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

  /* ---- THE SLUMP: eliminated → glob → stand back up. Elimination hands
   * the FULL dress back (nothing left to read; the body can be a body). */
  creature.setFirstPersonDress('full');
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
check(result.maskLeaks === 0, `masked anchors never reach the render pack (${result.maskLeaks} leaks)`);
check(
  result.armBeads === 0,
  `each arm renders as ONE rope, hands-at-chest included (beads: ${result.armBeads}${result.firstBead ? ' first: ' + result.firstBead : ''})`,
);
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
      ? {
          exists: true,
          firstPerson: c.firstPerson,
          mode: c.mode,
          form: c.formValue,
          quality: c.qualityOverride,
          dress: c.dress,
          screen: window.__gdr.match.screen,
        }
      : { exists: false };
  });
const startAndSettle = async (opts) => {
  await appPage.evaluate((o) => window.__gdr.startRaid(o), opts);
  await appPage.waitForTimeout(2500); // count-in: the pour
  return bodyState();
};

await appPage.evaluate((o) => window.__gdr.startRaid(o), { seats: 8 });
// The count-in: the FULL body pours up while the screen is still counting.
const pouredFull = await appPage
  .waitForFunction(
    () => {
      const c = window.__gdr.body.creature;
      return !!c && c.dress === 'full' && c.formValue > 0.5 && window.__gdr.match.screen === 'countdown';
    },
    { timeout: 15000, polling: 100 },
  )
  .then(() => true)
  .catch(() => false);
const solo = await bodyState();
check(solo.exists && solo.firstPerson && solo.mode === 'puppet', `a SOLO set wears the body (puppet, first person)`);
check(pouredFull, `the count-in pours the FULL body (dress ${solo.dress}, form ${solo.form?.toFixed(2)})`);
// The drop: the record starts and the body sheds to the arms.
await appPage.waitForFunction(() => window.__gdr.match.screen === 'raid', { timeout: 30000, polling: 100 });
await appPage.waitForTimeout(400);
const liveState = await bodyState();
check(liveState.dress === 'arms', `the record drops and the body sheds to THE ARMS (dress ${liveState.dress})`);
// Elimination: the whole ghost returns and slumps.
await appPage.evaluate(() => {
  for (const pl of window.__gdr.match.players) if (pl.kind === 'local') pl.alive = false;
});
await appPage.waitForTimeout(900);
const outState = await bodyState();
check(
  outState.dress === 'full' && outState.form < 0.9,
  `eliminated: the full ghost returns and slumps (dress ${outState.dress}, form ${outState.form?.toFixed(2)})`,
);

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
