/**
 * PlayerSystem — reads the tracked head, keeps the dodge state fresh, and
 * self-calibrates your standing height so DUCK means the same thing whether
 * you're 1.5 m or 2 m tall.
 *
 * My platform IS the world origin (the ring is built around me), so the
 * head's world position is already platform-local — no transforms.
 *
 * Calibration: standing height snaps UP instantly (you can't fake tall) and
 * decays DOWN very slowly, so a whole set spent crouching never quietly
 * lowers the bar the sweeps are judged against.
 */

import { createSystem, Vector3 } from '@iwsdk/core';
import { CHOREO } from '../config.js';
import { match } from '../game/state.js';

const _head = new Vector3();

export class PlayerSystem extends createSystem({}) {
  update(delta: number): void {
    const headObj = this.playerHeadEntity?.object3D;
    if (!headObj) return;
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
}
