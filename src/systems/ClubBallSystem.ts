/**
 * ClubBallSystem — the raid-summoning ball, live on the floor.
 *
 * Watches net.ball: when somebody sends one up, the mirror ball appears at
 * their spot, spins, bobs, and wears its countdown plate (seconds, song,
 * caller, who's touched in — one orbiting pip per dancer in their colour).
 * Reach a hand within touching distance and the plate's edge warms; pull
 * the trigger (or squeeze) and you're ON — again, and you're out. The
 * caller's touch calls it off. The relay owns the clock: when it fires,
 * 'start' whisks the touchers to the ring and 'ball-off' clears the floor.
 *
 * Touch is deliberately PHYSICAL (walk up, reach out) — calling a raid is
 * a social act, and the walk to the ball is the RSVP.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import { Group, Vector3 } from 'three';
import * as sfx from '../audio/sfx.js';
import { BALL_TOUCH_RADIUS, buildBallVisual, type BallVisual } from '../club/ball.js';
import { seatHue } from '../config.js';
import { match } from '../game/state.js';
import { cancelBall, joinBall, memberHue, net } from '../net/session.js';

const _hand = new Vector3();
const _cam = new Vector3();

/** The raise's clock (s) — the spring below runs its bounces inside this. */
const RISE_SECONDS = 0.9;
/** The lower's clock (s) — gravity is brisker than a winch. */
const DROP_SECONDS = 0.55;
/** Where the raise starts: knee height, so the ball is visibly SENT UP. */
const RISE_FROM_Y = 0.32;
/** Under-damped spring 0 → 1: shoots past the top, dips back, settles —
 *  two visible bounces inside the raise window. */
const springUp = (p: number): number => 1 - Math.exp(-4.6 * p) * Math.cos(9.0 * p);

export class ClubBallSystem extends createSystem({}) {
  private holder = new Group();
  private visual: BallVisual | null = null;
  private clock = 0;
  private wasReach = false;
  private lastPaintKey = '';
  /** The ball's life on the floor: bounced up → hanging → lowered away. */
  private anim: 'rise' | 'hang' | 'drop' = 'rise';
  private animT = 0;
  /** Height the lower started from (the bob leaves y mid-wave). */
  private dropFrom = 0;

  init(): void {
    this.holder.name = 'raid-ball-holder';
    this.scene.add(this.holder);
  }

  update(delta: number): void {
    const inClub =
      (match.screen === 'lobby' || match.screen === 'tour') &&
      (net.phase === 'hosting' || net.phase === 'joined');
    const ballUp = inClub && net.ball !== null;

    // A resolving ball (called off, or fired without me) LOWERS away
    // instead of blinking out — but only while I'm still on the floor to
    // watch it go. Being whisked to the ring, or walking out, clears it
    // the old instant way.
    if (!ballUp && this.visual && inClub && this.anim !== 'drop') {
      this.anim = 'drop';
      this.animT = 0;
      this.dropFrom = this.visual.group.position.y;
      sfx.throwWhoosh();
    }
    const dropping = !ballUp && this.visual !== null && inClub && this.anim === 'drop';
    this.holder.visible = ballUp || dropping;

    if (!ballUp && !dropping) {
      if (this.visual) {
        this.visual.dispose();
        this.visual = null;
        this.lastPaintKey = '';
      }
      return;
    }
    const state = net.ball;

    // A fresh ball over a still-lowering husk (called off and re-called in
    // one breath): the old visual finishes nothing — the new one takes over.
    if (this.visual && ballUp && this.anim === 'drop') {
      this.visual.dispose();
      this.visual = null;
      this.lastPaintKey = '';
    }
    if (!this.visual) {
      this.visual = buildBallVisual();
      this.holder.add(this.visual.group);
      this.anim = 'rise';
      this.animT = 0;
      if (state) this.visual.group.position.set(state.pos[0], RISE_FROM_Y, state.pos[2]);
      // SENT UP, audibly: the recall's magnetic pull is the ball leaving
      // the caller's hands.
      sfx.recall();
    }
    const v = this.visual;

    // Life: slow spin, the glimmer, and the phase's own motion.
    this.clock += delta;
    this.animT += delta;
    v.ball.rotation.y += delta * 0.9;
    v.twinkle(delta);

    if (this.anim === 'rise' && state) {
      // THE BOUNCY RAISE: a springy launch from the floor to its hang
      // height, overshooting and settling, swelling from a pip as it goes.
      const p = Math.min(1, this.animT / RISE_SECONDS);
      const k = springUp(p);
      v.group.position.set(state.pos[0], RISE_FROM_Y + (state.pos[1] - RISE_FROM_Y) * k, state.pos[2]);
      v.group.scale.setScalar(Math.max(0.05, 0.3 + 0.7 * k));
      if (p >= 1) {
        this.anim = 'hang';
        v.group.scale.setScalar(1);
      }
    } else if (this.anim === 'drop') {
      // THE LOWER: gravity takes it — an accelerating sink to the boards,
      // shrinking away, whirling faster the further it falls.
      const p = Math.min(1, this.animT / DROP_SECONDS);
      v.group.position.y = this.dropFrom - (this.dropFrom - 0.1) * p * p;
      v.group.scale.setScalar(Math.max(0.02, 1 - p * p * 0.9));
      v.ball.rotation.y += delta * p * 9;
      if (p >= 1) {
        v.dispose();
        this.visual = null;
        this.lastPaintKey = '';
        return;
      }
    } else if (state) {
      // Hanging: the gentle bob.
      v.group.position.set(state.pos[0], state.pos[1] + Math.sin(this.clock * 1.3) * 0.03, state.pos[2]);
    }

    // The plate faces whoever looks, wherever the ball is on its way.
    this.camera.getWorldPosition(_cam);
    v.plate.rotation.y = Math.atan2(_cam.x - v.group.position.x, _cam.z - v.group.position.z);
    if (!state) return; // lowering away — nothing left to touch or read

    // Touch: either hand close to the ball's heart.
    let inReach = false;
    for (const hand of ['left', 'right'] as const) {
      const obj = this.world.playerSpaceEntities?.gripSpaces?.[hand]?.object3D ?? this.world.playerSpaceEntities?.raySpaces?.[hand]?.object3D;
      if (!obj) continue;
      obj.getWorldPosition(_hand);
      if (_hand.distanceTo(v.group.position) > BALL_TOUCH_RADIUS) continue;
      inReach = true;
      const gp = this.input.xr.gamepads[hand];
      if (gp?.getButtonDown(InputComponent.Trigger) || gp?.getButtonDown(InputComponent.Squeeze)) {
        this.touch();
        this.buzz(hand);
      }
    }
    if (inReach && !this.wasReach) sfx.uiHover();
    this.wasReach = inReach;
    const scale = inReach ? 1.1 : 1;
    v.ball.scale.set(scale, scale, scale);

    // The plate: repaint when the second, the joins, or my state changes.
    const seconds = Math.ceil(Math.max(0, state.firesAt - performance.now()) / 1000);
    const mine = state.callerIdx === net.myIdx;
    const joined = state.joins.has(net.myIdx);
    const joinIdxs = [...state.joins].sort((a, b) => a - b);
    const key = `${seconds}|${joinIdxs.join(',')}|${mine}|${joined}|${inReach}`;
    if (key !== this.lastPaintKey) {
      this.lastPaintKey = key;
      const nameOf = (idx: number): string => net.members.find((m) => m.idx === idx)?.name ?? `#${idx}`;
      v.paint({
        seconds,
        trackId: state.track,
        callerName: state.callerName || nameOf(state.callerIdx),
        joinNames: joinIdxs.map(nameOf),
        mine,
        joined,
        inReach,
      });
      // Pips wear each dancer's own colour, same as their figure across the
      // floor — a slot's neon only stands in for someone who never picked.
      v.setPips(joinIdxs.map((idx) => {
        const m = net.members.find((mm) => mm.idx === idx);
        return m ? memberHue(m) : seatHue(idx);
      }));
    }
  }

  /** My hand met the ball: join, leave, or (caller) wave it away. */
  private touch(): void {
    const state = net.ball;
    if (!state) return;
    sfx.uiClick();
    if (state.callerIdx === net.myIdx) {
      cancelBall();
      return;
    }
    joinBall(!state.joins.has(net.myIdx));
  }

  /** A short haptic tick — the ball answers the hand that touched it. */
  private buzz(hand: 'left' | 'right'): void {
    const session = (this.world as { session?: XRSession | null }).session;
    if (!session?.inputSources) return;
    for (const src of session.inputSources) {
      if (src.handedness !== hand) continue;
      const actuator = (
        src.gamepad as { hapticActuators?: readonly { pulse?: (i: number, ms: number) => void }[] } | undefined
      )?.hapticActuators?.[0];
      try {
        actuator?.pulse?.(0.4, 50);
      } catch {
        /* garnish */
      }
    }
  }
}
