/**
 * Shared mutable app/match state — one plain singleton every system reads
 * and writes (the FIRE FIGHT `app` pattern). No framework, no events except
 * a couple of tiny queues ("buses") for cross-system one-shots.
 */

import { BOTS, GRADE, MUSIC, RING, seatHue, type MoveKind } from '../config.js';
import { mix, mulberry32 } from './rng.js';

export type Screen =
  | 'lobby' // the rave floor idles, menu up
  | 'countdown' // seats locked, music counting in
  | 'raid' // the set is live
  | 'podium' // set over — winner on high, board frozen
  | 'tour'; // the campaign screen: sets of nights

export interface Dancer {
  seat: number;
  kind: 'local' | 'bot' | 'remote';
  name: string;
  hue: number;
  /** Bot dodge chance (rolled from the seed; meaningless for humans). */
  skill: number;
  score: number;
  /** Consecutive dodges — the chain behind the HUD's ×N. (The field
   *  keeps its old name: it rides the score wire between clients.) */
  combo: number;
  bestCombo: number;
  dodges: number;
  perfects: number;
  /** Landings that clipped this dancer, all night — the grade's denominator
   *  along with `dodges`. */
  hits: number;
  /** Clipped landings BACK TO BACK. Any dodge wipes it; reaching
   *  GRADE.chainOut ends the night. Not a life count — a chain count. */
  missChain: number;
  alive: boolean;
  /** Song beat this dancer fell on (−1 while alive) — later = ranks higher. */
  elimAtBeat: number;
  /** 1-based live rank, recomputed by RankSystem. */
  rank: number;
  /** I-frames: landings before this song beat can't hurt this dancer. */
  invulnUntilBeat: number;
  /** Remote only: connection id on the relay. */
  netId?: number;
}

/** A one-shot the boss performs when a move starts telegraphing. */
export interface GestureCue {
  kind: MoveKind;
  chargeBeats: number;
  /** A follow-up strike inside a multi-landing move (seesaw halves,
   *  routine steps) — a quick jab/hook, not the full wind-up. */
  step?: boolean;
  /** Directional payload so the MC's body can ACT the move out: sweep entry
   *  side / seesaw-surge doomed side (platform-local sign). */
  side?: number;
  /** half-moves and gates: 0 = x split/column, 1 = z split/row. */
  axis?: number;
  /** gate only: the safe band's platform-local offset. */
  gapX?: number;
  /** beam only: THE X — the arms are thrown crossed. */
  crossed?: boolean;
  /** routine only: the whole corner sequence, so the boss can TEACH it —
   *  he points each one out in turn while the marks are still lit. */
  routine?: readonly number[];
  /** The landing this cue charges toward (song beats) — lets the MC time
   *  its strike snap without re-deriving the set-list. */
  dueBeat?: number;
}

/** A transient HUD flair (PERFECT! / HIT / NIGHT CLEARED). */
export interface Flair {
  text: string;
  tone: 'dodge' | 'perfect' | 'hit' | 'milestone' | 'info';
}

export interface MatchState {
  screen: Screen;
  /** What the countdown counts into. */
  after: 'raid';
  /** Bumped whenever the roster/seed/mode changes — systems that build
   *  things (arena, set-list, music) rebuild when they see a new number. */
  generation: number;
  /** Seats in the ring this match (RING.minSeats..maxSeats). */
  seats: number;
  /** My seat index (0 in solo; assigned by the relay online). */
  mySeat: number;
  seed: number;
  /** The record on the decks — its measured tempo IS match.bpm. */
  trackId: string;
  /** Lobby override: a track id to always play, or '' for seed shuffle. */
  preferredTrack: string;
  /** DIFFICULTY (0 easy · 1 normal · 2 hard) — the act floor for the whole
   *  song. Chosen on the board; the ball carries the caller's choice. */
  difficulty: number;
  bpm: number;
  /** Total phrases in the current set — derived from the track's length. */
  phrases: number;
  /** Online only: AudioContext-clock time for beat 0 handed down by the
   *  relay sync (NaN = start whenever the music system likes). */
  beatZeroAt: number;
  players: Dancer[];

  /* ── the song clock (MusicSystem owns these) ── */
  playing: boolean;
  /** Continuous song position in beats (can be negative during count-in). */
  beat: number;
  /** Seconds per beat, cached from bpm. */
  beatLen: number;

  /* ── local dodge state (PlayerSystem owns these) ── */
  /** Calibrated standing head height (m). */
  standingHeight: number;
  /** Head position in MY platform space (origin = platform centre). */
  headX: number;
  headY: number;
  headZ: number;
  /** True while the head is below the duck line. */
  ducked: boolean;
  /** Live rhythm-swap streak (one hand up, one down, swap on the beat) —
   *  the glowstick sparks are its voice, the wedge's groove row its
   *  ledger. Never a word on screen. */
  grooveStreak: number;
  /** Points the CURRENT groove streak has paid so far — the HUD's combo
   *  tally. Resets with the streak, so it always reads "this run". */
  grooveScore: number;

  /* ── buses ── */
  gestures: GestureCue[];
  flairs: Flair[];


  /* ── the headliner ── */
  /** Who runs the stage this match: the MC most nights, the GOOP on
   *  finales. */
  bossKind: 'mc' | 'goop';
  /** Finale gel recolour (null = classic green). */
  goopTint: { shallow: number; deep: number; nucleus: number } | null;
  /** Finale opener: the MC is on stage for the count-in until the goop
   *  drops in and EATS him. */
  eatIntro: boolean;

  /* ── the tour (campaign) ── */
  /** Which night this raid is, or null for a free-play set. */
  tour: { set: number; song: number } | null;

  /* ── online ── */
  online: boolean;
  roomCode: string;
}

export const match: MatchState = {
  // The TOUR MAP is the main attraction — it's the first thing you see.
  screen: 'tour',
  after: 'raid',
  generation: 0,
  seats: RING.defaultSeats,
  mySeat: 0,
  seed: 1,
  trackId: '',
  preferredTrack: '',
  difficulty: 1,
  bpm: MUSIC.fallbackBpm,
  phrases: 8,
  beatZeroAt: NaN,
  players: [],
  playing: false,
  beat: -Infinity,
  beatLen: 60 / MUSIC.fallbackBpm,
  standingHeight: 1.65,
  headX: 0,
  headY: 1.65,
  headZ: 0,
  ducked: false,
  grooveStreak: 0,
  grooveScore: 0,
  gestures: [],
  flairs: [],
  bossKind: 'mc',
  goopTint: null,
  eatIntro: false,
  tour: null,
  online: false,
  roomCode: '',
};

export const me = (): Dancer | undefined => match.players[0] && match.players.find((p) => p.kind === 'local');

/** Beats in one bar / one phrase for the current track. */
export const barBeats = (): number => MUSIC.beatsPerBar;
export const phraseBeats = (): number => MUSIC.beatsPerBar * MUSIC.barsPerPhrase;

/** The set's final beat (landings stop here; the outro rides out after). */
export const setEndBeat = (): number => match.phrases * phraseBeats();

/** Build the dancer roster for a raid. `humans` maps seat → name for online
 *  play; every unlisted seat becomes a seeded goo-groupie. */
export function buildRoster(seats: number, seed: number, mySeat: number, humans?: Map<number, { name: string; netId?: number }>): void {
  const rng = mulberry32(mix(seed, 0xb07));
  const players: Dancer[] = [];
  let bots = 0;
  for (let seat = 0; seat < seats; seat++) {
    const human = seat === mySeat ? { name: 'YOU' } : humans?.get(seat);
    // Bots wear plain service tags, numbered around the ring.
    const botName = human ? '' : `BOT${String(++bots).padStart(2, '0')}`;
    players.push({
      seat,
      kind: seat === mySeat ? 'local' : human ? 'remote' : 'bot',
      name: human?.name ?? botName,
      hue: seatHue(seat),
      skill: BOTS.skillMin + rng() * (BOTS.skillMax - BOTS.skillMin),
      score: 0,
      combo: 0,
      bestCombo: 0,
      dodges: 0,
      perfects: 0,
      hits: 0,
      missChain: 0,
      alive: true,
      elimAtBeat: -1,
      rank: seat + 1,
      invulnUntilBeat: -Infinity,
      netId: human && 'netId' in human ? human.netId : undefined,
    });
  }
  // Local player first in the array = convenient; seat order via .seat.
  players.sort((a, b) => (a.kind === 'local' ? -1 : b.kind === 'local' ? 1 : a.seat - b.seat));
  match.players = players;
}

export function dancerAtSeat(seat: number): Dancer | undefined {
  return match.players.find((p) => p.seat === seat);
}

export function aliveCount(): number {
  return match.players.reduce((n, p) => n + (p.alive ? 1 : 0), 0);
}

/**
 * The night's letter for one dancer — the thing you actually take home.
 *
 * It reads the SET, not the scoreboard: what share of the landings thrown
 * at you did you survive, and how many of those did you leave to the last
 * beat. Points reward flair and dancing; the grade rewards not being hit.
 *
 * Falling to the chain is an F no matter how clean the night was up to it —
 * you didn't finish the record, and the letter says so.
 */
export function gradeOf(d: Dancer): string {
  if (!d.alive) return GRADE.fail;
  const faced = d.dodges + d.hits;
  if (faced === 0) return GRADE.fail; // nothing danced, nothing earned
  const rate = d.dodges / faced;
  const perfectRate = d.perfects / faced;
  for (const cut of GRADE.cuts) {
    if (rate >= cut.rate && perfectRate >= cut.perfect) return cut.letter;
  }
  return GRADE.fail;
}

/** The share of landings survived, 0..1 — the grade's raw number. */
export function dodgeRate(d: Dancer): number {
  const faced = d.dodges + d.hits;
  return faced === 0 ? 0 : d.dodges / faced;
}

export function pushFlair(text: string, tone: Flair['tone']): void {
  match.flairs.push({ text, tone });
  if (match.flairs.length > 6) match.flairs.shift();
}

/**
 * Where each NON-LOCAL dancer currently stands on their own deck
 * (platform-local x/z), written by AvatarSystem every frame — zone judges
 * read these. The local player's spot is match.headX/Z directly.
 */
export const liveSpots = new Map<number, { x: number; z: number }>();

/* ── tour progress (localStorage) ─────────────────────────────────────── */

import { TOUR, TOUR_KEY } from '../config.js';

export function clearedTourNights(): Set<string> {
  try {
    const raw = localStorage.getItem(TOUR_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

export function markTourNightCleared(set: number, song: number): void {
  const done = clearedTourNights();
  done.add(`${set}:${song}`);
  try {
    localStorage.setItem(TOUR_KEY, JSON.stringify([...done]));
  } catch {
    /* storage may be unavailable */
  }
}

/** Night 1 of set 1 is always open; a night needs the previous night, and a
 *  set needs the whole set before it. */
export function tourNightUnlocked(set: number, song: number): boolean {
  if (set >= TOUR.freeSets) return false; // the teaser rows — not for sale yet
  const done = clearedTourNights();
  for (let s = 0; s < set; s++) {
    for (let i = 0; i < 3; i++) if (!done.has(`${s}:${i}`)) return false;
  }
  for (let i = 0; i < song; i++) if (!done.has(`${set}:${i}`)) return false;
  return true;
}

