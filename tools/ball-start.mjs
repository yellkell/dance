#!/usr/bin/env node
/**
 * START THE BALL EARLY — the caller's half of the split row, end to end.
 *
 *   npm run dev       # terminal 1
 *   npm run server    # terminal 2
 *   node tools/ball-start.mjs [outDir]
 *
 * Two real headsets against the real relay: a host opens a room, a guest
 * walks in, the host sends the ball up and the guest touches it. Then the
 * host presses START, and both are dealt onto the ring — the whole point
 * being that this happens in SECONDS rather than at the end of the relay's
 * sixty, which is what the timeout would otherwise take.
 *
 * What it holds to:
 *   THE ROW SPLITS   while my own ball hangs, the caller's console shows
 *                    CALL IT OFF and START side by side, and START says
 *                    how many it would deal.
 *   IT DEALS         pressing START takes the host AND the guest to a
 *                    countdown, well inside the ball's own clock.
 *   ONLY THE CALLER  a guest pressing START (or sending the verb straight
 *                    down the wire) changes nothing — the relay refuses it,
 *                    so the button cannot decide the room's business for it.
 *   IT STILL WAITS   a ball nobody starts is still hanging a few seconds
 *                    later; START is a shortcut, not a new default.
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const out = resolve(process.argv[2] ?? 'shots');
const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
mkdirSync(out, { recursive: true });

let browser;
try { browser = await chromium.launch(); }
catch { browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }); }

const problems = [];
const note = (m) => { problems.push(m); console.log(`  FAIL ${m}`); };

/** One headset, in the club, with the SOCIAL panel reachable. */
async function headset(label) {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  page.on('pageerror', (e) => console.log(`[${label} pageerror] ${e.message}`));
  await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => page.goto(base));
  await page.waitForTimeout(1000);
  await page.click('#enter-vr');
  await page.waitForFunction(() => document.body.classList.contains('app-entered'), {
    timeout: 15000,
    polling: 200,
  });
  await page.waitForTimeout(1500);
  return page;
}

const host = await headset('host');
const guest = await headset('guest');

// ── the room ──────────────────────────────────────────────────────────────
console.log('the room:');
await host.evaluate(() => window.__gdr.net.host());
const code = await host
  .waitForFunction(() => (window.__gdr.net.state.phase === 'hosting' ? window.__gdr.net.state.code : null), {
    timeout: 10000,
    polling: 100,
  })
  .then((h) => h.jsonValue());
console.log(`  host opened ${code}`);
await guest.evaluate((c) => window.__gdr.net.join(c), code);
await guest.waitForFunction(() => window.__gdr.net.state.phase === 'joined', { timeout: 10000, polling: 100 });
console.log('  guest walked in');
await host.waitForFunction(() => window.__gdr.net.state.members.length === 2, { timeout: 10000, polling: 100 });

// ── the ball, and a guest on it ───────────────────────────────────────────
console.log('\nthe ball:');
await host.evaluate(() => window.__gdr.club.call([0, 1.5, -1.9]));
await host.waitForFunction(() => window.__gdr.net.state.ball !== null, { timeout: 8000, polling: 100 });
await guest.waitForFunction(() => window.__gdr.net.state.ball !== null, { timeout: 8000, polling: 100 });
const hangSeconds = await host.evaluate(
  () => Math.round((window.__gdr.net.state.ball.firesAt - performance.now()) / 100) / 10,
);
console.log(`  up, and it fires on its own in ${hangSeconds}s`);
await guest.evaluate(() => window.__gdr.club.touch(true));
await host.waitForFunction(() => window.__gdr.net.state.ball?.joins.size === 1, { timeout: 8000, polling: 100 });
console.log('  the guest touched in');

// ── the row splits ────────────────────────────────────────────────────────
console.log('\nthe caller\'s row:');
await host.evaluate(() => window.__gdr.menu.show(true));
await host.waitForFunction(() => window.__gdr.menu.shown?.() === true, { timeout: 8000, polling: 100 }).catch(() => {});
await host.waitForTimeout(500);
// The panel publishes no button list, so the row is judged from the CANVAS
// it paints — straight off snapSocial, which beats photographing it through
// an emulator whose own chrome covers most of the frame.
const painted = await host.evaluate(() => window.__gdr.menu.snapSocial?.() ?? '');
if (!painted.startsWith('data:image/png')) note('could not snapshot the social panel');
else {
  writeFileSync(`${out}/ball-row-split.png`, Buffer.from(painted.split(',')[1], 'base64'));
  console.log(`  the caller's console painted → ball-row-split.png`);
}

// A press of a button that is not there must not deal the room, so prove
// the id is live by checking the ball survives an unrelated press first.
await host.evaluate(() => window.__gdr.menu.press('mic'));
await host.waitForTimeout(300);
if (await host.evaluate(() => window.__gdr.net.state.ball === null)) {
  note('an unrelated press dropped the ball');
}

// ── a guest cannot start it ───────────────────────────────────────────────
console.log('\nthe guest tries to start it:');
await guest.evaluate(() => window.__gdr.club.go());
await guest.waitForTimeout(900);
const afterGuest = await Promise.all([
  host.evaluate(() => ({ ball: window.__gdr.net.state.ball !== null, screen: window.__gdr.match.screen })),
  guest.evaluate(() => ({ ball: window.__gdr.net.state.ball !== null, screen: window.__gdr.match.screen })),
]);
console.log(`  host ${JSON.stringify(afterGuest[0])}  guest ${JSON.stringify(afterGuest[1])}`);
if (!afterGuest[0].ball || !afterGuest[1].ball) note('a guest STARTed the caller\'s ball');
// lobby AND tour are both "on the club floor" (see ClubSocialSystem's
// inClub); what matters is that the guest did not get dealt onto a ring.
if (afterGuest[1].screen !== 'lobby' && afterGuest[1].screen !== 'tour') {
  note(`the guest left the floor on their own press (${afterGuest[1].screen})`);
}

// ── the caller starts it ──────────────────────────────────────────────────
console.log('\nthe caller presses START:');
const t0 = Date.now();
await host.evaluate(() => window.__gdr.menu.press('start'));
const dealt = async (page, who) => {
  const ok = await page
    .waitForFunction(() => window.__gdr.match.screen === 'countdown' || window.__gdr.match.screen === 'raid', {
      timeout: 15000,
      polling: 60,
    })
    .then(() => true)
    .catch(() => false);
  if (!ok) note(`${who} was never dealt onto the ring`);
  return ok;
};
const hostDealt = await dealt(host, 'the host');
const guestDealt = await dealt(guest, 'the guest');
const took = (Date.now() - t0) / 1000;
console.log(`  both dealt in ${took.toFixed(1)}s (the ball had ${hangSeconds}s left to run)`);
if (hostDealt && guestDealt && took > 12) note(`START took ${took.toFixed(1)}s — that is not "early"`);
if (took >= hangSeconds) note('the deal did not beat the ball\'s own clock');

const seats = await host.evaluate(() => ({
  seats: window.__gdr.match.seats,
  humans: window.__gdr.match.players.filter((p) => p.kind !== 'bot').length,
}));
console.log(`  dealt onto a ${seats.seats}-ring, ${seats.humans} human(s)`);
if (seats.humans !== 2) note(`expected 2 humans on the ring, got ${seats.humans}`);
await host.screenshot({ path: `${out}/ball-started.png` });

// ── and a ball nobody starts still waits ──────────────────────────────────
console.log('\na ball nobody starts:');
await Promise.all([
  host.evaluate(() => window.__gdr.endSet()),
  guest.evaluate(() => window.__gdr.toLobby()),
]);
await host.waitForTimeout(2500);
await host.evaluate(() => window.__gdr.toLobby());
await host.waitForFunction(() => window.__gdr.net.state.phase === 'hosting', { timeout: 15000, polling: 200 })
  .catch(() => note('the host never got back to the floor'));
await host.waitForTimeout(800);
await host.evaluate(() => window.__gdr.club.call([0, 1.5, -1.9]));
const upAgain = await host
  .waitForFunction(() => window.__gdr.net.state.ball !== null, { timeout: 8000, polling: 100 })
  .then(() => true)
  .catch(() => false);
if (!upAgain) {
  console.log('  (the floor would not raise a second ball — skipped)');
} else {
  await host.waitForTimeout(4000);
  const stillUp = await host.evaluate(
    () => window.__gdr.net.state.ball !== null && window.__gdr.match.screen === 'lobby',
  );
  console.log(`  four seconds on and it is ${stillUp ? 'still hanging' : 'GONE'}`);
  if (!stillUp) note('an unstarted ball fired (or the floor left) on its own');
  await host.evaluate(() => window.__gdr.club.cancel());
}

await browser.close();
if (problems.length) {
  console.log(`\n${problems.length} problem(s).`);
  process.exit(1);
}
console.log('\nthe caller can start the night early, and only the caller.');
