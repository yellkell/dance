#!/usr/bin/env node
/**
 * Teleport rules check — the club's floor/wall rules, exercised against the
 * REAL exported logic (vite serves the TypeScript, so this imports the same
 * `crossesWall`/`floorYAt`/`TELEPORT_AREAS` the game runs on).
 *
 *   npm run dev
 *   node tools/teleport-rules.mjs
 *
 * Covers the bar-top rule in particular: you can get UP on the counter and
 * back DOWN, and nobody on the floor gets a free hop into the keeper's
 * aisle over the top of it.
 */

import { chromium } from 'playwright';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';

async function launch() {
  try {
    return await chromium.launch();
  } catch {
    return chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  }
}

const browser = await launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 });

const results = await page.evaluate(async () => {
  const cfg = await import('/src/club/config.ts');
  const { CLUB, TELEPORT_AREAS, crossesWall, floorYAt } = cfg;

  const areaAt = (x, z) => {
    for (const a of TELEPORT_AREAS) {
      if (x >= a.minX && x <= a.maxX && z >= a.minZ && z <= a.maxZ) return a;
    }
    return null;
  };
  // Exactly the system's rule: land on a real area, with no wall in the way
  // at the higher of the two ends.
  const canHop = (fx, fz, tx, tz) => {
    const area = areaAt(tx, tz);
    if (!area) return { ok: false, why: 'no floor there' };
    const hopY = Math.max(floorYAt(fx, fz), area.y);
    if (crossesWall(fx, fz, tx, tz, hopY)) return { ok: false, why: 'wall in the way' };
    return { ok: true, why: `lands at y=${area.y}` };
  };

  const barMidZ = (CLUB.bar.z0 + CLUB.bar.z1) / 2;
  const onBar = [CLUB.bar.x + CLUB.bar.depth / 2, barMidZ];
  const inHall = [5.4, barMidZ];
  const inAisle = [8.0, barMidZ];
  const inFrontOfStage = [0, -5.0];
  const onStage = [0, -7.6];

  const cases = [
    ['hall → ON THE BAR', inHall, onBar, true],
    ['bar → back down to the hall', onBar, inHall, true],
    ['bar → down into the aisle', onBar, inAisle, true],
    ['hall → straight over the bar into the aisle', inHall, inAisle, false],
    ['hall → dance floor', [0, -2], [1.5, -4], true],
    ['hall → through the still room wall', [-6.8, -7.0], [-6.8, -10.0], false],
    ['hall → in through the still room door', [-6.0, -8.6], [-6.8, -10.0], true],
    ['hall → onto a booth table', [-6.0, -3.4], [CLUB.boothX, CLUB.boothZs[1]], true],
    ['hall → onto the terrace', [0, 2.0], [-4.0, 3.6], true],
    ['hall → UP ON THE STAGE', inFrontOfStage, onStage, true],
    ['stage → back down to the hall', onStage, inFrontOfStage, true],
    ['stage → into a wing beside the decks', onStage, [2.0, -8.5], true],
    ['hall → over the stage to backstage', [0, -5.0], [0, -10.4], false],
    ['stage → out the back to backstage', onStage, [0, -10.4], false],
    ['hall → the pocket under the stage', [0, -5.0], [0, -7.0], false],
    ['beside the stage → up onto it', [-3.3, -7.0], onStage, true],
    ['hall → inside the DJ desk', inFrontOfStage, [0, -8.4], false],
    // The arcade's old plot, north-east, beside the stage.
    ['hall → the north-east corner', [5.5, -7.5], [7.0, -9.5], true],
    ['NE corner → back out to the hall', [7.0, -9.5], [5.5, -7.5], true],
    ['NE corner → the corridor by the stage', [7.0, -9.5], [4.2, -9.5], true],
    ['NE corner → through the back-bar wall', [7.0, -9.5], [8.9, -9.5], false],
  ];

  return cases.map(([name, from, to, want]) => {
    const got = canHop(from[0], from[1], to[0], to[1]);
    return { name, want, got: got.ok, why: got.why };
  });
});

let bad = 0;
for (const r of results) {
  const ok = r.got === r.want;
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${r.name.padEnd(46)} ${r.got ? 'allowed' : 'refused'} (${r.why})`);
}
console.log(bad ? `\n${bad} failing` : '\nall teleport rules hold');

await browser.close();
process.exit(bad ? 1 : 0);
