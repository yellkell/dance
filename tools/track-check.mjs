#!/usr/bin/env node
/**
 * THE RECORD BOX, audited — every track in `tracks.ts` fetched and decoded
 * through the real app, and its declared numbers checked against the file.
 *
 *   npm run dev
 *   node tools/track-check.mjs
 *
 * A row in the box is a promise about a file: this is what a wrong `seconds`
 * (a set that ends early or runs into silence), a broken import, or an
 * unplayable codec looks like before a headset finds it.
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
  const { TRACKS, trackPhrases } = await import('/src/audio/tracks.ts');
  const { TOUR, MUSIC, countInBeatsFor } = await import('/src/config.ts');
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  // Plain Chromium ships no AAC decoder (it's proprietary; Chrome and the
  // headset browsers have it). Half the box is .m4a, so without this the
  // audit would cry wolf over a dozen perfectly good records.
  const aac = new Audio().canPlayType('audio/mp4; codecs="mp4a.40.2"') !== '';
  const rows = [];
  for (const t of TRACKS) {
    const row = { id: t.id, title: t.title, bpm: t.bpm, declared: t.seconds, roles: t.roles.join('+') };
    try {
      const res = await fetch(t.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      row.bytes = buf.byteLength;
      if (!aac && /\.m4a(\?|$)/.test(t.url)) {
        row.skipped = 'no AAC decoder in this browser';
      } else {
        const audio = await ctx.decodeAudioData(buf);
        row.actual = audio.duration;
      }
      row.phrases = trackPhrases(t, countInBeatsFor(t.bpm), MUSIC.beatsPerBar * MUSIC.barsPerPhrase);
    } catch (e) {
      row.error = String(e.message || e);
    }
    rows.push(row);
  }
  const after = TOUR.sets.find((s) => s.id === 'afterhours');
  return { aac, rows, tour: TOUR.sets.map((s) => ({ id: s.id, songs: s.songs })), after: after?.songs ?? [] };
});

const problems = [];
const NEW = ['giveit', 'vone', 'fusion', 'futurevibe', 'braineater', 'credits', 'defense', 'awakening'];

console.log(`record box${out.aac ? '' : '  (this browser has no AAC decoder — .m4a rows are fetch-checked only)'}:`);
for (const r of out.rows) {
  const mark = NEW.includes(r.id) ? ' *' : '  ';
  if (r.error) {
    problems.push(`${r.id}: ${r.error}`);
    console.log(`${mark} ${r.id.padEnd(12)} FAILED — ${r.error}`);
    continue;
  }
  if (r.skipped) {
    if (!r.bytes) problems.push(`${r.id}: fetched 0 bytes`);
    console.log(
      `${mark} ${r.id.padEnd(12)} ${String(r.bpm).padStart(8)} bpm  ` +
        `fetched ${(r.bytes / 1024).toFixed(0)}k, decode skipped (${r.skipped})  ${r.roles}`,
    );
    continue;
  }
  const drift = Math.abs(r.actual - r.declared);
  console.log(
    `${mark} ${r.id.padEnd(12)} ${String(r.bpm).padStart(8)} bpm  ` +
      `${r.actual.toFixed(2).padStart(7)}s (declared ${r.declared.toFixed(2)})  ` +
      `${String(r.phrases).padStart(2)} phrases  ${r.roles}`,
  );
  if (drift > 0.5) problems.push(`${r.id}: declared ${r.declared}s but the file is ${r.actual.toFixed(2)}s`);
  if (r.phrases < 3) problems.push(`${r.id}: only ${r.phrases} phrases — too short for a set`);
}

console.log('\ncampaign:');
for (const s of out.tour) console.log(`  ${s.id.padEnd(11)} ${s.songs.join(' → ')}`);

const ids = new Set(out.rows.map((r) => r.id));
for (const s of out.tour) {
  for (const song of s.songs) {
    if (!ids.has(song)) problems.push(`campaign set "${s.id}" names a record that isn't in the box: ${song}`);
  }
}
if (out.after[0] !== 'giveit') problems.push(`AFTER HOURS should open on giveit, opens on ${out.after[0]}`);
if (out.after.includes('infection')) problems.push('infection is still in the campaign');
// No record may appear on two nights.
const all = out.tour.flatMap((s) => s.songs);
const dupes = all.filter((x, i) => all.indexOf(x) !== i);
if (dupes.length) problems.push(`repeated on the tour: ${[...new Set(dupes)].join(', ')}`);

for (const id of NEW) if (!ids.has(id)) problems.push(`${id} never made it into the box`);

// And the night itself: does AFTER HOURS actually mount the new record?
const night = await page.evaluate(() => {
  window.__gdr.startRaid({ tour: { set: 2, song: 0 } });
  const m = window.__gdr.match;
  return { trackId: m.trackId, bpm: m.bpm, difficulty: m.difficulty, phrases: m.phrases };
});
console.log(
  `\nAFTER HOURS night 1 mounts: ${night.trackId} @ ${night.bpm} bpm, ` +
    `${night.phrases} phrases, difficulty ${night.difficulty}`,
);
if (night.trackId !== 'giveit') problems.push(`the night mounted ${night.trackId}, not giveit`);
if (Math.abs(night.bpm - 112) > 0.001) problems.push(`the night is running at ${night.bpm} bpm`);

if (problems.length) {
  console.log('\nPROBLEMS:');
  for (const p of problems) console.log('  ' + p);
} else {
  console.log('\nno problems: every record decodes, every duration matches, the campaign is clean');
}
await browser.close();
process.exit(problems.length ? 1 : 0);
