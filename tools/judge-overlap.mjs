#!/usr/bin/env node
/**
 * ONE LANDING, ONE VERDICT — the judge, checked against overlapping fire.
 *
 *   npm run dev
 *   node tools/judge-overlap.mjs
 *
 * The bug this guards against: a twin pair (or a wave's march) resolves as
 * independent zones, and the judge used to score each alone. Get clipped by
 * one rail while the probe had caught you "still inside" the other a beat
 * out, and the deck shouted HIT and PERFECT! in the same breath — and the
 * phantom dodge revived the combo the hit had just killed and wiped the
 * three-in-a-row chain. The rule now: i-frames judge NOTHING (harm or
 * reward, exactly like the bots), and a same-tick sibling landing on you
 * suppresses the dodge whichever order the zones resolve in.
 *
 * Four rounds through the REAL pipeline (drop hooks + the live judge), each
 * on a fresh raid's count-in so the seeded set-list can't reach the window
 * (its first landing never comes before beat ~3). Every round returns to
 * the lobby first — a raid started over a still-playing set races the old
 * clock — and a round that takes a hit must show the i-frame stamp of the
 * zone it EXPECTED to be hit by, so a set-list stray can't pass as a pass:
 *
 *   A  twin, hit lane judged FIRST  → one HIT, nothing else (i-frame path)
 *   B  twin, hit lane judged SECOND → one HIT, nothing else (sibling scan)
 *   C  twin dodged clean off a last-instant exit → PERFECT! still pays
 *   D  wave, clipped mid-march → the next strip neither harms nor rewards
 *      (no dodge, and the miss chain HOLDS at 1)
 */

import { chromium } from 'playwright';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
let browser;
try { browser = await chromium.launch(); }
catch { browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }); }
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));

await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => page.goto(base));
await page.waitForTimeout(1200);
await page.click('#enter-vr');
await page.waitForFunction(() => document.body.classList.contains('app-entered'), {
  timeout: 15000,
  polling: 200,
});
await page.waitForTimeout(1500);

/**
 * One round, entirely inside the page so the timing rides the real clock.
 * plan: { move: 'twin'|'wave', side, bait, end, hitDueIdx } — stand at
 * `bait` until the perfect probe has sampled, then step to `end` for the
 * landings. hitDueIdx names which of MY zones (due-sorted) should own any
 * hit; null promises a clean round.
 */
const round = (plan) =>
  page.evaluate(async (p) => {
    const g = window.__gdr;
    const m = g.match;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // Through the LOBBY, always: startRaid over a still-playing set leaves
    // one frame where the OLD clock is finite under the NEW generation, and
    // a round that catches it drops its zones against a needle about to be
    // re-cued (the rebuild then wipes them and the set-list plays through
    // the window instead).
    g.toLobby();
    for (let i = 0; i < 200 && m.playing; i++) await sleep(20);
    g.startRaid({ seats: 8 });
    for (let i = 0; i < 900 && !(m.playing && Number.isFinite(m.beat) && m.beat < -2.5); i++) await sleep(20);
    if (!(Number.isFinite(m.beat) && m.beat < -2.5)) return { fail: 'no fresh count-in' };

    // Where the emulated head actually sits for a parked rig.
    g.rig(0, 0.35, 0);
    await sleep(120);
    const headOff = m.headX;
    const park = (x) => g.rig(x - headOff, 0.35, 0);

    const d = m.players.find((pl) => pl.kind === 'local');
    const before = { hits: d.hits, dodges: d.dodges, perfects: d.perfects };
    const seen = [];
    const push0 = m.flairs.push.bind(m.flairs);
    m.flairs.push = (f) => { seen.push(f.text); return push0(f); };

    park(p.bait);
    await sleep(60);
    if (p.move === 'twin') g.choreo.dropTwin(0, p.side);
    else g.choreo.dropWave(0, false);

    // My zones: the dev drops number their moves from 9500/9950 up.
    await sleep(60);
    const mine = g.choreo.zones
      .filter((z) => z.seat === m.mySeat && z.moveIdx >= 9000)
      .sort((a, b) => a.dueBeat - b.dueBeat);
    if (!mine.length) return { fail: 'drop produced no zones' };
    const firstDue = mine[0].dueBeat;
    // Twin asserts just after its pair lands; the wave after its third strip
    // (which is the one the i-frames from the second must swallow).
    const lastDue = p.move === 'twin' ? firstDue : mine[2].dueBeat;

    // Hold the bait spot through the probe (dueBeat − 1), then step.
    while (m.beat < firstDue - 0.72) await sleep(18);
    if (p.move === 'twin') park(p.end);
    while (m.beat < lastDue + 0.6) await sleep(18);

    m.flairs.push = push0;
    const after = { hits: d.hits, dodges: d.dodges, perfects: d.perfects };
    // ATTRIBUTION: a hit stamps i-frames at its zone's due + invulnBeats,
    // so the stamp says WHOSE landing connected. A set-list stray (or a
    // round that drifted) shows a stamp off the promised beat.
    const wantDue = p.hitDueIdx === null ? null : mine[p.hitDueIdx].dueBeat;
    const stampOk =
      wantDue === null
        ? d.invulnUntilBeat === -Infinity || d.invulnUntilBeat < firstDue
        : Math.abs(d.invulnUntilBeat - (wantDue + 2)) < 0.01;
    // TAINT: any set-list zone STILL PENDING for my seat that was due
    // inside the window (resolved ones leave the array — the stamp above
    // covers those).
    const tainted = g.choreo.zones.some(
      (z) => z.seat === m.mySeat && z.moveIdx < 9000 && z.dueBeat <= m.beat + 0.1,
    );
    return {
      tainted,
      stampOk,
      dHits: after.hits - before.hits,
      dDodges: after.dodges - before.dodges,
      dPerfects: after.perfects - before.perfects,
      missChain: d.missChain,
      flairs: seen,
    };
  }, plan);

const IN = 0.12; // CHOREO.beamTwinInner
const OUT = 0.62; // inner + 2×halfW + 0.02
const S1 = -0.215; // the wave's second strip (CHOREO.waveLaneX[1])

const ROUNDS = [
  ['A: twin, hit lane first', { move: 'twin', side: 1, bait: OUT, end: IN, hitDueIdx: 0 },
    (r) => r.dHits === 1 && r.dDodges === 0 && r.dPerfects === 0 && !r.flairs.includes('PERFECT!')],
  ['B: twin, hit lane second', { move: 'twin', side: -1, bait: -IN, end: -OUT, hitDueIdx: 0 },
    (r) => r.dHits === 1 && r.dDodges === 0 && r.dPerfects === 0 && !r.flairs.includes('PERFECT!')],
  ['C: twin dodged on the last instant', { move: 'twin', side: 1, bait: OUT, end: -0.5, hitDueIdx: null },
    (r) => r.dHits === 0 && r.dDodges === 2 && r.dPerfects === 1 && r.flairs.includes('PERFECT!')],
  ['D: wave, clipped mid-march', { move: 'wave', bait: S1, end: S1, hitDueIdx: 1 },
    (r) => r.dHits === 1 && r.dDodges === 1 && r.dPerfects === 0 && r.missChain === 1 &&
      !r.flairs.includes('PERFECT!')],
];

const problems = [];
for (const [name, plan, ok] of ROUNDS) {
  let r = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    r = await round(plan);
    if (r.fail) break;
    if (!r.tainted) break;
    console.log(`  ${name}: set-list landing intruded — retrying (${attempt})`);
  }
  const pass = !r.fail && !r.tainted && r.stampOk && ok(r);
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name} → ${JSON.stringify(r)}`);
  if (!pass) problems.push(name);
}

await browser.close();
if (problems.length) {
  console.log(`\n${problems.length} round(s) failed.`);
  process.exit(1);
}
console.log('\nthe judge holds: one landing, one verdict.');
