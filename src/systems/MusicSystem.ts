/**
 * MusicSystem — owns the set: starts the synthesised techno on a countdown,
 * mirrors the beat clock into shared state every frame, flips countdown →
 * live when beat 0 drops, and fades the set out for the podium.
 */

import { createSystem } from '@iwsdk/core';
import { MUSIC } from '../config.js';
import { beatNow, setRunning, startSet, stopSet } from '../audio/techno.js';
import { actOfBeat } from '../choreo/setlist.js';
import { match, phraseBeats } from '../game/state.js';

const COUNT_IN_BEATS = 8;

export class MusicSystem extends createSystem({}) {
  private generation = -1;
  private stoppedFor: typeof match.screen | '' = '';

  update(): void {
    // A fresh countdown generation → drop the needle.
    if (match.screen === 'countdown' && this.generation !== match.generation) {
      this.generation = match.generation;
      this.stoppedFor = '';
      const tutorial = match.after === 'tutorial';
      startSet({
        bpm: match.bpm,
        countInBeats: COUNT_IN_BEATS,
        endBeat: tutorial ? 1e9 : match.phrases * phraseBeats(),
        seed: match.seed,
        actAt: tutorial ? () => 0 : (beat) => actOfBeat(beat),
        beatZeroAt: Number.isFinite(match.beatZeroAt) ? match.beatZeroAt : undefined,
      });
      match.beatLen = 60 / match.bpm;
      match.playing = true;
    }

    if (match.playing && setRunning()) {
      match.beat = beatNow();
      if (match.screen === 'countdown' && match.beat >= 0) {
        match.screen = match.after;
      }
    }

    // Podium / lobby / map: let the set die once, gently.
    if ((match.screen === 'podium' || match.screen === 'lobby' || match.screen === 'map') && this.stoppedFor !== match.screen) {
      this.stoppedFor = match.screen;
      if (setRunning()) stopSet(match.screen === 'podium' ? 1.6 : 0.5);
      match.playing = false;
    }
  }
}

export const musicIntroPhrases = (): number => MUSIC.introPhrases;
