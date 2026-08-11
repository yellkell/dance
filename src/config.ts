/**
 * GOOPLIATH: DANCE RAID — every number the feel depends on.
 *
 * The game: a full-VR techno rave over your real floor. Up to 24 dancers
 * stand on octagonal platforms ringed around one giant gel creature — the
 * GOOPLIATH — who dances on a stage in the middle and throws beat-quantized
 * moves that mark EVERY platform at the same time. You don't fight back.
 * You read the floor, move with the rhythm, and outlast everyone else.
 *
 * Dodge → the chain climbs → points multiply. Get clipped → the chain
 * dies. There are no lives: you dance the whole record and the night
 * GRADES you at the end, S to F, on the share of landings you survived.
 * The one way to end early is three clipped landings BACK TO BACK — a
 * dodge wipes that count, so it's a chain, not a budget. Dancing in
 * rhythm builds the COMBO for bonus points. A live holo leaderboard rings
 * the stage; the top ten dance on raised platforms and the current
 * champion above them all.
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
  /** The boss stage: a round dance floor in the middle. */
  stageRadius: 2.6,
  /** Deliberately LOW: the goop dances ON the common floor, not a riser —
   *  so the stage top reads as the experience-floor plane, and rank sinks
   *  (RankSystem) read true instead of the podium height eating them. */
  stageHeight: 0.06,
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
 * moves, never the read.
 *
 * THE TELEGRAPH IS THE WHOLE INSTRUCTION. Danger shapes fill amber→red:
 * whatever is filling, don't be in it when it lands. Safe ground is drawn
 * with bright DOORPOST rails and chevrons marching INTO it: whatever the
 * chevrons run toward, be there. An experienced dancer never needs a word:
 *
 *  slam   : discs fill on the deck — STEP off them.
 *  beam   : a strip fills down the deck — SIDESTEP off the lane. A single
 *           laser snaps to one of three slots (middle, or a third out); a
 *           DOUBLE is never two random strips — it is either a TWIN pair
 *           shoulder to shoulder covering one side and the middle (get
 *           across), or a SPLIT evenly either side of centre (stand in the
 *           corridor between them). Deliberate shapes, read at a glance.
 *  sweep  : the AIR burns, never the floor — a danger roof overhead with a
 *           blazing limbo line as its underside, a short chevron fringe
 *           dripping off it — get UNDER the line (duck). The deck stays
 *           unpainted on purpose: floor paint means "move your feet"
 *           everywhere else, and the sweep's answer is the opposite.
 *  seesaw : one half floods, chevrons march at the centreline — CROSS.
 *  surge  : the seesaw's cousin, front/back.
 *  gate   : the WHOLE deck fills except one clear column, doorposts + both
 *           chevron streams pointing into it — STAND IN THE GAP.
 *  chase  : a disc GLUED to your feet — it follows you while it fills,
 *           freezes late, then lands. Moving after the freeze IS the dodge.
 *  nova   : everything burns EXCEPT one wedge at a shared compass bearing —
 *           the whole ring rotates to the same safe ground together.
 *  routine: THE MEMORY TEST. The deck splits into four quarters and the
 *           boss teaches a ROUTINE — two to four corners, never the same
 *           one twice, each marked with its step number and pointed out in
 *           order by his own body. Then the marks go out. From there the
 *           only cue is a TICK a beat ahead of each step, pitched by step
 *           number, and blocks crush the three corners you didn't learn.
 *           The quarter lines stay lit the whole way through: the floor
 *           tells you where the boxes are, never which one is yours.
 *  donut  : the RIM burns and the middle lives — a closing ring with a
 *           bright doorpost circle and chevrons marching INWARD: get to the
 *           centre. Usually opens with a laser straight down the middle,
 *           which drives you OFF centre first, so the pair walks you out
 *           and hauls you back in.
 *  cross  : LASERS FROM THE SIDES. A strip fills ACROSS the deck, fed from
 *           an emitter at one rail — step FORWARD or BACK off it (the beam's
 *           quarter-turn cousin: same read, the other axis). Late on it
 *           lays a stage lane across itself and the safe ground is a cell.
 */
export type MoveKind =
  | 'slam'
  | 'beam'
  | 'sweep'
  | 'seesaw'
  | 'surge'
  | 'gate'
  | 'chase'
  | 'nova'
  | 'cross'
  | 'donut'
  | 'routine';

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
  // nearly every set and never letting up.
  slam: { chargeBeats: 4, weights: [1, 3, 2, 2] },
  beam: { chargeBeats: 4, weights: [2, 3, 3, 3] },
  // Ducking is the most physically demanding dodge in the game — a spice,
  // not a staple. At weight 3 it was landing several times every song.
  sweep: { chargeBeats: 4, weights: [1, 2, 2, 2] },
  // The gentle 2-stage seesaw joins the openers — crossing is a day-one verb.
  seesaw: { chargeBeats: 4, weights: [2, 3, 4, 4] },
  surge: { chargeBeats: 4, weights: [0, 0, 2, 3] },
  // The GATE is the early-variety hero: instantly readable, teaches lateral
  // precision, and looks great rippling around the whole ring.
  gate: { chargeBeats: 4, weights: [3, 3, 2, 2] },
  // The CHASE arrives once feet are warm — pursuit, then the late juke.
  chase: { chargeBeats: 5, weights: [0, 2, 3, 3] },
  // The PIE hits on a chase-length fuse: finding the wedge takes one look,
  // and the old 8-beat wind-up was a 6-second stand-and-wait on slow
  // records. 5 beats keeps the whole-ring rotate honest and lands sooner.
  nova: { chargeBeats: 5, weights: [0, 0, 2, 3] },
  // CROSSFIRE is a day-one verb (it reads exactly like the beam) and it's
  // the only move that regularly asks for a step toward or away from the
  // stage — the ring stops being a left/right game.
  cross: { chargeBeats: 4, weights: [2, 3, 3, 3] },
  // commit to standing still. Held back until the floor is warm, and never
  // The DONUT is the nova's opposite number and mostly arrives as a
  // one-two, so it charges like one: long enough to read the middle laser,
  // clear it, and still get home.
  donut: { chargeBeats: 5, weights: [0, 2, 3, 3] },
  // THE ROUTINE charges for two bars because the charge IS the lesson —
  // you're being taught, not warned. Rare on purpose: it's the set piece
  // the floor talks about afterwards, and a memory test you meet every
  // phrase stops being one.
  routine: { chargeBeats: 8, weights: [0, 1, 2, 2] },
};

export const CHOREO = {
  /** Slam disc radius on the deck. */
  slamRadius: 0.34,
  /** Extra beats between multi-disc slam landings (the drumline). */
  slamStepBeats: 1,
  /** Beam lane half-width. */
  beamHalfWidth: 0.24,
  /** A SINGLE laser only ever lands on one of these local-x slots — the
   *  middle or a third out. Random x read as noise; three slots read as a
   *  choice the boss made, and the middle one is the setup the donut wants
   *  to answer. */
  beamSlots: [-0.42, 0, 0.42],
  /** DOUBLE lasers, two deliberate shapes and nothing in between:
   *   SPLIT — one either side of centre at ±beamSplitX. The strips leave a
   *     corridor down the middle and only slivers at the rim, so the answer
   *     is to stand BETWEEN the lasers.
   *   TWIN — two shoulder to shoulder from beamTwinInner outward, covering
   *     one whole side AND the middle: the answer is to get across.
   *  The split gets likelier at the peak, where precision is the point. */
  beamSplitX: 0.5,
  beamTwinInner: 0.12,
  beamSplitChance: [0.4, 0.4, 0.55, 0.55],
  /** THE ROUTINE: how many corners you're asked to hold in your head (per
   *  act, clamped to the 2–4 the deck's four quarters can offer without
   *  ever repeating one), and how many beats apart the steps land. Two
   *  beats is a brisk corner-to-corner step — about a metre of travel —
   *  which is the point: the memory has to be ready before the tick. */
  routineSteps: [2, 2, 3, 4],
  routineStepBeats: 2,
  /** How many beats before each routine step its blocks are already VISIBLY
   *  falling — the DOWN language, upside down: spinning neon polyhedra
   *  descend onto the three quarters you weren't taught, deck rings
   *  brightening under them as they close. The descent is beat-locked, so
   *  the landing IS the downbeat. */
  routineDropBeats: 2,
  /** How far PAST the quarter line you must stand for a corner to count.
   *  Without it, loitering at dead centre would satisfy all four corners
   *  at once and the whole move would be free — so the routine asks you to
   *  commit, and the lit quarter lines show exactly where the line is. */
  routineMargin: 0.08,
  /** THE DONUT: radius of the safe disc in the middle (tighter at the
   *  peak), how long after the opening laser the ring closes, and how often
   *  it opens with that laser instead of arriving alone. A full bar between
   *  the two is the whole move: driven off centre, then hauled back. */
  donutInnerR: 0.46,
  donutInnerRLate: 0.38,
  donutRadius: 1.15,
  donutFollowBeats: 4,
  donutOpenChance: 0.7,
  /** The sweep's LIMBO LINE: the rendered underside of the danger. Sits a
   *  touch BELOW the average duck threshold (judgement is duck-state, not
   *  metres) so "visibly under the line" is never a hit — the picture may
   *  demand slightly more crouch than the judge, never less. */
  sweepY: 1.26,
  /** Half-height of the glowing line pane at sweepY. */
  sweepThickness: 0.12,
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
  /** THE CHAIN (late-act nova): three SINGULAR pies, one after the other,
   *  each safe wedge a third of the compass further on — three dodges walk
   *  you the whole way around the ring. Only ONE pie is ever on the floor
   *  (the next disc doesn't even appear until the last one has gone off),
   *  and each rides the same short fuse, so the chain reads as three clean
   *  beats instead of a slow stack of overlapping discs. */
  novaChainBeats: 3,
  novaChainTurn: (Math.PI * 2) / 3,
  /** CROSSFIRE: half-depth of the side-laser strip (a shade tighter than the
   *  beam's — the deck is shallower front-to-back than it is wide, so the
   *  same margin has to come out of less ground). */
  railHalfDepth: 0.2,
  /** How far off deck centre a rail can sit — a rail through the middle
   *  leaves a mean margin both ways, so they always favour one side. */
  railOffsetMin: 0.12,
  railOffsetMax: 0.42,
  /** From this act on, the crossfire lays a stage lane ACROSS the rail: the
   *  safe ground becomes a quarter of the deck and the dodge is diagonal. */
  latticeFromAct: 2,
  /** Gate: half-width of the safe column; tightens in the last act. */
  gateHalfW: 0.3,
  gateHalfWLate: 0.22,
  /** Chase: disc radius, and how many beats before landing it FREEZES —
   *  the freeze is the cue, the juke after it is the dodge. */
  chaseRadius: 0.42,
  chaseLockBeats: 1.25,
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
 *
 * NAMING: neither meter wears a word on screen anymore. The groove
 * answers loudly through the glowsticks (spark bursts off the paying tip)
 * and quietly through the wedge's GROOVE ROW (pips winding up, then a
 * fill bar and the streak's earnings); the dodge chain is the wedge's ×N.
 * The code keeps its groove-flavoured identifiers so the two streaks can
 * never be confused in here.
 */
export const GROOVE = {
  /** Vertical hand separation (m) that counts as "one up, one down". */
  split: 0.35,
  /** Points for a rhythmic swap. */
  base: 6,
  /** Extra points per streak step — the consistency creep. */
  perStreak: 0.5,
  /** The STREAK counter runs to 999 — a whole-night flex on the HUD. */
  streakCap: 999,
  /** …but PAY saturates here (base + 50 = 56 a swap), so the trickle never
   *  outruns dodging no matter how long the flex gets. */
  payCap: 100,
  /**
   * PAY-RATE CAP: rewarded swaps lock to the HALF-BEAT grid. Records have
   * double-time passages (MORNING's fast bits) where swapping on the
   * eighths IS the dance — capping at whole beats forced you to groove
   * slower than the song. Light-speed flailing is still absorbed silently
   * (no reward, no reset): pay can never exceed two swaps a beat, however
   * fast the hands go. Slightly under 0.5 for human timing slop.
   */
  minBeats: 0.45,
  /** Stop swapping for this long and the streak lets go. */
  maxBeats: 2.6,
};

/* ────────────────────────────── THE SCORE ────────────────────────────────
 * Survive a landing → a DODGE: points × the chain multiplier, and the
 * chain climbs one. Get clipped → lose a life, the chain dies, brief
 * i-frames. Three and out. (The chain is `combo` in code — the field rides
 * the score wire; on screen it's just the ×N in your colour.)
 * A PERFECT is a last-instant dodge: you were still inside the doomed zone
 * one beat before impact and clear when it landed — riding the beat.
 */
export const SCORE = {
  base: 100,
  perfectMult: 1.5,
  comboStep: 0.1, // multiplier = 1 + comboStep × min(combo, comboCap)
  comboCap: 30, // → ×4 ceiling
  invulnBeats: 2,
  /** Sample "were you inside the zone" this many beats before impact. */
  perfectProbeBeats: 1,
  /** Survival tick: staying alive pays a trickle every bar so late-game
   *  rankings separate even between flawless dancers. */
  aliveBarBonus: 10,
};

/* ───────────────────────────── THE GRADE ─────────────────────────────────
 * No lives. You dance the whole record and the night grades you at the
 * end — S down to F, off the share of landings you survived, with the
 * top letter reserved for a clean set danced on the last beat.
 *
 * The one way to end early is a CHAIN: three clipped landings back to
 * back and you're off the floor. It is not a budget of three hits — any
 * dodge wipes the count clean. Being clipped costs you your grade; being
 * clipped three times running costs you the night, and takes the letter
 * with it.
 */
export const GRADE = {
  /** Consecutive clipped landings that end your night. A dodge clears it. */
  chainOut: 3,
  /** Beats between a solo game over and the results card — long enough for
   *  the last crush and the flair to land, short enough to feel like an
   *  ending rather than a wait. */
  overBeats: 3,
  /** The letter cuts, best first. `rate` is the share of landings you
   *  survived; `perfect` is the share of those taken on the last beat —
   *  only S asks for it, so the crown means clean AND late. */
  cuts: [
    { letter: 'S', rate: 0.999, perfect: 0.25 },
    { letter: 'A', rate: 0.93, perfect: 0 },
    { letter: 'B', rate: 0.82, perfect: 0 },
    { letter: 'C', rate: 0.62, perfect: 0 },
  ],
  /** Below the last cut — and always, if the chain took you out. */
  fail: 'F',
  /** Letter colours, so the card and the board agree. */
  colors: {
    S: '#ffd75e',
    A: '#b9ffc4',
    B: '#4fb7ff',
    C: '#b06bff',
    F: '#ff5040',
  } as Record<string, string>,
};

/* ─────────────────────────────── THE RANK ────────────────────────────────
 * Alive beats eliminated; among the living, score; among the fallen, who
 * lasted longest. VR height law: NOBODY EVER RENDERS BELOW THE FLOOR.
 * Dancers who outrank you rise above you by the tier gap; your own lift is
 * something only OTHERS see (their clients raise your platform — you can't
 * feel a floor you're not standing on, and nobody has to look at sunken,
 * shortened dancers anymore). Eliminated platforms dim; they don't sink.
 */
export const RANK = {
  championLift: 0.7,
  topTenLift: 0.32,
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
    id: 'door',
    name: 'BOUNCER',
    epithet: 'the velvet rope',
    move: 'gate',
    scale: 1.45,
    trackId: 'capture',
    clears: 6,
    lesson: 'The whole deck floods — one gap stays.\nSTAND IN THE DOORWAY.',
  },
  {
    id: 'cling',
    name: 'SMITTEN',
    epithet: 'the lovestruck puddle',
    move: 'chase',
    scale: 1.5,
    trackId: 'combat',
    clears: 6,
    lesson: 'A disc GLUES to your feet and follows.\nKEEP MOVING — JUKE when it freezes.',
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

/* ──────────────────────────────── THE MC ─────────────────────────────────
 * The headliner most nights: a GIANT of the dancers' own kind — same sleek
 * neon humanoid as the groupies, scaled to tower over the stage — whose
 * whole body ACTS OUT every attack during its charge. The point: the tell
 * lives at EYE LEVEL, in silhouette, so nobody has to stare at the floor.
 * The GOOP still owns the set finales (and eats this guy on the way in).
 */
export const MC = {
  /** Rig root scale — the groupie figure is ~1.6 m, so ×2.1 ≈ a 3.4 m icon. */
  scale: 2.1,
  /** Signature colour (hue for hueToColor) — icy stage-cyan, no seat owns it. */
  hue: 0.52,
  /** Sticks/accents flip to WARN amber while a move charges. */
  warnColor: 0xffb03a,
};

/* ─────────────────────────────── THE TOUR ────────────────────────────────
 * The campaign proper: NIGHTS grouped into SETS of three records. Nights
 * unlock in order; a set's third night is the GOOP FINALE — the gel returns
 * in a new colour and EATS the MC as the record starts. The first
 * `freeSets` sets ship with the game; the teaser row at the bottom of the
 * tour screen is where paid sets would slot in later.
 */
export interface TourSet {
  id: string;
  name: string;
  /** Exactly three track ids (audio/tracks.ts); index 2 is the finale. */
  songs: [string, string, string];
  /** Finale gel tint (gelMaterial uniforms); null = the classic green. */
  tint: { shallow: number; deep: number; nucleus: number } | null;
}

export const TOUR: { sets: TourSet[]; freeSets: number; maxPhrases: number } = {
  freeSets: 3,
  /** Tour nights cap here even when the record could run longer — UNITY is
   *  five minutes; a campaign night shouldn't be. Free play still rides the
   *  whole file. */
  maxPhrases: 12,
  sets: [
    {
      id: 'opening',
      name: 'OPENING SET',
      // The night starts in the MORNING — short, fun, duck-free. MONEY
      // moved to the quick-raid pool when it gave up the slot.
      songs: ['morning', 'target', 'capture'], // 97 → 91 → 117 BPM
      tint: null, // the classic green goop
    },
    {
      id: 'peak',
      name: 'PEAK HOURS',
      // DYNASTY takes SAKUPENED's place on the tour (SAKUPENED stays in the
      // quick-raid pool). At 155 it's the fastest of the three, so it closes
      // the set — every set still climbs.
      songs: ['combat', 'loop', 'dynasty'], // 135 → 150 → 155 BPM
      tint: { shallow: 0xff6ee0, deep: 0x571040, nucleus: 0xff9ff0 }, // hot magenta
    },
    {
      id: 'afterhours',
      name: 'AFTER HOURS',
      // No repeats anywhere on the tour. SPREAD replaced UNITY (a fight
      // record where a five-minute journey used to sit) and, being the
      // faster of the two openers, it plays second so the set still climbs.
      songs: ['infection', 'spread', 'breakcore'], // 138 → 150 → 174 BPM
      tint: { shallow: 0xffd24a, deep: 0x6e3c06, nucleus: 0xffefad }, // molten gold
    },
  ],
};

export const TOUR_KEY = 'gdr-tour';

/* ─────────────────────────────── THE BOTS ────────────────────────────────
 * Empty seats are filled with bots — seeded, deterministic dancers every
 * client simulates identically (no bot netcode: same seed, same outcome,
 * same leaderboard everywhere). They wear plain service tags (BOT01…),
 * numbered around the ring in state.buildRoster.
 */
export const BOTS = {
  /** Dodge chance range rolled per bot from the match seed. */
  skillMin: 0.7,
  skillMax: 0.96,
  /** Dodge chance shrinks by this per act (the floor thins as the set peaks). */
  actPenalty: 0.05,
};

/* ─────────────────────────────── THE LOOK ────────────────────────────────
 * An absolute disco: neon on the void's black. Everything additive — a
 * bloom-ish glow without post-processing.
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

/* (The old ROOM DIM / SET VOID passthrough toggle is gone: the game is FULL
 * VR now — the void environment IS the set's world, always, and the scene
 * carries an opaque backdrop everywhere. No halfway states.) */

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

/** The hosted room relay (deploy server/index.mjs here — same Render-style
 *  arrangement as Iron Balls Boxing's pub relay). Override per-session with
 *  ?server=wss://… or by setting localStorage 'gdr-server'. */
export const DEFAULT_RELAY = 'wss://rave-raid-relay.onrender.com';

/** Resolve the relay URL: ?server= param > localStorage > a local dev
 *  relay when the page itself is local > the hosted relay (raveraid.web.app
 *  and friends can't reach ws://localhost). */
export function serverUrl(): string {
  const param = new URLSearchParams(location.search).get('server');
  if (param) return param;
  try {
    const stored = localStorage.getItem('gdr-server');
    if (stored) return stored;
  } catch {
    /* storage may be unavailable */
  }
  // A plain-http page is a dev serve (vite on this machine or its LAN IP,
  // reached from a headset) — talk to the relay running beside it. Https
  // means a real deploy (raveraid.web.app), which needs the hosted relay.
  if (location.protocol !== 'https:') {
    return `ws://${location.hostname}:${NET.defaultPort}`;
  }
  return DEFAULT_RELAY;
}
