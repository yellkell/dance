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
  DIFFICULTY,
  MOVES,
  MUSIC,
  type MoveKind,
} from '../config.js';
import { mix, mulberry32 } from '../game/rng.js';

/** A seat-local danger zone, judged at its landing beat. */
export type Zone =
  /** A laser strip. `yaw` spins it about the deck centre (THE X throws two
   *  at ±45° through the middle); `x` is the perpendicular offset. */
  | { kind: 'lane'; x: number; halfW: number; yaw?: number }
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
  /** Everything burns EXCEPT a clear band at `at` — stand in the gap.
   *  axis 0: a COLUMN at local x (sidestep in). axis 1: the horizontal
   *  cousin — a ROW at local z (step forward or back into it). */
  | { kind: 'gate'; at: number; half: number; axis: 0 | 1 }
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

/** Act for a phrase within a set of `total` phrases: the chosen DIFFICULTY
 *  sets the floor for the whole song, and the back stretch lifts one act —
 *  a set still deserves a finale, but nobody sits through a trivial
 *  opening third ever again. */
export function actOfPhrase(phrase: number, total: number, difficulty = 1): number {
  const progress = total > 0 ? phrase / total : 0;
  const base = DIFFICULTY.baseAct[Math.max(0, Math.min(DIFFICULTY.baseAct.length - 1, difficulty))];
  return Math.min(DIFFICULTY.maxAct, base + (progress >= DIFFICULTY.liftAt ? 1 : 0));
}

export function actOfBeat(beat: number, totalPhrases: number, difficulty = 1): number {
  return actOfPhrase(Math.floor(Math.max(0, beat) / phraseBeats), totalPhrases, difficulty);
}

/**
 * The MOVEMENT GRAMMAR: every kind's dodge asks the body for one primary
 * verb. Successive moves are steered AWAY from repeating a verb, so the
 * floor keeps travelling — out and in, left and right, forward and back —
 * instead of sidestepping three times in a row.
 */
const VERB: Record<MoveKind, string> = {
  beam: 'lateral',
  seesaw: 'lateral',
  gate: 'lateral', // the row gate reads as depth, but the kind leans lateral
  cross: 'depth',
  surge: 'depth',
  donut: 'radial',
  duckdonut: 'radial',
  nova: 'compass',
  sweep: 'duck',
  routine: 'corners',
  wave: 'travel', // the whole-deck crossing — its own verb, never damped
};

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
    if (k === 'duckdonut' && banned.includes('sweep')) continue; // no duck → no combo
    if (k === last) continue; // NEVER the same move twice running
    const weights = MOVES[k].weights;
    let w = weights[Math.min(act, weights.length - 1)];
    if (w <= 0) continue;
    if (last && VERB[k] === VERB[last]) w *= 0.35; // same verb, new face — still a rut
    pool.push([k, w]);
    total += w;
  }
  let roll = rng() * total;
  for (const [k, w] of pool) {
    roll -= w;
    if (roll <= 0) return k;
  }
  return pool[0]?.[0] ?? 'beam';
}

/** Build one move's landings from the seeded rng (seat-local pattern).
 *  `sweptRoutines` is the chart-wide coin for THE SWEPT ROUTINE — rolled
 *  once per song, so some expert nights carry it and some never do. */
function buildLandings(
  kind: MoveKind,
  landBeat: number,
  act: number,
  rng: () => number,
  sweptRoutines = false,
): Landing[] {
  const landings: Landing[] = [];
  if (kind === 'beam') {
    const halfW = CHOREO.beamHalfWidth;
    const laneAt = (beat: number, x: number) => landings.push({ beat, zone: { kind: 'lane', x, halfW } });
    const lane = (x: number) => laneAt(landBeat, x);
    if (act < 2) {
      // One laser, and it lands on a SLOT: the middle, or a third out.
      lane(CHOREO.beamSlots[Math.floor(rng() * CHOREO.beamSlots.length)]);
    } else if (rng() < CHOREO.beamXChance[Math.min(act, CHOREO.beamXChance.length - 1)]) {
      // THE X: two beams thrown diagonally at once, crossing dead centre.
      // The safe ground is the four pockets between the arms — the dodge
      // is radial, out of the cross, not a sidestep off a line. The arms
      // run thin so the pockets are real rooms, not slivers.
      const xw = CHOREO.beamXHalfW;
      landings.push({ beat: landBeat, zone: { kind: 'lane', x: 0, halfW: xw, yaw: Math.PI / 4 } });
      landings.push({ beat: landBeat, zone: { kind: 'lane', x: 0, halfW: xw, yaw: -Math.PI / 4 } });
    } else if (rng() < CHOREO.beamSplitChance[Math.min(act, CHOREO.beamSplitChance.length - 1)]) {
      // SPLIT: evenly spaced either side of centre. What's left is a
      // corridor down the middle — the dodge is to stand BETWEEN them.
      lane(-CHOREO.beamSplitX);
      lane(CHOREO.beamSplitX);
    } else {
      // TWIN: two strips shoulder to shoulder, taking one whole side and
      // the middle with them. No corridor, no choice — get across.
      const s = rng() < 0.5 ? 1 : -1;
      const inner = CHOREO.beamTwinInner;
      const outer = CHOREO.beamTwinInner + halfW * 2 + 0.02;
      lane(s * inner);
      lane(s * outer);
      // THE RETURN: a bar later the same pair lands MIRRORED, on the ground
      // the first pair just chased you onto. Across, and straight back —
      // one move that uses the whole width of the deck instead of parking
      // you on the far side with nothing left to ask.
      if (rng() < CHOREO.twinReturnChance[Math.min(act, CHOREO.twinReturnChance.length - 1)]) {
        const back = landBeat + CHOREO.twinReturnBeats;
        laneAt(back, -s * inner);
        laneAt(back, -s * outer);
      }
    }
  } else if (kind === 'donut') {
    // THE ONE-TWO: a laser straight down the middle drives everyone off
    // centre, and a bar later the rim closes and the middle is the only
    // ground left. Out, then back — the whole deck used in four beats.
    // (The ring's own telegraph holds off until the laser has fired; see
    // ChoreoSystem, which gates the second stage's window.)
    const innerR =
      act >= 4 ? CHOREO.donutInnerRExpert : act >= 3 ? CHOREO.donutInnerRLate : CHOREO.donutInnerR;
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
    // THE TRAP (late acts, on a roll): TWO rails on the same beat, one
    // from each side emitter, symmetric about the centreline — the safe
    // ground is the corridor pinned between them. Sideways lasers that
    // close like jaws; the read is the gap.
    const trapChance = CHOREO.railTrapChance[Math.min(act, CHOREO.railTrapChance.length - 1)];
    if (rng() < trapChance) {
      landings.push({
        beat: landBeat,
        zone: { kind: 'rail', z: -CHOREO.railTrapZ, halfD: CHOREO.railHalfDepth, from: -1 },
      });
      landings.push({
        beat: landBeat,
        zone: { kind: 'rail', z: CHOREO.railTrapZ, halfD: CHOREO.railHalfDepth, from: 1 },
      });
      return landings;
    }
    // THE VERTICAL TWIN: the beam's twin, quarter-turned. Two rails
    // shoulder to shoulder take one whole HALF — both from the same
    // emitter, one battery firing a pair — and the RETURN mirrors them onto
    // the other half a bar later. Two at the back, then two at the front:
    // the deck's front/back answer to the lateral twin's walk across, and
    // the surest way to make a floor that only ever sidesteps travel.
    const twinChance = CHOREO.railTwinChance[Math.min(act, CHOREO.railTwinChance.length - 1)];
    if (rng() < twinChance) {
      const halfD = CHOREO.railHalfDepth;
      const inner = CHOREO.railTwinInner;
      const outer = CHOREO.railTwinInner + halfD * 2 + 0.02;
      const s: 1 | -1 = rng() < 0.5 ? 1 : -1; // +1 floods the back, −1 the front
      const from: 1 | -1 = rng() < 0.5 ? 1 : -1;
      const pair = (beat: number, side: number, emitter: 1 | -1) => {
        landings.push({ beat, zone: { kind: 'rail', z: side * inner, halfD, from: emitter } });
        landings.push({ beat, zone: { kind: 'rail', z: side * outer, halfD, from: emitter } });
      };
      pair(landBeat, s, from);
      if (rng() < CHOREO.twinReturnChance[Math.min(act, CHOREO.twinReturnChance.length - 1)]) {
        // The answering battery fires from the OTHER rail, so the return
        // announces itself as a new machine rather than a repeat.
        pair(landBeat + CHOREO.twinReturnBeats, -s, from === 1 ? -1 : 1);
      }
      return landings;
    }
    // A single rail always lands on the FRONT half (toward the stage,
    // where your eyes already are) — one strip behind your back was a
    // read nobody should be asked to make. The trap and the wave keep
    // their rear ground: both telegraph as a whole-deck event.
    const z = -(CHOREO.railOffsetMin + rng() * (CHOREO.railOffsetMax - CHOREO.railOffsetMin));
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
    // THE SWEPT ROUTINE (act 4, on the charts that carry it): every blast
    // arrives under the sweep's blade — stand in the taught corner AND
    // duck on each tick. The memory test and the limbo, one body.
    const swept = sweptRoutines && act >= 4;
    routine.forEach((corner, step) => {
      const beat = landBeat + step * CHOREO.routineStepBeats;
      landings.push({ beat, zone: { kind: 'quad', corner, step, routine } });
      if (swept) landings.push({ beat, zone: { kind: 'sweep' } });
    });
  } else if (kind === 'wave') {
    // THE WAVE: beams marching 1-2-3 across the deck — travel with the
    // march into the EXIT: the last quarter never fires, so the crossing
    // has a destination instead of a countdown. Sideways (lanes walking x)
    // or front/back (rails walking z); each stop's telegraph runs the
    // beam's own short fuse, staggered, so the deck reads as a wave
    // building.
    //
    // THE TURN — on every wave: the march wheels AT the exit and comes
    // back. Its first return strike is the exit square itself, a double
    // step plus one whole beat late (you only just got there; the
    // breather is the read), and the new exit is the far side where the
    // whole thing began. Across, and all the way back.
    const axis: 0 | 1 = rng() < 0.5 ? 1 : 0;
    const step = CHOREO.waveStepBeats[Math.min(act, CHOREO.waveStepBeats.length - 1)];
    const stops = axis ? CHOREO.waveRailZ : CHOREO.waveLaneX;
    const ordered = rng() < 0.5 ? [...stops] : [...stops].reverse();
    const at: number[] = ordered.slice(0, -1); // out over three; exit = ordered[3]
    const beats: number[] = at.map((_, i) => landBeat + i * step);
    const turnAt = beats[beats.length - 1] + step * 2 + CHOREO.waveTurnExtraBeats;
    [ordered[3], ordered[2], ordered[1]].forEach((stop, i) => {
      at.push(stop);
      beats.push(turnAt + i * step);
    });
    const from: 1 | -1 = rng() < 0.5 ? 1 : -1;
    at.forEach((stop, i) => {
      landings.push({
        beat: beats[i],
        zone: axis
          ? { kind: 'rail', z: stop, halfD: CHOREO.railHalfDepth, from }
          : { kind: 'lane', x: stop, halfW: CHOREO.beamHalfWidth },
      });
    });
  } else if (kind === 'duckdonut') {
    // THE COMBINATION: the rim floods AND the blade hangs over the middle
    // — get to the centre and DUCK there. Both zones detonate together;
    // both answers are ones the set already taught.
    landings.push({ beat: landBeat, zone: { kind: 'sweep' } });
    landings.push({ beat: landBeat, zone: { kind: 'donut', innerR: CHOREO.donutInnerR } });
  } else if (kind === 'sweep') {
    landings.push({ beat: landBeat, zone: { kind: 'sweep' } });
  } else if (kind === 'gate') {
    // The doorway — or, half the time, its horizontal cousin: a clear ROW
    // at a depth line, so the gap asks for a forward/back step instead.
    // The gap never sits over the middle: a doorway you're probably
    // already standing in asks for nothing.
    const axis: 0 | 1 = rng() < 0.5 ? 1 : 0;
    const span = axis ? 0.35 : 0.5;
    const off = CHOREO.gateOffsetMin + rng() * (span - CHOREO.gateOffsetMin);
    landings.push({
      beat: landBeat,
      zone: {
        kind: 'gate',
        at: (rng() < 0.5 ? 1 : -1) * off,
        half: act >= 4 ? CHOREO.gateHalfWExpert : act >= 3 ? CHOREO.gateHalfWLate : CHOREO.gateHalfW,
        axis,
      },
    });
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
    const halfAngle =
      act >= 4 ? CHOREO.novaHalfAngleExpert : act >= 3 ? CHOREO.novaHalfAngleLate : CHOREO.novaHalfAngle;
    let bearing = rng() * Math.PI * 2;
    const turn = (rng() < 0.5 ? 1 : -1) * CHOREO.novaChainTurn;
    for (let i = 0; i < slices; i++) {
      landings.push({ beat: landBeat + i * CHOREO.novaChainBeats, zone: { kind: 'nova', bearing, halfAngle } });
      bearing += turn;
    }
  }
  return landings;
}

/* ── THE FLOOR MANAGER ──────────────────────────────────────────────────
 * The set-list can't see the player (every deck runs the identical chart),
 * but it CAN know where each move's correct dodge PARKS a dancer who plays
 * it right: the split's corridor parks you dead centre, the seesaw leaves
 * you hugging the centreline, the donut ends in the middle by definition.
 * So the generator carries that parking spot forward and re-rolls any move
 * whose danger never touches it — a move that asks nothing of the ground
 * you're standing on is a move that didn't happen. A `null` park means
 * "somewhere unknowable" (the nova's wedge is a different place on every
 * deck) and accepts anything.
 */
export type Park = { x: number; z: number } | null;

function laneCovers(zone: { x: number; halfW: number; yaw?: number }, p: { x: number; z: number }): boolean {
  const yaw = zone.yaw ?? 0;
  const perp = yaw ? Math.cos(yaw) * p.x - Math.sin(yaw) * p.z : p.x;
  return Math.abs(perp - zone.x) <= zone.halfW + 0.12;
}

/** Does any landing of this move touch the park — i.e., demand something
 *  of a dancer standing exactly where the last move left them? */
export function evictsPark(landings: readonly Landing[], park: Park): boolean {
  if (!park) return true;
  return landings.some(({ zone }) => {
    switch (zone.kind) {
      case 'lane':
        return laneCovers(zone, park);
      case 'rail':
        return Math.abs(park.z - zone.z) <= zone.halfD + 0.12;
      case 'donut':
        return Math.hypot(park.x, park.z) > zone.innerR - 0.05;
      case 'gate':
        return Math.abs((zone.axis ? park.z : park.x) - zone.at) > zone.half - 0.05;
      case 'half':
        return (zone.axis ? park.z : park.x) * zone.side > -0.06;
      case 'sweep': // the duck is a demand wherever you stand
      case 'nova': // dead centre is never safe, and the wedge rotates per seat
      case 'quad': // the routine makes you commit, corner to corner
        return true;
    }
  });
}

/** Where this move's correct dodge leaves a dancer standing. */
export function parkOf(kind: MoveKind, landings: readonly Landing[], prev: Park): Park {
  const p = prev ?? { x: 0, z: 0 };
  const cx = (x: number) => Math.max(-0.7, Math.min(0.7, x));
  const cz = (z: number) => Math.max(-0.6, Math.min(0.6, z));
  switch (kind) {
    case 'sweep':
      return prev; // ducked in place — nobody moved
    case 'donut':
    case 'duckdonut':
      return { x: 0, z: 0 }; // hauled into the middle by definition
    case 'nova':
      return null; // the wedge is a different place on every deck
    case 'routine': {
      const quads = landings.filter((l) => l.zone.kind === 'quad');
      const lastQ = quads[quads.length - 1]?.zone;
      if (lastQ?.kind !== 'quad') return prev;
      return { x: (lastQ.corner & 1 ? 1 : -1) * 0.45, z: (lastQ.corner & 2 ? 1 : -1) * 0.4 };
    }
    case 'seesaw':
    case 'surge': {
      // Crossers hug the line — the seesaw centre-parks as surely as the
      // donut does, which is exactly why the manager has to know it.
      const lastH = landings[landings.length - 1].zone;
      if (lastH.kind !== 'half') return prev;
      const coord = -lastH.side * 0.22;
      return lastH.axis ? { x: p.x, z: coord } : { x: coord, z: p.z };
    }
    case 'gate': {
      const g = landings[0].zone;
      if (g.kind !== 'gate') return prev;
      return g.axis ? { x: p.x, z: g.at } : { x: g.at, z: p.z };
    }
    case 'wave': {
      // Every wave turns, so the final exit is the ground where the march
      // BEGAN — the first stop's square.
      const first = landings[0].zone;
      if (first.kind === 'rail') return { x: p.x, z: first.z };
      if (first.kind === 'lane') return { x: first.x, z: p.z };
      return prev;
    }
    case 'cross': {
      // Only the LAST volley decides where you end up: a vertical twin that
      // returns chases you off one half and then off the other.
      const all: { beat: number; z: number; halfD: number }[] = [];
      for (const l of landings) if (l.zone.kind === 'rail') all.push({ beat: l.beat, ...l.zone });
      const lane = landings.find((l) => l.zone.kind === 'lane')?.zone;
      const x = lane?.kind === 'lane' ? cx(lane.x + (p.x >= lane.x ? 1 : -1) * (lane.halfW + 0.2)) : p.x;
      if (!all.length) return { x, z: p.z };
      const lastBeat = Math.max(...all.map((r) => r.beat));
      const rails = all.filter((r) => r.beat === lastBeat);
      if (rails.length >= 2) {
        // Opposite sides of centre is THE TRAP — the jaws leave a corridor
        // down the middle. Same side is the TWIN, which leaves you a whole
        // half and no corridor at all.
        return rails[0].z * rails[1].z < 0
          ? { x, z: 0 }
          : { x, z: -Math.sign(rails[0].z || rails[1].z) * 0.42 };
      }
      return { x, z: cz(rails[0].z + rails[0].halfD + 0.3) }; // step off, away from the stage
    }
    case 'beam': {
      const all: { beat: number; x: number; halfW: number; yaw?: number }[] = [];
      for (const l of landings) if (l.zone.kind === 'lane') all.push({ beat: l.beat, ...l.zone });
      if (!all.length) return prev;
      // A twin that RETURNS lands twice: only the second pair decides where
      // the dodge finally leaves you standing.
      const lastBeat = Math.max(...all.map((l) => l.beat));
      const lanes = all.filter((l) => l.beat === lastBeat);
      if (lanes.some((l) => l.yaw)) {
        // THE X: the nearest pocket between the arms.
        const pockets = [
          { x: 0.55, z: 0 },
          { x: -0.55, z: 0 },
          { x: 0, z: 0.5 },
          { x: 0, z: -0.5 },
        ];
        let best = pockets[0];
        let bd = Infinity;
        for (const q of pockets) {
          const d = Math.hypot(q.x - p.x, q.z - p.z);
          if (d < bd) {
            bd = d;
            best = q;
          }
        }
        return best;
      }
      if (lanes.length === 2) {
        return lanes[0].x * lanes[1].x < 0
          ? { x: 0, z: p.z } // SPLIT: the corridor parks you dead centre
          : { x: -Math.sign(lanes[0].x || lanes[1].x) * 0.5, z: p.z }; // TWIN: the empty side
      }
      const s = lanes[0]?.x ?? 0;
      const side = p.x >= s ? 1 : -1; // step off the short way
      return { x: cx(s + side * ((lanes[0]?.halfW ?? 0.24) + 0.24)), z: p.z };
    }
  }
}

/**
 * The full raid set. Pure function of (seed, phrases, banned, difficulty)
 * — every client, and every rewatch of the same seed, gets the identical
 * show. `banned` comes from the record on the decks (tracks.ts): some
 * songs simply never call certain moves.
 */
export function generateSetlist(
  seed: number,
  phrases: number,
  banned: readonly MoveKind[] = [],
  difficulty = 1,
): SetMove[] {
  const rng = mulberry32(mix(seed, 0xc03e0));
  const moves: SetMove[] = [];
  // THE SWEPT ROUTINE is a per-CHART coin: some expert nights carry it,
  // some never do — the hardest challenges stay distinct records, not a
  // constant garnish. (Rolled for every chart so the stream stays aligned;
  // it only ever bites at act 4.)
  const sweptRoutines = rng() < CHOREO.routineSweepChance;
  // Two bars of dancing, then the show starts: the first telegraph blooms at
  // bar 2 and the first landing hits the bar-3 downbeat — you're dodging
  // within seconds of the drop, not a phrase later.
  let cursor = MUSIC.introBars * barBeats;
  let last: MoveKind | null = null;
  let park: Park = { x: 0, z: 0 }; // everyone spawns dead centre
  let index = 0;

  for (let phrase = 0; phrase < phrases; phrase++) {
    const act = actOfPhrase(phrase, phrases, difficulty);
    const want = CHOREO.movesPerPhrase[Math.min(act, CHOREO.movesPerPhrase.length - 1)];
    const phraseEnd = (phrase + 1) * phraseBeats;
    const rest = CHOREO.restBeats[Math.min(act, CHOREO.restBeats.length - 1)];

    for (let m = 0; m < want; m++) {
      let kind = pickKind(rng, act, last, banned);
      let charge = MOVES[kind].chargeBeats;
      // Land on the next bar downbeat that the telegraph fits in front of.
      let landBeat = Math.ceil((cursor + charge) / barBeats) * barBeats;
      let landings = buildLandings(kind, landBeat, act, rng, sweptRoutines);
      // THE FLOOR MANAGER: a move whose danger never touches the ground
      // the last move parked you on asks for nothing — roll another shape
      // (same seeded stream, so every client re-rolls identically).
      for (let attempt = 0; attempt < 6 && !evictsPark(landings, park); attempt++) {
        kind = pickKind(rng, act, last, banned);
        charge = MOVES[kind].chargeBeats;
        landBeat = Math.ceil((cursor + charge) / barBeats) * barBeats;
        landings = buildLandings(kind, landBeat, act, rng, sweptRoutines);
      }
      if (landBeat >= phraseEnd + barBeats) break; // phrase is full — move on
      moves.push({ index: index++, kind, telegraphBeat: landBeat - charge, landBeat, landings, act });
      park = parkOf(kind, landings, park);
      last = kind;
      cursor = landings[landings.length - 1].beat + rest;
    }
  }
  return moves;
}

