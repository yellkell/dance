/**
 * The two pictures the course paints for itself. No image assets ship
 * (research/02 §5) — both are drawn onto a canvas at build time, and neither
 * uses RNG, so the circuit looks the same every night.
 *
 * The soft glow the invitation circle wears is the venue's own
 * (materials/glow.ts): a course inside the club should light its floor with
 * the club's light.
 */

import {
  CanvasTexture,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from 'three';
import { PALETTE } from '../config.js';
import { font } from '../ui/fonts.js';

/**
 * THE PLAY-AREA PATTERN, exactly as Eye of the Temple draws it: a thick
 * border along the play-area edge and a thick circle at the centre
 * (research/03 §3). Platforms show the crop of the square they claim, so the
 * ghost overlay makes level-design correctness a picture you look at.
 */
export function patternTexture(): CanvasTexture {
  const size = 768;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, size, size);
  const stroke = size * 0.035;
  g.strokeStyle = 'rgba(255,255,255,0.92)';
  g.lineWidth = stroke;
  g.strokeRect(stroke * 0.75, stroke * 0.75, size - stroke * 1.5, size - stroke * 1.5);
  g.beginPath();
  g.arc(size / 2, size / 2, size * 0.13, 0, Math.PI * 2);
  g.stroke();
  // Faint seams marking the nine squares, so a single-square crop still reads.
  g.lineWidth = size * 0.006;
  g.strokeStyle = 'rgba(255,255,255,0.28)';
  for (let i = 1; i < 3; i++) {
    g.beginPath();
    g.moveTo((size / 3) * i, 0);
    g.lineTo((size / 3) * i, size);
    g.stroke();
    g.beginPath();
    g.moveTo(0, (size / 3) * i);
    g.lineTo(size, (size / 3) * i);
    g.stroke();
  }
  const tex = new CanvasTexture(c);
  tex.minFilter = LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  return tex;
}

export interface PanelSpec {
  title?: string;
  lines: string[];
  small?: string;
  width: number; // metres
  color?: string;
  accent?: number;
}

/** Just the picture, for a card that changes what it says. */
export function panelTexture(spec: PanelSpec): { tex: CanvasTexture; aspect: number } {
  const W = 1024;
  const pad = 64;
  const titleSize = 104;
  const lineSize = 52;
  const smallSize = 34;
  const lineGap = 26;
  let h = pad * 2;
  if (spec.title) h += titleSize + 40;
  h += spec.lines.length * (lineSize + lineGap);
  if (spec.small) h += smallSize + 30;

  const accent = spec.accent ?? PALETTE.magenta;
  const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;

  const c = document.createElement('canvas');
  c.width = W;
  c.height = h;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, W, h);
  g.fillStyle = 'rgba(10,3,14,0.72)';
  g.fillRect(0, 0, W, h);
  g.strokeStyle = 'rgba(255,42,213,0.5)';
  g.lineWidth = 6;
  g.strokeRect(3, 3, W - 6, h - 6);

  const color = spec.color ?? '#e8c6ff';
  let y = pad;
  g.textAlign = 'center';
  if (spec.title) {
    g.fillStyle = css(accent);
    g.shadowColor = css(accent);
    g.shadowBlur = 22;
    g.font = font(700, titleSize);
    g.letterSpacing = '10px';
    // Bounded like the body lines: a title long enough to overrun would
    // otherwise paint straight off the edge of the panel.
    g.fillText(spec.title, W / 2, y + titleSize * 0.82, W - pad * 2);
    g.letterSpacing = '0px';
    g.shadowBlur = 0;
    y += titleSize + 40;
  }
  g.fillStyle = color;
  g.font = font(500, lineSize);
  for (const line of spec.lines) {
    g.fillText(line, W / 2, y + lineSize * 0.8, W - pad * 2);
    y += lineSize + lineGap;
  }
  if (spec.small) {
    g.fillStyle = 'rgba(232,198,255,0.6)';
    g.font = font(500, smallSize);
    g.fillText(spec.small, W / 2, y + smallSize * 0.9, W - pad * 2);
  }

  const tex = new CanvasTexture(c);
  tex.anisotropy = 4;
  return { tex, aspect: h / W };
}

/**
 * A text panel, planted ~3 m out (research/02 §6) in the house typeface and
 * the house magenta. Four lines is the whole manual: embodied movement
 * doesn't have to be learned (research/03 §5).
 *
 * SINGLE-SIDED, deliberately. A card is written to be read from one place —
 * these face the home pad — and a double-sided one hands anybody standing
 * behind it a page of mirror writing, which from the skywalk is the biggest
 * thing in the view straight down. Better to be nothing from the back.
 */
export function textPanel(spec: PanelSpec): Mesh {
  const { tex, aspect } = panelTexture(spec);
  return new Mesh(
    new PlaneGeometry(spec.width, spec.width * aspect),
    new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
}
