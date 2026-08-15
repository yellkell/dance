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
 * riding your controllers in your seat's colour, each one cased in a thick
 * near-black outline so it never dissolves into the deck wearing that same
 * colour. They burn brighter as the combo climbs, and every REWARDED swap
 * answers from the hand that went up:
 * the stick pulses, the palm ticks, and a burst of SPARKS jumps off the tip
 * — a few faint motes when the groove is young, a hotter, denser fountain
 * as it deepens. No numbers, no panels: the sticks themselves are the
 * combo meter.
 */

import { createSystem, Vector3 } from '@iwsdk/core';
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
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
import { CHOREO, GROOVE, hueToColor } from '../config.js';
import { glintTexture, glowSprite } from '../materials/glow.js';
import { danceHue } from '../game/profile.js';
import { match, me } from '../game/state.js';
import { net } from '../net/session.js';

const _head = new Vector3();
const _hand = new Vector3();
const _c = new Color();
const _white = new Color(0xffffff);

/** Dev window into the groove: `__gdr.sparkle(heat)` plays a whole rewarded
 *  swap off the right stick — flash, shake and sparks — so the answer can be
 *  tuned without dancing for it. */
export const grooveView: {
  burst?: (heat?: number) => void;
  /** Getting HIT breaks the hand rhythm — the judge calls this to cut the
   *  groove streak (and its tally) dead. */
  disrupt?: () => void;
} = {};

interface Stick {
  group: Group;
  mat: MeshBasicMaterial;
  halo: Sprite;
  pulse: number;
  attachedTo: Object3D | null;
}

/** Stick dimensions, and how thick its black casing runs. */
const STICK_R = 0.013;
const STICK_LEN = 0.3;
const STICK_CASE = 0.007;
/** Held like a stick: up and slightly forward off the grip. The shake
 *  wobbles around this, so it has to be a named rest pose rather than a
 *  number set once at build time. */
const STICK_TILT = -0.55;

/** One near-black casing material for both hands — never lit, never tinted. */
let _casingMat: MeshBasicMaterial | null = null;
function casingMat(): MeshBasicMaterial {
  if (!_casingMat) _casingMat = new MeshBasicMaterial({ color: 0x02010a, side: BackSide });
  return _casingMat;
}

/**
 * The groove's voice: NEON SPARKLES — lens glints, not dots and never
 * squares. One additive Points cloud, world-space, recycled, wearing the
 * shared glint texture (hot core, crossing streaks), with a TWIN cloud
 * mirrored under the deck plane: the polished slab you dance on gets the
 * reflection the void's floor already has, so every burst lands twice.
 * Sparks fade by darkening (additive black = gone) and DIE IN THE AIR —
 * a glint that settles on the floor is litter, and litter is retro.
 */
const MAX_SPARKS = 192;
/** Below this height a spark twinkles out rather than landing. */
const SPARK_FLOOR = 0.12;

class SparkPool {
  readonly points: Points;
  // Primary sparks in [0, MAX); their mirror twins in [MAX, 2·MAX).
  private pos = new Float32Array(MAX_SPARKS * 6);
  private col = new Float32Array(MAX_SPARKS * 6);
  private vel = new Float32Array(MAX_SPARKS * 3);
  private base = new Float32Array(MAX_SPARKS * 3);
  private age = new Float32Array(MAX_SPARKS);
  private life = new Float32Array(MAX_SPARKS);
  private twinkle = new Float32Array(MAX_SPARKS);
  private cursor = 0;
  private posAttr: BufferAttribute;
  private colAttr: BufferAttribute;

  constructor() {
    const geo = new BufferGeometry();
    this.pos.fill(0);
    for (let i = 0; i < MAX_SPARKS * 2; i++) this.pos[i * 3 + 1] = -999; // parked
    this.posAttr = new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage);
    this.colAttr = new BufferAttribute(this.col, 3).setUsage(DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    this.points = new Points(
      geo,
      new PointsMaterial({
        size: 0.085,
        map: glintTexture(),
        vertexColors: true,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 29;
  }

  /** `heat` 0..1 — deeper groove throws more, faster, whiter sparkles. */
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
      // each sparkle jittered so the burst shimmers instead of banding.
      _c.setHex(colorHex).lerp(_white, Math.min(1, heat * 0.55 + Math.random() * 0.3));
      this.base[i3] = _c.r;
      this.base[i3 + 1] = _c.g;
      this.base[i3 + 2] = _c.b;
      this.age[i] = 0;
      this.life[i] = 0.35 + Math.random() * 0.35 + heat * 0.2;
      // Each glint scintillates at its own rate — the difference between
      // "particles" and "sparkles" is that sparkles TWINKLE.
      this.twinkle[i] = 7 + Math.random() * 9;
    }
  }

  update(delta: number): void {
    const M3 = MAX_SPARKS * 3;
    for (let i = 0; i < MAX_SPARKS; i++) {
      if (this.life[i] <= 0) continue;
      const i3 = i * 3;
      this.age[i] += delta;
      const k = this.age[i] / this.life[i];
      const grounded = this.pos[i3 + 1] <= SPARK_FLOOR;
      if (k >= 1 || grounded) {
        this.life[i] = 0;
        this.pos[i3 + 1] = -999;
        this.pos[i3 + 1 + M3] = -999;
        this.col[i3] = this.col[i3 + 1] = this.col[i3 + 2] = 0;
        this.col[i3 + M3] = this.col[i3 + 1 + M3] = this.col[i3 + 2 + M3] = 0;
        continue;
      }
      this.vel[i3 + 1] -= 2.4 * delta; // light gravity — a fountain, not confetti
      const drag = Math.max(0, 1 - 1.4 * delta);
      this.vel[i3] *= drag;
      this.vel[i3 + 2] *= drag;
      this.pos[i3] += this.vel[i3] * delta;
      this.pos[i3 + 1] += this.vel[i3 + 1] * delta;
      this.pos[i3 + 2] += this.vel[i3 + 2] * delta;
      const flicker = 0.72 + 0.28 * Math.sin(this.age[i] * this.twinkle[i] + i * 1.7);
      const fade = (1 - k) * (1 - k) * flicker;
      this.col[i3] = this.base[i3] * fade;
      this.col[i3 + 1] = this.base[i3 + 1] * fade;
      this.col[i3 + 2] = this.base[i3 + 2] * fade;
      // The twin in the polish: same glint, upside down, dimmed the way
      // the void mirrors its own towers.
      this.pos[i3 + M3] = this.pos[i3];
      this.pos[i3 + 1 + M3] = -this.pos[i3 + 1];
      this.pos[i3 + 2 + M3] = this.pos[i3 + 2];
      this.col[i3 + M3] = this.col[i3] * 0.38;
      this.col[i3 + 1 + M3] = this.col[i3 + 1] * 0.38;
      this.col[i3 + 2 + M3] = this.col[i3 + 2] * 0.38;
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
  /** Your seat colour, held so the flash has something to fall back to. */
  private stickColor = new Color(0xffffff);
  /** Free-running seconds — the shake's oscillator. */
  private clock = 0;

  init(): void {
    this.sticks = { left: this.buildStick(), right: this.buildStick() };
    this.scene.add(this.sparks.points);
    grooveView.burst = (heat = 1) => {
      const s = this.sticks.right;
      s.pulse = 1; // the whole reward answer, not just the sparks
      if (s.attachedTo) s.halo.getWorldPosition(_hand);
      else _hand.set(0.25, 1.35, -0.4);
      this.sparks.burst(_hand, Math.min(1, Math.max(0, heat)), hueToColor(danceHue(match.mySeat, true), 0.6));
    };
    grooveView.disrupt = () => {
      // A hit knocks the rhythm out of your hands: streak, tally and the
      // metronome pose all reset — the groove restarts from the first swap.
      this.streak = 0;
      this.grooveSide = 0;
      match.grooveStreak = 0;
      match.grooveScore = 0;
    };
  }

  private buildStick(): Stick {
    const group = new Group();

    // THE CASING. Your sticks and your deck wear the same seat colour —
    // hueToColor(seatHue, 0.6), the identical value — so a bare neon rod
    // held over your own rim vanishes into it. The fix is the fix the HUD
    // already uses for text: a thick near-black outline, so the colour
    // reads as a lit object ON the deck instead of a patch OF it.
    //
    // It's an inverted hull: a slightly fatter cylinder drawn BACK faces
    // only, so its far wall sits behind the core and rings it in black
    // from every angle, with no second render pass.
    const casing = new Mesh(
      new CylinderGeometry(STICK_R + STICK_CASE, STICK_R + STICK_CASE, STICK_LEN + STICK_CASE * 2, 8),
      casingMat(),
    );
    casing.position.y = 0.02;
    group.add(casing);

    const mat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
    const stick = new Mesh(new CylinderGeometry(STICK_R, STICK_R, STICK_LEN, 8), mat);
    stick.position.y = 0.02;
    group.add(stick);
    // A hot white filament down the middle of the neon — the same reason
    // the casing is there. Colour says WHOSE; brightness says it's a light.
    const core = new Mesh(
      new CylinderGeometry(STICK_R * 0.5, STICK_R * 0.5, STICK_LEN * 0.97, 6),
      new MeshBasicMaterial({ color: 0xfffaff }),
    );
    core.position.y = 0.02;
    group.add(core);

    group.name = 'live-glowstick';
    const halo = glowSprite(0xffffff, 0.34, 0.55);
    halo.position.y = 0.08;
    group.add(halo);
    group.rotation.x = STICK_TILT;
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
    // Your colour: the one you picked, else your seat's (it can change per
    // match online).
    this.clock += delta;
    const hue = danceHue(match.mySeat, true);
    if (hue !== this.stickHue) {
      this.stickHue = hue;
      this.stickColor.setHex(hueToColor(hue, 0.6));
    }

    // The sticks are RING kit. On the club floor your hands are hands —
    // drinks to hold, panels to poke, an arcade to shoot — so the
    // glowsticks stay in the bag until a set takes you back to the ring.
    const clubFloor =
      (match.screen === 'lobby' || match.screen === 'tour') &&
      (net.phase === 'hosting' || net.phase === 'joined');

    // ONCE THE RECORD DROPS, THE PLASTIC GOES. Through a set you are a
    // dancer holding two glowsticks, not somebody wearing two controllers:
    // the moulded grips are hidden for the whole song and handed back at
    // the podium. Only the controller MODEL goes — tracked hands are your
    // actual hands and stay, and the pointer's own ray and cursor still
    // draw, so the pause card is as pokeable as ever.
    this.showControllers(!(match.screen === 'countdown' || match.screen === 'raid'));

    for (const hand of ['left', 'right'] as const) {
      const s = this.sticks[hand];
      const obj = this.world.playerSpaceEntities?.raySpaces?.[hand]?.object3D ?? null;
      if (obj !== s.attachedTo) {
        s.group.removeFromParent();
        s.attachedTo = obj;
        if (obj) obj.add(s.group);
      }
      s.group.visible = !clubFloor;
      // Brighter the deeper the groove; the pulse pops it on a rewarded swap.
      const grooveGlow = Math.min(this.streak, 50) / 50;
      s.mat.opacity = 0.7 + grooveGlow * 0.3;
      (s.halo.material as SpriteMaterial).opacity = 0.4 + grooveGlow * 0.3 + s.pulse * 0.5;
      const scale = 1 + s.pulse * 0.5;
      s.group.scale.set(scale, 1 + s.pulse * 0.25, scale);

      // THE KICK. A rewarded swap already threw sparks and ticked the palm;
      // now the STICK answers too, so the reward reads in the thing you're
      // actually looking at. Two parts, both riding the same pulse:
      //
      //  FLASH — the neon runs hot toward white and falls back to your
      //    seat colour, the way a tube does when it's struck.
      //  SHAKE — a short rattle about the grip, squared off the pulse so it
      //    bites on the beat and is gone before the next one. This is the
      //    seen half of the haptic tick: the buzz you feel, on the object.
      //
      // Deliberately small: the sticks are read in peripheral vision all
      // set long, and a stick that whips about is a stick you stop trusting
      // to tell you where your hands are.
      const flash = s.pulse * s.pulse;
      s.mat.color.copy(this.stickColor).lerp(_white, flash * 0.55);
      (s.halo.material as SpriteMaterial).color.copy(this.stickColor).lerp(_white, flash * 0.4);
      s.group.rotation.x = STICK_TILT + Math.sin(this.clock * 47) * 0.075 * flash;
      s.group.rotation.z = Math.sin(this.clock * 61 + 1.7) * 0.095 * flash;

      // Decay LAST, and never by more than a frame's worth. Draining the
      // pulse before drawing with it meant the frame a swap landed on
      // rendered the stick already half-way home — and a single long frame
      // (a hitch, a headset waking up) drank the whole kick before it was
      // ever seen. Set on one frame, shown on that frame.
      s.pulse = Math.max(0, s.pulse - Math.min(delta, 0.05) * 4);
    }
  }

  /**
   * Show or hide the moulded controller models.
   *
   * Written every frame rather than on the edge: the visual is rebuilt
   * whenever a controller reconnects (or wakes from sleep), and it comes
   * back visible, so a one-shot hide would quietly undo itself mid-song.
   * Writing `visible` straight onto the model — instead of the adapter's
   * own `toggle`, which latches on an internal flag — means a reconnect
   * can't leave the two disagreeing.
   */
  private showControllers(show: boolean): void {
    const pads = this.input?.xr?.visualAdapters?.controller;
    if (!pads) return;
    for (const hand of ['left', 'right'] as const) {
      const model = pads[hand]?.visual?.model;
      if (model && model.visible !== show) model.visible = show;
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
    const live = match.playing && match.screen === 'raid' && d?.alive;
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
