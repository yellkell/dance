#!/usr/bin/env node
/**
 * The lying-stick check — the liquid surface must never leave the glass.
 *
 *   npm run dev
 *   node tools/lying-stick.mjs
 *
 * The slosh tilt is a slope. Across a vertical stick it swings the surface
 * across a 2 cm bore; across a HORIZONTAL stick the same slope used to swing
 * the cut line ±9 cm over a 30 cm tube — half the liquid discarded to
 * nothing and you saw clean through the stick. This drives the real
 * createLiquid() at max tilt in both poses and asserts, from the shader's
 * own uniforms, that the plane stays inside the interior: displacement at
 * the tube ends ≤ 45% of the liquid's vertical span when lying, charm
 * untouched when standing (and across the bore, in every pose).
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
  const { createLiquid } = await import('/src/materials/liquid.ts');
  const THREE = await import('/node_modules/three/build/three.module.js');

  // The stick's real proportions (PlayerSystem's LIQUID_R / STICK_LEN).
  const R = 0.0115;
  const SHAFT = 0.28;
  const LEN = R * 2 + SHAFT;
  const FILL = 0.85;

  const problems = [];
  const rows = [];

  /** One posed measurement: force the pendulum to `tilt`, read the plane. */
  function probe(name, axis, tiltX, tiltZ) {
    const liquid = createLiquid(new THREE.CapsuleGeometry(R, SHAFT, 3, 10));
    const worldHeight = R * 2 + SHAFT * Math.abs(axis.y);
    liquid.slosh.tiltX = tiltX;
    liquid.slosh.tiltZ = tiltZ;
    // dt=0 step: SloshSim decays nothing meaningful in one tick at rest —
    // but update() re-integrates, so re-force the tilt after, then render.
    liquid.update(0, 0, FILL, new THREE.Vector3(0, 1, 0), worldHeight, axis, LEN, new THREE.Vector3());
    liquid.slosh.tiltX = tiltX;
    liquid.slosh.tiltZ = tiltZ;
    liquid.update(0, 0, FILL, new THREE.Vector3(0, 1, 0), worldHeight, axis, LEN, new THREE.Vector3());
    const u = liquid.material.uniforms;
    const n = u.uPlaneNormal.value;
    const slopeX = n.x / n.y;
    const slopeZ = n.z / n.y;
    const row = {
      name,
      slopeX: +slopeX.toFixed(4),
      slopeZ: +slopeZ.toFixed(4),
      rippleAmp: +u.uRippleAmp.value.toFixed(5),
      foamReach: +u.uFoamReach.value.toFixed(5),
      worldHeight: +worldHeight.toFixed(4),
    };
    rows.push(row);
    liquid.dispose();
    return row;
  }

  // 1. LYING, tilted ALONG its own axis — the see-through case. The plane's
  // rise over the half-length must stay inside the liquid's span.
  const lying = probe('lying, tilt along axis', new THREE.Vector3(1, 0, 0), 0.6, 0);
  const endRise = Math.abs(lying.slopeX) * (LEN / 2);
  if (endRise > 0.45 * lying.worldHeight + 1e-4) {
    problems.push(`lying stick: plane rises ${endRise.toFixed(4)} m at the tube end — outside the glass (span ${lying.worldHeight})`);
  }

  // 2. LYING, tilted ACROSS the bore — the charm must be untouched.
  const across = probe('lying, tilt across bore', new THREE.Vector3(1, 0, 0), 0, 0.6);
  if (Math.abs(across.slopeZ - 0.6 / Math.hypot(0.6, 1) * Math.hypot(0.6, 1)) > 0.05 && Math.abs(across.slopeZ) < 0.5) {
    problems.push(`across-bore slosh was clamped too (slopeZ ${across.slopeZ}) — the guard overreached`);
  }

  // 3. STANDING — the original behaviour, bit for bit.
  const standing = probe('standing, full tilt', new THREE.Vector3(0, 1, 0), 0.6, 0);
  if (Math.abs(standing.slopeX - 0.6) > 0.02) {
    problems.push(`standing stick lost its surge: slope ${standing.slopeX} (wanted 0.6)`);
  }
  if (Math.abs(standing.rippleAmp - 0.006) > 1e-4) {
    problems.push(`standing ripple amplitude moved: ${standing.rippleAmp} (wanted 0.006)`);
  }

  // 4. Lying ripple + meniscus must shrink with the span — the flicker and
  // the whiteout were the other two see-through accomplices.
  if (lying.rippleAmp > lying.worldHeight * 0.13) {
    problems.push(`lying ripple ${lying.rippleAmp} still bore-sized (span ${lying.worldHeight})`);
  }
  if (lying.foamReach > lying.worldHeight * 0.31) {
    problems.push(`lying meniscus ${lying.foamReach} still eats the body (span ${lying.worldHeight})`);
  }

  return { rows, problems };
});

for (const r of out.rows) {
  console.log(
    `  ${r.name.padEnd(26)} slopeX ${String(r.slopeX).padStart(8)}  slopeZ ${String(r.slopeZ).padStart(8)}` +
    `  ripple ${r.rippleAmp}  foam ${r.foamReach}  span ${r.worldHeight}`,
  );
}
if (out.problems.length) {
  console.log('\nPROBLEMS:');
  for (const p of out.problems) console.log(`  ✗ ${p}`);
} else {
  console.log('\n  ✓ the surface stays in the glass, and the standing stick keeps its surge');
}
await browser.close();
process.exit(out.problems.length ? 1 : 0);
