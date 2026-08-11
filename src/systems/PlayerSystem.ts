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
 * THE GROOVE (the COMBO on screen): dance like the groupies — one hand up,
 * one hand down, and SWAP on the beat. Each rhythmic swap pays a few
 * points, and the payout creeps upward the longer the motion stays
 * consistent (the streak). Swap off-rhythm or stop, and it lets go. It
 * never outweighs dodging; it's the trickle that makes standing still the
 * wrong idea. (The dodge chain is a separate thing — that one multiplies.)
 *
 * THE STICKS: every dancer on the ring carries glowsticks — now so do you,
 * riding your controllers in your seat's colour. They burn brighter as the
 * combo climbs, and every REWARDED swap answers from the hand that went up:
 * the stick pulses, the palm ticks, and a burst of SPARKS jumps off the tip
 * — a few faint motes when the groove is young, a hotter, denser fountain
 * as it deepens. No numbers, no panels: the sticks themselves are the
 * combo meter.
 */

import { createSystem, Vector3 } from '@iwsdk/core';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Sprite,
  SpriteMaterial,
  type Object3D,
} from 'three';
import { CHOREO, GROOVE, hueToColor, seatHue } from '../config.js';
import { glowSprite } from '../materials/glow.js';
import { match, me } from '../game/state.js';

const _head = new Vector3();
const _hand = new Vector3();
const _c = new Color();
const _white = new Color(0xffffff);

interface Stick {
  group: Group;
  mat: MeshBasicMaterial;
  halo: Sprite;
  pulse: number;
  attachedTo: Object3D | null;
}

/** A soft round dot for the spark points — drawn once, shared forever. */
function sparkDot(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

/**
 * The groove's voice: one additive Points cloud, world-space, recycled.
 * Sparks fly up and out of a stick tip, ride a little gravity, and fade by
 * darkening (additive black = gone) — so no per-particle opacity needed.
 */
const MAX_SPARKS = 192;

class SparkPool {
  readonly points: Points;
  private pos = new Float32Array(MAX_SPARKS * 3);
  private col = new Float32Array(MAX_SPARKS * 3);
  private vel = new Float32Array(MAX_SPARKS * 3);
  private base = new Float32Array(MAX_SPARKS * 3);
  private age = new Float32Array(MAX_SPARKS);
  private life = new Float32Array(MAX_SPARKS);
  private cursor = 0;
  private posAttr: BufferAttribute;
  private colAttr: BufferAttribute;

  constructor() {
    const geo = new BufferGeometry();
    this.pos.fill(0);
    for (let i = 0; i < MAX_SPARKS; i++) this.pos[i * 3 + 1] = -999; // parked
    this.posAttr = new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage);
    this.colAttr = new BufferAttribute(this.col, 3).setUsage(DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    this.points = new Points(
      geo,
      new PointsMaterial({
        size: 0.05,
        map: sparkDot(),
        vertexColors: true,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 29;
  }

  /** `heat` 0..1 — deeper groove throws more, faster, whiter sparks. */
  burst(at: Vector3, heat: number, colorHex: number): void {
    const count = Math.round(6 + heat * 22);
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_SPARKS;
      const i3 = i * 3;
      this.pos[i3] = at.x;
      this.pos[i3 + 1] = at.y;
      this.pos[i3 + 2] = at.z;
      // An upward cone with a lateral scatter that widens with heat.
      const a = Math.random() * Math.PI * 2;
      const r = (0.25 + Math.random() * 0.45) * (0.7 + heat * 0.8);
      this.vel[i3] = Math.cos(a) * r;
      this.vel[i3 + 1] = (0.7 + Math.random() * 0.9) * (0.8 + heat * 0.9);
      this.vel[i3 + 2] = Math.sin(a) * r;
      // Seat colour, run hotter (toward white) as the streak deepens —
      // each spark jittered so the burst shimmers instead of banding.
      _c.setHex(colorHex).lerp(_white, Math.min(1, heat * 0.55 + Math.random() * 0.3));
      this.base[i3] = _c.r;
      this.base[i3 + 1] = _c.g;
      this.base[i3 + 2] = _c.b;
      this.age[i] = 0;
      this.life[i] = 0.3 + Math.random() * 0.3 + heat * 0.2;
    }
  }

  update(delta: number): void {
    for (let i = 0; i < MAX_SPARKS; i++) {
      if (this.life[i] <= 0) continue;
      const i3 = i * 3;
      this.age[i] += delta;
      const k = this.age[i] / this.life[i];
      if (k >= 1) {
        this.life[i] = 0;
        this.pos[i3 + 1] = -999;
        this.col[i3] = this.col[i3 + 1] = this.col[i3 + 2] = 0;
        continue;
      }
      this.vel[i3 + 1] -= 2.4 * delta; // light gravity — a fountain, not confetti
      const drag = Math.max(0, 1 - 1.4 * delta);
      this.vel[i3] *= drag;
      this.vel[i3 + 2] *= drag;
      this.pos[i3] += this.vel[i3] * delta;
      this.pos[i3 + 1] += this.vel[i3 + 1] * delta;
      this.pos[i3 + 2] += this.vel[i3 + 2] * delta;
      const fade = (1 - k) * (1 - k);
      this.col[i3] = this.base[i3] * fade;
      this.col[i3 + 1] = this.base[i3 + 1] * fade;
      this.col[i3 + 2] = this.base[i3 + 2] * fade;
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }
}

export class PlayerSystem extends createSystem({}) {
  /** Which hand is currently "up": 1 = left, −1 = right, 0 = undecided. */
  private grooveSide = 0;
  /** Last physical flip (streak-hold detection). */
  private lastFlipBeat = -Infinity;
  /** Last PAID flip — the pay-rate cap gate. */
  private lastRewardBeat = -Infinity;
  private streak = 0;

  private sticks!: Record<'left' | 'right', Stick>;
  private sparks = new SparkPool();
  private stickHue = -1;

  init(): void {
    this.sticks = { left: this.buildStick(), right: this.buildStick() };
    this.scene.add(this.sparks.points);
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
    this.sparks.update(delta);
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
      match.grooveScore = 0;
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
      // Held too long without a swap → the groove lets go, tally and all.
      if (this.streak > 0 && match.beat - this.lastFlipBeat > GROOVE.maxBeats) {
        this.streak = 0;
        match.grooveStreak = 0;
        match.grooveScore = 0;
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
    // The counter runs to 999; the payout curve flattens at payCap.
    const award = Math.round(GROOVE.base + Math.min(this.streak, GROOVE.payCap) * GROOVE.perStreak);
    d.score += award;
    match.grooveStreak = this.streak;
    match.grooveScore += award;

    // The answer from the hand that went up: the stick pops, sparks jump
    // off its tip — more and hotter the deeper the streak — and the palm
    // gets a short TICK. Felt and seen, never read.
    const hand = side === 1 ? 'left' : 'right';
    const stick = this.sticks[hand];
    stick.pulse = 1;
    if (stick.attachedTo) {
      stick.halo.getWorldPosition(_hand);
      this.sparks.burst(_hand, Math.min(this.streak, 50) / 50, hueToColor(this.stickHue, 0.6));
    }
    this.buzz(hand, 0.28 + Math.min(this.streak, 50) * 0.004, 40);

    // No milestone pop-ups: the pips, the ×meter and the stick pulses ARE
    // the groove feedback — the flair channel stays clear for dodges, hits
    // and the fights that matter.
  }

  /** A short haptic tick on one controller. The IWSDK gamepad wrapper is a
   *  pure state tracker, so this talks to the raw WebXR input source; on
   *  hardware without an actuator it's a silent no-op. */
  private buzz(hand: 'left' | 'right', intensity: number, ms: number): void {
    const session = (this.world as { session?: XRSession | null }).session;
    if (!session?.inputSources) return;
    for (const src of session.inputSources) {
      if (src.handedness !== hand) continue;
      const actuator = (
        src.gamepad as { hapticActuators?: readonly { pulse?: (i: number, ms: number) => void }[] } | undefined
      )?.hapticActuators?.[0];
      try {
        actuator?.pulse?.(Math.min(1, intensity), ms);
      } catch {
        /* some browsers throw on unsupported pulse — fine, it's garnish */
      }
    }
  }
}
