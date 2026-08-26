#!/usr/bin/env node
/**
 * Does the room keep talking through the set it's dancing — and can you
 * still shut someone up while you're on the ring?
 *
 *   npm run dev
 *   node tools/voice-in-set.mjs
 *
 * Two headsets, one room, then a real set dealt to both through the ball.
 * The claims under test:
 *
 *   - voice outlives the club floor: frames still cross the relay, and each
 *     dancer's voice still lands on a speaker, once the record has dropped;
 *   - MUTE and BLOCK still bite mid-set, which is the whole reason the
 *     pause card carries them.
 *
 * Frames are INJECTED rather than spoken: Chromium's fake capture device is
 * swallowed by noiseSuppression, so nothing clears the VAD gate and a
 * microphone proves nothing here. Pushing a real PCM frame down sendVoice
 * exercises everything that matters after it — the relay's fan-out to
 * members away on the ring, the speaker graph, and the safety lists.
 */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';
const RELAY_PORT = 8791;
const BALL_MS = 6000; // short fuse: the ball fires in seconds, not a minute

const results = [];
const check = (name, ok, detail) => {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const relay = spawn(process.execPath, ['server/index.mjs'], {
  env: { ...process.env, PORT: String(RELAY_PORT), BALL_MS: String(BALL_MS) },
  stdio: 'ignore',
});
await new Promise((r) => setTimeout(r, 800));

async function boot(name) {
  const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];
  let browser;
  try {
    browser = await chromium.launch({ args });
  } catch {
    browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args });
  }
  const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
  page.on('pageerror', (e) => console.log(`[${name}] ${e.message}`));
  const url = `${base}/?server=ws://localhost:${RELAY_PORT}&name=${name}`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => page.goto(url));
  await page.waitForTimeout(1000);
  await page.click('#enter-vr');
  await page.waitForFunction(() => document.body.classList.contains('app-entered'), { timeout: 15000 });
  await page.waitForTimeout(1500);
  // Warm the dynamic imports. The first import() of a module costs enough
  // to push a check past SPEAKING_MS and read a delivered frame as silence.
  await page.evaluate(async () => {
    await import('/src/club/voice.ts');
    await import('/src/club/social.ts');
    await import('/src/net/session.ts');
  });
  return { browser, page };
}

/** Push a burst of real PCM down this headset's voice sender. */
const talk = (page) =>
  page.evaluate(async () => {
    const { sendVoice } = await import('/src/net/session.ts');
    for (let n = 0; n < 4; n++) {
      const samples = 320;
      const out = new ArrayBuffer(8 + samples * 2);
      new DataView(out).setFloat64(0, 16000, true);
      const pcm = new Int16Array(out, 8);
      for (let i = 0; i < samples; i++) pcm[i] = Math.round(Math.sin(i * 0.2) * 9000);
      sendVoice(out);
      await new Promise((r) => setTimeout(r, 40));
    }
  });

/**
 * Watch IN-PAGE for `idx` to be heard at any point over `ms`.
 *
 * isSpeaking's window is 350 ms and a Playwright round trip through two
 * WebXR pages sharing a container's CPU routinely costs more than that, so
 * sampling from node races the very thing it measures. A rAF loop inside
 * the listening page cannot lose that race. Returns a promise — start it
 * BEFORE making the other headset talk.
 */
const watch = (page, idx, ms) =>
  page.evaluate(
    async ({ i, ms }) => {
      const v = await import('/src/club/voice.ts');
      return new Promise((done) => {
        let seen = false;
        const t0 = performance.now();
        const tick = () => {
          if (v.isSpeaking(String(i))) seen = true;
          if (performance.now() - t0 > ms) done(seen);
          else requestAnimationFrame(tick);
        };
        tick();
      });
    },
    { i: idx, ms },
  );

/** Did `listener` hear `speaker` at all while it was talking? */
async function heard(listener, idx, speaker, ms = 3000) {
  const watching = watch(listener, idx, ms);
  for (let n = 0; n < 5; n++) await talk(speaker);
  return watching;
}

/** Where a headset thinks it is, and whether its mic is open. */
const state = (page) =>
  page.evaluate(async () => {
    const v = await import('/src/club/voice.ts');
    return {
      screen: window.__gdr.match.screen,
      phase: window.__gdr.net.state.phase,
      capturing: v.isVoiceCapturing(),
    };
  });

const A = await boot('ALPHA');
const B = await boot('BETA');

await A.page.evaluate(() => window.__gdr.net.host());
await A.page.waitForFunction(() => window.__gdr.net.state.phase === 'hosting', { timeout: 8000, polling: 200 });
const code = await A.page.evaluate(() => window.__gdr.net.state.code);
await B.page.evaluate((c) => window.__gdr.net.join(c), code);
await B.page.waitForFunction(() => window.__gdr.net.state.phase === 'joined', { timeout: 8000, polling: 200 });
await A.page.waitForFunction(() => window.__gdr.net.state.members.length === 2, { timeout: 6000, polling: 200 });
console.log(`\nroom ${code}, two dancers`);

console.log('\n=== on the club floor ===');
let ok = await heard(B.page, 0, A.page);
check('BETA hears ALPHA on the floor', ok);

console.log('\n=== the record drops — both onto the ring ===');
await A.page.evaluate(() => window.__gdr.club.call([0, 1.5, -1.5]));
await A.page.waitForFunction(() => window.__gdr.net.state.ball !== null, { timeout: 8000, polling: 200 });
await B.page.evaluate(() => window.__gdr.club.touch(true));
await Promise.all([
  A.page.waitForFunction(() => window.__gdr.net.state.phase === 'live', { timeout: BALL_MS + 15000, polling: 250 }),
  B.page.waitForFunction(() => window.__gdr.net.state.phase === 'live', { timeout: BALL_MS + 15000, polling: 250 }),
]);
await A.page.waitForTimeout(2000);

const aState = await state(A.page);
const bState = await state(B.page);
console.log(`  ALPHA: screen ${aState.screen}, phase ${aState.phase}, capturing ${aState.capturing}`);
console.log(`  BETA : screen ${bState.screen}, phase ${bState.phase}, capturing ${bState.capturing}`);
check('both are on the ring', aState.phase === 'live' && bState.phase === 'live');
check('ALPHA keeps its mic open mid-set', aState.capturing);
check('BETA keeps its mic open mid-set', bState.capturing);

ok = await heard(B.page, 0, A.page);
check('BETA still hears ALPHA mid-set', ok);
ok = await heard(A.page, 1, B.page);
check('ALPHA still hears BETA mid-set', ok);

console.log('\n=== right Ⓐ, mid-set ===');
const card = await B.page.evaluate(() => {
  window.__gdr.menu.setPause(true);
  return null;
});
void card;
await B.page.waitForTimeout(600);
const ids = await B.page.evaluate(() => window.__gdr.menu.pauseButtons());
check('the card still offers the two decisions', ids.includes('resume') && ids.includes('bail'), ids.join(', '));
check('…and ALPHA\'s mute control', ids.includes('mute:ALPHA'));
check('…and ALPHA\'s block control', ids.includes('block:ALPHA'));
check('…and this headset\'s mic + voice switches', ids.includes('mic') && ids.includes('voice'));

// Press MUTE through the card itself — the real click path, not the store.
await B.page.evaluate(() => window.__gdr.menu.act('mute:ALPHA'));
await B.page.waitForTimeout(500);
const muted = await B.page.evaluate(async () => {
  const { socialMuted } = await import('/src/club/social.ts');
  return socialMuted('ALPHA');
});
check('pressing MUTE on the card mutes them', muted);
const stillUp = await B.page.evaluate(() => window.__gdr.menu.pauseButtons().length > 0);
check('the card stays up after a mute', stillUp);

// The card itself, for eyeballing — canvas geometry is easy to get subtly
// wrong and no assertion above would notice a row under the voice desk.
// Captured HERE, mid-set: once the record ends the room card is gone.
mkdirSync('artifacts', { recursive: true });
const shot = await B.page.evaluate(() => window.__gdr.menu.snapPause());
writeFileSync('artifacts/pause-room.png', Buffer.from(shot.split(',')[1], 'base64'));
console.log('  → artifacts/pause-room.png');

console.log('\n=== the mute controls actually silence, mid-set ===');
await B.page.waitForTimeout(700); // a frame or two for the system to apply it
ok = await heard(B.page, 0, A.page);
check('muting ALPHA silences them on the ring', !ok, ok ? 'still audible' : 'silent for the whole window');

await B.page.evaluate(() => window.__gdr.menu.act('mute:ALPHA'));
await B.page.waitForTimeout(700);
ok = await heard(B.page, 0, A.page);
check('un-muting from the card brings them back', ok);

const bad = results.filter((r) => !r).length;
console.log(`\n${results.length - bad}/${results.length} checks passed`);
await A.browser.close();
await B.browser.close();
relay.kill();
process.exit(bad ? 1 : 0);
