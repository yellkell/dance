/**
 * THE RECORD BOX — the real tracks, and everything the game needs to dance
 * to them.
 *
 * Every number here was MEASURED from the files themselves, not guessed:
 *
 *  - `bpm`      : onset-flux autocorrelation, then phase-locked across the
 *                 whole track at 0.005 BPM resolution. Four of these land on
 *                 exact integers (a DAW grid); three genuinely sit a hair
 *                 under, and using the rounded value visibly drifts off the
 *                 kick by the last third — so the fractions stay.
 *  - `downbeat` : seconds from file start to BAR 1 BEAT 1 (a 4-beat energy
 *                 vote picks which beat of the bar is the downbeat). This is
 *                 the one number a human ear might want to nudge: if a set
 *                 ever feels like it lands on the 2 instead of the 1, move
 *                 this by ±(60/bpm) and nothing else changes.
 *  - `lufs`     : EBU R128 integrated loudness (ffmpeg ebur128). The spread
 *                 across these masters is 7.6 dB — swag comes in at −15.7
 *                 while sakupened is slammed to −8.1 — so every track is
 *                 gain-matched to TARGET_LUFS at playback. Nothing is ever
 *                 re-encoded; it's a gain node.
 *
 * Adding a track: drop the file in src/assets/music/, add a row here, done.
 * Roles decide where it plays; move a track between roles freely.
 */

import sakupenedUrl from '../assets/music/sakupened.mp3';
import swagUrl from '../assets/music/swag.mp3';
import combatUrl from '../assets/music/combat.m4a';
import targetUrl from '../assets/music/target.m4a';
import captureUrl from '../assets/music/capture.m4a';
import loopUrl from '../assets/music/loop.m4a';
import moneyUrl from '../assets/music/money.m4a';
import breakcoreUrl from '../assets/music/breakcore.mp3';
import infectionUrl from '../assets/music/infection.m4a';
import unityUrl from '../assets/music/unity.m4a';
import dynastyUrl from '../assets/music/dynasty.mp3';
import spreadUrl from '../assets/music/spread.m4a';
import morningUrl from '../assets/music/morning.mp3';
import assembleUrl from '../assets/music/assemble.m4a';
import discoballUrl from '../assets/music/discoball.mp3';
import eclipseUrl from '../assets/music/eclipse.mp3';
import type { MoveKind } from '../config.js';

export type TrackRole = 'raid' | 'lobby' | 'club';

export interface Track {
  id: string;
  /** Shown on the lobby selector and the count-in card. */
  title: string;
  url: string;
  /** Measured tempo — fractions are deliberate (see the header). */
  bpm: number;
  /** Seconds to bar 1 beat 1. Game beat 0 = this + the count-in. */
  downbeat: number;
  /** File duration in seconds. */
  seconds: number;
  /** EBU R128 integrated loudness of the master. */
  lufs: number;
  roles: TrackRole[];
  /** Optional: begin playback this far into the file (skips an ambient
   *  intro). Must still sit on the grid — use downbeat + n×4 beats. */
  startAt?: number;
  /** Optional: move kinds this record never calls — the set-list generator
   *  skips them entirely. Same trackId on every client, so a ban never
   *  desyncs a room. */
  banned?: MoveKind[];
}

/**
 * Playback target. −14 LUFS keeps every master at or under unity gain except
 * the quietest, leaves headroom over the sfx bus, and (with the limiter in
 * music.ts) means no track can ever slam the mix.
 */
export const TARGET_LUFS = -14;

export const TRACKS: Track[] = [
  {
    id: 'sakupened',
    title: 'SAKUPENED',
    url: sakupenedUrl,
    bpm: 133.964,
    downbeat: 1.7848,
    seconds: 154.02,
    lufs: -8.1,
    roles: ['raid'],
  },
  {
    id: 'combat',
    title: 'COMBAT',
    url: combatUrl,
    bpm: 135.0,
    downbeat: 0.4909,
    seconds: 186.67,
    lufs: -13.2,
    // Back in PEAK HOURS (slot 2, between DISCO BALL's strut and DYNASTY's
    // finale) — LOOP took its old seat in the quick-raid pool.
    roles: ['raid'],
  },
  {
    id: 'discoball',
    title: 'DISCO BALL',
    url: discoballUrl,
    bpm: 73.33,
    downbeat: 2.1763,
    seconds: 126.62,
    lufs: -12.6,
    // The night after the first goop falls: PEAK HOURS opens on a slow
    // strut — the tour's victory lap before COMBAT kicks the doors in. At
    // 73 BPM nobody should be ducking; the groove is the point.
    roles: ['raid'],
    banned: ['sweep'],
  },
  {
    id: 'loop',
    title: 'LOOP',
    url: loopUrl,
    bpm: 150.0,
    downbeat: 1.2523,
    seconds: 225.6,
    lufs: -11.2,
    roles: ['raid'],
  },
  {
    id: 'capture',
    title: 'CAPTURE',
    url: captureUrl,
    bpm: 117.0,
    downbeat: 1.0663,
    seconds: 225.64,
    lufs: -15.0,
    roles: ['raid'],
  },
  {
    id: 'morning',
    title: 'MORNING',
    url: morningUrl,
    bpm: 96.665,
    downbeat: 0.8239,
    seconds: 112.65,
    lufs: -11.1,
    roles: ['raid'],
    // The tour's opening night: short, fun, and called MORNING — the night
    // starts here. Everyone stays on their feet.
    banned: ['sweep'],
  },
  {
    id: 'money',
    title: 'MONEY',
    url: moneyUrl,
    bpm: 78.395,
    downbeat: 0.4934,
    seconds: 173.88,
    lufs: -14.5,
    // MORNING took its tour night; it plays on in the quick-raid pool —
    // and a record this laid-back still never asks anyone to duck.
    roles: ['raid'],
    banned: ['sweep'],
  },
  {
    id: 'target',
    title: 'TARGET',
    url: targetUrl,
    bpm: 91.0,
    downbeat: 0.0406,
    seconds: 253.19,
    lufs: -9.5,
    roles: ['raid'],
  },
  {
    id: 'breakcore',
    title: 'BREAKCORE',
    url: breakcoreUrl,
    bpm: 174.0,
    downbeat: 1.6347,
    seconds: 130.61,
    lufs: -8.3,
    // The endgame record: pure 174 DnB grid (phase-locked measurement said
    // 174.005 — one analyser step off the integer, 4 ms over the file).
    roles: ['raid'],
  },
  {
    id: 'dynasty',
    title: 'DYNASTY',
    url: dynastyUrl,
    bpm: 155.0,
    downbeat: 1.5444,
    seconds: 139.2,
    lufs: -9.6,
    // PEAK HOURS' closer: the magenta goop's record.
    roles: ['raid'],
  },
  {
    id: 'spread',
    title: 'SPREAD',
    url: spreadUrl,
    bpm: 150.0,
    downbeat: 1.2523,
    seconds: 244.81,
    lufs: -13.1,
    // A proper fight record — it took UNITY's night on the tour. Its groove
    // proper starts six bars in, so a set skips straight to it (still on
    // the grid: downbeat + 6 bars at 150).
    startAt: 10.8523,
    roles: ['raid'],
  },
  {
    id: 'unity',
    title: 'UNITY',
    url: unityUrl,
    bpm: 117.0,
    downbeat: 0.0464,
    seconds: 299.49,
    lufs: -13.8,
    // The five-minute journey — its ambient open is skipped so a set
    // drops straight into the groove (bar 7 on the grid). SPREAD took its
    // tour night; it plays on for quick raids and the seeded shuffle.
    startAt: 12.3542,
    roles: ['raid'],
  },
  {
    id: 'assemble',
    title: 'ASSEMBLE',
    url: assembleUrl,
    bpm: 125.0,
    // The record opens with about six seconds of near-silent riser (−55 dB
    // climbing to −30) and then SLAMS in at 5.804 s — a transient sharp
    // enough to see, jumping 18 dB inside 5 ms. Both the whole-file and the
    // body-only tempo passes put a beat within 2 ms of it, so the drop is
    // the honest anchor: bar 1 beat 1 is the slam, and startAt puts the
    // needle down right on it. The riser never plays.
    downbeat: 5.8043,
    startAt: 5.8043,
    seconds: 263.04,
    // The hottest master in the box, hotter even than sakupened.
    lufs: -7.5,
    roles: ['raid'],
  },
  {
    id: 'infection',
    title: 'INFECTION',
    url: infectionUrl,
    bpm: 138.0,
    downbeat: 0.7308,
    seconds: 222.61,
    lufs: -10.9,
    roles: ['raid'],
  },
  {
    id: 'eclipse',
    title: 'ECLIPSE',
    url: eclipseUrl,
    bpm: 70.0,
    downbeat: 3.4248,
    seconds: 154.03,
    lufs: -10.4,
    // The club's own record — a slow-burn 70 BPM groove that holds
    // the club whenever an online room has the floor between sets. The
    // chandelier phases to it. Never a raid record: at this tempo the ring
    // would be a waiting room, and the club deserves a house sound no set
    // ever borrows.
    roles: ['club'],
  },
  {
    id: 'swag',
    title: 'SWAG',
    url: swagUrl,
    bpm: 91.974,
    downbeat: 2.1661,
    seconds: 127.01,
    lufs: -15.7,
    // The soft one — it holds the room before the drop instead of fighting
    // it. (Its groove proper starts around 17.8 s; the lobby loop just rides
    // the whole thing, intro and all.)
    roles: ['lobby'],
  },
];

export function trackById(id: string): Track | undefined {
  return TRACKS.find((t) => t.id === id);
}

export function tracksFor(role: TrackRole): Track[] {
  return TRACKS.filter((t) => t.roles.includes(role));
}

/** Linear gain that brings a master to TARGET_LUFS. */
export function trackGain(track: Track): number {
  return Math.pow(10, (TARGET_LUFS - track.lufs) / 20);
}

/** Seconds per beat. */
export function beatLenOf(track: Track): number {
  return 60 / track.bpm;
}

/**
 * How much SET a track affords: game beat 0 sits `countInBeats` after the
 * first downbeat, and the last landing must leave a bar of room before the
 * file runs out.
 */
export function trackPhrases(track: Track, countInBeats: number, beatsPerPhrase = 32): number {
  const beatLen = beatLenOf(track);
  const zero = Math.max(track.downbeat, track.startAt ?? 0) + countInBeats * beatLen;
  const beats = (track.seconds - zero) / beatLen - beatsPerPhrase / 8; // tail guard
  return Math.max(2, Math.floor(beats / beatsPerPhrase));
}

/** Deterministic track pick for a seed — every client lands on the same set. */
export function pickRaidTrack(seed: number): Track {
  const pool = tracksFor('raid');
  return pool[seed % pool.length] ?? TRACKS[0];
}
