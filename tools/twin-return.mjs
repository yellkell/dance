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
    problems: [],
  };
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

  for (let seed = 1; seed <= 400; seed++) {
    // difficulty 3 so the late acts (where twins live) are well sampled
    const set = generateSetlist(seed, 12, [], 3);
    let park = { x: 0, z: 0 };
    for (const mv of set) {
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
if (out.problems.length) {
  console.log('\nPROBLEMS:');
  for (const p of out.problems) console.log('  ' + p);
} else {
  console.log('\nno problems: every return mirrors, lands on a downbeat, and chases the park');
}
await browser.close();
process.exit(out.problems.length ? 1 : 0);
