/**
 * HudSystem — your numbers, OUT of your sightline. A small readout floats
 * low off the FRONT-LEFT rim of your deck, angled up at you like a monitor
 * wedge at a gig: the score, the ×multiplier (only while a chain is alive),
 * and three lives. Nothing else — no labels, no words, no meter for the
 * groove (the glowsticks in your hands are that meter). The centre of your
 * view belongs to the giant and the blocks.
 *
 * The count-in and the goopling's lesson still take the centre — they're
 * cards you READ while nothing is trying to kill you — and the flair pops
 * (PERFECT! / HIT) ride high off to the right, where they can shout
 * without standing between you and the next landing.
 *
 * NO PANELS. Menus get panels, gameplay gets ink: every glyph wears a
 * thick near-black casing so it reads against the void, the lasers, and
 * the gel creature all at once.
 */

import { createSystem, Vector3 } from '@iwsdk/core';
import {
  CanvasTexture,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from 'three';
import { SCORE, TOUR, hueToColor, seatHue } from '../config.js';
import { trackById } from '../audio/tracks.js';
import { match, me } from '../game/state.js';

const SET_COLORS = ['#8cff70', '#ff6ee0', '#ffd24a'];

/** The centre card (count-in / lesson). */
const CW = 768;
const CH = 384;
/** The wedge strip (live readout). */
const SW = 512;
const SH = 256;

const _head = new Vector3();

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
  /** The centre card: count-in, "cueing", the goopling's lesson. */
  private cardCanvas = document.createElement('canvas');
  private cardTex!: CanvasTexture;
  private card!: Mesh;
  /** The monitor wedge: score / ×mult / lives, low off the front-left rim. */
  private stripCanvas = document.createElement('canvas');
  private stripTex!: CanvasTexture;
  private strip!: Mesh;
  /** A plane, not a Sprite — flair text must never roll with the head. */
  private flair!: Mesh;
  private flairMat!: MeshBasicMaterial;
  private flairCanvas = document.createElement('canvas');
  private flairTex!: CanvasTexture;
  private flairAge = 9;
  private lastKey = '';

  init(): void {
    this.cardCanvas.width = CW;
    this.cardCanvas.height = CH;
    this.cardTex = new CanvasTexture(this.cardCanvas);
    this.card = new Mesh(
      new PlaneGeometry(0.9, 0.45),
      new MeshBasicMaterial({ map: this.cardTex, transparent: true, side: DoubleSide, depthWrite: false }),
    );
    this.card.renderOrder = 30;
    this.card.position.set(0, 0.62, -1.06);
    this.card.rotation.x = -0.5;
    this.scene.add(this.card);

    this.stripCanvas.width = SW;
    this.stripCanvas.height = SH;
    this.stripTex = new CanvasTexture(this.stripCanvas);
    this.strip = new Mesh(
      new PlaneGeometry(0.44, 0.22),
      new MeshBasicMaterial({ map: this.stripTex, transparent: true, side: DoubleSide, depthWrite: false }),
    );
    this.strip.renderOrder = 30;
    this.strip.position.set(-0.55, 0.34, -0.78);
    this.scene.add(this.strip);

    this.flairCanvas.width = 512;
    this.flairCanvas.height = 160;
    this.flairTex = new CanvasTexture(this.flairCanvas);
    this.flairMat = new MeshBasicMaterial({
      map: this.flairTex,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    this.flair = new Mesh(new PlaneGeometry(1.1, 0.34), this.flairMat);
    this.flair.renderOrder = 31;
    this.flair.position.set(0.62, 1.5, -1.25); // high right — off the action line
    this.scene.add(this.flair);
  }

  update(delta: number): void {
    const inSet = match.screen === 'countdown' || match.screen === 'raid' || match.screen === 'tutorial';
    _head.set(match.headX, match.headY, match.headZ);

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
    if (this.flair.visible) this.flair.lookAt(_head);
    const pop = 0.6 + 0.4 * k;
    this.flair.scale.set(pop, pop, 1);
    this.flairMat.opacity = fade;

    // The lesson and the count-in take the centre; the live game gets the
    // wedge. (The goopling card owns the whole tutorial.)
    const cardUp = inSet && (match.goopling !== null || match.screen === 'countdown');
    this.card.visible = cardUp;
    this.strip.visible = inSet && !cardUp;
    if (this.strip.visible) this.strip.lookAt(_head);

    if (!inSet) return;

    const d = me();
    const beat = match.beat;
    const countdown = match.screen === 'countdown' && Number.isFinite(beat) && beat < 0;
    const count = countdown ? Math.ceil(-beat) : 0;
    const key = [
      match.screen,
      count,
      Number.isFinite(match.beat), // the "cueing the record" card
      match.trackId,
      match.mySeat,
      d?.score,
      d?.combo,
      d?.lives,
      d?.alive,
      match.tutorialClears,
      match.goopling?.id,
    ].join(':');
    if (key !== this.lastKey) {
      this.lastKey = key;
      if (cardUp) this.drawCard(count);
      else this.drawStrip();
    }
  }

  /* ── the centre card: things you READ while nothing hunts you ─────────── */

  private drawCard(count: number): void {
    const g = this.cardCanvas.getContext('2d')!;
    g.clearRect(0, 0, CW, CH);
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    if (match.goopling) {
      const gp = match.goopling;
      ink(g, gp.name, CW / 2, 52, 54, '#b9ffc4');
      ink(g, gp.epithet, CW / 2, 102, 24, 'rgba(232,236,242,0.85)');
      gp.lesson.split('\n').forEach((line, i) => {
        ink(g, line, CW / 2, 168 + i * 46, 30, '#f4f6fb', CW - 60);
      });
      ink(g, `${match.tutorialClears} / ${gp.clears}`, CW / 2, CH - 58, 46, '#ffb000');
      this.cardTex.needsUpdate = true;
      return;
    }

    if (!Number.isFinite(match.beat)) {
      // The record is still decoding — the clock stays parked until it's
      // ready, so nothing can land early.
      ink(g, 'CUEING THE RECORD…', CW / 2, CH / 2, 46, '#ffd9f6', CW - 60);
      this.cardTex.needsUpdate = true;
      return;
    }

    const cued = trackById(match.trackId);
    ink(g, 'THE SET DROPS IN', CW / 2, 64, 40, '#ffd9f6');
    // Tour nights announce themselves on the card.
    if (match.tour) {
      const set = TOUR.sets[match.tour.set];
      ink(
        g,
        `${set?.name ?? 'THE TOUR'} — NIGHT ${match.tour.song + 1}`,
        CW / 2,
        112,
        26,
        SET_COLORS[match.tour.set % SET_COLORS.length],
      );
    }
    ink(g, `${Math.max(1, count)}`, CW / 2, CH / 2 + 22, 144, '#ff2ad5');
    if (cued) ink(g, `♪ ${cued.title}`, CW / 2, CH - 44, 38, '#b9ffc4');
    this.cardTex.needsUpdate = true;
  }

  /* ── the wedge: score, ×mult, lives — glanceable, wordless ────────────── */

  private drawStrip(): void {
    const g = this.stripCanvas.getContext('2d')!;
    g.clearRect(0, 0, SW, SH);
    g.textBaseline = 'middle';

    const d = me();
    const seatCss = `#${hueToColor(seatHue(match.mySeat), 0.62).toString(16).padStart(6, '0')}`;

    // Score — big, white, left-anchored.
    g.textAlign = 'left';
    ink(g, `${d?.score ?? 0}`, 34, 84, 96, '#ffffff');

    // The chain multiplier, in YOUR colour — only while a chain is alive.
    // No label: ×3.4 says everything the old shouting line said.
    if (d && d.alive && d.combo > 0) {
      const mult = 1 + SCORE.comboStep * Math.min(d.combo, SCORE.comboCap);
      ink(g, `×${mult.toFixed(1)}`, 36, 164, 58, seatCss);
    }

    if (d?.alive === false) {
      ink(g, 'SPECTATING', 34, 222, 34, 'rgba(232,236,242,0.8)');
    } else {
      // Lives as goo drops.
      const lives = d?.lives ?? 0;
      const r = 16;
      const gapX = 52;
      for (let i = 0; i < SCORE.lives; i++) {
        g.beginPath();
        g.arc(52 + i * gapX, 224, r, 0, Math.PI * 2);
        g.lineWidth = 7;
        g.strokeStyle = 'rgba(0,2,6,0.96)';
        g.stroke();
        g.fillStyle = i < lives ? '#36e05a' : 'rgba(70,78,92,0.85)';
        g.fill();
      }
    }

    this.stripTex.needsUpdate = true;
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
