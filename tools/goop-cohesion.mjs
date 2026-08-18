#!/usr/bin/env node
/**
 * ONE PIECE — does the DJ hold together through the whole show?
 *
 *   npm run dev                      # terminal 1
 *   node tools/goop-cohesion.mjs
 *
 * The gel body is a smooth-min over ~20 blobs, and the surface genuinely
 * severs once a limb segment's gap passes blend/2 — a pose is either one
 * rope of goo or beads floating in formation, and which one is pure
 * geometry. So this drives the REAL creature (GelCreature + GoopSim, the
 * exact modules the stage uses) through the full performance — every dance
 * combo on the bar with the two-step, every gesture at the system's real
 * reach and beyond, the melt, and a stance-swap torture loop — and after
 * every sim step checks the field the shader would render: sample the
 * smooth-min along every near pair, build the bridge graph, count the
 * pieces. One component = one creature.
 *
 * Runs the battery twice — cohesion off (the before), cohesion on — and
 * exits non-zero unless the cohesive body is ONE PIECE on every frame.
 * "meaty" additionally requires every bridge to carry enough field depth
 * (−0.03) that the agitation wobble can't shimmer it apart mid-groove.
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
// The catwalk page is the lightest module host the dev server offers.
await page.goto(base + '/avatar-preview.html?still=1', { waitUntil: 'load', timeout: 30000 });

const runBattery = (cohesion) =>
  page.evaluate(async (cohesionOn) => {
    const { GelCreature } = await import('/src/goopliath/GelCreature.ts');
    const { A } = await import('/src/goopliath/poses.ts');
    const { DANCE_COMBOS } = await import('/src/goopliath/dancePoses.ts');
    const { CREATURE } = await import('/src/goopliath/goopConfig.ts');
    const { GOOP } = await import('/src/config.ts');

    const NAME = Object.fromEntries(Object.entries(A).map(([k, v]) => [v, k]));
    const CORE = Object.keys(NAME).length;

    const creature = new GelCreature({ splat() {}, burst() {}, update() {} });
    creature.sim.cohesion = cohesionOn;
    // Drips are deliberate ambience (they bud off and slurp home); the law
    // under test is the CORE body, so keep the cast fixed.
    creature.sim.spawnDrip = () => {};
    const V3 = creature.position.constructor;
    const head = new V3(0, 1.7, 2.5);

    const DT = 1 / 60; // stage-real frames; the sim clock rides GOOP.timeScale
    const BPM = 128;
    const STEPS = [
      [-0.34, 0.06],
      [-0.08, -0.12],
      [0.34, 0.06],
      [0.08, -0.12],
    ];

    // ---- the ONE PIECE check: bridge graph over the actual field ----
    const _p = new V3();
    const solidBridge = (sim, i, j, eps) => {
      const P = sim.packed;
      const ax = P[i * 4], ay = P[i * 4 + 1], az = P[i * 4 + 2], ar = P[i * 4 + 3];
      const bx = P[j * 4], by = P[j * 4 + 1], bz = P[j * 4 + 2], br = P[j * 4 + 3];
      const d = Math.hypot(bx - ax, by - ay, bz - az);
      if (d - ar - br > CREATURE.blend * sim.blendScale * 0.75) return false; // can't bridge
      let worst = -1e5;
      for (let s = 1; s <= 9; s++) {
        const t = s / 10;
        _p.set(ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t);
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
      const roots = new Set();
      for (let i = 0; i < CORE; i++) roots.add(find(i));
      if (roots.size === 1) return null;
      // Name the strays: every blob outside the biggest component.
      const byRoot = {};
      for (let i = 0; i < CORE; i++) (byRoot[find(i)] ??= []).push(i);
      const groups = Object.values(byRoot).sort((a, b) => b.length - a.length);
      return { count: roots.size, adrift: groups.slice(1).flat().map((i) => NAME[i]) };
    };

    const scenarios = [];
    let scn = null;
    const begin = (name) => {
      scn = { name, frames: 0, whole: 0, meaty: 0, worst: null };
      scenarios.push(scn);
    };
    let clock = 0;
    let lastKick = -1;
    let lastBar = -1;
    const frame = (dance) => {
      clock += DT;
      const beat = (clock * BPM) / 60;
      if (dance) {
        const kick = Math.floor(beat);
        const beatInBar = ((kick % 4) + 4) % 4;
        if (kick !== lastKick) {
          lastKick = kick;
          const bounce = kick % 32 === 0 ? 0.85 : beatInBar === 0 ? 0.55 : GOOP.danceBounce;
          creature.sim.agitation = Math.min(1, creature.sim.agitation + bounce);
        }
        creature.moveSpeedScale = 2.4;
        creature.moveTo(new V3(STEPS[beatInBar][0], 0, STEPS[beatInBar][1]));
      } else {
        creature.moveSpeedScale = 1;
        creature.moveTo(new V3(0, 0, 0));
      }
      creature.faceToward(new V3(0, 1.6, 2.5));
      creature.update(DT * GOOP.timeScale, head);
      scn.frames++;
      const broken = pieces(creature.sim, 0.004);
      if (!broken) scn.whole++;
      else if (!scn.worst || broken.count > scn.worst.count) scn.worst = broken;
      if (!pieces(creature.sim, 0.03)) scn.meaty++;
    };
    const run = (seconds, dance) => {
      for (let i = 0; i < Math.round(seconds / DT); i++) frame(dance);
    };
    const bar = 240 / BPM; // seconds per bar

    // ---- 1. form up: glob pours itself into the dancer ----
    begin('form-up');
    creature.styleEase = 6;
    creature.setFormTarget(1);
    run(3, false);

    // ---- 2. the show: every combo, a new silhouette every bar, on the
    //         two-step, exactly as GoopliathSystem drives it ----
    begin('the-show');
    for (let block = 0; block < DANCE_COMBOS.length; block++) {
      for (let b = 0; b < 4; b++) {
        const combo = DANCE_COMBOS[block];
        creature.setFightStyle(combo[b % 2].pose);
        run(bar, true);
      }
    }

    // ---- 3. gestures at the system's real reach (GOOP.gestureReach), the
    //         floor tell for every move — at both tempo extremes ----
    const throwAndSettle = async (name, hand, target, tempo) => {
      creature.tempoScale = tempo;
      if (!creature.throwAttack(name, hand, target)) return false;
      let guard = 0;
      while (creature.isPunching && guard++ < 4000) frame(true);
      run(0.35, true);
      return true;
    };
    const ATTACK_NAMES = ['jab', 'cross', 'hook', 'uppercut', 'overhand', 'backfist', 'roundhouse', 'spinkick', 'clap'];
    begin('gestures-game');
    creature.setFightStyle(null);
    run(0.5, true);
    let hand = 'left';
    for (const tempo of [1, 0.35]) {
      for (const name of ATTACK_NAMES) {
        hand = hand === 'left' ? 'right' : 'left';
        // The system's exact ask: reach GOOP.gestureReach from centre at
        // world head height (local, since this rig runs unscaled).
        if (!(await throwAndSettle(name, hand, new V3(0, 1.6 / 2.4, GOOP.gestureReach), tempo))) {
          scn.worst = { count: -1, adrift: [`${name} refused`] };
        }
      }
    }

    // ---- 4. gestures past the game's ask (future tuning headroom): twice
    //         the system's reach and more. Kicks are scoped a little shorter
    //         than punches — a leg is a three-link chain from the pelvis and
    //         that is all the rope it has. ----
    begin('gestures-stress');
    for (const name of ATTACK_NAMES) {
      hand = hand === 'left' ? 'right' : 'left';
      const kick = name === 'roundhouse' || name === 'spinkick';
      const target = kick ? new V3(0.15, 0.85, 0.9) : new V3(0.2, 1.0, 1.1);
      if (!(await throwAndSettle(name, hand, target, 0.6))) {
        scn.worst = { count: -1, adrift: [`${name} refused`] };
      }
    }

    // ---- 5. the melt: he lets himself go mid-groove and pours back up ----
    begin('the-melt');
    creature.setFightStyle(DANCE_COMBOS[0][1].pose);
    run(bar, true);
    creature.setFormTarget(0);
    run(1.4 * (60 / BPM), true);
    creature.setFormTarget(1);
    run(CREATURE.formTime / GOOP.timeScale + 0.5, true);

    // ---- 6. stance-swap torture: the widest opposing pair, faster than
    //         any real bar, with the mass still lurching the two-step ----
    begin('torture');
    const wide = DANCE_COMBOS[1]; // rave-Y ↔ floor-stomp
    for (let i = 0; i < 16; i++) {
      creature.setFightStyle(wide[i % 2].pose);
      run(0.7, true);
    }

    return scenarios.map((s) => ({
      name: s.name,
      frames: s.frames,
      whole: s.whole,
      meaty: s.meaty,
      worst: s.worst ? `${s.worst.count} pieces — adrift: ${s.worst.adrift.join(', ')}` : null,
    }));
  }, cohesion);

// Exact, never rounded: 2699/2700 must read as a break, not as "100%".
const pct = (n, of) => {
  if (n === of) return '  100';
  const p = (100 * n) / of;
  return (p > 99.9 ? '99.9' : p.toFixed(1)).padStart(5);
};
const line = (s) =>
  `${s.name.padEnd(16)} ${pct(s.whole, s.frames)}% one piece · ${pct(s.meaty, s.frames)}% meaty` +
  (s.worst ? `  (worst: ${s.worst})` : '');

console.log('ONE PIECE — the DJ through the whole show, field-checked per frame');
console.log('cohesion OFF (the before):');
const before = await runBattery(false);
for (const s of before) console.log(`    ${line(s)}`);
console.log('cohesion ON:');
const after = await runBattery(true);
for (const s of after) check(s.whole === s.frames, line(s));

await browser.close();
if (fails.length) {
  console.error(`\n${fails.length} failed — he came apart.`);
  process.exit(1);
}
console.log('\nhe holds together — one piece, the whole set.');
