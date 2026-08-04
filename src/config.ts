/**
 * GOOPLIATH: DANCE RAID — every number the feel depends on.
 *
 * The game: a passthrough techno rave in your real room. Up to 24 dancers
 * stand on octagonal platforms ringed around one giant gel creature — the
 * GOOPLIATH — who dances on a stage in the middle and throws beat-quantized
 * moves that mark EVERY platform at the same time. You don't fight back.
 * You read the floor, move with the rhythm, and outlast everyone else.
 *
 * Dodge → combo climbs → points multiply. Get clipped → combo dies, one of
 * three lives gone. Three hits and you're off the floor. A live holo
 * leaderboard rings the stage; the top ten dance on raised platforms and the
 * current champion above them all.
 *
 * Dimensions are metres. Times are expressed in BEATS wherever the music
 * rules (the whole game is quantized to the track).
 */

import type { Vector2Tuple } from 'three';

export const GAME_TITLE = 'GOOPLIATH: DANCE RAID';

/* ────────────────────────────── THE MUSIC ────────────────────────────────
 * The set is a REAL TRACK (see audio/tracks.ts — measured tempo, downbeat
 * and loudness per file). The whole game hangs off its beat clock, and a
 * track's length decides how long the set runs. audio/techno.ts survives as
 * a synthesised fallback for any browser that can't decode a file.
 */
export const MUSIC = {
  /** Only used when a track can't be decoded and the synth takes over. */
  fallbackBpm: 128,
  beatsPerBar: 4,
  barsPerPhrase: 8, // the choreography thinks in 8-bar phrases
  /** Bars of pure dancing before the first landing — the first telegraph is
   *  already blooming seconds after the drop. */
  introBars: 2,
  /** Master music level (the sfx bus is its own knob in audio/sfx.ts). */
  volume: 0.6,
};

export const beatSeconds = (bpm: number): number => 60 / bpm;

/**
 * Count-in length in beats, sized in SECONDS so slow records don't dawdle:
 * ~3 s of "the set drops in" whatever the tempo (MONEY at 78 BPM used to
 * hold you for six seconds; LOOP at 150 still gets its full two bars).
 */
export function countInBeatsFor(bpm: number): number {
  return Math.max(4, Math.min(8, Math.ceil(3.0 / (60 / bpm))));
}

/* ────────────────────────────── THE RING ─────────────────────────────────
 * Platforms stand on one circle around the boss stage. Every client sees
 * ITSELF at the world origin facing −Z (the headset can't be teleported),
 * so the canonical ring is re-expressed per seat — and because every seat
 * faces the centre at the same radius, the GOOPLIATH lands at (0,0,−R) in
 * every player's frame and the whole boss/choreo stack runs unchanged per
 * client. Only the OTHER dancers' platforms need seat transforms.
 */
export const RING = {
  minSeats: 4,
  maxSeats: 24,
  defaultSeats: 12,
  /** Centre-to-centre air between neighbouring platforms on the circle. */
  seatSpacing: 2.7,
  /** The ring never tightens below this radius even with 4 dancers. */
  minRadius: 4.6,
  /** The boss stage: a round podium in the middle. */
  stageRadius: 2.6,
  stageHeight: 0.35,
};

/** Ring radius for a seat count: keep neighbour spacing honest. */
export function ringRadius(seats: number): number {
  return Math.max(RING.minRadius, (seats * RING.seatSpacing) / (Math.PI * 2));
}

/**
 * The dancer's octagonal platform — the Blaston play-space footprint carried
 * over from FIRE FIGHT (~1.72 × 1.5 m, chamfered corners). The whole dodge
 * game happens inside this slab.
 */
export const OCTAGON_HALF_WIDTH = 0.86;
export const OCTAGON_HALF_DEPTH = 0.75;
const EDGE_HALF = 0.375;
const CHAMFER = 0.375;

export const OCTAGON_VERTICES: Vector2Tuple[] = [
  [-EDGE_HALF, -OCTAGON_HALF_DEPTH],
  [EDGE_HALF, -OCTAGON_HALF_DEPTH],
  [OCTAGON_HALF_WIDTH, -CHAMFER],
  [OCTAGON_HALF_WIDTH, CHAMFER],
  [EDGE_HALF, OCTAGON_HALF_DEPTH],
  [-EDGE_HALF, OCTAGON_HALF_DEPTH],
  [-OCTAGON_HALF_WIDTH, CHAMFER],
  [-OCTAGON_HALF_WIDTH, -CHAMFER],
];

/** Platform slab + neon trim. */
export const PLATFORM = {
  thickness: 0.14,
  rimLift: 0.012,
};

/** Floor decals hover here, clear of the deck furniture. */
export const DECAL_Y = 0.05;

/* ─────────────────────────────── THE BOSS ────────────────────────────────
 * The gel sim always runs man-sized (1.78 m) inside a scaled parent group —
 * identical trick to the FIRE FIGHT boss — so every wobble keeps the
 * creature's true proportions.
 */
export const GOOP = {
  /** Parent-group scale: ~4.3 m of dancing gel on the centre stage. */
  scale: 2.4,
  /** The sim clock runs slow so the giant reads as tons of gel, not jelly. */
  timeScale: 0.55,
  /** Raymarch step budget (the single biggest perf knob on Quest). */
  quality: 0.85,
  /** Step budget while a gesture is mid-swing (limb stretches balloon the
   *  raymarch bounds — drop quality exactly then). */
  attackQuality: 0.5,
  /** Gesture swings stay basically inside his silhouette (reach in body
   *  units from his centre) — the floor zones carry the danger. */
  gestureReach: 0.5,
  /** How hard he bounces to the beat at rest (sim agitation pulse). */
  danceBounce: 0.35,
};

/* ─────────────────────────────── THE MOVES ───────────────────────────────
 * Every move telegraphs on EVERY live platform at once and lands ON a
 * downbeat. The windup is sacred: escalation compresses the gaps between
 * moves, never the read. Charges are in beats (at 128 BPM a beat is 469 ms).
 *
 *  slam   : discs mark spots on your deck — STEP clear.
 *  beam   : a strip rakes across the deck — SIDESTEP off the lane.
 *  sweep  : a horizontal blade at chest height — DUCK under it.
 *  seesaw : one half floods, then the other — CROSS the centreline (left/right).
 *  surge  : the seesaw's cousin, front/back.
 *  nova   : everything burns EXCEPT one wedge at a shared compass bearing —
 *           the whole ring rotates to the same safe ground together.
 */
export type MoveKind = 'slam' | 'beam' | 'sweep' | 'seesaw' | 'surge' | 'nova';

export const MOVES: Record<
  MoveKind,
  {
    /** Telegraph length in beats (act 0 baseline; acts may stretch it). */
    chargeBeats: number;
    /** Weight in the seeded set-list roll, per act (index clamps). */
    weights: number[];
  }
> = {
  // The slam is deliberately RARE and LATE: it fits, but it was opening
  // nearly every set and never letting up. Sweeps and beams carry the
  // early acts now; the drumline is a mid-set guest, not the doorman.
  slam: { chargeBeats: 4, weights: [1, 3, 2, 2] },
  beam: { chargeBeats: 4, weights: [2, 3, 3, 3] },
  sweep: { chargeBeats: 4, weights: [3, 3, 3, 3] },
  seesaw: { chargeBeats: 4, weights: [0, 3, 4, 4] },
  surge: { chargeBeats: 4, weights: [0, 0, 2, 3] },
  nova: { chargeBeats: 8, weights: [0, 0, 2, 3] },
};

export const CHOREO = {
  /** Slam disc radius on the deck. */
  slamRadius: 0.34,
  /** Extra beats between multi-disc slam landings (the drumline). */
  slamStepBeats: 1,
  /** Beam lane half-width. */
  beamHalfWidth: 0.24,
  /** The sweep blade's rendered height (judgement is duck-state, not metres,
   *  so every body height plays the same game). */
  sweepY: 1.42,
  sweepThickness: 0.19,
  /** Head below this fraction of your calibrated standing height = ducked. */
  duckFrac: 0.78,
  /** Seesaw/surge: beats between half-floods per act. Whole bars early,
   *  half-bars late — every flood lands where the music actually hits (a
   *  3-beat gap straddled the grid and read as random). */
  seesawGapBeats: [4, 4, 2, 2],
  /** Forgiveness strip either side of the centreline (m). */
  seesawSafeLip: 0.06,
  /** Nova safe-wedge half-angle (radians); tightens in the last act. */
  novaHalfAngle: 0.6,
  novaHalfAngleLate: 0.45,
  novaRadius: 1.15,
  /** Moves per phrase by act — the escalation curve. */
  movesPerPhrase: [2, 3, 4, 5],
  /** Minimum clear beats between one landing and the next telegraph —
   *  bar/half-bar multiples so successive moves stay on the grid. */
  restBeats: [4, 4, 2, 2],
  /**
   * Act boundaries as a FRACTION of the set, not fixed phrase numbers —
   * the tracks run 2 to 4 minutes, so the escalation curve has to stretch
   * to whatever record is on. Act 0 opens, act 3 is the last fifth.
   */
  actAtProgress: [0, 0.25, 0.55, 0.8],
};

/* ────────────────────────────── THE GROOVE ───────────────────────────────
 * Dance like the groupies dance: ONE HAND UP, ONE HAND DOWN, and swap on
 * the beat. Every rhythmic swap pays a little — and the payout creeps up
 * the longer you keep the motion going. It never rivals a dodge; it's the
 * tax refund for actually dancing between them.
 */
export const GROOVE = {
  /** Vertical hand separation (m) that counts as "one up, one down". */
  split: 0.35,
  /** Points for a rhythmic swap. */
  base: 6,
  /** Extra points per streak step — the consistency creep. */
  perStreak: 0.5,
  /** Streak stops growing here (base + 50 = 56 a swap at full groove). */
  streakCap: 100,
  /** A swap must land this many beats after the last to stay in the groove. */
  minBeats: 0.4,
  maxBeats: 2.6,
};

/* ────────────────────────────── THE SCORE ────────────────────────────────
 * Survive a landing → a DODGE: points × combo multiplier, combo +1.
 * Get clipped → lose a life, combo dies, brief i-frames. Three and out.
 * A PERFECT is a last-instant dodge: you were still inside the doomed zone
 * one beat before impact and clear when it landed — riding the beat.
 */
export const SCORE = {
  base: 100,
  perfectMult: 1.5,
  comboStep: 0.1, // multiplier = 1 + comboStep × min(combo, comboCap)
  comboCap: 30, // → ×4 ceiling
  lives: 3,
  invulnBeats: 2,
  /** Sample "were you inside the zone" this many beats before impact. */
  perfectProbeBeats: 1,
  /** Survival tick: staying alive pays a trickle every bar so late-game
   *  rankings separate even between flawless dancers. */
  aliveBarBonus: 10,
};

/* ─────────────────────────────── THE RANK ────────────────────────────────
 * Alive beats eliminated; among the living, score; among the fallen, who
 * lasted longest. The top ten dance raised above the floor and the current
 * champion above them — platform heights are rendered RELATIVE to your own
 * (your real floor never moves; the ring moves around you).
 */
export const RANK = {
  championLift: 0.85,
  topTenLift: 0.42,
  /** Eliminated platforms sink and dim. */
  outSink: -0.35,
  /** Height easing rate (per second). */
  lerp: 1.6,
  /** Rank recompute cadence (seconds). */
  refresh: 0.25,
};

/* ────────────────────────────── THE PODIUM ───────────────────────────────
 * When the set ends (or one dancer remains) the winner takes the high
 * ground, confetti cannons fire, and the board freezes for the reading.
 */
export const PODIUM = {
  holdSeconds: 18,
};

/* ────────────────────────────── THE CAMPAIGN ─────────────────────────────
 * REHEARSAL: a small map of goop creatures, each teaching ONE move at a
 * gentle BPM. Clear a creature by surviving `clears` of its move; the last
 * node opens the full raid. Progress lives in localStorage.
 */
export interface GooplingDef {
  id: string;
  name: string;
  epithet: string;
  move: MoveKind;
  /** Creature scale (the raid boss is 2.4). */
  scale: number;
  /** Which record this lesson runs on (audio/tracks.ts) — its measured
   *  tempo sets the pace, so the row steps up 91 → 117 → 135 BPM. */
  trackId: string;
  clears: number;
  /** What the card tells you. */
  lesson: string;
}

export const GOOPLINGS: GooplingDef[] = [
  {
    id: 'step',
    name: 'GOOPLET',
    epithet: 'the puddle prodigy',
    move: 'slam',
    scale: 1.0,
    trackId: 'target',
    clears: 6,
    lesson: 'Discs mark where the goo lands.\nSTEP OFF the glow before the drop.',
  },
  {
    id: 'lane',
    name: 'DRIZZLE',
    epithet: 'the laser sommelier',
    move: 'beam',
    scale: 1.15,
    trackId: 'target',
    clears: 6,
    lesson: 'A lane of light rakes the deck.\nSIDESTEP out of the strip.',
  },
  {
    id: 'duck',
    name: 'SLOSHA',
    epithet: 'the limbo queen',
    move: 'sweep',
    scale: 1.3,
    trackId: 'capture',
    clears: 6,
    lesson: 'A blade of goo sweeps head-high.\nDUCK — get LOW and hold it.',
  },
  {
    id: 'cross',
    name: 'BIG SPILL',
    epithet: 'the tide turner',
    move: 'seesaw',
    scale: 1.6,
    trackId: 'capture',
    clears: 8,
    lesson: 'Half the deck floods, then the other.\nCROSS the centreline on the beat.',
  },
  {
    id: 'compass',
    name: 'GLOBULON',
    epithet: 'the wedge preacher',
    move: 'nova',
    scale: 1.9,
    trackId: 'combat',
    clears: 4,
    lesson: 'Everything burns except one wedge.\nSTAND in the marked safe ground.',
  },
];

export const CAMPAIGN_KEY = 'gdr-campaign';

/* ─────────────────────────────── THE BOTS ────────────────────────────────
 * Empty seats are filled with goo-groupies — seeded, deterministic dancers
 * every client simulates identically (no bot netcode: same seed, same
 * outcome, same leaderboard everywhere).
 */
export const BOTS = {
  /** Dodge chance range rolled per bot from the match seed. */
  skillMin: 0.7,
  skillMax: 0.96,
  /** Dodge chance shrinks by this per act (the floor thins as the set peaks). */
  actPenalty: 0.05,
  names: [
    'MC WOBBLE', 'JELLY ROLL', 'GLUCOSE', 'SLIME BOOTS', 'DJ OOZE',
    'GEL-VIS', 'BOUNCEHAUS', 'THE BLOBFATHER', 'MISS SQUISH', 'GOOTHYK',
    'LORD LAVA LAMP', 'PECTIN', 'WIGGLETRON', 'AGAR AGAR', 'FLUBBERINA',
    'SIR OSMOSIS', 'TAPIOCA', 'GLOOPI GOTH', 'VISCOSA', 'THE MARMALADE',
    'PLASMA PAM', 'GUNK FUNK', 'SLURP DOGG',
  ],
};

/* ─────────────────────────────── THE LOOK ────────────────────────────────
 * An absolute disco: neon on passthrough. Everything additive — a bloom-ish
 * glow without post-processing.
 */
export const PALETTE = {
  goopGreen: 0x36e05a,
  goopDeep: 0x14602f,
  magenta: 0xff2ad5,
  cyan: 0x4fb7ff,
  violet: 0xb06bff,
  amber: 0xffb000,
  danger: 0xe8352a,
  whiteHot: 0xfff3cf,
  white: 0xf4f6fb,
  mirror: 0xcfd8e6,
};

/**
 * PALETTE DISCIPLINE — how you tell an attack from the party:
 * danger speaks ONLY hazard amber→red (telegraphs, beams, novas) and goo
 * green (the gel itself arriving); the disco speaks magenta/cyan/violet.
 * The two vocabularies never share a colour, and while a telegraph charges
 * on YOUR deck the disco DUCKS (lasers and shafts fade to a quarter) so the
 * warning owns the room.
 */

/**
 * ROOM DIM — the Laser Dance move: darken the passthrough so the neon owns
 * your real room. WebXR can't dim the camera feed itself, so we draw an
 * enormous inside-out black shell behind everything; the compositor
 * alpha-blends it over the passthrough and the whole room drops to club
 * lighting. Three levels, cycled from the lobby panel, persisted.
 */
export const ROOM_DIM = {
  levels: [0, 0.45, 0.72],
  names: ['OFF', 'CLUB', 'CAVE'],
  defaultLevel: 1,
  /** The lobby keeps a little more of your room than the live set does. */
  lobbyFactor: 0.7,
  /** Subtle breathe on the kick while the set is live (kept tiny). */
  beatPulse: 0.05,
  key: 'gdr-room-dim',
};

/** Laser fan hues cycled by the light rig. */
export const LASER_HUES = [0.9, 0.55, 0.75, 0.33, 0.12];

/** Seat accent hue: golden-angle walk around the wheel — 24 distinct neons. */
export function seatHue(seat: number): number {
  return (seat * 0.381966) % 1;
}

/** hue (0..1) → saturated neon colour. */
export function hueToColor(hue: number, light = 0.55): number {
  const h = (((hue % 1) + 1) % 1) * 6;
  const l = Math.max(0.2, Math.min(0.9, light));
  const c = (1 - Math.abs(2 * l - 1)) * 1;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 1) {
    r = c;
    g = x;
  } else if (h < 2) {
    r = x;
    g = c;
  } else if (h < 3) {
    g = c;
    b = x;
  } else if (h < 4) {
    g = x;
    b = c;
  } else if (h < 5) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const R = Math.round((r + m) * 255);
  const G = Math.round((g + m) * 255);
  const B = Math.round((b + m) * 255);
  return (R << 16) | (G << 8) | B;
}

/* ────────────────────────────── NETWORKING ───────────────────────────────
 * Optional — the game is fully playable solo against the groupies. With a
 * relay up (npm run server) you host a room, share the 4-letter code, and
 * the server hands everyone a seat, the seed and a shared start time. The
 * whole choreography is deterministic from the seed, so the wire only
 * carries poses, hits and scores.
 */
export const NET = {
  poseRateHz: 10,
  scoreRateHz: 3,
  smoothing: 14,
  defaultPort: 8788,
};

export function serverUrl(): string {
  const param = new URLSearchParams(location.search).get('server');
  if (param) return param;
  try {
    const stored = localStorage.getItem('gdr-server');
    if (stored) return stored;
  } catch {
    /* storage may be unavailable */
  }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.hostname}:${NET.defaultPort}`;
}
