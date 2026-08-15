#!/usr/bin/env node
/**
 * THE CREDITS — the campaign's last night, played to the end, and what the
 * map does about it.
 *
 *   npm run dev
 *   node tools/credits-roll.mjs [outDir]
 *
 * Runs the real flow: start AFTER HOURS night 3, survive it, take the
 * podium's exit, and check the map comes back wearing the credits card with
 * the closing theme on the decks — then that dismissing it hands the foyer
 * its own records back.
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? '/tmp/claude-0/-home-user-dance/c1d6b436-3df6-5e9e-85cb-6f34ab9935b2/scratchpad/credits';
mkdirSync(out, { recursive: true });
const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
let browser;
try { browser = await chromium.launch(); }
catch { browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }); }
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1200);
await page.click('#enter-vr');
await page.waitForFunction(() => document.body.classList.contains('app-entered'), { timeout: 15000 });
await page.waitForTimeout(2200);

const problems = [];
const step = (label, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) problems.push(label);
};

// The record the closing theme must not be reachable from.
const roles = await page.evaluate(async () => {
  const { TRACKS, tracksFor, pickRaidTrack } = await import('/src/audio/tracks.ts');
  const credits = TRACKS.find((t) => t.id === 'credits');
  const brain = TRACKS.find((t) => t.id === 'braineater');
  const raidIds = tracksFor('raid').map((t) => t.id);
  // Every seed must miss the credits record.
  let shuffleHit = false;
  for (let s = 0; s < 500; s++) if (pickRaidTrack(s).id === 'credits') shuffleHit = true;
  return { credits: credits?.roles, brain: brain?.roles, inRaidPool: raidIds.includes('credits'), shuffleHit };
});
step('BRAIN EATER is on the raid shelf', roles.brain?.includes('raid') === true, (roles.brain ?? []).join('+'));
step('the credits record has its own role', roles.credits?.join('+') === 'credits', (roles.credits ?? []).join('+'));
step('the credits record is not in the raid pool', !roles.inRaidPool);
step('no seed can shuffle into the credits record', !roles.shuffleHit);

// The last night of the tour, survived.
const beaten = await page.evaluate(async () => {
  const { TOUR } = await import('/src/config.ts');
  const last = TOUR.sets.length - 1;
  const song = TOUR.sets[last].songs.length - 1;
  window.__gdr.startRaid({ tour: { set: last, song }, seats: 1 });
  return { last, song, track: window.__gdr.match.trackId };
});
step('the last night mounts its record', !!beaten.track, `set ${beaten.last} song ${beaten.song} → ${beaten.track}`);

await page.waitForFunction(() => window.__gdr.match.screen === 'raid', { timeout: 30000 });
const finished = await page.evaluate(() => {
  window.__gdr.endSet(); // survived: nothing killed us
  return { screen: window.__gdr.match.screen, credits: window.__gdr.match.credits };
});
step('surviving the last night marks the credits due', finished.credits === true, `screen ${finished.screen}`);

// The podium's exit walks back to the map.
await page.evaluate(() => window.__gdr.toTour());
await page.waitForTimeout(1500);
const onMap = await page.evaluate(() => ({
  screen: window.__gdr.match.screen,
  credits: window.__gdr.match.credits,
}));
step('the map is where you land', onMap.screen === 'tour');
step('the credits are up on the map', onMap.credits === true);
await page.screenshot({ path: `${out}/01-credits.png` });

// And the decks.
await page.waitForTimeout(2500);
const playing = await page.evaluate(async () => {
  const m = await import('/src/audio/music.ts');
  return { running: m.ambientRunning() };
});
step('a record is on the decks over the credits', playing.running === true);

// Dismiss it: the foyer gets its own rotation back.
await page.evaluate(() => window.__gdr.menu.act?.('credits-done'));
await page.waitForTimeout(600);
const after = await page.evaluate(() => ({ credits: window.__gdr.match.credits, screen: window.__gdr.match.screen }));
step('dismissing returns the map', after.credits === false && after.screen === 'tour', `credits=${after.credits}`);
await page.screenshot({ path: `${out}/02-map-after.png` });

console.log(problems.length ? `\n${problems.length} failing` : '\nno problems: the tour ends on the credits');
await browser.close();
process.exit(problems.length ? 1 : 0);
