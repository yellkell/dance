/**
 * Match flow — the only place screens change hands. These are plain state
 * mutations; the systems notice (`match.generation`, `match.screen`) and do
 * the physical work: MusicSystem drops the needle, ArenaSystem rebuilds the
 * ring, ChoreoSystem regenerates the set-list, RankSystem re-seats the board.
 *
 * The record decides the shape of the match: a track's measured tempo
 * becomes `match.bpm`, and its playable length becomes `match.phrases` — so
 * the set always ends with the song, and the escalation curve (act
 * boundaries are fractions of the set) stretches to fit whatever is on.
 */

import { GOOPLINGS, MUSIC, RING } from '../config.js';
import { pickRaidTrack, trackById, trackPhrases, tracksFor, type Track } from '../audio/tracks.js';
import { freshSeed } from './rng.js';
import { buildRoster, markGooplingCleared, match, pushFlair } from './state.js';

const phraseBeats = MUSIC.beatsPerBar * MUSIC.barsPerPhrase;

/** Apply a track to the match: tempo, set length, id. */
function mountTrack(track: Track): void {
  match.trackId = track.id;
  match.bpm = track.bpm;
  match.beatLen = 60 / track.bpm;
  match.phrases = trackPhrases(track, MUSIC.countInBeats, phraseBeats);
}

export interface RaidOptions {
  seats?: number;
  seed?: number;
  mySeat?: number;
  /** Online: seat → who (unlisted seats become groupies). */
  humans?: Map<number, { name: string; netId?: number }>;
  /** Online: shared AudioContext-clock time for beat 0. */
  beatZeroAt?: number;
  online?: boolean;
  /** Force a track; otherwise the lobby preference, else a seeded pick. */
  trackId?: string;
}

/** Take the floor: a full raid set (solo vs groupies by default). */
export function startRaid(opts: RaidOptions = {}): void {
  const seats = Math.max(RING.minSeats, Math.min(RING.maxSeats, opts.seats ?? match.seats));
  match.seats = seats;
  match.mySeat = opts.mySeat ?? 0;
  match.seed = opts.seed ?? freshSeed();

  // Track: an explicit choice (the host's, over the wire) wins; then this
  // headset's lobby preference; then a pick derived from the match seed —
  // which every client computes identically, so a shuffled room still
  // agrees on the record without anyone sending it.
  const chosen =
    (opts.trackId ? trackById(opts.trackId) : undefined) ??
    (match.preferredTrack ? trackById(match.preferredTrack) : undefined) ??
    pickRaidTrack(match.seed);
  mountTrack(chosen);

  match.goopling = null;
  match.beatZeroAt = opts.beatZeroAt ?? NaN;
  match.online = opts.online ?? false;
  buildRoster(seats, match.seed, match.mySeat, opts.humans);
  match.after = 'raid';
  match.screen = 'countdown';
  match.playing = false;
  match.beat = -Infinity;
  match.generation++;
}

/** One goopling's rehearsal: a private stage, its move on a kind clock. */
export function startTutorial(gooplingIndex: number): void {
  const goopling = GOOPLINGS[gooplingIndex];
  if (!goopling) return;
  match.goopling = goopling;
  match.tutorialClears = 0;
  match.seats = 1;
  match.mySeat = 0;
  match.seed = 0x600d + gooplingIndex; // fixed seed: a lesson, not a gamble

  // Rehearsals run on the steadiest record we have (see tracks.ts roles).
  const track = trackById(goopling.trackId) ?? tracksFor('rehearsal')[0] ?? pickRaidTrack(0);
  mountTrack(track);
  match.phrases = 999; // the lesson loops until you clear it

  match.beatZeroAt = NaN;
  match.online = false;
  buildRoster(1, match.seed, 0);
  match.after = 'tutorial';
  match.screen = 'countdown';
  match.playing = false;
  match.beat = -Infinity;
  match.generation++;
}

/** The set resolves — freeze the board, raise the champion, pop confetti. */
export function finishRaid(): void {
  if (match.screen !== 'raid') return;
  match.screen = 'podium';
}

/** Rehearsal cleared (or abandoned). */
export function finishTutorial(cleared: boolean): void {
  if (match.goopling && cleared) {
    markGooplingCleared(match.goopling.id);
    pushFlair(`${match.goopling.name} CLEARED`, 'milestone');
  }
  match.goopling = null;
  toMap();
}

/** The rehearsal map (campaign screen). */
export function toMap(): void {
  match.screen = 'map';
  match.playing = false;
  match.beat = -Infinity;
  match.generation++;
}

/** Back to the lobby floor. */
export function toLobby(): void {
  match.screen = 'lobby';
  match.playing = false;
  match.beat = -Infinity;
  match.goopling = null;
  match.generation++;
}
