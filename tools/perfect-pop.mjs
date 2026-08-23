#!/usr/bin/env node
/**
 * THE PERFECT POP, audited — one word, every time, and a kick.
 *
 *   npm run dev
 *   node tools/perfect-pop.mjs [outDir]
 *
 * The pop briefly carried the chain's ×N and it was the wrong instrument
 * for a number: half a second at the edge of your eye while something is
 * trying to kill you. The wedge holds the chain; the pop says you rode the
 * beat and gets out of the way. This holds that line.
 *
 *   THE WORD    every perfect pops "PERFECT!" — the same word each time,
 *               and NOTHING else on the plane. No multiplier, no counter.
 *   THE CHAIN   still climbs behind it, on the wedge where it belongs: the
 *               score is paid at 1 + 0.1 × combo, and a perfect takes its
 *               own ×1.5 ON TOP — worth MORE at the ×4 ceiling (+200 a
 *               landing), not less, which is the thing the pop was never
 *               the right place to say.
 *   THE KICK    the plane's scale starts small, overshoots 1 and settles
 *               back, sampled off the live scene graph.
 *
 * How a perfect is farmed: a twin throws two lanes now and two mirrored
 * lanes four beats later. Stand in the outer lane until the probe samples
 * (one beat out), step across, and the lane you left pays a PERFECT while
 * the one you crossed pays a plain dodge — then hold for the return and
 * do it again in mirror. Two perfects and four chain steps per twin, no
 * hits. The seeded set-list is held off the floor for the duration (see
 * the quiet floor below) so only these landings are ever judged.
 *
 * A container's software GL runs this scene at about THREE frames a second
 * — roughly one frame per beat — so nothing here may depend on catching a
 * window. The step is driven off the probe's own flag rather than a beat
 * offset, the slowest record on the shelf is forced to widen every beat,
 * and the kick is read from popScale() as maths rather than sampled off
 * the plane, where it would live inside a single frame.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const out = resolve(process.argv[2] ?? 'shots');
const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
mkdirSync(out, { recursive: true });

let browser;
try { browser = await chromium.launch(); }
catch { browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }); }
// SMALL: software GL is fill-rate bound, and this scene runs ~3 fps at
// 1280×800 against ~6 at 320×240 — the difference between one frame per
// beat and three, which is the difference between being able to step off
// a lane in time and not. The layout shot at the end goes back to full size.
const SMALL = { width: 320, height: 240 };
const BIG = { width: 1280, height: 800 };
const page = await browser.newPage({ viewport: SMALL });
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));

await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => page.goto(base));
await page.waitForTimeout(1200);
await page.click('#enter-vr');
await page.waitForFunction(() => document.body.classList.contains('app-entered'), {
  timeout: 15000,
  polling: 200,
});
await page.waitForTimeout(1800);

// Clean frames: the emulator draws its gizmos into its OWN three.js canvas
// (r181) over the app's (r184), and its readouts are plain DOM.
await page.evaluate(() => {
  for (const c of document.querySelectorAll('canvas')) {
    if (c.dataset.engine && c.dataset.engine !== 'three.js r184') c.style.display = 'none';
  }
  for (const el of document.body.children) {
    if (el.tagName !== 'DIV' || el.id === 'scene-container' || el.className) continue;
    if (el.querySelector('canvas')) {
      for (const kid of el.children) if (kid.tagName !== 'CANVAS') kid.style.display = 'none';
    } else el.style.display = 'none';
  }
});

const problems = [];
const note = (m) => { problems.push(m); console.log(`  FAIL ${m}`); };

// THE FLAIR PLANE, by the geometry only it is built from. renderOrder 31
// is NOT unique in this scene (five meshes share it) and picking by that
// alone watches the wrong object all the way to a green run.
const planes = await page.evaluate(() => {
  const hits = [];
  window.__gdr.scene().traverse((o) => {
    const p = o.geometry?.parameters;
    if (p && Math.abs(p.width - 0.76) < 1e-9 && Math.abs(p.height - 0.24) < 1e-9) hits.push(o);
  });
  window.__flair = hits[0] ?? null;
  return hits.length;
});
console.log(`flair plane: ${planes} match(es)`);
if (planes !== 1) note(`expected exactly one flair plane, found ${planes}`);

const shot = async (name) => {
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`  ${name}.png`);
};

// DISCO BALL at EASY: the slowest record on the shelf (73 bpm) and no
// double time, so one beat is as many frames as this renderer can give.
await page.evaluate(() => window.__gdr.startRaid({ seats: 8, trackId: 'discoball', difficulty: 0 }));
await page.waitForFunction(
  () => window.__gdr.match.playing && Number.isFinite(window.__gdr.match.beat),
  { timeout: 60000, polling: 100 },
);

// THE QUIET FLOOR: hold the seeded set-list off the deck so the only
// landings judged are the ones this tool throws. Marking a zone resolved
// retires it before judgement (and its telegraph goes with it), which is
// the same door ChoreoSystem uses when a dancer falls.
await page.evaluate(() => {
  window.__quiet = setInterval(() => {
    for (const z of window.__gdr.choreo.zones) {
      if (z.moveIdx >= 9000 || z.resolved) continue;
      z.resolved = true;
      z.tg?.dispose?.();
      z.tg = null;
      z.blocks?.dispose?.();
      z.blocks = undefined;
    }
  }, 25);
});

// Face the wedge and its pop — both ride off the left shoulder.
await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__YAW = 0.5;
  window.__gdr.rig(0, 0.35, window.__YAW);
  await sleep(180);
  // Head offset measured AT THIS YAW and once only: re-measuring from a
  // parked rig each round compounds the error until the bait misses.
  window.__headOff = window.__gdr.match.headX;
});

/**
 * One twin, start to finish: two perfects, four chain steps, no hits.
 * Returns what the pop said at each landing beside what the wedge held.
 */
const twinRound = () =>
  page.evaluate(async () => {
    const g = window.__gdr;
    const m = g.match;
    const d = m.players.find((p) => p.kind === 'local');
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const park = (x) => g.rig(x - window.__headOff, 0.35, window.__YAW);

    let seen = null;
    const hits0 = d.hits;
    const push0 = m.flairs.push.bind(m.flairs);
    m.flairs.push = (f) => { seen = { ...f }; return push0(f); };
    const reading = () => ({
      tookHit: d.hits - hits0,
      pop: seen,
      combo: d.combo,
      wedge: +(1 + 0.1 * Math.min(d.combo, 30)).toFixed(4),
      perfects: d.perfects,
      hits: d.hits,
    });

    park(0.62); // the outer lane: bait, so the probe finds us standing in it
    await sleep(60);
    g.choreo.dropTwin(0, 1);
    await sleep(80);
    const mine = g.choreo.zones
      .filter((z) => z.seat === m.mySeat && z.moveIdx >= 9000 && !z.resolved)
      .sort((a, b) => a.dueBeat - b.dueBeat);
    if (mine.length !== 4) { m.flairs.push = push0; return { fail: `twin gave ${mine.length} zones` }; }
    const firstDue = mine[0].dueBeat;
    const returnDue = mine[3].dueBeat;

    // Step on the PROBE, not on a clock: the judge stamps `probed` the frame
    // it samples "were you inside", and at these frame rates a fixed beat
    // offset lands after the landing as often as before it.
    //
    // Then WAIT FOR THE WORLD to have the step: rig() moves the player, but
    // match.headX — the only thing the judge reads — is rewritten by
    // PlayerSystem on a later frame. If the landing beats us to it we did
    // not dodge anything, so the round says `raced` and the runner throws
    // it away rather than reporting a judgement the harness caused.
    const step = async (zone, to, by) => {
      while (!zone.probed && m.beat < by) await sleep(4);
      park(to);
      while (Math.abs(m.headX - to) > 0.02 && m.beat < by) await sleep(4);
      return Math.abs(m.headX - to) <= 0.02 && m.beat < by;
    };

    const outer = mine.find((z) => Math.abs(z.zone.x - 0.62) < 1e-6) ?? mine[1];
    if (!(await step(outer, -0.5, firstDue))) { m.flairs.push = push0; return { raced: 'out' }; }
    while (m.beat < firstDue + 0.25) await sleep(8);
    const first = reading();

    seen = null;
    const backOuter = mine.find((z) => Math.abs(z.zone.x + 0.62) < 1e-6) ?? mine[3];
    if (!(await step(backOuter, 0.5, returnDue))) { m.flairs.push = push0; return { raced: 'back' }; }
    while (m.beat < returnDue + 0.25) await sleep(8);
    const back = reading();

    m.flairs.push = push0;
    return { first, back };
  });

console.log('\nthree clean twins, six perfects — the chain should climb:');
const pops = [];
let clean = 0;
for (let attempt = 1; attempt <= 10 && clean < 3; attempt++) {
  const r = await twinRound();
  if (r.fail) { note(`attempt ${attempt}: ${r.fail}`); break; }
  if (r.raced) {
    // The harness lost the step, not the game. Let any i-frames expire and
    // the chain settle, then throw another twin.
    console.log(`  attempt ${attempt}: lost the step (${r.raced}) — retrying`);
    await page.evaluate(async () => {
      const m = window.__gdr.match;
      const to = m.beat + 4;
      while (m.beat < to) await new Promise((r) => setTimeout(r, 16));
    });
    continue;
  }
  clean++;
  const i = clean - 1;
  for (const [label, s] of [['out', r.first], ['back', r.back]]) {
    pops.push(s);
    const shown = s.pop?.mult;
    console.log(
      `  twin ${i + 1} ${label.padEnd(4)} pop=${JSON.stringify(s.pop?.text)} ×${shown?.toFixed(1)} ` +
        `(chain ${s.combo} → wedge ×${s.wedge.toFixed(1)}, perfects ${s.perfects}, hits ${s.hits})`,
    );
    if (!s.pop) note(`twin ${i + 1} ${label}: no pop at all`);
    else if (s.pop.text !== 'PERFECT!') note(`twin ${i + 1} ${label}: pop said ${JSON.stringify(s.pop.text)}`);
    // NOTHING but the word: a stray number on the plane is the regression
    // this tool exists to catch.
    if (shown !== undefined) note(`twin ${i + 1} ${label}: the pop carried a number (×${shown})`);
    // Hits WITHIN this twin only. A lifetime count condemns every later
    // round for one raced step ten seconds ago, which says nothing.
    if (s.tookHit !== 0) note(`twin ${i + 1} ${label}: took a hit inside the round`);
  }
  // THE WORD EVERY TIME. The second perfect of a live chain says exactly
  // what the first did — no shrinking to a number, no going quiet.
  if (r.back.pop?.text !== 'PERFECT!') {
    note(`twin ${i + 1}: the second perfect did not say the word (${JSON.stringify(r.back.pop?.text)})`);
  }
  // THE CHAIN still moves behind it. Both readings are taken AFTER their
  // own pair resolves, so the gap between them is the return's two landings
  // — two chain steps, 0.2 on the wedge — even though the pop never
  // mentions it.
  const climb = r.back.wedge - r.first.wedge;
  if (Math.abs(climb - 0.2) > 1e-9) {
    note(`twin ${i + 1}: the wedge moved ${climb.toFixed(2)} across the twin, not 0.20`);
  }
}
if (clean < 3) note(`only ${clean} clean twin(s) in 10 attempts`);
// How high the run got, reported but NOT asserted: a step lost to the
// frame rate takes a hit, a hit resets the chain, and how far a session
// climbs before that happens is a fact about this renderer.
const top = Math.max(...pops.map((p) => p.wedge ?? 0));
console.log(`  highest chain reached this run: ×${top.toFixed(1)}`);
console.log('\nthe kick — the curve itself:');
const curve = await page.evaluate(async () => {
  const { popScale } = await import('/src/systems/HudSystem.ts');
  const s = [];
  for (let i = 0; i <= 120; i++) s.push(+popScale(i / 120).toFixed(4)); // one second
  return { start: +popScale(0).toFixed(4), s, rest: +popScale(0.9).toFixed(4) };
});
const peak = Math.max(...curve.s);
const peakAt = curve.s.indexOf(peak) / 120;
const dip = Math.min(...curve.s);
console.log(
  `  starts ${curve.start}, tops ${peak} at ${peakAt.toFixed(2)}s, floor ${dip}, home ${curve.rest}`,
);
if (!(curve.start < 0.7)) note(`the pop does not start small (${curve.start})`);
if (!(peak > 1.05)) note(`the pop never overshoots 1 (peak ${peak})`);
if (!(peakAt > 0.05 && peakAt < 0.3)) note(`the overshoot lands at ${peakAt.toFixed(2)}s`);
if (Math.abs(curve.rest - 1) > 0.01) note(`the pop is not home by its hold (${curve.rest})`);

// …and the plane is actually driven by it. At ~3 fps the bounce is one
// frame wide, so this only asks whether the scale MOVED off 1 on a pop.
console.log('the kick — wired to the plane:');
const wired = await page.evaluate(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  window.__gdr.match.flairs.push({ text: 'PERFECT!', tone: 'perfect', mult: 2.4 });
  const s = [];
  for (let i = 0; i < 8; i++) { await frame(); s.push(+window.__flair.scale.x.toFixed(4)); }
  return s;
});
console.log(`  first frames after a pop: ${wired.join(' ')}`);
if (!wired.some((v) => Math.abs(v - 1) > 0.005)) note('the pop never moved the plane');

console.log('\nafter a hit, the chain starts over:');
const beforeHit = pops[pops.length - 1]?.wedge ?? 0;
const hit = await page.evaluate(async () => {
  const g = window.__gdr;
  const m = g.match;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const d = m.players.find((p) => p.kind === 'local');
  const park = (x) => g.rig(x - window.__headOff, 0.35, window.__YAW);
  park(0.62); // stand in the lane and WEAR it
  await sleep(60);
  g.choreo.dropTwin(0, 1);
  await sleep(80);
  const mine = g.choreo.zones
    .filter((z) => z.seat === m.mySeat && z.moveIdx >= 9000 && !z.resolved)
    .sort((a, b) => a.dueBeat - b.dueBeat);
  const firstDue = mine[0]?.dueBeat ?? m.beat + 3;
  const returnDue = mine[3]?.dueBeat ?? firstDue + 4;
  while (m.beat < firstDue + 0.25) await sleep(16);
  const afterHit = { combo: d.combo, hits: d.hits };
  // Let the i-frames AND the return expire: inside them the judge scores
  // nothing at all, so a pop farmed there would say nothing either.
  while (m.beat < returnDue + 2.5) await sleep(16);
  return afterHit;
});
console.log(`  the hit → chain ${hit.combo} (was paying ×${beforeHit.toFixed(1)})`);
if (hit.combo !== 0) note(`the hit left the chain at ${hit.combo}`);
let restart = null;
for (let attempt = 1; attempt <= 14 && !restart; attempt++) {
  const r = await twinRound();
  if (r.raced || r.fail) continue;
  restart = r.first;
}
// Not a failure if the harness simply never won a step: the reset itself is
// asserted above (the hit put the chain on the floor), and whether this
// renderer can score one more perfect inside fourteen tries is a fact about
// the container, not about the pop.
if (!restart) console.log('  (no clean perfect farmed in 14 tries — step lost every time; check skipped)');
else {
  console.log(
    `  next pop ${JSON.stringify(restart.pop?.text)} against wedge ×${restart.wedge.toFixed(1)}`,
  );
  if (restart.pop?.text !== 'PERFECT!') {
    note(`the pop after the hit said ${JSON.stringify(restart.pop?.text)}`);
  }
  if (restart.pop?.mult !== undefined) note('the pop after the hit carried a number');
  // Deliberately NOT "lower than the pre-hit pop": between the hit and a
  // clean twin the harness may burn several landings retrying a lost step,
  // and the chain climbs through those. The reset itself is already proven
  // above — the hit put the chain on the floor — and what this pop has to
  // show is that it still reads whatever the chain now actually is.
}

// THE LAYOUT, at a size worth looking at — in a page of its own. The
// canvas does not follow a viewport resize (the emulator fixes it at
// entry), so the shot needs a browser that started big. And the wedge and
// its pop hang at a FIXED WORLD SPOT beside where the dancer stands, not
// off the camera, so this parks the rig back on the origin and aims at
// them: left 0.53 rad and a shade down, which frames (-0.52, 0.93, -0.88)
// sits from a head at eye height.
//
// drawFlair does not care where a pop came from, so a pushed one renders
// exactly what a scored one does — and this way the picture never depends
// on winning a step at three frames a second.
console.log('\nthe look:');
const look = await browser.newPage({ viewport: BIG });
look.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await look.goto(base, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => look.goto(base));
await look.waitForTimeout(1200);
await look.click('#enter-vr');
await look.waitForFunction(() => document.body.classList.contains('app-entered'), {
  timeout: 15000,
  polling: 200,
});
await look.waitForTimeout(1800);
await look.evaluate(() => {
  for (const c of document.querySelectorAll('canvas')) {
    if (c.dataset.engine && c.dataset.engine !== 'three.js r184') c.style.display = 'none';
  }
  for (const el of document.body.children) {
    if (el.tagName !== 'DIV' || el.id === 'scene-container' || el.className) continue;
    if (el.querySelector('canvas')) {
      for (const kid of el.children) if (kid.tagName !== 'CANVAS') kid.style.display = 'none';
    } else el.style.display = 'none';
  }
});
await look.evaluate(() => window.__gdr.startRaid({ seats: 8, trackId: 'discoball', difficulty: 0 }));
await look.waitForFunction(
  () => window.__gdr.match.screen === 'raid' && Number.isFinite(window.__gdr.match.beat) && window.__gdr.match.beat > 1,
  { timeout: 90000, polling: 200 },
);
// FREEZE the set for the portrait: a live floor throws strike flashes that
// white out half the frame, and a still dancer is being hit by them. The
// screen stays 'raid' so the wedge and the pop still draw.
await look.evaluate(() => {
  window.__gdr.match.playing = false;
  window.__gdr.rig(0, 0, 0.53, 0, -0.4);
});
await look.waitForTimeout(600);
await look.evaluate(() => {
  window.__flair = null;
  window.__gdr.scene().traverse((o) => {
    const p = o.geometry?.parameters;
    if (p && Math.abs(p.width - 0.76) < 1e-9 && Math.abs(p.height - 0.24) < 1e-9) window.__flair = o;
  });
});

// HOLD the pop for the shutter, and only fire it once the plane says it is
// actually up. A pop lives 1.4 s and this renderer gives about three frames
// a second, so a fixed wait catches it faded as often as not.
const hold = async (name, flair, combo) => {
  await look.evaluate(([f, cb]) => {
    const m = window.__gdr.match;
    const d = m.players.find((p) => p.kind === 'local');
    if (d && cb !== null) { d.combo = cb; d.score = Math.round(1000 * (1 + 0.1 * cb)); }
    clearInterval(window.__hold);
    const put = () => { m.flairs.length = 0; m.flairs.push({ ...f }); };
    put();
    window.__hold = setInterval(put, 60);
  }, [flair, combo ?? null]);
  const up = await look
    .waitForFunction(() => window.__flair?.visible && window.__flair.material.opacity > 0.9, {
      timeout: 8000,
      polling: 50,
    })
    .then(() => true)
    .catch(() => false);
  await look.screenshot({ path: `${out}/${name}.png` });
  await look.evaluate(() => clearInterval(window.__hold));
  console.log(`  ${name}.png${up ? '' : '  (the plane never reported itself up)'}`);
  if (!up) note(`${name}: the pop never came up for the camera`);
};

// The pop on a cold floor and the pop at the ceiling: the SAME word, which
// is the whole point of the revert — only the wedge behind it has moved.
await hold('pop-perfect-cold', { text: 'PERFECT!', tone: 'perfect' }, 1);
await hold('pop-perfect-capped', { text: 'PERFECT!', tone: 'perfect' }, 30);
await hold('pop-hit', { text: 'HIT', tone: 'hit' }, 0);
await look.close();

await page.evaluate(() => {
  clearInterval(window.__quiet);
  window.__gdr.toLobby();
});
await browser.close();
if (problems.length) {
  console.log(`\n${problems.length} problem(s).`);
  process.exit(1);
}
console.log('\none word, every time, with a kick — and the chain kept where it belongs.');
