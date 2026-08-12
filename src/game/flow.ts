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

import { MUSIC, RING, TOUR, countInBeatsFor } from '../config.js';
import { pickRaidTrack, trackById, trackPhrases, type Track } from '../audio/tracks.js';
import { freshSeed } from './rng.js';
import { buildRoster, gradeOf, markTourNightCleared, match, pushFlair } from './state.js';

const phraseBeats = MUSIC.beatsPerBar * MUSIC.barsPerPhrase;

/** Apply a track to the match: tempo, set length, id. */
function mountTrack(track: Track): void {
  match.trackId = track.id;
  match.bpm = track.bpm;
  match.beatLen = 60 / track.bpm;
  match.phrases = trackPhrases(track, countInBeatsFor(track.bpm), phraseBeats);
  match.grooveStreak = 0;
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
  /** Force a difficulty (online: the caller's) — else this headset's. */
  difficulty?: number;
  /** A tour night: fixes the record, and the set's third night books the
   *  GOOP (recoloured, with the eat-the-MC opener). */
  tour?: { set: number; song: number };
}

/** Take the floor: a full raid set (solo vs groupies by default). */
export function startRaid(opts: RaidOptions = {}): void {
  const seats = Math.max(RING.minSeats, Math.min(RING.maxSeats, opts.seats ?? match.seats));
  match.seats = seats;
  match.mySeat = opts.mySeat ?? 0;
  match.seed = opts.seed ?? freshSeed();
  if (opts.difficulty !== undefined) match.difficulty = Math.max(0, Math.min(3, opts.difficulty));

  // The headliner: the MC runs most nights; the GOOP takes tour finales.
  const tourSet = opts.tour ? TOUR.sets[opts.tour.set] : undefined;
  const finale = Boolean(opts.tour && opts.tour.song === 2);
  match.tour = opts.tour ?? null;
  match.bossKind = finale ? 'goop' : 'mc';
  match.goopTint = finale ? (tourSet?.tint ?? null) : null;
  match.eatIntro = finale;

  // Track: a tour night's record is fixed; otherwise an explicit choice
  // (the host's, over the wire) wins; then this headset's lobby preference;
  // then a pick derived from the match seed — which every client computes
  // identically, so a shuffled room still agrees on the record without
  // anyone sending it.
  const chosen =
    (tourSet ? trackById(tourSet.songs[opts.tour!.song]) : undefined) ??
    (opts.trackId ? trackById(opts.trackId) : undefined) ??
    (match.preferredTrack ? trackById(match.preferredTrack) : undefined) ??
    pickRaidTrack(match.seed);
  mountTrack(chosen);
  // Campaign nights stay night-sized even on marathon records.
  if (opts.tour) match.phrases = Math.min(match.phrases, TOUR.maxPhrases);

  match.beatZeroAt = opts.beatZeroAt ?? NaN;
  match.online = opts.online ?? false;
  buildRoster(seats, match.seed, match.mySeat, opts.humans);
  match.after = 'raid';
  match.screen = 'countdown';
  match.playing = false;
  match.beat = -Infinity;
  match.generation++;
}

/** The set resolves — freeze the board, raise the champion, pop confetti. */
export function finishRaid(): void {
  if (match.screen !== 'raid') return;
  // A tour night is CLEARED by surviving it — the letter is for bragging.
  if (match.tour) {
    const me = match.players.find((p) => p.kind === 'local');
    if (me?.alive) {
      markTourNightCleared(match.tour.set, match.tour.song);
      pushFlair(`NIGHT CLEARED — ${gradeOf(me)}`, 'milestone');
    }
  }
  match.screen = 'podium';
}

/** The tour screen (the campaign of song sets). */
export function toTour(): void {
  match.screen = 'tour';
  match.playing = false;
  match.beat = -Infinity;
  match.generation++;
}

/** Back to the lobby floor. */
export function toLobby(): void {
  match.screen = 'lobby';
  match.playing = false;
  match.beat = -Infinity;
  match.tour = null;
  match.generation++;
}
