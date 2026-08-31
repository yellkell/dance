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
 *          │ THE STEP │─ terrace ╨ vestibule ╨ ─│ ARCADE  │
 *          z = +5 ──────────────────────────────────────────
 *
 * Both back corners are rooms now, one either side of the way in: the
 * ARCADE on the east, and on the west THE STEP — a bare little room with a
 * doorway standing in it that doesn't lead anywhere in this building.
 */

export const CLUB = {
  /** Hall shell extents. */
  halfW: 9,
  minZ: -11.5,
  maxZ: 5,
  /** Main ceiling slab; the dome over the dance floor steps up to domeH. */
  ceilH: 3.4,
  domeH: 5.1,
  /** The corner rooms (still room, arcade) cap at door height — lower,
   *  closer volumes. Shared here because the BALL's cable needs to agree
   *  with the architecture about where the ceiling is. */
  roomCeilH: 2.5,

  /** The dance floor: a circle the raid ring roughly re-occupies —
   *  the club and the game share a centre of gravity. */
  floor: { x: 0, z: -4.2, r: 4.3 },

  /** Where you arrive — the world origin, the same spot the raid puts your
   *  platform. (When a set books the room the rig simply drops back to
   *  identity, so no re-plant is needed: the origin IS the spawn.) */
  spawn: { x: 0, z: 0 },

  /** The stage: a raised crescent hugging the north wall, DJ console at its
   *  heart, brass sunburst behind. You can get up on it (TELEPORT_AREAS) —
   *  the deck is a half-drum, so the standable spots are cut to fit inside
   *  the curve rather than one rectangle overhanging its lip.
   *
   *  `desk` is the DJ console's world footprint, kept here because two
   *  places need to agree on it: build.ts stands the console on it, and the
   *  drinks bounce off it (props.ts). */
  stage: {
    z: -9.3,
    r: 3.0,
    h: 0.45,
    desk: { z: -8.4, halfW: 1.12, halfD: 0.31, top: 1.41 },
  },

  /** Bar along the east wall. Counter FRONT face at `x`; the keeper's aisle
   *  runs between the counter back and the back-bar shelf wall. The `top` is
   *  a standable surface (TELEPORT_AREAS) — getting up on the bar is the
   *  oldest move in the book, and it's the one perch the whole hall can see. */
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

  /** THE MIRROR — a grand smoked pier glass on the north wall's east end,
   *  the still room's opposite number across the DJ. The one place in the
   *  game you can see your own body: walk up and the glass wakes, showing
   *  the figure everyone ELSE sees (plus whoever stands near you). It
   *  sleeps as plain black glass beyond `range` — the reflection is real
   *  mirrored rigs in a recess behind the wall, and nobody pays for them
   *  from across the hall.
   *
   *  `x` centres it in the north-east corner walk; the glass plane IS the
   *  north wall. `reflectRange` bounds both the recess depth and which
   *  dancers reflect; `maxFigures` caps a packed room's bill. */
  mirror: {
    x: 6.65,
    w: 2.5,
    h: 2.35,
    baseY: 0.16,
    /** Head → glass distance that wakes it (sleep again at +0.4). */
    range: 3.4,
    /** Only figures this close to the glass appear in it. */
    reflectRange: 3.2,
    maxFigures: 8,
  },

  /** THE ARCADE — the still room's loud mirror, and its POLAR opposite:
   *  the still room is front-left by the stage, so the noise goes
   *  back-right, by the door. Its own door faces north, onto the floor.
   *  (It used to sit beside the stage, which put the quiet room and the
   *  loud room on the same wall — mirrored, but not opposite.) */
  // maxX/maxZ ARE the shell (halfW, maxZ): a room tucked into a corner has
  // to meet the outer walls, or the leftover slot shows daylight from the
  // hall over the top of its low ceiling.
  arcade: { minX: 4.9, maxX: 9, minZ: 2.05, maxZ: 5, doorX0: 5.4, doorX1: 6.6 },

  /** THE STEP — the arcade's opposite number across the way in, and the odd
   *  one out in the whole venue: the other three corners are rooms, and this
   *  one is a DOOR. Same footprint as the arcade mirrored about the
   *  vestibule, same low ceiling, its own door facing north onto the floor —
   *  and standing against its back wall, a portal frame with the VOID in it.
   *  Step into the frame and the hall is gone: you come out on a platform in
   *  the middle of RAVE RAID's own abstract space, on ground that moves, with
   *  none of the club's teleport under your thumb. Ride the circuit and it
   *  hands you back through the same doorway.
   *
   *  `portal*` is the frame's world footprint — build.ts stands it up,
   *  CourseSystem watches the threshold in front of it, and both have to
   *  agree to the centimetre or you get a door that looks shut and isn't. */
  step: {
    minX: -9,
    maxX: -4.9,
    minZ: 2.05,
    maxZ: 5,
    doorX0: -6.6,
    doorX1: -5.4,
    /** The frame: centred in the room, standing on its south wall. */
    portalX: -6.95,
    portalZ: 4.72,
    portalW: 1.5,
    portalH: 2.1,
    /** How far out from the glass the threshold reaches — one stride. */
    reach: 0.62,
  },

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
  /** BACK on the stick is a short shuffle away from whatever you're facing,
   *  not a teleport arc. Aiming an arc behind your own feet meant turning
   *  round, throwing it, and turning back — three moves for the one thing
   *  you actually want at a bar, which is to be half a metre further off it.
   *  Probed at decreasing lengths so you can back right up against a wall
   *  instead of the flick doing nothing. */
  stepBack: [0.5, 0.34, 0.2],
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
const S = CLUB.step;

/** Booth marble tabletop height (top.y 0.745 + half its 0.035 slab). */
const BOOTH_TABLE_Y = 0.763;

export const TELEPORT_AREAS: FloorArea[] = [
  // ── STANDABLE FURNITURE — small islands, listed FIRST so they win the
  // area lookup over the floor beneath them. Dancing on the tables is not
  // an accident in this venue; it is the venue.
  // THE BAR ITSELF. Getting up on the counter is the oldest move in the
  // book, and the counter is the one surface in here everybody can see
  // from everywhere. Inset from the lip so you land on oak, not air.
  {
    minX: CLUB.bar.x + 0.15,
    maxX: CLUB.bar.x + CLUB.bar.depth - 0.12,
    minZ: CLUB.bar.z0 + 0.3,
    maxZ: CLUB.bar.z1 - 0.2,
    y: CLUB.bar.top,
  },
  // THE STAGE. Three patches, not one rectangle: the deck is a half-drum
  // of radius 3 centred on the north wall, so a single box big enough to be
  // worth standing on would hang its corners out over the lip. A wide strip
  // in FRONT of the decks (where anyone performing actually stands), and a
  // wing either side of the console — every corner inside r = 2.85, which
  // leaves the brass nosing to itself.
  { minX: -2.0, maxX: 2.0, minZ: -8.0, maxZ: -7.35, y: CLUB.stage.h },
  { minX: -2.5, maxX: -1.25, minZ: -9.05, maxZ: -8.0, y: CLUB.stage.h },
  { minX: 1.25, maxX: 2.5, minZ: -9.05, maxZ: -8.0, y: CLUB.stage.h },
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
  // front and the stage lip. THREE rectangles, because the stage is in the
  // way of one: as a single box reaching z = −8.15 it ran clean under the
  // drum, so the middle of the hall let you stand inside the stage — and
  // from in there, hop out the back to the backstage walk without ever
  // crossing the stage face. The centre band stops at the face; the wings
  // either side of the drum keep the full depth they always had.
  { minX: -3.2, maxX: 3.2, minZ: -5.9, maxZ: T.z0 - 0.12, y: 0 },
  { minX: -8.55, maxX: -3.2, minZ: -8.15, maxZ: T.z0 - 0.12, y: 0 },
  { minX: 3.2, maxX: CLUB.bar.x - 0.15, minZ: -8.15, maxZ: T.z0 - 0.12, y: 0 },
  // Behind the bar — the keeper's aisle is open to anyone who fancies
  // playing host (enter round the counter's south end).
  { minX: CLUB.bar.x + CLUB.bar.depth + 0.25, maxX: 8.45, minZ: CLUB.bar.z0 + 0.15, maxZ: CLUB.bar.z1 + 0.9, y: 0 },
  // Terrace wings (raised) either side of the vestibule. Neither wing runs
  // the whole way any more — the arcade took the east corner and THE STEP
  // has the west, so the two galleries are the same length again.
  { minX: S.maxX + 0.15, maxX: -T.gapHalfW - 0.15, minZ: T.z0 + 0.12, maxZ: T.z1 - 0.1, y: T.h },
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
  // THE STEP, and its doorway strip — the arcade's mirror image about the
  // vestibule, and the same north-facing door. The threshold in front of
  // the frame is ordinary floor and takes an arc like anywhere else: you
  // reach the far door the way you reach every other door in the building,
  // and a 2 × 2 m room is not asked to find a stride it hasn't got.
  { minX: S.minX + 0.25, maxX: S.maxX - 0.25, minZ: S.minZ + 0.2, maxZ: S.portalZ - 0.18, y: 0 },
  { minX: S.doorX0 + 0.05, maxX: S.doorX1 - 0.05, minZ: S.minZ - 0.75, maxZ: S.minZ + 0.05, y: 0 },
  // THE NORTH-EAST CORNER — the arcade's old plot. When the arcade moved
  // to the back-right by the door it left this whole corner behind the
  // stage's east side standing empty, and nobody had given the floor back:
  // you could see it, walk the corridor past it, and not stand in it. It
  // stops short of the back-bar's shelf wall (x 8.72) and the north shell.
  { minX: 4.85, maxX: 8.45, minZ: -11.2, maxZ: -8.15, y: 0 },
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
 * A wall a teleport may not arc THROUGH: the XZ segment [ax, az, bx, bz],
 * plus an optional SILL — the height at which it stops being a wall and
 * becomes something you're standing on top of.
 *
 * The bar counter is the case that needs it. It has to block hops straight
 * over it at floor level (walk round the south end to get behind), while
 * still letting you up ONTO it — and, once you're up there, back down
 * either side. A sill-less segment is solid at every height.
 */
export type WallSegment = [number, number, number, number, number?];

/**
 * Solid walls a teleport may not arc THROUGH — the landing can be valid
 * floor, but if the straight path from where you stand crosses one of these
 * you can't go (no phasing through walls). The still room keeps its doorway
 * gap; the bar counter is silled at its own worktop.
 */
export const WALL_SEGMENTS: WallSegment[] = [
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
  // THE STEP: its EAST wall, and the north wall split around its doorway —
  // the arcade's plan reflected, because the room is.
  [S.maxX, S.minZ, S.maxX, S.maxZ],
  [S.minX, S.minZ, S.doorX0, S.minZ],
  [S.doorX1, S.minZ, S.maxX, S.minZ],
  // The stage face, silled at the deck like the bar counter: step UP onto
  // the stage and back down, but a hop at floor level still can't use it as
  // a shortcut to the backstage walk behind.
  [
    -CLUB.stage.r - 0.4,
    CLUB.stage.z + CLUB.stage.r + 0.35,
    CLUB.stage.r + 0.4,
    CLUB.stage.z + CLUB.stage.r + 0.35,
    CLUB.stage.h,
  ],
  // The stage's flat BACK — a closed panelled face, so the way onto the
  // stage is its steps, not a hop through the scenery from the backstage
  // walk. No sill: solid at every height.
  [-CLUB.stage.r, CLUB.stage.z - 0.05, CLUB.stage.r, CLUB.stage.z - 0.05],
  // The bar counter line (its south end at z1 stays open into the aisle).
  // Silled at the worktop: solid to anyone on the floor, a step to anyone
  // standing on it.
  [CLUB.bar.x, CLUB.bar.z0 - 0.4, CLUB.bar.x, CLUB.bar.z1, CLUB.bar.top],
];

/** Do segments AB and CD properly cross? (Collinear/endpoint touches don't
 *  count — grazing a doorway edge shouldn't block the hop.) */
function segmentsCross(
  ax: number, az: number, bx: number, bz: number,
  cx: number, cz: number, dx: number, dz: number,
): boolean {
  const o = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number): number =>
    (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
  const d1 = o(cx, cz, dx, dz, ax, az);
  const d2 = o(cx, cz, dx, dz, bx, bz);
  const d3 = o(ax, az, bx, bz, cx, cz);
  const d4 = o(ax, az, bx, bz, dx, dz);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * Does the straight path (x0,z0)→(x1,z1) cross any solid wall?
 *
 * `atY` is the HIGHER of the two ends' floor heights — the height the hop
 * is really travelling at. A silled wall (the bar counter) stops being an
 * obstacle once you're at or above its top, which is what makes climbing
 * onto the counter legal without also opening the keeper's aisle to
 * anyone standing on the floor in front of it.
 */
export function crossesWall(x0: number, z0: number, x1: number, z1: number, atY = 0): boolean {
  return WALL_SEGMENTS.some(
    ([ax, az, bx, bz, sill]) =>
      (sill === undefined || atY < sill - 1e-6) && segmentsCross(x0, z0, x1, z1, ax, az, bx, bz),
  );
}

/* ── the social wire ────────────────────────────────────────────────────── */
export const CLUB_NET = {
  /** Club pose stream rate while you're on the floor (Hz). */
  poseRateHz: 12,
  /** Remote punter pose smoothing (exponential ease rate). */
  smoothing: 12,
} as const;

/** Localstorage keys for the club's social safety lists. */
export const SOCIAL_KEYS = {
  muted: 'gdr-muted',
  blocked: 'gdr-blocked',
  voice: 'gdr-voice',
  music: 'gdr-club-music',
} as const;
