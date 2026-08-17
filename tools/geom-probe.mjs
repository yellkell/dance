#!/usr/bin/env node
/**
 * Geometry probe — ask the LIVE club what actually occupies a region.
 *
 *   npm run dev      # terminal 1
 *   npm run server   # terminal 2
 *   node tools/geom-probe.mjs
 *
 * Boots the app through the emulated XR path, hosts a room so the club
 * builds, then walks the real scene graph and reports every mesh whose
 * world-space bounding box meets each query box. Written for the
 * "what is overlapping this?" questions that are guesswork from source.
 */

import { chromium } from 'playwright';

const base = process.env.PREVIEW_BASE ?? 'http://localhost:5173';

async function launch() {
  const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];
  try {
    return await chromium.launch({ args });
  } catch {
    return chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args });
  }
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));

await page.goto(base, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => page.goto(base));
await page.waitForTimeout(1200);
await page.click('#enter-vr');
await page.waitForFunction(() => document.body.classList.contains('app-entered'), { timeout: 15000 });
await page.waitForTimeout(2000);
await page.evaluate(() => window.__gdr.net.host());
await page.waitForFunction(() => window.__gdr.net.state.phase === 'hosting', { timeout: 8000 });
await page.waitForTimeout(1500);

/** Query boxes: [label, minX, maxX, minY, maxY, minZ, maxZ] */
const QUERIES = [
  ['NE CORNER — the arcade\'s old plot, beside the DJ booth', 4.7, 9.01, 0, 2.6, -11.5, -8.0],
];

// Triangle-level, because the club merges its scenery into a handful of
// giant BufferGeometries — a per-mesh bounding box there spans the whole
// hall and answers nothing. Overlapping triangles are grouped into slabs
// (rounded bounds) so the output names shapes, not 40,000 faces.
const found = await page.evaluate((queries) => {
  const scene = window.__gdr.scene();
  const out = {};
  scene.updateMatrixWorld(true);

  const meshes = [];
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    for (let p = o; p; p = p.parent) if (!p.visible) return;
    meshes.push(o);
  });

  for (const [label, x0, x1, y0, y1, z0, z1] of queries) {
    const slabs = new Map();
    for (const o of meshes) {
      const pos = o.geometry.attributes.position;
      const idx = o.geometry.index;
      const n = idx ? idx.count : pos.count;
      const m = o.matrixWorld.elements;
      // Inline world transform — 40k triangles through Vector3 is slow.
      const wx = (x, y, z) => m[0] * x + m[4] * y + m[8] * z + m[12];
      const wy = (x, y, z) => m[1] * x + m[5] * y + m[9] * z + m[13];
      const wz = (x, y, z) => m[2] * x + m[6] * y + m[10] * z + m[14];
      for (let t = 0; t < n; t += 3) {
        let aX = Infinity, aY = Infinity, aZ = Infinity;
        let bX = -Infinity, bY = -Infinity, bZ = -Infinity;
        for (let k = 0; k < 3; k++) {
          const v = idx ? idx.getX(t + k) : t + k;
          const lx = pos.getX(v), ly = pos.getY(v), lz = pos.getZ(v);
          const X = wx(lx, ly, lz), Y = wy(lx, ly, lz), Z = wz(lx, ly, lz);
          if (X < aX) aX = X; if (X > bX) bX = X;
          if (Y < aY) aY = Y; if (Y > bY) bY = Y;
          if (Z < aZ) aZ = Z; if (Z > bZ) bZ = Z;
        }
        if (bX < x0 || aX > x1 || bY < y0 || aY > y1 || bZ < z0 || aZ > z1) continue;
        const r = (v) => Math.round(v * 100) / 100;
        const key = `${o.name || o.geometry.type}|${r(aX)},${r(bX)},${r(aY)},${r(bY)},${r(aZ)},${r(bZ)}`;
        const cur = slabs.get(key);
        if (cur) cur.n++;
        else
          slabs.set(key, {
            n: 1,
            name: o.name || o.geometry.type,
            box: [aX, bX, aY, bY, aZ, bZ].map((v) => Math.round(v * 1000) / 1000),
          });
      }
    }
    // Merge slabs that share (rounded) bounds on two axes — one logical part.
    out[label] = [...slabs.values()].sort((a, b) => a.box[2] - b.box[2]);
  }
  return out;
}, QUERIES);

for (const [label, hits] of Object.entries(found)) {
  console.log(`\n=== ${label} — ${hits.length} distinct part(s) ===`);
  for (const h of hits) {
    const [ax, bx, ay, by, az, bz] = h.box;
    console.log(
      `  ${String(h.name).padEnd(20)} x[${ax} ${bx}] y[${ay} ${by}] z[${az} ${bz}]  (${h.n} tri)`,
    );
  }
}

await browser.close();
