/**
 * PlayerSystem — reads the tracked body, keeps the dodge state fresh, pays
 * you for dancing, and puts GLOWSTICKS in your hands.
 *
 * My platform IS the world origin (the ring is built around me), so the
 * head's world position is already platform-local — no transforms.
 *
 * Calibration: standing height snaps UP instantly (you can't fake tall) and
 * decays DOWN very slowly, so a whole set spent crouching never quietly
 * lowers the bar the sweeps are judged against.
 *
 * THE GROOVE: dance like the groupies — one hand up, one hand down, and
 * SWAP on the beat. Each rhythmic swap pays a few points, and the payout
 * creeps upward the longer the motion stays consistent (the streak). Swap
 * off-rhythm or stop, and the streak lets go. It never outweighs dodging;
 * it's the trickle that makes standing still the wrong idea.
 *
 * THE STICKS: every dancer on the ring carries glowsticks — now so do you,
 * riding your controllers in your seat's colour. They burn brighter as your
 * groove streak climbs, and every REWARDED swap answers quietly from the
 * hand that went up: the stick pulses and a small "+N" drifts off it. No
 * panels, no fanfare — the stick itself tells you the dancing is paying.
 */

import { createSystem, Vector3 } from '@iwsdk/core';
import {
  CanvasTexture,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Sprite,
  SpriteMaterial,
  type Object3D,
} from 'three';
import { CHOREO, GROOVE, hueToColor, seatHue } from '../config.js';
import * as sfx from '../audio/sfx.js';
import { glowSprite } from '../materials/glow.js';
import { match, me, pushFlair } from '../game/state.js';

const _head = new Vector3();
const _hand = new Vector3();

interface Stick {
  group: Group;
  mat: MeshBasicMaterial;
  halo: Sprite;
  pulse: number;
  attachedTo: Object3D | null;
}

interface Floater {
  sprite: Sprite;
  tex: CanvasTexture;
  canvas: HTMLCanvasElement;
  age: number;
}

const FLOATERS = 4;

export class PlayerSystem extends createSystem({}) {
  /** Which hand is currently "up": 1 = left, −1 = right, 0 = undecided. */
  private grooveSide = 0;
  /** Last physical flip (streak-hold detection). */
  private lastFlipBeat = -Infinity;
  /** Last PAID flip — the pay-rate cap gate. */
  private lastRewardBeat = -Infinity;
  private streak = 0;

  private sticks!: Record<'left' | 'right', Stick>;
  private floaters: Floater[] = [];
  private floaterCursor = 0;
  private stickHue = -1;

  init(): void {
    this.sticks = { left: this.buildStick(), right: this.buildStick() };
    for (let i = 0; i < FLOATERS; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = 160;
      canvas.height = 80;
      const tex = new CanvasTexture(canvas);
      const sprite = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      sprite.scale.set(0.16, 0.08, 1);
      sprite.renderOrder = 31;
      sprite.visible = false;
      this.scene.add(sprite);
      this.floaters.push({ sprite, tex, canvas, age: 9 });
    }
  }

  private buildStick(): Stick {
    const group = new Group();
    const mat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
    const stick = new Mesh(new CylinderGeometry(0.013, 0.013, 0.3, 8), mat);
    stick.position.y = 0.02;
    group.add(stick);
    const halo = glowSprite(0xffffff, 0.34, 0.55);
    halo.position.y = 0.08;
    group.add(halo);
    // Held like a stick: up and slightly forward off the grip.
    group.rotation.x = -0.55;
    group.position.set(0, 0.01, -0.02);
    return { group, mat, halo, pulse: 0, attachedTo: null };
  }

  update(delta: number): void {
    const headObj = this.playerHeadEntity?.object3D;
    if (headObj) {
      headObj.getWorldPosition(_head);
      match.headX = _head.x;
      match.headY = _head.y;
      match.headZ = _head.z;

      // Standing height: fast attack, glacial release.
      if (_head.y > match.standingHeight) {
        match.standingHeight = _head.y;
      } else {
        match.standingHeight = Math.max(1.1, match.standingHeight - delta * 0.015);
      }
      match.ducked = _head.y < match.standingHeight * CHOREO.duckFrac;
    }

    this.updateSticks(delta);
    this.updateFloaters(delta);
    this.groove();
  }

  /* ── the sticks ───────────────────────────────────────────────────────── */

  private updateSticks(delta: number): void {
    // Your seat's colour (it can change per match online).
    const hue = seatHue(match.mySeat);
    if (hue !== this.stickHue) {
      this.stickHue = hue;
      const color = hueToColor(hue, 0.6);
      for (const hand of ['left', 'right'] as const) {
        this.sticks[hand].mat.color.setHex(color);
        (this.sticks[hand].halo.material as SpriteMaterial).color.setHex(color);
      }
    }

    for (const hand of ['left', 'right'] as const) {
      const s = this.sticks[hand];
      const obj = this.world.playerSpaceEntities?.raySpaces?.[hand]?.object3D ?? null;
      if (obj !== s.attachedTo) {
        s.group.removeFromParent();
        s.attachedTo = obj;
        if (obj) obj.add(s.group);
      }
      // Brighter the deeper the groove; the pulse pops it on a rewarded swap.
      s.pulse = Math.max(0, s.pulse - delta * 4);
      const grooveGlow = Math.min(this.streak, 50) / 50;
      s.mat.opacity = 0.7 + grooveGlow * 0.3;
      (s.halo.material as SpriteMaterial).opacity = 0.4 + grooveGlow * 0.3 + s.pulse * 0.5;
      const scale = 1 + s.pulse * 0.5;
      s.group.scale.set(scale, 1 + s.pulse * 0.25, scale);
    }
  }

  /* ── the +N floaters ──────────────────────────────────────────────────── */

  private popFloater(text: string, at: Vector3): void {
    const f = this.floaters[this.floaterCursor];
    this.floaterCursor = (this.floaterCursor + 1) % FLOATERS;
    const g = f.canvas.getContext('2d')!;
    g.clearRect(0, 0, 160, 80);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = "900 46px 'Arial Black', system-ui, sans-serif";
    g.lineJoin = 'round';
    g.lineWidth = 11;
    g.strokeStyle = 'rgba(0,2,6,0.96)';
    g.strokeText(text, 80, 40);
    g.fillStyle = '#4fb7ff';
    g.fillText(text, 80, 40);
    f.tex.needsUpdate = true;
    f.sprite.position.copy(at);
    f.sprite.visible = true;
    f.age = 0;
  }

  private updateFloaters(delta: number): void {
    for (const f of this.floaters) {
      if (!f.sprite.visible) continue;
      f.age += delta;
      f.sprite.position.y += delta * 0.35;
      const fade = 1 - Math.max(0, f.age - 0.25) / 0.5;
      (f.sprite.material as SpriteMaterial).opacity = Math.max(0, fade);
      if (f.age > 0.75) f.sprite.visible = false;
    }
  }

  /* ── the groove ───────────────────────────────────────────────────────── */

  private handY(hand: 'left' | 'right'): number | null {
    const obj = this.world.playerSpaceEntities?.raySpaces?.[hand]?.object3D;
    if (!obj) return null;
    obj.getWorldPosition(_hand);
    return _hand.y;
  }

  private groove(): void {
    const d = me();
    const live = match.playing && (match.screen === 'raid' || match.screen === 'tutorial') && d?.alive;
    if (!live) {
      this.grooveSide = 0;
      this.streak = 0;
      match.grooveStreak = 0;
      return;
    }

    const ly = this.handY('left');
    const ry = this.handY('right');
    if (ly === null || ry === null) return;

    // One up, one down — with hysteresis so a wobble at the crossover
    // doesn't machine-gun fake swaps.
    const diff = ly - ry;
    const side = diff > GROOVE.split ? 1 : diff < -GROOVE.split ? -1 : 0;
    if (side === 0 || side === this.grooveSide) {
      // Held too long without a swap → the groove lets go.
      if (this.streak > 0 && match.beat - this.lastFlipBeat > GROOVE.maxBeats) {
        this.streak = 0;
        match.grooveStreak = 0;
      }
      return;
    }

    // A physical flip. Every flip keeps the hold-timer alive, but PAY is
    // rate-capped to the music: at most one rewarded swap per ~beat since
    // the last PAID one. Spamming faster than the BPM is silently absorbed —
    // no reward, no reset — so light-speed flailing earns exactly what
    // dancing on the beat earns, and no more.
    const first = this.grooveSide === 0;
    this.grooveSide = side;
    this.lastFlipBeat = match.beat;
    if (first) {
      this.lastRewardBeat = match.beat; // the opening pose sets the metronome
      return;
    }

    const paidGap = match.beat - this.lastRewardBeat;
    if (paidGap < GROOVE.minBeats) return; // faster than the music — absorbed

    this.lastRewardBeat = match.beat;
    this.streak = Math.min(GROOVE.streakCap, this.streak + 1);
    const award = Math.round(GROOVE.base + this.streak * GROOVE.perStreak);
    d.score += award;
    match.grooveStreak = this.streak;

    // The quiet answer from the hand that went up: the stick pops and a
    // small +N drifts off it.
    const hand = side === 1 ? 'left' : 'right';
    const stick = this.sticks[hand];
    stick.pulse = 1;
    if (stick.attachedTo) {
      stick.group.getWorldPosition(_hand);
      _hand.y += 0.12;
      this.popFloater(`+${award}`, _hand);
    }

    if (this.streak === 8 || this.streak === 32 || this.streak === GROOVE.streakCap) {
      pushFlair(this.streak === GROOVE.streakCap ? 'MAX GROOVE!!' : 'IN THE GROOVE!', 'milestone');
      sfx.uiClick();
    }
  }
}
