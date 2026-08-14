/**
 * THE CLUB — layout + tunables for RAVE RAID's home venue. (It has no
 * name — the sign over the stage is a moon, not a word.)
 *
 * The club is the room the menus live in (it replaces the bare green room)
 * and the SOCIAL FLOOR for online rooms: everyone in your room stands here
 * between sets, voices carried spatially, teleporting around the venue. When
 * the host drops the set the club packs away and the raid's void takes
 * the room; when the set resolves everyone lands back here together.
 *
 * The look is deliberately the opposite pole from FIRE FIGHT's steel boozer:
 * restrained Art Deco fused with the rave's neon — charcoal lime plaster,
 * smoked oak, champagne brass, oxblood velvet, ribbed glass — with saturated
 * colour reserved for light, drinks and signage. Its hero is the ECLIPSE
 * CHANDELIER: concentric suspended brass rings over the dance floor that
 * slowly counter-rotate and phase with the music.
 *
 * Everything in metres, world space. You SPAWN at the origin — the same spot
 * the raid puts your platform — standing at the near edge of the dance
 * floor, facing the stage (−z). The menu board floats dead ahead, exactly
 * where it always has.
 *
 *          z = −11.5 ───────── stage + drape wall ─────────
 *          │ STILL RM │        ◠ stage ◠         │ back    │
 *          │ (quiet)  │      DJ + sunburst       │  bar    │
 *          x = −9 ────┤                          ├─ BAR ───│ x = +9
 *          │  booths  │      DANCE FLOOR         │ counter │
 *          │ (velvet) │     (eclipse above)      │ stools  │
 *          │          │      ⊙ you spawn         │         │
 *          │─ terrace ─╨──── vestibule portal ───╨─ terrace │
 *          z = +5 ──────────────────────────────────────────
 */

export const CLUB = {
  /** Hall shell extents. */
  halfW: 9,
  minZ: -11.5,
  maxZ: 5,
  /** Main ceiling slab; the dome over the dance floor steps up to domeH. */
  ceilH: 3.4,
  domeH: 5.1,

  /** The dance floor: a circle the raid ring roughly re-occupies —
   *  the club and the game share a centre of gravity. */
  floor: { x: 0, z: -4.2, r: 4.3 },

  /** Where you arrive (and are re-planted when a set books the room). */
  spawn: { x: 0, z: 0 },

  /** The stage: a raised crescent hugging the north wall, DJ console at its
   *  heart, brass sunburst behind. Not teleportable — the stage performs. */
  stage: { z: -9.3, r: 3.0, h: 0.45 },

  /** Bar along the east wall. Counter FRONT face at `x`; the keeper's aisle
   *  runs between the counter back and the back-bar shelf wall. */
  bar: {
    x: 6.7,
    z0: -6.8,
    z1: 0.4,
    top: 1.09,
    depth: 0.62,
    /** Back-bar glass wall (ribbed, backlit) proud of the east wall. */
    backX: 8.72,
  },

  /** Lounge booths down the west wall: velvet horseshoes + marble tables. */
  boothX: -7.35,
  boothZs: [-6.3, -3.4, -0.5],

  /** Raised terrace along the south wall (two wings around the vestibule),
   *  brass-railed, overlooking the floor toward the stage. */
  terrace: { z0: 3.1, z1: 4.65, h: 0.45, gapHalfW: 2.1 },

  /** THE STILL ROOM — the quiet decompression room, north-west corner. The
   *  ambient mix ducks to a murmur inside; voices stay. */
  quiet: { minX: -8.7, maxX: -4.9, minZ: -11.2, maxZ: -8.45, doorX0: -6.6, doorX1: -5.4 },

  /** THE ARCADE — the still room's loud mirror, and its POLAR opposite:
   *  the still room is front-left by the stage, so the noise goes
   *  back-right, by the door. Its own door faces north, onto the floor.
   *  (It used to sit beside the stage, which put the quiet room and the
   *  loud room on the same wall — mirrored, but not opposite.) */
  // maxX/maxZ ARE the shell (halfW, maxZ): a room tucked into a corner has
  // to meet the outer walls, or the leftover slot shows daylight from the
  // hall over the top of its low ceiling.
  arcade: { minX: 4.9, maxX: 9, minZ: 2.05, maxZ: 5, doorX0: 5.4, doorX1: 6.6 },

  /** The eclipse chandelier: ring radii + counter-rotation speeds (rad/s).
   *  Hangs over the dance floor centre at `y`. */
  chandelier: {
    y: 3.55,
    rings: [
      { r: 0.55, speed: 0.21 },
      { r: 0.95, speed: -0.14 },
      { r: 1.4, speed: 0.09 },
      { r: 1.9, speed: -0.06 },
      { r: 2.45, speed: 0.035 },
    ],
  },
} as const;

/* ── the venue's palette (the deco pole; the rave neon stays in PALETTE) ── */
export const DECOR = {
  plaster: 0x2b2830, // charcoal lime plaster
  plasterDeep: 0x211e27,
  oak: 0x4a3524, // smoked oak
  oakDark: 0x33241a,
  brass: 0xc9a86a, // champagne brass
  brassDeep: 0x8a6f3f,
  bronze: 0x5f4a33, // oxidised bronze
  velvet: 0x5e1f26, // oxblood
  velvetDeep: 0x431419,
  stone: 0x24262c, // dark veined stone
  candle: 0xffc678, // 2400 K practical
  cove: 0xffb45e, // 2700 K architectural cove
  face: 0xffd9ac, // 3200 K flattering key
  moon: 0xf2ecff, // the eclipse's moon-white
} as const;

/* ── teleport-only locomotion (the FIRE FIGHT club's system, carried over
 *    whole: arc + octagon marker + thumbstick-rolled facing + snap turn) ── */
export const TELEPORT = {
  engage: 0.5, // thumbstick magnitude that starts aiming
  release: 0.35, // …and below this on the way back, you go
  launchSpeed: 7.5, // m/s along the controller ray
  gravity: 9.8,
  arcPoints: 48,
  arcStep: 0.035, // seconds of simulated flight per arc sample
  snapAngle: (35 * Math.PI) / 180,
  snapEngage: 0.7,
  snapReset: 0.3,
} as const;

/** Where a teleport may land: floor rectangles + the height they stand at. */
export interface FloorArea {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  y: number;
}

const Q = CLUB.quiet;
const T = CLUB.terrace;
const A = CLUB.arcade;

/** Booth marble tabletop height (top.y 0.745 + half its 0.035 slab). */
const BOOTH_TABLE_Y = 0.763;

export const TELEPORT_AREAS: FloorArea[] = [
  // ── STANDABLE FURNITURE — small islands, listed FIRST so they win the
  // area lookup over the floor beneath them. Dancing on the tables is not
  // an accident in this venue; it is the venue.
  // The booth tables (inside each velvet horseshoe).
  ...CLUB.boothZs.map((bz) => ({
    minX: CLUB.boothX - 0.42,
    maxX: CLUB.boothX + 0.42,
    minZ: bz - 0.42,
    maxZ: bz + 0.42,
    y: BOOTH_TABLE_Y,
  })),
  // The still room's low table — a quieter pedestal.
  { minX: -7.14, maxX: -6.46, minZ: -9.62, maxZ: -8.94, y: 0.36 },

  // ── THE FLOOR ──
  // The hall floor: dance floor, lounge aisle, everything up to the bar
  // front and the stage lip.
  { minX: -8.55, maxX: CLUB.bar.x - 0.15, minZ: -8.15, maxZ: T.z0 - 0.12, y: 0 },
  // Behind the bar — the keeper's aisle is open to anyone who fancies
  // playing host (enter round the counter's south end).
  { minX: CLUB.bar.x + CLUB.bar.depth + 0.25, maxX: 8.45, minZ: CLUB.bar.z0 + 0.15, maxZ: CLUB.bar.z1 + 0.9, y: 0 },
  // Terrace wings (raised) either side of the vestibule. The east wing
  // stops at the arcade's wall — that corner is a room now.
  { minX: -8.55, maxX: -T.gapHalfW - 0.15, minZ: T.z0 + 0.12, maxZ: T.z1 - 0.1, y: T.h },
  { minX: T.gapHalfW + 0.15, maxX: A.minX - 0.15, minZ: T.z0 + 0.12, maxZ: T.z1 - 0.1, y: T.h },
  // The vestibule landing between the wings, floor level.
  { minX: -T.gapHalfW + 0.1, maxX: T.gapHalfW - 0.1, minZ: T.z0, maxZ: 4.8, y: 0 },
  // The still room, and the strip through its doorway (the old dead band
  // where arcs aimed at the door just died).
  { minX: Q.minX + 0.25, maxX: Q.maxX - 0.25, minZ: Q.minZ + 0.25, maxZ: Q.maxZ - 0.2, y: 0 },
  { minX: Q.doorX0 + 0.05, maxX: Q.doorX1 - 0.05, minZ: Q.maxZ - 0.05, maxZ: -8.1, y: 0 },
  // THE ARCADE room, and its doorway strip — its door faces north now, so
  // the strip runs back toward the floor rather than up toward the stage.
  { minX: A.minX + 0.25, maxX: A.maxX - 0.25, minZ: A.minZ + 0.2, maxZ: A.maxZ - 0.25, y: 0 },
  { minX: A.doorX0 + 0.05, maxX: A.doorX1 - 0.05, minZ: A.minZ - 0.75, maxZ: A.minZ + 0.05, y: 0 },
  // The north corridors flanking the stage, and the backstage walk behind
  // it — the whole perimeter is a loop now, not a set of dead ends.
  { minX: -4.85, maxX: -3.45, minZ: -11.3, maxZ: -8.1, y: 0 },
  { minX: 3.45, maxX: 4.85, minZ: -11.3, maxZ: -8.1, y: 0 },
  { minX: -3.45, maxX: 3.45, minZ: -11.3, maxZ: -9.45, y: 0 },
];

/** Floor height under a point, for arcs and rigs (0 if outside any area). */
export function floorYAt(x: number, z: number): number {
  for (const a of TELEPORT_AREAS) {
    if (x >= a.minX && x <= a.maxX && z >= a.minZ && z <= a.maxZ) return a.y;
  }
  return 0;
}

/**
 * Solid walls a teleport may not arc THROUGH — the landing can be valid
 * floor, but if the straight path from where you stand crosses one of these
 * you can't go (no phasing through walls). Each is an XZ segment
 * [ax, az, bx, bz]. The still room keeps its doorway gap; the bar counter
 * blocks hops straight over it (walk round the south end instead).
 */
export const WALL_SEGMENTS: Array<[number, number, number, number]> = [
  // Hall perimeter.
  [-CLUB.halfW, CLUB.minZ, CLUB.halfW, CLUB.minZ], // north (stage/drape) wall
  [-CLUB.halfW, CLUB.maxZ, CLUB.halfW, CLUB.maxZ], // south (vestibule) wall
  [-CLUB.halfW, CLUB.minZ, -CLUB.halfW, CLUB.maxZ], // west
  [CLUB.halfW, CLUB.minZ, CLUB.halfW, CLUB.maxZ], // east
  // The still room: east wall, and the south wall split around its doorway.
  [Q.maxX, Q.minZ, Q.maxX, Q.maxZ],
  [Q.minX, Q.maxZ, Q.doorX0, Q.maxZ],
  [Q.doorX1, Q.maxZ, Q.maxX, Q.maxZ],
  // THE ARCADE: its west wall, and the NORTH wall split around its doorway
  // (the room sits against the south shell, so it opens onto the floor).
  [A.minX, A.minZ, A.minX, A.maxZ],
  [A.minX, A.minZ, A.doorX0, A.minZ],
  [A.doorX1, A.minZ, A.maxX, A.minZ],
  // The stage face — the performer's ground, not the crowd's.
  [-CLUB.stage.r - 0.4, CLUB.stage.z + CLUB.stage.r + 0.35, CLUB.stage.r + 0.4, CLUB.stage.z + CLUB.stage.r + 0.35],
  // The bar counter line (its south end at z1 stays open into the aisle).
  [CLUB.bar.x, CLUB.bar.z0 - 0.4, CLUB.bar.x, CLUB.bar.z1],
];

/* ── the social wire ────────────────────────────────────────────────────── */
export const CLUB_NET = {
  /** Club pose stream rate while you're on the floor (Hz). */
  poseRateHz: 12,
  /** Remote punter pose smoothing (exponential ease rate). */
  smoothing: 12,
} as const;

/** Localstorage keys for the club's social safety lists. */
export const SOCIAL_KEYS = { muted: 'gdr-muted', blocked: 'gdr-blocked', voice: 'gdr-voice' } as const;
