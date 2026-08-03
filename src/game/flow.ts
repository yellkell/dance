/**
 * Match flow — the only place screens change hands. These are plain state
 * mutations; the systems notice (`match.generation`, `match.screen`) and do
 * the physical work: MusicSystem starts the set, ArenaSystem rebuilds the
 * ring, ChoreoSystem regenerates the set-list, RankSystem re-seats the board.
 */

import { GOOPLINGS, MUSIC, RING } from '../config.js';
import { freshSeed } from './rng.js';
import { buildRoster, markGooplingCleared, match, pushFlair } from './state.js';

export interface RaidOptions {
  seats?: number;
  seed?: number;
  mySeat?: number;
  /** Online: seat → who (unlisted seats become groupies). */
  humans?: Map<number, { name: string; netId?: number }>;
  /** Online: shared AudioContext-clock time for beat 0. */
  beatZeroAt?: number;
  online?: boolean;
}

/** Take the floor: a full raid set (solo vs groupies by default). */
export function startRaid(opts: RaidOptions = {}): void {
  const seats = Math.max(RING.minSeats, Math.min(RING.maxSeats, opts.seats ?? match.seats));
  match.seats = seats;
  match.mySeat = opts.mySeat ?? 0;
  match.seed = opts.seed ?? freshSeed();
  match.bpm = MUSIC.bpm;
  match.phrases = MUSIC.raidPhrases;
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
  match.bpm = goopling.bpm;
  match.phrases = 999;
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
