#!/usr/bin/env node
/**
 * THE COLLAR IS SEALED — no sky inside the neck ring, looking down.
 *
 *   npm run dev                        # terminal 1
 *   node tools/collar-seal.mjs
 *
 * Every torso piece is a LatheGeometry: an OPEN surface with its back faces
 * culled. A profile that stops short of the axis leaves an aperture the
 * width of its last ring, and the TORSO_X/TORSO_Z cross-section then
 * stretches that aperture wider across the shoulders than whatever is meant
 * to plug it. The bodice used to stop at 0.028 — pulled out to 0.033 across
 * the body against a neck only 0.0287 wide there — so front to back the
 * neck covered the hole and side to side it fell a few millimetres short:
 * two crescents either side of the throat, straight through the figure and
 * out the far side. You only see them looking DOWN at him, which in a
 * headset is most of the time.
 *
 * So: park the camera above the collar, over a spread of nods, tilts, turns
 * and a melt, and sample points across the yoke the neck has to plug.
 * Nothing that isn't him may show through there.
 *
 * Both detail tiers are checked, and the DISTANT one is the reason this
 * runs at all. setDetail(false) strips the trim — choker, clavicles, seams
 * — so anything that only closes because a small mesh happens to lie over
 * it comes apart at exactly the range most of the crowd is standing at.
 * That tier is also what caught the NECK sitting in the detail list: culled
 * at distance, the head came off and floated above the shoulders.
 *
 * Exits non-zero if daylight gets in.
 */

import { chromium } from 'playwright';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';

let browser;
try {
  browser = await chromium.launch();
} catch {
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
}
const page = await browser.newPage({ viewport: { width: 640, height: 640 } });
const fails = [];
page.on('pageerror', (e) => fails.push(`[pageerror] ${e.message}`));
await page.goto(base + '/avatar-preview.html?still=1', { waitUntil: 'load', timeout: 30000 });

const report = await page.evaluate(async () => {
  const THREE = await import('/node_modules/three/build/three.module.js');
  const { buildDancer } = await import('/src/game/avatars.ts');

  const S = 512; // square frame, the collar filling most of it
  // Pure red: nothing in the kit is ever (255, 0, 0), and an unlit scene
  // background can't be tinted into the palette by a stray light.
  const BG = 0xff0000;

  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(S, S);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(1, 2, 1.5);
  scene.add(key);

  const rig = buildDancer(0.55);
  scene.add(rig.root);
  const collar = rig.root.getObjectByName('collar');
  const camera = new THREE.PerspectiveCamera(34, 1, 0.005, 50);

  const basePose = () => ({
    hx: 0, hy: 1.52, hz: 0, yaw: 0, pitch: 0, roll: 0,
    lx: -0.3, ly: 1.0, lz: -0.12, rx: 0.3, ry: 1.0, rz: -0.12, slump: 0,
  });
  // Every way the neck join can be wrenched about: nods to the limit of
  // PITCH_MAX, a hard tilt, turns, arms overhead pulling the yoke, a melt.
  const POSES = [
    ['at ease', {}],
    ['chin up', { pitch: 0.45 }],
    ['head down', { pitch: -0.45 }],
    ['head tilted', { roll: 0.55, pitch: 0.2 }],
    ['quarter turn', { yaw: 0.8, pitch: 0.2 }],
    ['turned away', { yaw: Math.PI, roll: -0.3 }],
    ['arms overhead', { ly: 1.85, ry: 1.85, lx: -0.18, rx: 0.18 }],
    ['melting', { slump: 0.6 }],
  ];
  // Looking DOWN on him — a headset stands over the crowd. The floor is 42°
  // because the ring is a HOOP wider than the neck it circles: by 35° the
  // sight-line to its far rim clears the trapezius entirely and comes out
  // over his shoulder, and every sample that complained down there was in
  // the two back corners of the ring, which is a hoop doing its job.
  const ELEVS = [85, 70, 55, 42];
  const AZIMS = [0, 40, 90, 140, 180, 220, 270, 320];

  // THE YOKE, sampled in three dimensions rather than as a circle on the
  // screen. A disc of points in the ring's OWN frame, projected one at a
  // time: at a shallow angle the opening projects to a squashed, tilted
  // ellipse, and a round screen window would spill off its top and bottom
  // into the sky beyond his shoulders and cry hole.
  //
  // The disc is the YOKE, not the whole hoop — 0.036, the bodice's own top
  // ring of 0.028 with a third again for margin. That is the ground the
  // neck has to plug, and where the crescents were. Sampling the hoop out
  // to its rim instead would fail honestly: the collar is a ring WIDER
  // than the neck it circles, so past about 40° down the sight-line to its
  // far edge clears the trapezius and comes out over his shoulder. That is
  // a hoop being a hoop, and a test that calls it a hole is a test nobody
  // will keep running.
  const APERTURE = [];
  for (let ri = 1; ri <= 22; ri++) {
    const r = (ri / 22) * 0.036;
    const n = 8 * ri;
    for (let k = 0; k < n; k++) {
      const th = (k / n) * Math.PI * 2;
      APERTURE.push([Math.cos(th) * r, Math.sin(th) * r]);
    }
  }

  const gl = renderer.getContext();
  const px = new Uint8Array(S * S * 4);
  const _c = new THREE.Vector3();
  const _e = new THREE.Vector3();
  const SAMPLES = APERTURE.length;
  const bad = [];

  for (const distant of [false, true]) {
    rig.setDetail(!distant);
    for (const [name, over] of POSES) {
      const p = { ...basePose(), ...over };
      rig.pose(p);
      collar.updateWorldMatrix(true, false);
      _c.setFromMatrixPosition(collar.matrixWorld);
      for (const elev of ELEVS) {
        for (const az of AZIMS) {
          const e = (elev * Math.PI) / 180;
          const a = (az * Math.PI) / 180;
          const d = 0.3;
          camera.position.set(
            _c.x + Math.sin(a) * Math.cos(e) * d,
            _c.y + Math.sin(e) * d,
            _c.z - Math.cos(a) * Math.cos(e) * d,
          );
          camera.lookAt(_c);
          camera.updateMatrixWorld();
          renderer.render(scene, camera);
          gl.readPixels(0, 0, S, S, gl.RGBA, gl.UNSIGNED_BYTE, px);

          let seen = 0;
          for (const [ax, ay] of APERTURE) {
            _e.set(ax, ay, 0).applyMatrix4(collar.matrixWorld).project(camera);
            const x = Math.round((_e.x * 0.5 + 0.5) * S);
            const y = Math.round((1 - (_e.y * 0.5 + 0.5)) * S);
            if (x < 0 || x >= S || y < 0 || y >= S) continue;
            // readPixels is bottom-up.
            const i = ((S - 1 - y) * S + x) * 4;
            if (px[i] > 200 && px[i + 1] < 60 && px[i + 2] < 60) seen++;
          }
          if (seen > 0) bad.push({ distant, name, elev, az, seen });
        }
      }
    }
  }
  const shots = 2 * POSES.length * ELEVS.length * AZIMS.length;
  rig.dispose();
  renderer.dispose();
  bad.sort((x, y) => y.seen - x.seen);
  return { shots, samples: SAMPLES, total: bad.length, worst: bad.slice(0, 10) };
});

console.log(`COLLAR — ${report.shots} looks down the neck of one dancer, ${report.samples} points across the ring each`);
if (report.total === 0) {
  console.log('  ✓ not one point of sky inside the ring, at any angle, in either detail tier');
} else {
  console.log(`  ✗ ${report.total} of ${report.shots} looks see through the collar:`);
  for (const w of report.worst) {
    console.log(
      `      ${String(w.seen).padStart(5)} pts ${w.name} @ elev ${w.elev}° az ${w.az}°` +
        `  (${w.distant ? 'DISTANT — trim culled' : 'near'})`,
    );
  }
  fails.push(`${report.total} looks see through the collar`);
}

await browser.close();
if (fails.length) {
  console.error(`\n${fails.length} failed.`);
  process.exit(1);
}
console.log('\nthe collar holds.');
