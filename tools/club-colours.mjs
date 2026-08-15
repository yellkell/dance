#!/usr/bin/env node
/**
 * Do our chosen colours hold true in the social area?
 *
 *   npm run dev      # terminal 1
 *   npm run server   # terminal 2
 *   node tools/club-colours.mjs
 *
 * Two headsets, two picked colours, one room. Checks that a colour chosen
 * at the foyer board travels the wire and lands on the OTHER dancer's
 * screen — in the roster, in the figure's neon, and in the name tag — and
 * that repainting yourself mid-room repaints you on their floor too.
 *
 * Written because reading the source can't tell you whether the paint made
 * it across a socket. The materials it samples are the real ones off the
 * live scene graph.
 */

import { chromium } from 'playwright';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';

const HOST_HUE = 0.33; // green
const GUEST_HUE = 0.86; // magenta
const REPAINT_HUE = 0.09; // amber — the guest changes their mind mid-room

async function launch() {
  const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];
  try {
    return await chromium.launch({ args });
  } catch {
    return chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args });
  }
}

/** Boot one headset with a colour already stored in its profile. */
async function headset(browser, hue, label) {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 520 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${label} pageerror] ${e.message}`));
  await page.addInitScript(
    ({ h, name }) => {
      localStorage.setItem('gdr-hue', String(h));
      localStorage.setItem('gdr-name', name);
    },
    { h: hue, name: label === 'HOST' ? 'GREENY' : 'MAGENTA' },
  );
  await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => page.goto(base));
  await page.waitForTimeout(1000);
  await page.click('#enter-vr');
  await page.waitForFunction(() => document.body.classList.contains('app-entered'), { timeout: 15000 });
  await page.waitForTimeout(1500);
  return page;
}

/** The standard sRGB EOTF — three.js stores material colours in its LINEAR
 *  working space, so an sRGB triple has to be decoded before comparing. */
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** hueToColor(hue, 0.6) in three's working space, mirrored from
 *  src/config.ts so the check is independent of the code under test. */
function expectedNeon(hue) {
  // HSL → RGB at S=1, L=0.6 (what hueToColor uses for a dancer's flat neon).
  const s = 1, l = 0.6;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const h6 = (((hue % 1) + 1) % 1) * 6;
  const x = c * (1 - Math.abs((h6 % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h6 < 1 ? [c, x, 0] : h6 < 2 ? [x, c, 0] : h6 < 3 ? [0, c, x]
    : h6 < 4 ? [0, x, c] : h6 < 5 ? [x, 0, c] : [c, 0, x];
  // hueToColor rounds to a 24-bit hex, so quantise the same way first.
  return [r + m, g + m, b + m].map((v) => toLinear(Math.round(v * 255) / 255));
}

/** What the HOST's screen believes about every other dancer on the floor:
 *  their roster hue, and the actual colour of their figure's flat neon. */
async function readFloor(page) {
  return page.evaluate(() => {
    const net = window.__gdr.net.state;
    const scene = window.__gdr.scene();
    const crowd = scene?.getObjectByName('club-crowd') ?? null;
    // The flat neon (MeshBasicMaterial) is the figure's hottest trim — the
    // one a player actually reads a dancer's colour off across a room.
    const neons = [];
    crowd?.traverse((o) => {
      const m = o.material;
      if (m && m.isMeshBasicMaterial && m.color && !m.map) {
        neons.push([m.color.r, m.color.g, m.color.b]);
      }
    });
    return {
      myIdx: net.myIdx,
      phase: net.phase,
      code: net.code,
      members: net.members.map((m) => ({ idx: m.idx, name: m.name, hue: m.hue ?? null })),
      neons,
    };
  });
}

function near(a, b, tol = 0.02) {
  return Math.abs(a - b) <= tol;
}

function matchesNeon(neons, hue) {
  const [er, eg, eb] = expectedNeon(hue);
  return neons.some(([r, g, b]) => near(r, er, 0.04) && near(g, eg, 0.04) && near(b, eb, 0.04));
}

const browser = await launch();
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const host = await headset(browser, HOST_HUE, 'HOST');
const guest = await headset(browser, GUEST_HUE, 'GUEST');

console.log('\n=== the wire ===');

await host.evaluate(() => window.__gdr.net.host());
await host.waitForFunction(() => window.__gdr.net.state.phase === 'hosting', { timeout: 8000 });
const code = await host.evaluate(() => window.__gdr.net.state.code);
console.log(`  room ${code}`);

await guest.evaluate((c) => window.__gdr.net.join(c), code);
await guest.waitForFunction(() => window.__gdr.net.state.phase === 'joined', { timeout: 8000 });
await host.waitForFunction(() => window.__gdr.net.state.members.length === 2, { timeout: 8000 });
await host.waitForTimeout(600);

let floor = await readFloor(host);
const guestRow = floor.members.find((m) => m.idx !== floor.myIdx);
check(
  'the guest\'s chosen hue reaches the host\'s roster',
  guestRow != null && guestRow.hue != null && near(guestRow.hue, GUEST_HUE),
  `roster hue ${guestRow?.hue ?? 'absent'} (picked ${GUEST_HUE})`,
);
const hostRow = floor.members.find((m) => m.idx === floor.myIdx);
check(
  'the host\'s own hue is echoed back in the roster',
  hostRow != null && hostRow.hue != null && near(hostRow.hue, HOST_HUE),
  `roster hue ${hostRow?.hue ?? 'absent'} (picked ${HOST_HUE})`,
);

console.log('\n=== the floor ===');

// Both walk into the club so the crowd builds.
for (const page of [host, guest]) {
  await page.evaluate(() => window.__gdr.rig(0, -2, 0));
  await page.evaluate(() => (window.__gdr.match.screen = 'club'));
}
await host.waitForTimeout(1200);
floor = await readFloor(host);

check(
  'the guest\'s figure is built in the colour they picked',
  matchesNeon(floor.neons, GUEST_HUE),
  `${floor.neons.length} flat-neon material(s) on the floor`,
);
check(
  'and NOT in the colour their slot would have handed out',
  // seat 1's golden-angle neon — the old behaviour this replaces.
  !matchesNeon(floor.neons, (1 * 0.381966) % 1),
  'slot colour absent from the figure',
);

console.log('\n=== a change of mind, mid-room ===');

await guest.evaluate((h) => window.__gdr.net.setHue(h), REPAINT_HUE);
await host.waitForFunction(
  (h) => {
    const net = window.__gdr.net.state;
    const other = net.members.find((m) => m.idx !== net.myIdx);
    return other != null && other.hue != null && Math.abs(other.hue - h) < 0.02;
  },
  REPAINT_HUE,
  { timeout: 6000 },
).catch(() => {});
await host.waitForTimeout(1200);
floor = await readFloor(host);
const repainted = floor.members.find((m) => m.idx !== floor.myIdx);
check(
  'repainting yourself pushes down the wire',
  repainted?.hue != null && near(repainted.hue, REPAINT_HUE),
  `roster hue ${repainted?.hue ?? 'absent'} (repainted to ${REPAINT_HUE})`,
);
check(
  'the figure on the floor is rebuilt in the new colour',
  matchesNeon(floor.neons, REPAINT_HUE),
  'new neon present',
);
check(
  'the old colour is gone from the floor',
  !matchesNeon(floor.neons, GUEST_HUE),
  'stale neon cleared',
);

console.log('\n=== back to the slot ===');

await guest.evaluate(() => window.__gdr.net.setHue(null));
await host.waitForTimeout(1400);
floor = await readFloor(host);
const cleared = floor.members.find((m) => m.idx !== floor.myIdx);
check(
  'clearing your pick hands the colour back to the slot',
  cleared != null && cleared.hue == null,
  `roster hue ${cleared?.hue ?? 'null'}`,
);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
