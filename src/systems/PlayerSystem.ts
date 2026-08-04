/**
 * PlayerSystem — reads the tracked body, keeps the dodge state fresh, and
 * pays you for actually dancing.
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
 */

import { createSystem, Vector3 } from '@iwsdk/core';
import { CHOREO, GROOVE } from '../config.js';
import * as sfx from '../audio/sfx.js';
import { match, me, pushFlair } from '../game/state.js';

const _head = new Vector3();
const _hand = new Vector3();

export class PlayerSystem extends createSystem({}) {
  /** Which hand is currently "up": 1 = left, −1 = right, 0 = undecided. */
  private grooveSide = 0;
  private lastSwapBeat = -Infinity;
  private streak = 0;

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

    this.groove();
  }

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
      if (this.streak > 0 && match.beat - this.lastSwapBeat > GROOVE.maxBeats) {
        this.streak = 0;
        match.grooveStreak = 0;
      }
      return;
    }

    // A swap. Rhythmic (not too soon, not too late) keeps the streak alive.
    const gap = match.beat - this.lastSwapBeat;
    const first = this.grooveSide === 0;
    this.grooveSide = side;
    this.lastSwapBeat = match.beat;
    if (first) return; // the opening pose sets the metronome, pays nothing

    if (gap >= GROOVE.minBeats && gap <= GROOVE.maxBeats) {
      this.streak = Math.min(GROOVE.streakCap, this.streak + 1);
      d.score += Math.round(GROOVE.base + this.streak * GROOVE.perStreak);
      match.grooveStreak = this.streak;
      if (this.streak === 8 || this.streak === 32 || this.streak === GROOVE.streakCap) {
        pushFlair(this.streak === GROOVE.streakCap ? 'MAX GROOVE!!' : 'IN THE GROOVE!', 'milestone');
        sfx.uiClick();
      }
    } else {
      this.streak = 0;
      match.grooveStreak = 0;
    }
  }
}
