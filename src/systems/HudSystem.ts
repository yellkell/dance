/**
 * HudSystem — your own numbers, floating free just past your platform's
 * front rim: score, combo multiplier, groove streak, lives, the count-in,
 * and the flair pops (PERFECT! / 20 COMBO / HIT).
 *
 * NO PANELS. No smoked glass, no frames — menus get panels, gameplay gets
 * ink: every glyph wears a thick black outline so it reads against a bright
 * real room, a dark real room, and the gel creature behind it all at once.
 * In a rehearsal the same free-floating text carries the goopling's lesson.
 */

import { createSystem } from '@iwsdk/core';
import {
  CanvasTexture,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from 'three';
import { SCORE, TOUR } from '../config.js';
import { trackById } from '../audio/tracks.js';
import { match, me } from '../game/state.js';

const SET_COLORS = ['#8cff70', '#ff6ee0', '#ffd24a'];

const W = 768;
const H = 384;

/** Heavy club lettering: a thick near-black casing, then the colour. */
function ink(
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  px: number,
  fill: string,
  maxWidth?: number,
): void {
  g.font = `900 ${px}px 'Arial Black', system-ui, sans-serif`;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.lineWidth = Math.max(6, px * 0.22);
  g.strokeStyle = 'rgba(0,2,6,0.96)';
  if (maxWidth) g.strokeText(text, x, y, maxWidth);
  else g.strokeText(text, x, y);
  g.fillStyle = fill;
  if (maxWidth) g.fillText(text, x, y, maxWidth);
  else g.fillText(text, x, y);
}

export class HudSystem extends createSystem({}) {
  private canvas = document.createElement('canvas');
  private tex!: CanvasTexture;
  private panel!: Mesh;
  /** A plane, not a Sprite — flair text must never roll with the head. */
  private flair!: Mesh;
  private flairMat!: MeshBasicMaterial;
  private flairCanvas = document.createElement('canvas');
  private flairTex!: CanvasTexture;
  private flairAge = 9;
  private lastKey = '';

  init(): void {
    this.canvas.width = W;
    this.canvas.height = H;
    this.tex = new CanvasTexture(this.canvas);
    this.panel = new Mesh(
      new PlaneGeometry(0.9, 0.45),
      new MeshBasicMaterial({ map: this.tex, transparent: true, side: DoubleSide, depthWrite: false }),
    );
    this.panel.renderOrder = 30; // over the gel, always
    this.panel.position.set(0, 0.62, -1.06);
    this.panel.rotation.x = -0.5;
    this.scene.add(this.panel);

    this.flairCanvas.width = 512;
    this.flairCanvas.height = 160;
    this.flairTex = new CanvasTexture(this.flairCanvas);
    this.flairMat = new MeshBasicMaterial({
      map: this.flairTex,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    this.flair = new Mesh(new PlaneGeometry(1.3, 0.4), this.flairMat);
    this.flair.renderOrder = 31;
    this.flair.position.set(0, 1.75, -1.3); // dead ahead, facing the player
    this.scene.add(this.flair);
  }

  update(delta: number): void {
    const inSet = match.screen === 'countdown' || match.screen === 'raid' || match.screen === 'tutorial';
    this.panel.visible = inSet;

    // Flair pops.
    const next = match.flairs.shift();
    if (next) {
      this.drawFlair(next.text, next.tone);
      this.flairAge = 0;
    }
    this.flairAge += delta;
    const k = Math.min(1, this.flairAge / 0.18);
    const fade = Math.max(0, 1 - Math.max(0, this.flairAge - 0.9) / 0.5);
    this.flair.visible = inSet && fade > 0;
    const pop = 0.6 + 0.4 * k;
    this.flair.scale.set(pop, pop, 1);
    this.flairMat.opacity = fade;

    if (!inSet) return;

    const d = me();
    const beat = match.beat;
    const countdown = match.screen === 'countdown' && Number.isFinite(beat) && beat < 0;
    const count = countdown ? Math.ceil(-beat) : 0;
    const mult = d ? 1 + SCORE.comboStep * Math.min(d.combo, SCORE.comboCap) : 1;
    const key = [
      match.screen,
      count,
      Number.isFinite(match.beat), // the "cueing the record" card
      match.trackId,
      d?.score,
      d?.combo,
      d?.lives,
      d?.alive,
      match.grooveStreak,
      match.tutorialClears,
      match.goopling?.id,
    ].join(':');
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.draw(count, mult);
    }
  }

  private draw(count: number, mult: number): void {
    const g = this.canvas.getContext('2d')!;
    g.clearRect(0, 0, W, H);
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    const d = me();

    if (match.goopling) {
      // The lesson, free-floating.
      const gp = match.goopling;
      ink(g, gp.name, W / 2, 52, 54, '#b9ffc4');
      ink(g, gp.epithet, W / 2, 102, 24, 'rgba(232,236,242,0.85)');
      gp.lesson.split('\n').forEach((line, i) => {
        ink(g, line, W / 2, 168 + i * 46, 30, '#f4f6fb', W - 60);
      });
      ink(g, `${match.tutorialClears} / ${gp.clears}`, W / 2, H - 58, 46, '#ffb000');
      this.tex.needsUpdate = true;
      return;
    }

    if (match.screen === 'countdown' && !Number.isFinite(match.beat)) {
      // The record is still decoding — the clock stays parked until it's
      // ready, so nothing can land early.
      ink(g, 'CUEING THE RECORD…', W / 2, H / 2, 46, '#ffd9f6', W - 60);
      this.tex.needsUpdate = true;
      return;
    }

    if (count > 0) {
      const cued = trackById(match.trackId);
      ink(g, 'THE SET DROPS IN', W / 2, 64, 40, '#ffd9f6');
      // Tour nights announce themselves on the card.
      if (match.tour) {
        const set = TOUR.sets[match.tour.set];
        ink(
          g,
          `${set?.name ?? 'THE TOUR'} — NIGHT ${match.tour.song + 1}`,
          W / 2,
          112,
          26,
          SET_COLORS[match.tour.set % SET_COLORS.length],
        );
      }
      ink(g, `${count}`, W / 2, H / 2 + 22, 144, '#ff2ad5');
      if (cued) ink(g, `♪ ${cued.title}`, W / 2, H - 44, 38, '#b9ffc4');
      this.tex.needsUpdate = true;
      return;
    }

    // Live readout — big ink, no furniture.
    ink(g, `${d?.score ?? 0}`, W / 2, 88, 104, '#ffffff');
    ink(
      g,
      d && d.combo > 0 ? `${d.combo} COMBO  ×${mult.toFixed(1)}` : 'NO COMBO',
      W / 2,
      196,
      50,
      d && d.combo > 0 ? '#ffb000' : 'rgba(168,172,186,0.9)',
    );
    if (match.grooveStreak >= 4) {
      ink(g, `GROOVE ×${match.grooveStreak}`, W / 2, 258, 32, '#4fb7ff');
    } else if (match.grooveStreak > 0) {
      // The wind-up: rogue-style combo pips. Each rhythmic swap lights one;
      // at four the row gives way to the ×meter above. Same ink discipline —
      // heavy casing so they read on any room.
      const pips = 4;
      const gap = 54;
      const x0 = W / 2 - gap * ((pips - 1) / 2);
      for (let i = 0; i < pips; i++) {
        g.beginPath();
        g.arc(x0 + i * gap, 258, 12, 0, Math.PI * 2);
        g.lineWidth = 8;
        g.strokeStyle = 'rgba(0,2,6,0.96)';
        g.stroke();
        if (i < match.grooveStreak) {
          g.shadowColor = '#4fb7ff';
          g.shadowBlur = 16;
          g.fillStyle = '#4fb7ff';
        } else {
          g.fillStyle = 'rgba(50,58,72,0.9)';
        }
        g.fill();
        g.shadowBlur = 0;
      }
    }

    // Lives as goo drops — drawn, so they get outlines too.
    if (d?.alive === false) {
      ink(g, 'SPECTATING', W / 2, 322, 44, 'rgba(232,236,242,0.85)');
    } else {
      const lives = d?.lives ?? 0;
      const r = 22;
      const gapX = 76;
      const cx0 = W / 2 - gapX * ((SCORE.lives - 1) / 2);
      for (let i = 0; i < SCORE.lives; i++) {
        g.beginPath();
        g.arc(cx0 + i * gapX, 322, r, 0, Math.PI * 2);
        g.lineWidth = 9;
        g.strokeStyle = 'rgba(0,2,6,0.96)';
        g.stroke();
        g.fillStyle = i < lives ? '#36e05a' : 'rgba(60,66,78,0.9)';
        g.fill();
      }
    }

    this.tex.needsUpdate = true;
  }

  private drawFlair(text: string, tone: 'dodge' | 'perfect' | 'hit' | 'milestone' | 'info'): void {
    const g = this.flairCanvas.getContext('2d')!;
    g.clearRect(0, 0, 512, 160);
    const color =
      tone === 'perfect' ? '#ffd75e' : tone === 'hit' ? '#ff5040' : tone === 'milestone' ? '#ff2ad5' : '#b9ffc4';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = color;
    g.shadowBlur = 26;
    ink(g, text, 256, 80, 72, color, 490);
    g.shadowBlur = 0;
    this.flairTex.needsUpdate = true;
  }
}
