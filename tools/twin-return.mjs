#!/usr/bin/env node
/**
 * THE RETURN, audited — the twin's second pair, both axes, checked against
 * the real generated set-lists (vite serves the TypeScript, so this runs
 * the same `generateSetlist`/`parkOf` the raid does).
 *
 *   npm run dev
 *   node tools/twin-return.mjs
 *
 * The properties that matter aren't "does it appear" — it's that the
 * answering pair genuinely chases the ground the first pair left you on,
 * lands on a bar downbeat, and mirrors rather than repeats.
 */

import { chromium } from 'playwright';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
let browser;
try { browser = await chromium.launch(); }
catch { browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }); }
const page = await browser.newPage();
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });

const out = await page.evaluate(async () => {
  const { generateSetlist, parkOf } = await import('/src/choreo/setlist.ts');
  const { CHOREO, MUSIC } = await import('/src/config.ts');
  const bar = MUSIC.beatsPerBar;

  const stats = {
    beamTwins: 0, beamReturns: 0,
    railTwins: 0, railReturns: 0, railTraps: 0,
    backFirst: 0, frontFirst: 0,
    bouncedBack: 0, chain: {},
    // DENSITY: what an EXPERT night actually serves up. The correctness
    // checks above say the bounce is well formed; these say how often a
    // dancer meets one, which is the only question tuning can answer.
    byAct: {},
    byDiff: {},
    perSong: [],
    songs: 0, movesTotal: 0, sourceMoves: 0,
    problems: [],
  };
  const actRow = (a) =>
    (stats.byAct[a] ??= {
      twins: 0, one: 0, two: 0, three: 0, source: 0,
      // The SHAPE CENSUS: raising the twin's share spends someone else's,
      // so the mix is part of the reading. A deck that only ever throws
      // twins is as dull as one that never does.
      single: 0, x: 0, split: 0, trap: 0,
    });
  const note = (m) => { if (stats.problems.length < 12) stats.problems.push(m); };

  // Group a move's landings into volleys by beat.
  const volleys = (mv) => {
    const byBeat = new Map();
    for (const l of mv.landings) {
      if (!byBeat.has(l.beat)) byBeat.set(l.beat, []);
      byBeat.get(l.beat).push(l.zone);
    }
    return [...byBeat.entries()].sort((a, b) => a[0] - b[0]);
  };
  const covers = (z, pt) => {
    if (z.kind === 'lane') {
      const yaw = z.yaw ?? 0;
      const perp = yaw ? Math.cos(yaw) * pt.x - Math.sin(yaw) * pt.z : pt.x;
      return Math.abs(perp - z.x) <= z.halfW;
    }
    if (z.kind === 'rail') return Math.abs(pt.z - z.z) <= z.halfD;
    return false;
  };

  for (let pass = 0; pass <= 3; pass++)
  for (let seed = 1; seed <= 400; seed++) {
    const set = generateSetlist(seed, 12, [], pass);
    stats.byDiff[pass] ??= { bounces: 0, none: 0, nights: 0 };
    let park = { x: 0, z: 0 };
    if (pass === 3) { stats.songs++; stats.movesTotal += set.length; }
    let songBounces = 0;
    for (const mv of set) {
      if ((mv.kind === 'beam' || mv.kind === 'cross') && pass === 3) {
        stats.sourceMoves++;
        const r = actRow(mv.act);
        r.source++;
        const isRail = mv.kind === 'cross';
        const opening = volleys(mv)[0][1].filter((z) => z.kind === (isRail ? 'rail' : 'lane'));
        if (opening.length === 1) r.single++;
        else if (opening.length === 2) {
          if (opening.some((z) => z.yaw)) r.x++;
          else if ((isRail ? opening[0].z * opening[1].z : opening[0].x * opening[1].x) < 0) {
            if (isRail) r.trap++; else r.split++;
          }
        }
      }
      const vs = volleys(mv);
      const parkBefore = park;
      if (mv.kind === 'beam' || mv.kind === 'cross') {
        const isRail = mv.kind === 'cross';
        const first = vs[0][1].filter((z) => z.kind === (isRail ? 'rail' : 'lane'));
        const sameSide =
          first.length === 2 &&
          (isRail ? first[0].z * first[1].z : first[0].x * first[1].x) > 0 &&
          !first.some((z) => z.yaw);
        if (sameSide) {
          if (isRail) {
            stats.railTwins++;
            if (first[0].z > 0) stats.backFirst++; else stats.frontFirst++;
          } else stats.beamTwins++;

          // THE BOUNCE, volley by volley: each must mirror the one before,
          // land a bar later on the beat, and chase the ground its
          // predecessor parked you on.
          const len = vs.length;
          stats.chain[len] = (stats.chain[len] ?? 0) + 1;
          const row = pass === 3 ? actRow(mv.act) : { twins: 0, one: 0, two: 0, three: 0 };
          row.twins++;
          if (len >= 3) { row.three++; songBounces++; }
          else if (len === 2) row.two++;
          else row.one++;
          if (len > CHOREO.twinChainMax) note(`seed ${seed}: chain ran to ${len} volleys`);
          let park = parkBefore;
          for (let v = 0; v < len; v++) {
            const strips = vs[v][1].filter((z) => z.kind === (isRail ? 'rail' : 'lane'));
            if (strips.length !== 2) { note(`seed ${seed}: volley ${v} has ${strips.length} strips`); break; }
            const at = isRail ? strips[0].z : strips[0].x;
            if (v > 0) {
              const gap = vs[v][0] - vs[v - 1][0];
              if (gap !== CHOREO.twinReturnBeats) note(`seed ${seed}: volley ${v} gap ${gap}`);
              if (vs[v][0] % bar !== 0) note(`seed ${seed}: volley ${v} off the downbeat`);
              const prev = vs[v - 1][1].filter((z) => z.kind === (isRail ? 'rail' : 'lane'));
              const prevAt = isRail ? prev[0].z : prev[0].x;
              if (at * prevAt > 0) note(`seed ${seed}: volley ${v} repeated the side (${prevAt} → ${at})`);
              if (!strips.some((z) => covers(z, park))) {
                note(`seed ${seed}: volley ${v} misses the park ${JSON.stringify(park)}`);
              }
              // A third volley must land back where the FIRST one did.
              if (v === 2) {
                const firstAt = isRail ? first[0].z : first[0].x;
                if (at * firstAt < 0) note(`seed ${seed}: volley 2 did not return to the opening side`);
                else stats.bouncedBack++;
              }
            }
            park = parkOf(mv.kind, vs[v][1].map((z) => ({ beat: vs[v][0], zone: z })), park);
          }
          if (len > 1) { if (isRail) stats.railReturns++; else stats.beamReturns++; }
        } else if (isRail && first.length === 2) stats.railTraps++;
      }
      park = parkOf(mv.kind, mv.landings, park);
      // The park must never be off the deck.
      if (park && (Math.abs(park.x) > 0.86 || Math.abs(park.z) > 0.75)) {
        note(`seed ${seed}: ${mv.kind} parks off-deck ${JSON.stringify(park)}`);
      }
    }
    const d = stats.byDiff[pass];
    d.nights++;
    d.bounces += songBounces;
    if (!songBounces) d.none++;
    if (pass === 3) stats.perSong.push(songBounces);
  }
  return stats;
});

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
console.log(`lateral twins      ${out.beamTwins}, of which returned: ${out.beamReturns} (${pct(out.beamReturns, out.beamTwins)})`);
console.log(`vertical twins     ${out.railTwins}, of which returned: ${out.railReturns} (${pct(out.railReturns, out.railTwins)})`);
console.log(`   opened at back  ${out.backFirst}   opened at front ${out.frontFirst}`);
console.log(`crossfire traps    ${out.railTraps}`);
console.log(`chain lengths      ${Object.entries(out.chain).map(([k, v]) => `${k}-volley: ${v}`).join('   ')}`);
console.log(`full bounces       ${out.bouncedBack} ran across, back and across again`);

console.log(`\nEXPERT density — ${out.songs} nights, ${out.movesTotal} moves (${out.sourceMoves} beam/cross)`);
console.log('  act   beam+cross   twins            full 3-volley bounces');
for (const [a, r] of Object.entries(out.byAct).sort()) {
  const ofTwins = r.twins ? `${Math.round((r.three / r.twins) * 100)}% of twins` : '—';
  const ofSource = r.source ? `${Math.round((r.three / r.source) * 100)}% of moves` : '—';
  console.log(
    `  ${a}     ${String(r.source).padStart(6)}   ${String(r.twins).padStart(5)} (${pct(r.twins, r.source).padStart(4)})` +
    `   ${String(r.three).padStart(5)}  ${ofTwins.padEnd(14)} ${ofSource}`,
  );
}
const per = out.perSong;
const mean = per.reduce((a, b) => a + b, 0) / per.length;
const hist = {};
for (const n of per) hist[n] = (hist[n] ?? 0) + 1;
console.log(`  full bounces per night: mean ${mean.toFixed(2)}`);
console.log(`  spread: ${Object.entries(hist).sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}x:${v}`).join('  ')}`);
console.log(`  nights with none: ${(hist[0] ?? 0)} of ${per.length}`);

console.log('\n  every difficulty — full bounces per night');
for (const [d, r] of Object.entries(out.byDiff).sort()) {
  const label = ['EASY', 'NORMAL', 'HARD', 'EXPERT'][d];
  console.log(
    `  ${label.padEnd(7)} mean ${(r.bounces / r.nights).toFixed(2)}   ` +
    `nights with none ${r.none}/${r.nights} (${Math.round((r.none / r.nights) * 100)}%)`,
  );
}

console.log('\n  shape census (share of beam+cross moves)');
console.log('  act    single      X    split     trap     twin');
for (const [a, r] of Object.entries(out.byAct).sort()) {
  const f = (n) => pct(n, r.source).padStart(6);
  console.log(`  ${a}    ${f(r.single)}  ${f(r.x)}  ${f(r.split)}  ${f(r.trap)}  ${f(r.twins)}`);
}
if (out.problems.length) {
  console.log('\nPROBLEMS:');
  for (const p of out.problems) console.log('  ' + p);
} else {
  console.log('\nno problems: every return mirrors, lands on a downbeat, and chases the park');
}
await browser.close();
process.exit(out.problems.length ? 1 : 0);
