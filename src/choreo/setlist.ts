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
  /** The crossfire's side laser: a strip ACROSS the deck at local z, fed
   *  from the rail on `from` — step forward or back off it. */
  | { kind: 'rail'; z: number; halfD: number; from: 1 | -1 }
  /** The rim burns, the middle lives — everything outside `innerR` is
   *  doomed, so the whole ring collapses toward its own centre. */
  | { kind: 'donut'; innerR: number }
  /** One step of THE ROUTINE: the deck's four quarters, and `corner` is
   *  the only one that lives. Every step carries the WHOLE routine so the
   *  preview (and the boss's body) can teach it before step one lands.
   *  Corner bit 0 = local +x, bit 1 = local +z. */
  | { kind: 'quad'; corner: number; step: number; routine: readonly number[] }
  | { kind: 'sweep' }
  | { kind: 'half'; side: 1 | -1; axis: 0 | 1 }
  /** Everything burns EXCEPT a clear column at x — stand in the gap. */
  | { kind: 'gate'; x: number; halfW: number }
  /** A disc that HUNTS its dancer's feet, freezing late (the live lock
   *  position is per-seat runtime state on the LiveZone, not here). */
  | { kind: 'chase'; r: number }
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

/** Act for a phrase within a set of `total` phrases (boundaries are
 *  fractions of the set, so a 2-minute track and a 4-minute track both get
 *  a full opening, build, peak and finale). */
export function actOfPhrase(phrase: number, total: number): number {
  const progress = total > 0 ? phrase / total : 0;
  let act = 0;
  for (let i = 0; i < CHOREO.actAtProgress.length; i++) {
    if (progress >= CHOREO.actAtProgress[i]) act = i;
  }
  return act;
}

export function actOfBeat(beat: number, totalPhrases: number): number {
  return actOfPhrase(Math.floor(Math.max(0, beat) / phraseBeats), totalPhrases);
}

function pickKind(
  rng: () => number,
  act: number,
  last: MoveKind | null,
  banned: readonly MoveKind[],
): MoveKind {
  const kinds = Object.keys(MOVES) as MoveKind[];
  const pool: Array<[MoveKind, number]> = [];
  let total = 0;
  for (const k of kinds) {
    if (banned.includes(k)) continue; // this record never calls it
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
    const halfW = CHOREO.beamHalfWidth;
    const lane = (x: number) => landings.push({ beat: landBeat, zone: { kind: 'lane', x, halfW } });
    if (act < 2) {
      // One laser, and it lands on a SLOT: the middle, or a third out.
      lane(CHOREO.beamSlots[Math.floor(rng() * CHOREO.beamSlots.length)]);
    } else if (rng() < CHOREO.beamSplitChance[Math.min(act, CHOREO.beamSplitChance.length - 1)]) {
      // SPLIT: evenly spaced either side of centre. What's left is a
      // corridor down the middle — the dodge is to stand BETWEEN them.
      lane(-CHOREO.beamSplitX);
      lane(CHOREO.beamSplitX);
    } else {
      // TWIN: two strips shoulder to shoulder, taking one whole side and
      // the middle with them. No corridor, no choice — get across.
      const s = rng() < 0.5 ? 1 : -1;
      lane(s * CHOREO.beamTwinInner);
      lane(s * (CHOREO.beamTwinInner + halfW * 2 + 0.02));
    }
  } else if (kind === 'donut') {
    // THE ONE-TWO: a laser straight down the middle drives everyone off
    // centre, and a bar later the rim closes and the middle is the only
    // ground left. Out, then back — the whole deck used in four beats.
    // (The ring's own telegraph holds off until the laser has fired; see
    // ChoreoSystem, which gates the second stage's window.)
    const innerR = act >= 3 ? CHOREO.donutInnerRLate : CHOREO.donutInnerR;
    const opens = rng() < CHOREO.donutOpenChance;
    if (opens) {
      landings.push({
        beat: landBeat,
        zone: { kind: 'lane', x: 0, halfW: CHOREO.beamHalfWidth },
      });
    }
    landings.push({
      beat: landBeat + (opens ? CHOREO.donutFollowBeats : 0),
      zone: { kind: 'donut', innerR },
    });
  } else if (kind === 'cross') {
    // LASERS FROM THE SIDES: a strip across the deck, always pushed off
    // centre so one side of it is roomy ground and the read is obvious.
    // From the lattice act on, a stage lane crosses it on the same beat and
    // the safe ground becomes a quarter — the dodge turns diagonal.
    const zSign = rng() < 0.5 ? 1 : -1;
    const z =
      zSign * (CHOREO.railOffsetMin + rng() * (CHOREO.railOffsetMax - CHOREO.railOffsetMin));
    const from: 1 | -1 = rng() < 0.5 ? 1 : -1;
    landings.push({ beat: landBeat, zone: { kind: 'rail', z, halfD: CHOREO.railHalfDepth, from } });
    if (act >= CHOREO.latticeFromAct) {
      const xSign = rng() < 0.5 ? 1 : -1;
      landings.push({
        beat: landBeat,
        zone: { kind: 'lane', x: xSign * (0.2 + rng() * 0.32), halfW: CHOREO.beamHalfWidth },
      });
    }
  } else if (kind === 'routine') {
    // THE MEMORY TEST. A seeded shuffle of the four quarters, cut to
    // length — a shuffle can't repeat a corner, so "never the same corner
    // twice" is true by construction rather than by retrying rolls.
    const bag = [0, 1, 2, 3];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    const want = CHOREO.routineSteps[Math.min(act, CHOREO.routineSteps.length - 1)];
    const routine = bag.slice(0, Math.max(2, Math.min(4, want)));
    routine.forEach((corner, step) => {
      landings.push({
        beat: landBeat + step * CHOREO.routineStepBeats,
        zone: { kind: 'quad', corner, step, routine },
      });
    });
    } else if (kind === 'sweep') {
    landings.push({ beat: landBeat, zone: { kind: 'sweep' } });
  } else if (kind === 'gate') {
    landings.push({
      beat: landBeat,
      zone: {
        kind: 'gate',
        x: (rng() * 2 - 1) * 0.5,
        halfW: act >= 3 ? CHOREO.gateHalfWLate : CHOREO.gateHalfW,
      },
    });
  } else if (kind === 'chase') {
    landings.push({ beat: landBeat, zone: { kind: 'chase', r: CHOREO.chaseRadius } });
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
    // nova: one canonical compass bearing for the whole ring — and at the
    // set's peak, THE CHAIN: three SINGULAR pies one after the other, each
    // safe wedge a third of the compass on, so the wedges partition the
    // whole rose and the ring walks the full way around together. Each
    // disc appears only as the previous pie detonates (ChoreoSystem gates
    // the telegraph per landing) — one pie on the floor at a time, ever.
    const slices = act >= 3 ? 3 : act >= 2 && rng() < 0.45 ? 2 : 1;
    const halfAngle = act >= 3 ? CHOREO.novaHalfAngleLate : CHOREO.novaHalfAngle;
    let bearing = rng() * Math.PI * 2;
    const turn = (rng() < 0.5 ? 1 : -1) * CHOREO.novaChainTurn;
    for (let i = 0; i < slices; i++) {
      landings.push({ beat: landBeat + i * CHOREO.novaChainBeats, zone: { kind: 'nova', bearing, halfAngle } });
      bearing += turn;
    }
  }
  return landings;
}

/**
 * The full raid set. Pure function of (seed, phrases, banned) — every
 * client, and every rewatch of the same seed, gets the identical show.
 * `banned` comes from the record on the decks (tracks.ts): some songs
 * simply never call certain moves.
 */
export function generateSetlist(seed: number, phrases: number, banned: readonly MoveKind[] = []): SetMove[] {
  const rng = mulberry32(mix(seed, 0xc03e0));
  const moves: SetMove[] = [];
  // Two bars of dancing, then the show starts: the first telegraph blooms at
  // bar 2 and the first landing hits the bar-3 downbeat — you're dodging
  // within seconds of the drop, not a phrase later.
  let cursor = MUSIC.introBars * barBeats;
  let last: MoveKind | null = null;
  let index = 0;

  for (let phrase = 0; phrase < phrases; phrase++) {
    const act = actOfPhrase(phrase, phrases);
    const want = CHOREO.movesPerPhrase[Math.min(act, CHOREO.movesPerPhrase.length - 1)];
    const phraseEnd = (phrase + 1) * phraseBeats;
    const rest = CHOREO.restBeats[Math.min(act, CHOREO.restBeats.length - 1)];

    for (let m = 0; m < want; m++) {
      const kind = pickKind(rng, act, last, banned);
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
  let land = barBeats * 2;
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
