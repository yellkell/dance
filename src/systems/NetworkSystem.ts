/**
 * NetworkSystem — the online pumps. While a networked set is live it streams
 * my pose (10 Hz, platform-local: head + hands + head yaw) and my score line
 * (3 Hz, or instantly on a life change) to the room; the session module
 * applies everything inbound. Ends the session when I'm back in the lobby.
 */

import { createSystem, Quaternion, Vector3 } from '@iwsdk/core';
import { NET } from '../config.js';
import { match, me } from '../game/state.js';
import { leaveRoom, net, sendPose, sendScore } from '../net/session.js';

const _v = new Vector3();
const _q = new Quaternion();
const _f = new Vector3();

export class NetworkSystem extends createSystem({}) {
  private poseT = 0;
  private scoreT = 0;
  private lastLives = -1;

  update(delta: number): void {
    // A finished (or abandoned) online set folds the session.
    if (net.phase === 'live' && match.screen === 'lobby') leaveRoom();
    if (net.phase !== 'live' || !match.playing) return;

    this.poseT -= delta;
    if (this.poseT <= 0) {
      this.poseT = 1 / NET.poseRateHz;
      this.pumpPose();
    }

    const d = me();
    if (!d) return;
    this.scoreT -= delta;
    const livesChanged = d.lives !== this.lastLives;
    if (this.scoreT <= 0 || livesChanged) {
      this.scoreT = 1 / NET.scoreRateHz;
      this.lastLives = d.lives;
      sendScore({ score: d.score, combo: d.combo, lives: d.lives, alive: d.alive, elim: d.elimAtBeat });
    }
  }

  private pumpPose(): void {
    const headObj = this.playerHeadEntity?.object3D;
    if (!headObj) return;
    headObj.getWorldQuaternion(_q);
    _f.set(0, 0, -1).applyQuaternion(_q);
    const yaw = Math.atan2(-_f.x, -_f.z);

    const d: number[] = [match.headX, match.headY, match.headZ, yaw];
    for (const hand of ['left', 'right'] as const) {
      const obj = this.world.playerSpaceEntities?.raySpaces?.[hand]?.object3D;
      if (obj) {
        obj.getWorldPosition(_v);
        d.push(_v.x, _v.y, _v.z);
      } else {
        // No controller tracked — park the hand at the hip.
        d.push(hand === 'left' ? -0.25 : 0.25, Math.max(0.6, match.headY - 0.6), -0.1);
      }
    }
    sendPose(d);
  }
}
