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
import { match } from '../game/state.js';
import { cancelBall, joinBall, net } from '../net/session.js';

const _hand = new Vector3();
const _cam = new Vector3();

export class ClubBallSystem extends createSystem({}) {
  private holder = new Group();
  private visual: BallVisual | null = null;
  private clock = 0;
  private wasReach = false;
  private lastPaintKey = '';

  init(): void {
    this.holder.name = 'raid-ball-holder';
    this.scene.add(this.holder);
  }

  update(delta: number): void {
    const inClub =
      (match.screen === 'lobby' || match.screen === 'map' || match.screen === 'tour') &&
      (net.phase === 'hosting' || net.phase === 'joined');
    const ballUp = inClub && net.ball !== null;
    this.holder.visible = ballUp;

    if (!ballUp) {
      if (this.visual) {
        this.visual.dispose();
        this.visual = null;
        this.lastPaintKey = '';
      }
      return;
    }
    const state = net.ball!;

    if (!this.visual) {
      this.visual = buildBallVisual();
      this.holder.add(this.visual.group);
      sfx.uiHover();
    }
    const v = this.visual;
    v.group.position.set(state.pos[0], state.pos[1], state.pos[2]);

    // Life: slow spin, a gentle bob, the plate facing whoever looks.
    this.clock += delta;
    v.ball.rotation.y += delta * 0.9;
    v.group.position.y = state.pos[1] + Math.sin(this.clock * 1.3) * 0.03;
    this.camera.getWorldPosition(_cam);
    v.plate.rotation.y = Math.atan2(_cam.x - state.pos[0], _cam.z - state.pos[2]);

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
      v.setPips(joinIdxs);
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
