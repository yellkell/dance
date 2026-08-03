/**
 * The SET-LIST — the entire raid choreographed up front, deterministically,
 * from the match seed.
 *
 * Every move is a telegraph → landing pair quantized to the beat grid:
 * telegraphs start on beats, landings hit BAR downbeats, multi-part moves
 * (slam drumlines, seesaw cascades) step on beats after their first landing.
 * The same seat-local pattern marks EVERY platform simultaneously — one
 * giant's move, twenty-four floors lighting up as one — so the raid is fair
 * by construction and no client ever has to be told what the boss will do.
 *
 * The nova is the exception that proves the rule: its safe wedge is one
 * CANONICAL compass bearing shared by the whole ring (each seat sees it
 * rotated into its own frame), so the entire floor rotates to the same
 * ground together. Pure spectacle, still deterministic.
 */

import {
  CHOREO,
  MOVES,
  MUSIC,
  OCTAGON_HALF_DEPTH,
  OCTAGON_HALF_WIDTH,
  type GooplingDef,
  type MoveKind,
} from '../config.js';
import { mix, mulberry32 } from '../game/rng.js';

/** A seat-local danger zone, judged at its landing beat. */
export type Zone =
  | { kind: 'circle'; x: number; z: number; r: number }
  | { kind: 'lane'; x: number; halfW: number }
  | { kind: 'sweep' }
  | { kind: 'half'; side: 1 | -1; axis: 0 | 1 }
  | { kind: 'nova'; bearing: number; halfAngle: number };

/** One landing within a move (a move may land several beats in a row). */
export interface Landing {
  /** Song beat this zone detonates. */
  beat: number;
  zone: Zone;
}

export interface SetMove {
  index: number;
  kind: MoveKind;
  /** Telegraphs appear here… */
  telegraphBeat: number;
  /** …and the first landing hits here (a bar downbeat). */
  landBeat: number;
  landings: Landing[];
  /** Musical act 0..3 at the landing (drives strike visuals + bot odds). */
  act: number;
}

const barBeats = MUSIC.beatsPerBar;
const phraseBeats = MUSIC.beatsPerBar * MUSIC.barsPerPhrase;

export function actOfPhrase(phrase: number): number {
  let act = 0;
  for (let i = 0; i < CHOREO.actAtPhrase.length; i++) {
    if (phrase >= CHOREO.actAtPhrase[i]) act = i;
  }
  return act;
}

export function actOfBeat(beat: number): number {
  return actOfPhrase(Math.floor(Math.max(0, beat) / phraseBeats));
}

function pickKind(rng: () => number, act: number, last: MoveKind | null): MoveKind {
  const kinds = Object.keys(MOVES) as MoveKind[];
  const pool: Array<[MoveKind, number]> = [];
  let total = 0;
  for (const k of kinds) {
    const weights = MOVES[k].weights;
    let w = weights[Math.min(act, weights.length - 1)];
    if (w <= 0) continue;
    if (k === last) w *= 0.3;
    pool.push([k, w]);
    total += w;
  }
  let roll = rng() * total;
  for (const [k, w] of pool) {
    roll -= w;
    if (roll <= 0) return k;
  }
  return pool[0]?.[0] ?? 'slam';
}

/** Build one move's landings from the seeded rng (seat-local pattern). */
function buildLandings(kind: MoveKind, landBeat: number, act: number, rng: () => number): Landing[] {
  const landings: Landing[] = [];
  if (kind === 'slam') {
    const count = 1 + (act >= 1 ? 1 : 0) + (act >= 3 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      landings.push({
        beat: landBeat + i * CHOREO.slamStepBeats,
        zone: {
          kind: 'circle',
          x: (rng() * 2 - 1) * (OCTAGON_HALF_WIDTH - 0.24),
          z: (rng() * 2 - 1) * (OCTAGON_HALF_DEPTH - 0.2),
          r: CHOREO.slamRadius,
        },
      });
    }
  } else if (kind === 'beam') {
    const lanes = act >= 2 ? 2 : 1;
    const first = (rng() * 2 - 1) * 0.5;
    for (let i = 0; i < lanes; i++) {
      // The second lane cuts the other side of the deck — between them the
      // safe ground is a readable stripe, never a coin flip.
      const x = i === 0 ? first : -Math.sign(first) * (0.3 + rng() * 0.3);
      landings.push({ beat: landBeat, zone: { kind: 'lane', x, halfW: CHOREO.beamHalfWidth } });
    }
  } else if (kind === 'sweep') {
    landings.push({ beat: landBeat, zone: { kind: 'sweep' } });
  } else if (kind === 'seesaw' || kind === 'surge') {
    const axis: 0 | 1 = kind === 'surge' ? 1 : 0;
    const stages = 2 + Math.min(act, kind === 'surge' ? 2 : 3);
    const gap = CHOREO.seesawGapBeats[Math.min(act, CHOREO.seesawGapBeats.length - 1)];
    let side: 1 | -1 = rng() < 0.5 ? 1 : -1;
    for (let i = 0; i < stages; i++) {
      landings.push({ beat: landBeat + i * gap, zone: { kind: 'half', side, axis } });
      side = side === 1 ? -1 : 1;
    }
  } else {
    // nova: one canonical compass bearing for the whole ring.
    landings.push({
      beat: landBeat,
      zone: {
        kind: 'nova',
        bearing: rng() * Math.PI * 2,
        halfAngle: act >= 3 ? CHOREO.novaHalfAngleLate : CHOREO.novaHalfAngle,
      },
    });
  }
  return landings;
}

/**
 * The full raid set. Pure function of (seed, phrases) — every client, and
 * every rewatch of the same seed, gets the identical show.
 */
export function generateSetlist(seed: number, phrases: number): SetMove[] {
  const rng = mulberry32(mix(seed, 0xc03e0));
  const moves: SetMove[] = [];
  let cursor = MUSIC.introPhrases * phraseBeats; // the intro phrase just dances
  let last: MoveKind | null = null;
  let index = 0;

  for (let phrase = MUSIC.introPhrases; phrase < phrases; phrase++) {
    const act = actOfPhrase(phrase);
    const want = CHOREO.movesPerPhrase[Math.min(act, CHOREO.movesPerPhrase.length - 1)];
    const phraseEnd = (phrase + 1) * phraseBeats;
    const rest = CHOREO.restBeats[Math.min(act, CHOREO.restBeats.length - 1)];

    for (let m = 0; m < want; m++) {
      const kind = pickKind(rng, act, last);
      const charge = MOVES[kind].chargeBeats;
      // Land on the next bar downbeat that the telegraph fits in front of.
      const landBeat = Math.ceil((cursor + charge) / barBeats) * barBeats;
      if (landBeat >= phraseEnd + barBeats) break; // phrase is full — move on
      const landings = buildLandings(kind, landBeat, act, rng);
      moves.push({ index: index++, kind, telegraphBeat: landBeat - charge, landBeat, landings, act });
      last = kind;
      cursor = landings[landings.length - 1].beat + rest;
    }
  }
  return moves;
}

/**
 * A goopling's REHEARSAL loop: its one move, over and over, at a kind BPM.
 * Same structure as the raid set so the whole choreo stack runs unchanged.
 */
export function generateLesson(goopling: GooplingDef, seed: number, count = 60): SetMove[] {
  const rng = mulberry32(mix(seed, 0x1e550));
  const moves: SetMove[] = [];
  const charge = MOVES[goopling.move].chargeBeats;
  // One move per two bars, landing on the downbeat, forever.
  let land = MUSIC.introPhrases > 0 ? barBeats * 2 : barBeats * 2;
  for (let i = 0; i < count; i++) {
    const landings = buildLandings(goopling.move, land, 0, rng);
    moves.push({
      index: i,
      kind: goopling.move,
      telegraphBeat: land - charge,
      landBeat: land,
      landings,
      act: 0,
    });
    // Breathe for a bar after the last landing, then the next telegraph.
    land = landings[landings.length - 1].beat + barBeats + charge;
  }
  return moves;
}
