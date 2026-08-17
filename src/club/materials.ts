/**
 * The club's material wardrobe — every surface painted by hand on small
 * tileable canvases (no shipped image assets, same discipline as the rest of
 * the game). The palette does the restraint: charcoal plaster, smoked oak,
 * champagne brass, oxblood velvet, dark veined stone — saturated colour is
 * reserved for LIGHT (coves, candles, signage, the eclipse).
 *
 * Roughness separation carries the "expensive" read: plaster is dead matte,
 * velvet swallows light, oak is waxed, stone is honed, brass is the one
 * thing allowed to shine.
 */

import {
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';
import { DECOR } from './config.js';

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

function wrap(c: HTMLCanvasElement, repeat: [number, number]): CanvasTexture {
  const tex = new CanvasTexture(c);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.anisotropy = 4;
  return tex;
}

const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;

/** Deterministic per-texture rng so rebuilds look identical. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

const cache = new Map<string, CanvasTexture>();
function cached(key: string, make: () => CanvasTexture): CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const tex = make();
  cache.set(key, tex);
  return tex;
}

/* ── surfaces ───────────────────────────────────────────────────────────── */

/** Charcoal lime plaster: soft trowel clouds + the faintest grit. */
export function plasterTexture(repeat: [number, number] = [4, 2]): CanvasTexture {
  return cached(`plaster${repeat}`, () => {
    const [c, g] = canvas(256);
    const r = rng(0x9145);
    g.fillStyle = css(DECOR.plaster);
    g.fillRect(0, 0, 256, 256);
    // Trowel clouds: big soft ellipses a shade either side of the base.
    for (let i = 0; i < 46; i++) {
      const light = r() > 0.5;
      g.fillStyle = light ? 'rgba(96,90,106,0.05)' : 'rgba(12,10,18,0.07)';
      g.beginPath();
      g.ellipse(r() * 256, r() * 256, 30 + r() * 60, 14 + r() * 34, r() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
    // Grit.
    for (let i = 0; i < 700; i++) {
      g.fillStyle = r() > 0.5 ? 'rgba(200,195,210,0.03)' : 'rgba(0,0,0,0.05)';
      g.fillRect(r() * 256, r() * 256, 1, 1);
    }
    return wrap(c, repeat);
  });
}

/** Herringbone smoked-oak parquet — the dance floor's field. */
export function parquetTexture(repeat: [number, number] = [3, 3]): CanvasTexture {
  return cached(`parquet${repeat}`, () => {
    const [c, g] = canvas(512);
    const r = rng(0xdacef100);
    g.fillStyle = css(DECOR.oakDark);
    g.fillRect(0, 0, 512, 512);
    const L = 64; // plank length
    const W = 21; // plank width
    const tones = ['#4a3524', '#41301f', '#523a27', '#463222', '#3a2a1c', '#4e3626'];
    // Two diagonal families make the herringbone; drawn oversize so the tile
    // edge cuts cleanly and the pattern wraps.
    for (let row = -2; row < 20; row++) {
      for (let col = -2; col < 20; col++) {
        const x = col * L * 0.5;
        const y = row * W * 2;
        for (const flip of [0, 1]) {
          g.save();
          g.translate(x + (flip ? L * 0.25 : -L * 0.25) + L * 0.25, y + (flip ? W : 0) + W * 0.5);
          g.rotate(flip ? Math.PI / 4 : -Math.PI / 4);
          const tone = tones[Math.floor(r() * tones.length)];
          g.fillStyle = tone;
          g.fillRect(-L / 2, -W / 2, L, W);
          // Grain: a few long strokes down the plank.
          g.strokeStyle = 'rgba(0,0,0,0.16)';
          g.lineWidth = 1;
          for (let s = 0; s < 3; s++) {
            const gy = -W / 2 + (s + 0.6) * (W / 3.4) + (r() - 0.5) * 3;
            g.beginPath();
            g.moveTo(-L / 2 + 2, gy);
            g.bezierCurveTo(-L / 6, gy + (r() - 0.5) * 3, L / 6, gy + (r() - 0.5) * 3, L / 2 - 2, gy);
            g.stroke();
          }
          // Edge shadow so every plank keeps its joint.
          g.strokeStyle = 'rgba(0,0,0,0.4)';
          g.strokeRect(-L / 2, -W / 2, L, W);
          // A rare waxed highlight — the floor is loved but lived-on.
          if (r() > 0.9) {
            g.fillStyle = 'rgba(255,230,190,0.05)';
            g.fillRect(-L / 2, -W / 2, L, W / 3);
          }
          g.restore();
        }
      }
    }
    return wrap(c, repeat);
  });
}

/** Honed dark terrazzo with brass-fleck aggregate — walkways + bar floor. */
export function terrazzoTexture(repeat: [number, number] = [6, 6]): CanvasTexture {
  return cached(`terrazzo${repeat}`, () => {
    const [c, g] = canvas(256);
    const r = rng(0x7e44a);
    g.fillStyle = css(DECOR.stone);
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 340; i++) {
      const t = r();
      g.fillStyle =
        t > 0.94
          ? 'rgba(201,168,106,0.5)' // the brass flecks
          : t > 0.6
            ? 'rgba(180,185,198,0.16)'
            : t > 0.3
              ? 'rgba(120,126,140,0.14)'
              : 'rgba(8,9,12,0.35)';
      g.beginPath();
      g.ellipse(r() * 256, r() * 256, 1 + r() * 3.4, 1 + r() * 2.6, r() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
    return wrap(c, repeat);
  });
}

/** Oxblood velvet — deep nap with a low sheen band. `channels` draws the
 *  banquette's vertical channel tufting into the cloth. */
export function velvetTexture(repeat: [number, number] = [2, 1], channels = 0): CanvasTexture {
  return cached(`velvet${repeat}|${channels}`, () => {
    const [c, g] = canvas(256);
    const r = rng(0xb100d);
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, css(DECOR.velvet));
    grad.addColorStop(0.55, css(DECOR.velvetDeep));
    grad.addColorStop(1, css(DECOR.velvet));
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    // Nap: fine vertical strokes, darker and lighter threads.
    for (let i = 0; i < 420; i++) {
      const x = r() * 256;
      g.strokeStyle = r() > 0.5 ? 'rgba(255,150,150,0.03)' : 'rgba(0,0,0,0.06)';
      g.beginPath();
      g.moveTo(x, r() * 256);
      g.lineTo(x + (r() - 0.5) * 4, r() * 256);
      g.stroke();
    }
    if (channels > 0) {
      const w = 256 / channels;
      for (let i = 0; i < channels; i++) {
        const x = i * w;
        // Each channel: shaded edges, a soft crown, a seam line.
        const edge = g.createLinearGradient(x, 0, x + w, 0);
        edge.addColorStop(0, 'rgba(0,0,0,0.5)');
        edge.addColorStop(0.22, 'rgba(255,190,170,0.06)');
        edge.addColorStop(0.5, 'rgba(255,210,190,0.1)');
        edge.addColorStop(0.78, 'rgba(255,190,170,0.06)');
        edge.addColorStop(1, 'rgba(0,0,0,0.5)');
        g.fillStyle = edge;
        g.fillRect(x, 0, w, 256);
        g.strokeStyle = 'rgba(20,4,6,0.55)';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x + 0.5, 0);
        g.lineTo(x + 0.5, 256);
        g.stroke();
      }
    }
    return wrap(c, repeat);
  });
}

/** Ribbed glass — vertical reeds; backlit by an emissive material. */
export function ribbedGlassTexture(repeat: [number, number] = [6, 1]): CanvasTexture {
  return cached(`ribbed${repeat}`, () => {
    const [c, g] = canvas(128);
    const REED = 16;
    for (let x = 0; x < 128; x += REED) {
      const reed = g.createLinearGradient(x, 0, x + REED, 0);
      reed.addColorStop(0, '#5a5648');
      reed.addColorStop(0.28, '#d8cfae');
      reed.addColorStop(0.5, '#fff6d8');
      reed.addColorStop(0.72, '#d8cfae');
      reed.addColorStop(1, '#5a5648');
      g.fillStyle = reed;
      g.fillRect(x, 0, REED, 128);
    }
    // A soft vertical fade keeps the panel from reading as a flat stripe.
    const fade = g.createLinearGradient(0, 0, 0, 128);
    fade.addColorStop(0, 'rgba(30,26,18,0.35)');
    fade.addColorStop(0.5, 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(30,26,18,0.35)');
    g.fillStyle = fade;
    g.fillRect(0, 0, 128, 128);
    return wrap(c, repeat);
  });
}

/** Dark honed marble with pale + brass veining — counter and table tops. */
export function marbleTexture(repeat: [number, number] = [2, 1]): CanvasTexture {
  return cached(`marble${repeat}`, () => {
    const [c, g] = canvas(256);
    const r = rng(0x3a4b1e);
    g.fillStyle = '#16171c';
    g.fillRect(0, 0, 256, 256);
    // Cloudy body.
    for (let i = 0; i < 40; i++) {
      g.fillStyle = r() > 0.5 ? 'rgba(60,64,76,0.08)' : 'rgba(6,6,10,0.12)';
      g.beginPath();
      g.ellipse(r() * 256, r() * 256, 24 + r() * 60, 12 + r() * 30, r() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
    // Veins: wandering bezier threads, one in ghost-white, a rare one brass.
    for (let v = 0; v < 9; v++) {
      const brassVein = r() > 0.8;
      g.strokeStyle = brassVein ? 'rgba(201,168,106,0.34)' : 'rgba(214,218,230,0.22)';
      g.lineWidth = brassVein ? 1.6 : 0.9 + r() * 1.2;
      let x = r() * 256;
      let y = r() * 256;
      g.beginPath();
      g.moveTo(x, y);
      for (let s = 0; s < 5; s++) {
        const nx = x + (r() - 0.5) * 130;
        const ny = y + (r() - 0.5) * 130;
        g.quadraticCurveTo(x + (r() - 0.5) * 60, y + (r() - 0.5) * 60, nx, ny);
        x = nx;
        y = ny;
      }
      g.stroke();
      // A hairline echo beside the big vein sells the stone.
      if (!brassVein) {
        g.strokeStyle = 'rgba(214,218,230,0.08)';
        g.lineWidth = 0.5;
        g.stroke();
      }
    }
    return wrap(c, repeat);
  });
}

/** The lounge runner: a deco fan-and-line carpet in oxblood and brass. */
export function runnerTexture(repeat: [number, number] = [1, 3]): CanvasTexture {
  return cached(`runner${repeat}`, () => {
    const [c, g] = canvas(256);
    g.fillStyle = '#2c1216';
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(201,168,106,0.5)';
    g.lineWidth = 3;
    // Border rails.
    for (const x of [10, 22, 234, 246]) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, 256);
      g.stroke();
    }
    // Repeating sunburst fans up the middle.
    //
    // The fans are SPACED BY THE TILE, not by hand. Hand-placed at 42/128/214
    // the third one reached y = 278 on a 256 tile: the carpet lost the top of
    // every third fan to the seam, and since the motif was sliced rather than
    // wrapped the missing part never came back on the next tile. Give each
    // fan an equal slot and sit it in the middle of its own, and the run is
    // both evenly spaced AND whole across the join — the same pattern, minus
    // the haircut.
    const FANS = 3;
    const slot = 256 / FANS;
    // Ray length, and the apex offset the motif is centred on. The rays
    // spread ±60° off vertical (below), so the fan's half-height is
    // 44·cos(30°) = 38.1 — comfortably inside the 42.7 each slot allows.
    const REACH = 44;
    const APEX = 26;
    for (let k = 0; k < FANS; k++) {
      const cy = k * slot + slot / 2 - APEX;
      for (let i = 0; i < 7; i++) {
        const a = -Math.PI / 2 + ((i - 3) * Math.PI) / 9;
        g.beginPath();
        g.moveTo(128, cy + APEX);
        g.lineTo(128 + Math.sin(a) * REACH, cy + APEX - Math.cos(a) * REACH);
        g.stroke();
      }
      g.beginPath();
      g.arc(128, cy + APEX, 8, 0, Math.PI * 2);
      g.stroke();
    }
    // Wear: soft dark tread down the centre.
    const wear = g.createLinearGradient(64, 0, 192, 0);
    wear.addColorStop(0, 'rgba(0,0,0,0)');
    wear.addColorStop(0.5, 'rgba(0,0,0,0.25)');
    wear.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = wear;
    g.fillRect(0, 0, 256, 256);
    return wrap(c, repeat);
  });
}

/** Waxed oak planking for the bar front + stage skirt (straight lay). */
export function oakTexture(repeat: [number, number] = [3, 1]): CanvasTexture {
  return cached(`oak${repeat}`, () => {
    const [c, g] = canvas(256);
    const r = rng(0x0a45);
    g.fillStyle = css(DECOR.oak);
    g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 32) {
      g.fillStyle = `rgba(${20 + r() * 26}, ${12 + r() * 16}, ${6 + r() * 8}, 0.28)`;
      g.fillRect(0, y, 256, 32);
      g.strokeStyle = 'rgba(0,0,0,0.45)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(0, y + 0.5);
      g.lineTo(256, y + 0.5);
      g.stroke();
      for (let s = 0; s < 4; s++) {
        g.strokeStyle = 'rgba(0,0,0,0.14)';
        g.lineWidth = 1;
        const gy = y + 5 + r() * 24;
        g.beginPath();
        g.moveTo(0, gy);
        g.bezierCurveTo(80, gy + (r() - 0.5) * 5, 176, gy + (r() - 0.5) * 5, 256, gy);
        g.stroke();
      }
    }
    return wrap(c, repeat);
  });
}

/* ── material shorthands ────────────────────────────────────────────────── */

export const brassMat = (rough = 0.28): MeshStandardMaterial =>
  new MeshStandardMaterial({ color: DECOR.brass, metalness: 0.95, roughness: rough });

export const bronzeMat = (): MeshStandardMaterial =>
  new MeshStandardMaterial({ color: DECOR.bronze, metalness: 0.85, roughness: 0.5 });

export const blackSteelMat = (): MeshStandardMaterial =>
  new MeshStandardMaterial({ color: 0x1b1c21, metalness: 0.8, roughness: 0.55 });

/** A brass piece with its own warm glow — cove strips, ring underglow. */
export const brassGlowMat = (intensity: number): MeshStandardMaterial =>
  new MeshStandardMaterial({
    color: DECOR.brass,
    emissive: DECOR.cove,
    emissiveIntensity: intensity,
    metalness: 0.6,
    roughness: 0.35,
  });
