/**
 * MusicSystem — the DJ. Drops the needle on the countdown, mirrors the beat
 * clock into shared state every frame, flips countdown → live when beat 0
 * arrives, and rides the lobby loop the rest of the time.
 *
 * The lobby loop matters more than it looks: it publishes its own beat, so
 * the mirror ball, the lasers and the GOOPLIATH's idle bounce are already
 * grooving before anyone starts a set. The club is never dead.
 */

import { createSystem } from '@iwsdk/core';
import { countInBeatsFor } from '../config.js';
import {
  ambientBeat,
  ambientRunning,
  beatNow,
  preload,
  setPlaybackState,
  setRunning,
  startAmbient,
  startSet,
  stopAmbient,
  stopSet,
} from '../audio/music.js';
import { pickRaidTrack, trackById, tracksFor } from '../audio/tracks.js';
import { actOfBeat } from '../choreo/setlist.js';
import { match, phraseBeats } from '../game/state.js';
import { net } from '../net/session.js';

export class MusicSystem extends createSystem({}) {
  private generation = -1;
  private stoppedFor: typeof match.screen | '' = '';
  private warmed = false;

  update(): void {
    const screen = match.screen;

    // A fresh countdown generation → drop the needle.
    if (screen === 'countdown' && this.generation !== match.generation) {
      this.generation = match.generation;
      this.stoppedFor = '';
      stopAmbient(0.35);
      const track = trackById(match.trackId) ?? pickRaidTrack(match.seed);
      const total = match.phrases;
      startSet({
        track,
        countInBeats: countInBeatsFor(track.bpm),
        endBeat: total * phraseBeats(),
        seed: match.seed,
        actAt: (beat) => actOfBeat(beat, total, match.difficulty),
        beatZeroAt: Number.isFinite(match.beatZeroAt) ? match.beatZeroAt : undefined,
        loop: false,
      });
      match.beatLen = 60 / track.bpm;
      match.playing = true;
    }

    const inSet = screen === 'countdown' || screen === 'raid';

    if (match.playing && inSet) {
      // Still decoding? Hold the countdown — the clock stays parked at −∞
      // and nothing (choreography, scoring) can run early.
      match.beat = setRunning() ? beatNow() : -Infinity;
      if (screen === 'countdown' && Number.isFinite(match.beat) && match.beat >= 0) {
        match.screen = match.after;
      }
    }

    // Lobby / podium: fade the set out once, bring the room loop up.
    if (!inSet) {
      if (this.stoppedFor !== screen) {
        this.stoppedFor = screen;
        if (setRunning()) stopSet(screen === 'podium' ? 2.0 : 0.6);
        match.playing = false;
        this.generation = -1; // the next countdown always re-drops
      }
      if (screen === 'lobby' || screen === 'tour') {
        // The house sound: SWAG holds the club solo; the moment a room has
        // the floor (hosting or joined — the SOCIAL night), ECLIPSE takes
        // the decks. startAmbient switches cleanly when the id changes.
        const social = net.phase === 'hosting' || net.phase === 'joined';
        const room = (social ? tracksFor('club')[0] : undefined) ?? tracksFor('lobby')[0];
        if (room) startAmbient(room, social ? 0.7 : 0.55);
        // Warm the raid record while the room track holds the floor, so the
        // drop is instant when someone hits START.
        if (!this.warmed) {
          this.warmed = true;
          preload(trackById(match.preferredTrack) ?? pickRaidTrack(match.seed));
        }
        // The lights and the goop dance to the lobby loop.
        match.beat = ambientRunning() ? ambientBeat() : -Infinity;
      } else if (screen === 'podium') {
        match.beat = -Infinity;
      }
    } else {
      this.warmed = false;
    }
  }
}

export const musicDebug = { setPlaybackState };
