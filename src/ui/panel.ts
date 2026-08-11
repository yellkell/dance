/**
 * Canvas panel kit — smoked-glass menu boards with neon buttons, raycast by
 * the controller lasers. One canvas per panel, redrawn on state change; a
 * hit-test maps a ray intersection's UV back to the button under it.
 */

import {
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from 'three';

export interface PanelButton {
  id: string;
  label: string;
  sub?: string;
  accent?: string;
  disabled?: boolean;
  /** Canvas-space rect. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Smaller type for dense rows. */
  small?: boolean;
  /** Hit-testable but NOT drawn — the body paints its own visual (map
   *  nodes, custom widgets); label/sub are ignored. */
  ghost?: boolean;
}

export const UI = {
  glass: 'rgba(7,5,14,0.78)',
  edge: 'rgba(255,42,213,0.85)',
  magenta: '#ff2ad5',
  cyan: '#4fb7ff',
  green: '#b9ffc4',
  goop: '#36e05a',
  amber: '#ffb000',
  violet: '#b06bff',
  danger: '#ff5040',
  text: '#f4f6fb',
  dim: 'rgba(232,236,242,0.6)',
};

export class Panel {
  readonly group = new Group();
  readonly mesh: Mesh;
  private canvas = document.createElement('canvas');
  private tex: CanvasTexture;
  private buttons: PanelButton[] = [];
  private pxW: number;
  private pxH: number;

  constructor(widthM: number, heightM: number, pxW = 1024, pxH = 1024) {
    this.pxW = pxW;
    this.pxH = pxH;
    this.canvas.width = pxW;
    this.canvas.height = pxH;
    this.tex = new CanvasTexture(this.canvas);
    this.mesh = new Mesh(
      new PlaneGeometry(widthM, heightM),
      new MeshBasicMaterial({ map: this.tex, transparent: true, side: DoubleSide, depthWrite: false }),
    );
    // Menus must win the draw fight against the (transparent, depth-less)
    // gel creature behind them.
    this.mesh.renderOrder = 30;
    this.group.add(this.mesh);
  }

  ctx(): CanvasRenderingContext2D {
    return this.canvas.getContext('2d')!;
  }

  /** Repaint: frame + title, then the caller's body, then the button set. */
  paint(title: string, body: (g: CanvasRenderingContext2D) => void, buttons: PanelButton[], hover: string | null): void {
    this.buttons = buttons;
    const g = this.ctx();
    g.clearRect(0, 0, this.pxW, this.pxH);

    g.fillStyle = UI.glass;
    g.beginPath();
    g.roundRect(6, 6, this.pxW - 12, this.pxH - 12, 30);
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = UI.edge;
    g.shadowColor = UI.magenta;
    g.shadowBlur = 26;
    g.stroke();
    g.shadowBlur = 0;

    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = "900 68px 'Arial Black', system-ui, sans-serif";
    g.fillStyle = UI.magenta;
    g.shadowColor = UI.magenta;
    g.shadowBlur = 20;
    g.fillText(title, this.pxW / 2, 84);
    g.shadowBlur = 0;

    body(g);

    for (const b of buttons) {
      if (b.ghost) continue; // the body drew it; we only hit-test it
      const accent = b.disabled ? 'rgba(120,124,138,0.5)' : (b.accent ?? UI.magenta);
      const isHover = hover === b.id && !b.disabled;
      g.fillStyle = isHover ? 'rgba(255,42,213,0.22)' : 'rgba(20,16,30,0.85)';
      g.beginPath();
      g.roundRect(b.x, b.y, b.w, b.h, 18);
      g.fill();
      g.lineWidth = isHover ? 5 : 3;
      g.strokeStyle = accent;
      if (isHover) {
        g.shadowColor = accent;
        g.shadowBlur = 18;
      }
      g.stroke();
      g.shadowBlur = 0;
      // OWN the text state. The body callback is free to leave any
      // alignment behind (headings go left, statuses go right) — drawing
      // centre-anchored labels under an inherited 'right' shifts every
      // label half its width off its plate, which is exactly the "text
      // escaping the panels" bug on every tab whose body didn't happen to
      // end centre-aligned.
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = b.disabled ? 'rgba(150,154,168,0.5)' : UI.text;
      g.font = `900 ${b.small ? 30 : 42}px 'Arial Black', system-ui, sans-serif`;
      g.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 - (b.sub ? 14 : 0), b.w - 24);
      if (b.sub) {
        g.font = "700 22px 'Arial Black', system-ui, sans-serif";
        g.fillStyle = b.disabled ? 'rgba(150,154,168,0.4)' : UI.dim;
        g.fillText(b.sub, b.x + b.w / 2, b.y + b.h / 2 + 26, b.w - 24);
      }
    }

    this.tex.needsUpdate = true;
  }

  /** UV (from a raycast hit) → button id, or null. */
  buttonAt(u: number, v: number): string | null {
    const x = u * this.pxW;
    const y = (1 - v) * this.pxH;
    for (const b of this.buttons) {
      if (b.disabled) continue;
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.id;
    }
    return null;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).map?.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
  }
}
