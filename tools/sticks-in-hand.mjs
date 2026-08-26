#!/usr/bin/env node
/**
 * When the glowsticks are in your hands — the rule that decides whether a
 * controller model is drawn through one.
 *
 *   npm run dev
 *   npm run server        # the club-floor row needs a relay
 *   node tools/sticks-in-hand.mjs
 *
 * ONE HAND HOLDS ONE THING. The sticks and the moulded grips occupy the
 * same few centimetres, so exactly one of them may be drawn. That used to
 * be two conditions in two places — the sticks came out everywhere but the
 * club floor, while the plastic only went for 'countdown' and 'raid' — so
 * the solo lobby, the tour menu and the podium each drew a controller
 * straight through a glowstick. They are one expression now:
 *
 *     const sticksOut = !clubFloor;
 *     this.showControllers(!sticksOut);
 *
 * which is why this harness checks the STICK side only. The controller side
 * cannot disagree with it any more — it is the same variable, negated — and
 * checking it here would mean faking a controller glTF this browser does
 * not ship, injecting it into IWSDK's live adapters, and then measuring the
 * injection as much as the game. An earlier cut of this file did exactly
 * that and reported failures that were purely its own artifact.
 *
 * On a headset the other half is one line: `__gdr.pads()` in a menu, where
 * `inRig` should be false while a stick is in that hand.
 */

import { chromium } from 'playwright';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
let browser;
try { browser = await chromium.launch(); }
catch { browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }); }
const page = await browser.newPage();
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1000);
await page.click('#enter-vr');
await page.waitForFunction(() => document.body.classList.contains('app-entered'), { timeout: 15000 });
await page.waitForTimeout(800);

const out = await page.evaluate(async () => {
  const g = window.__gdr;
  const problems = [];
  const rows = [];

  const read = () => {
    let drawn = 0;
    let found = 0;
    g.scene()?.traverse((o) => {
      if (o.name !== 'live-glowstick') return;
      found++;
      if (o.visible && o.parent) drawn++;
    });
    return { drawn, found, screen: g.match.screen, phase: g.net.state.phase };
  };

  /**
   * Settle, then read. The world ticks on the XR session's own frame queue
   * (IWER emulates one), not window.requestAnimationFrame, so a fixed frame
   * count proves nothing about whether PlayerSystem has seen the new state.
   * Poll for the expected outcome and record whatever it settled on.
   */
  async function look(label, want, wantText) {
    const t0 = performance.now();
    let r = read();
    while (performance.now() - t0 < 3000) {
      r = read();
      if (want(r)) break;
      await new Promise((res) => setTimeout(res, 50));
    }
    rows.push({ label, ...r, wantText });
    if (!want(r)) problems.push(`${label}: wanted ${wantText}, got ${r.drawn} of ${r.found} drawn`);
    return r;
  }

  const out2 = (r) => r.drawn === 2;
  const away = (r) => r.drawn === 0;

  // ── IN YOUR HANDS: every solo state. These are the rows that used to
  // draw a controller through the stick. ──
  g.toLobby();
  await look('lobby (solo)', (r) => r.screen === 'lobby' && out2(r), 'both sticks out');

  g.toTour();
  await look('tour menu', (r) => r.screen === 'tour' && out2(r), 'both sticks out');

  // A count-in. ('raid' and 'podium' need the RECORD's clock to advance and
  // there is no audio clock headless, so the screen parks here — countdown
  // sits on the same side of the rule, so what it proves carries.)
  g.startRaid({ seats: 4 });
  await look('countdown', (r) => r.screen === 'countdown' && out2(r), 'both sticks out');

  g.toLobby();
  await look('lobby (back)', (r) => r.screen === 'lobby' && out2(r), 'both sticks out');

  // ── IN THE BAG: the club floor, where your hands are hands (drinks to
  // hold, panels to poke) and the plastic is what you want to see. ──
  g.net.host();
  const hosting = await new Promise((resolve) => {
    const t0 = performance.now();
    const tick = () => {
      if (g.net.state.phase === 'hosting') return resolve(true);
      if (performance.now() - t0 > 8000) return resolve(false);
      setTimeout(tick, 50);
    };
    tick();
  });
  if (hosting) {
    await look('club floor', (r) => r.phase === 'hosting' && away(r), 'both sticks away');
    g.net.leave();
    await look('left the room', (r) => r.phase === 'off' && out2(r), 'both sticks back');
  } else {
    problems.push('no relay beside the dev server (npm run server) — the club floor went untested');
  }

  // Anchors: without these every row could pass vacuously.
  if (!rows.some((r) => r.found > 0)) problems.push('no glowstick in the scene at all — the probe is blind');
  if (!rows.some((r) => r.drawn > 0)) problems.push('no state drew a stick — nothing was proven');
  if (!rows.some((r) => r.drawn === 0)) problems.push('no state put the sticks away — the bag path is untested');

  return { problems, rows };
});

for (const r of out.rows) {
  console.log(
    `  ${r.label.padEnd(14)} screen ${String(r.screen).padEnd(10)} phase ${String(r.phase).padEnd(8)}` +
    ` sticks drawn ${r.drawn}/${r.found}   (${r.wantText})`,
  );
}
if (out.problems.length) {
  console.log('\nPROBLEMS:');
  for (const p of out.problems) console.log(`  ✗ ${p}`);
} else {
  console.log('\n  ✓ the sticks are out for every solo state and away on the club floor');
  console.log('    the plastic is the same expression negated — on a headset: __gdr.pads() in a menu, inRig false');
}
await browser.close();
process.exit(out.problems.length ? 1 : 0);
