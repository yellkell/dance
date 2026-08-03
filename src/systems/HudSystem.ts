/**
 * HudSystem — your own numbers, floating just past your platform's front
 * rim: score, combo multiplier, lives, the count-in, and the flair pops
 * (PERFECT! / 20 COMBO / HIT). In a rehearsal it doubles as the goopling's
 * lesson card. Canvas-drawn, redrawn only when something changes.
 */

import { createSystem } from '@iwsdk/core';
import {
  CanvasTexture,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Sprite,
  SpriteMaterial,
} from 'three';
import { SCORE } from '../config.js';
import { match, me } from '../game/state.js';

const W = 768;
const H = 384;

export class HudSystem extends createSystem({}) {
  private canvas = document.createElement('canvas');
  private tex!: CanvasTexture;
  private panel!: Mesh;
  private flair!: Sprite;
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
    this.flair = new Sprite(new SpriteMaterial({ map: this.flairTex, transparent: true, depthWrite: false }));
    this.flair.renderOrder = 31;
    this.flair.position.set(0, 1.75, -1.3);
    this.flair.scale.set(1.3, 0.4, 1);
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
    this.flair.scale.set(1.3 * (0.6 + 0.4 * k), 0.4 * (0.6 + 0.4 * k), 1);
    (this.flair.material as SpriteMaterial).opacity = fade;

    if (!inSet) return;

    const d = me();
    const beat = match.beat;
    const countdown = match.screen === 'countdown' && Number.isFinite(beat) && beat < 0;
    const count = countdown ? Math.ceil(-beat) : 0;
    const mult = d ? 1 + SCORE.comboStep * Math.min(d.combo, SCORE.comboCap) : 1;
    const key = [
      match.screen,
      count,
      d?.score,
      d?.combo,
      d?.lives,
      d?.alive,
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
    g.fillStyle = 'rgba(6,4,12,0.62)';
    g.beginPath();
    g.roundRect(4, 4, W - 8, H - 8, 22);
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(255,42,213,0.8)';
    g.shadowColor = '#ff2ad5';
    g.shadowBlur = 16;
    g.stroke();
    g.shadowBlur = 0;
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    const d = me();

    if (match.goopling) {
      // Lesson card.
      const gp = match.goopling;
      g.fillStyle = '#b9ffc4';
      g.font = "900 54px 'Arial Black', system-ui, sans-serif";
      g.shadowColor = '#36e05a';
      g.shadowBlur = 14;
      g.fillText(gp.name, W / 2, 58);
      g.shadowBlur = 0;
      g.fillStyle = 'rgba(232,236,242,0.7)';
      g.font = "700 26px 'Arial Black', system-ui, sans-serif";
      g.fillText(gp.epithet, W / 2, 104);
      g.fillStyle = '#f4f6fb';
      g.font = "700 30px 'Arial Black', system-ui, sans-serif";
      gp.lesson.split('\n').forEach((line, i) => {
        g.fillText(line, W / 2, 168 + i * 44);
      });
      g.fillStyle = '#ffb000';
      g.font = "900 44px 'Arial Black', system-ui, sans-serif";
      g.fillText(`${match.tutorialClears} / ${gp.clears}`, W / 2, H - 62);
      this.tex.needsUpdate = true;
      return;
    }

    if (count > 0) {
      g.fillStyle = '#ffd9f6';
      g.font = "900 40px 'Arial Black', system-ui, sans-serif";
      g.fillText('THE SET DROPS IN', W / 2, 92);
      g.fillStyle = '#ff2ad5';
      g.shadowColor = '#ff2ad5';
      g.shadowBlur = 24;
      g.font = "900 170px 'Arial Black', system-ui, sans-serif";
      g.fillText(`${count}`, W / 2, H / 2 + 42);
      g.shadowBlur = 0;
      this.tex.needsUpdate = true;
      return;
    }

    // Live readout.
    g.fillStyle = '#f4f6fb';
    g.font = "900 84px 'Arial Black', system-ui, sans-serif";
    g.fillText(`${d?.score ?? 0}`, W / 2, 96);

    g.fillStyle = d && d.combo > 0 ? '#ffb000' : 'rgba(150,154,168,0.7)';
    g.font = "900 54px 'Arial Black', system-ui, sans-serif";
    g.fillText(d && d.combo > 0 ? `${d.combo} COMBO  ×${mult.toFixed(1)}` : 'NO COMBO', W / 2, 194);

    // Lives as goo drops.
    const lives = d?.lives ?? 0;
    g.font = "900 64px 'Arial Black', system-ui, sans-serif";
    let hearts = '';
    for (let i = 0; i < SCORE.lives; i++) hearts += i < lives ? '🟢' : '⚫';
    g.fillText(d?.alive === false ? 'SPECTATING' : hearts, W / 2, 300);
    if (d?.alive === false) {
      g.fillStyle = 'rgba(232,236,242,0.6)';
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
    g.font = "900 72px 'Arial Black', system-ui, sans-serif";
    g.shadowColor = color;
    g.shadowBlur = 26;
    g.fillStyle = color;
    g.fillText(text, 256, 80, 490);
    g.shadowBlur = 0;
    this.flairTex.needsUpdate = true;
  }
}
