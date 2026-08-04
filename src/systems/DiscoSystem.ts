/**
 * DiscoSystem — parks the light rig on the stage and feeds it the beat.
 * The club idles warm in the lobby (ball turning, lasers lazy) and goes
 * full rave the moment the set drops.
 */

import { createSystem } from '@iwsdk/core';
import { arena } from '../arena/arena.js';
import { DiscoRig } from '../arena/disco.js';
import { actOfBeat } from '../choreo/setlist.js';
import { match } from '../game/state.js';

let rig: DiscoRig | null = null;

/** RankSystem pops the podium confetti through this. */
export function discoRig(): DiscoRig | null {
  return rig;
}

export class DiscoSystem extends createSystem({}) {
  private generation = -1;

  init(): void {
    rig = new DiscoRig();
    this.scene.add(rig.root);
  }

  update(delta: number): void {
    if (!rig) return;
    const a = arena();
    if (a && this.generation !== match.generation) {
      this.generation = match.generation;
      rig.root.position.copy(a.stage.position);
    }

    const live = match.playing && (match.screen === 'raid' || match.screen === 'tutorial');
    // The lobby loop publishes a beat too, so the room grooves between sets.
    const onBeat = Number.isFinite(match.beat);
    const energy = live ? 1 : match.screen === 'countdown' ? 0.6 : onBeat ? 0.45 : 0.25;
    const beat = onBeat ? match.beat : performance.now() / 1000 / match.beatLen / 4;
    const act = match.screen === 'raid' ? actOfBeat(beat, match.phrases) : 0;
    rig.update(delta, beat, act, energy);

    // The stage ring breathes with the bar.
    if (a) {
      const pulse = 0.75 + 0.25 * Math.max(0, 1 - (beat - Math.floor(beat)) * 2.2);
      a.stageRingMat.opacity = energy > 0.5 ? pulse : 0.5;
    }
  }
}
