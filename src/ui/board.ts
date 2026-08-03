/**
 * The holo leaderboard — a smoked-glass panel floating over the stage that
 * every dancer can read: live rank, name, score, combo. Canvas-drawn, redrawn
 * only when the standings actually change, billboarded by RankSystem.
 */

import {
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from 'three';
import { glowSprite } from '../materials/glow.js';

const W = 768;
const H = 1024;

export interface BoardRow {
  rank: number;
  name: string;
  score: number;
  combo: number;
  alive: boolean;
  isMe: boolean;
  colorCss: string;
}

export class HoloBoard {
  readonly group = new Group();
  private canvas = document.createElement('canvas');
  private tex: CanvasTexture;
  private mesh: Mesh;

  constructor() {
    this.canvas.width = W;
    this.canvas.height = H;
    this.tex = new CanvasTexture(this.canvas);
    this.mesh = new Mesh(
      new PlaneGeometry(1.9, 2.53),
      new MeshBasicMaterial({ map: this.tex, transparent: true, side: DoubleSide, depthWrite: false }),
    );
    this.mesh.renderOrder = 25; // above the gel, below the near menus
    this.group.add(this.mesh);
    const halo = glowSprite(0xff2ad5, 3.4, 0.16);
    halo.position.z = -0.05;
    this.group.add(halo);
  }

  redraw(title: string, subtitle: string, rows: BoardRow[], accentCss: string): void {
    const g = this.canvas.getContext('2d')!;
    g.clearRect(0, 0, W, H);

    // Smoked glass with a neon frame.
    g.fillStyle = 'rgba(6,4,12,0.72)';
    g.beginPath();
    g.roundRect(8, 8, W - 16, H - 16, 26);
    g.fill();
    g.lineWidth = 5;
    g.strokeStyle = accentCss;
    g.shadowColor = accentCss;
    g.shadowBlur = 22;
    g.stroke();
    g.shadowBlur = 0;

    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = "900 64px 'Arial Black', system-ui, sans-serif";
    g.fillStyle = accentCss;
    g.shadowColor = accentCss;
    g.shadowBlur = 18;
    g.fillText(title, W / 2, 78);
    g.shadowBlur = 0;
    if (subtitle) {
      g.font = "700 30px 'Arial Black', system-ui, sans-serif";
      g.fillStyle = 'rgba(232,236,242,0.75)';
      g.fillText(subtitle, W / 2, 132);
    }

    const top = 180;
    const rowH = Math.min(66, (H - top - 30) / Math.max(rows.length, 1));
    rows.forEach((row, i) => {
      const y = top + i * rowH + rowH / 2;
      if (row.isMe) {
        g.fillStyle = 'rgba(255,42,213,0.16)';
        g.beginPath();
        g.roundRect(22, y - rowH / 2 + 3, W - 44, rowH - 6, 12);
        g.fill();
      }
      g.textAlign = 'left';
      g.font = "900 36px 'Arial Black', system-ui, sans-serif";
      g.fillStyle = row.rank === 1 ? '#ffd75e' : row.rank <= 10 ? '#b9ffc4' : 'rgba(232,236,242,0.85)';
      if (!row.alive) g.fillStyle = 'rgba(150,150,160,0.55)';
      g.fillText(`${row.rank}`, 40, y);
      g.fillStyle = row.alive ? row.colorCss : 'rgba(150,150,160,0.55)';
      g.fillText(row.name.slice(0, 14), 118, y);
      g.textAlign = 'right';
      g.fillStyle = row.alive ? 'rgba(244,246,251,0.95)' : 'rgba(150,150,160,0.55)';
      g.fillText(`${row.score}`, W - 150, y);
      g.font = "700 28px 'Arial Black', system-ui, sans-serif";
      g.fillStyle = row.combo > 0 ? '#ffb000' : 'rgba(120,124,138,0.6)';
      g.fillText(row.alive ? `×${row.combo}` : 'OUT', W - 40, y);
    });

    this.tex.needsUpdate = true;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).map?.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
  }
}
