/**
 * CLUB PROPS — the drinks, and the physics tables they live by.
 *
 * The interaction feel is FIRE FIGHT's pub, carried over: a fat invisible
 * grab proxy so a slim coupe is never fiddly to catch, a forgiving
 * aim-cone range grab, a five-frame ring buffer turning real hand motion
 * into throw velocity, per-surface landing, and a settle that eases a
 * tilted glass upright instead of snapping it. No physics engine — five
 * cheap tricks that read as one expensive one.
 *
 * Geometry: the coupe is the booths' decorative glass, sized for a hand,
 * with a cocktail in it (a magenta fill that empties when you drink).
 */

import {
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector2,
} from 'three';
import { CLUB } from './config.js';

export const PROP_PHYS = {
  gravity: 9.8,
  /** Throw speed cap (m/s) — a coupe is not a fastball. */
  maxThrowSpeed: 14,
  /** Bounce energy kept off floors and walls. */
  restitution: 0.32,
  /** Grind while sliding on a surface (exponential per second). */
  slideFriction: 2.2,
  /** Below this speed a landing settles instead of bouncing. */
  settleSpeed: 0.6,
  /** How fast a settled glass eases upright (per second). */
  uprightEase: 6,
  /** Tumble picked up from a throw. */
  spinFromThrow: 1.5,
  spinMax: 11,
  /** Range grab: aim cone + reach (the "force grab" half of the feel). */
  grabMaxDist: 1.0,
  grabConeCos: Math.cos((30 * Math.PI) / 180),
  /** Flight is SUBSTEPPED: no single step moves the glass further than
   *  this. A capped throw covers 15 cm in a 90 Hz frame, and the surface
   *  test only samples where the step ENDS — so at one step per frame a
   *  hard throw sails straight through a table edge it should have hit. */
  maxStep: 0.03,
  maxSubsteps: 24,
  /** No single frame simulates more than this much flight. A dropped frame
   *  (or a headset coming back from sleep) hands the system a delta worth
   *  half a second, and without a ceiling that teleports a thrown glass a
   *  metre — through whatever was in the way, and past the substep cap,
   *  since the substep count is bounded too. A hitch makes a glass move in
   *  slow motion for one frame, which nobody notices; it must never make a
   *  glass move through things, which everybody does. */
  maxFrame: 0.05,
  /** Below this horizontal speed a skidding glass finally comes to rest.
   *  (Above it, `slideFriction` grinds it down — a glass that lands slow
   *  used to stop dead the instant it touched, which is the one thing a
   *  glass on a bar top never does.) */
  slideStop: 0.14,
  /** Tumble bleeds off in the air (exponential, per second). */
  spinDamp: 0.5,
  /** GLASS ON GLASS: one sphere round the bowl is plenty to clack with —
   *  centre height up the local axis, and the radius of the sphere. */
  bodyY: 0.12,
  bodyR: 0.072,
  /** Energy kept when two glasses meet (they ring more than they stick). */
  glassRestitution: 0.45,
} as const;

/**
 * The coupe's silhouette as contact rings — the same profile the lathe is
 * built from, as {y, r} pairs.
 *
 * This is what keeps the drink OUT OF THE FLOOR. Resting on the root
 * origin is only correct while the glass is upright: tilt it and the bowl
 * and stem swing below the surface, because the origin sits at the base.
 * A surface of revolution makes the true answer cheap — under a rotation
 * whose tilt from vertical is θ, the lowest point of the ring (y, r) is
 * `y·cos θ − r·sin θ`, so the lowest point of the whole glass is the
 * smallest of those over the profile. Upright that picks the base (0);
 * on its side it picks the rim, and the coupe lies on its rim and foot
 * exactly as it should.
 */
export const COUPE_PROFILE: ReadonlyArray<{ y: number; r: number }> = [
  { y: 0, r: 0.001 },
  { y: 0.003, r: 0.042 },
  { y: 0.015, r: 0.006 },
  { y: 0.112, r: 0.006 },
  { y: 0.127, r: 0.03 },
  { y: 0.15, r: 0.063 },
  { y: 0.187, r: 0.066 },
];

/** How far the glass's lowest point sits below its origin at this tilt
 *  (`cosTilt` = the world-Y component of the glass's own up axis). */
export function coupeBottomOffset(cosTilt: number): number {
  const c = Math.max(-1, Math.min(1, cosTilt));
  const s = Math.sqrt(Math.max(0, 1 - c * c));
  let lowest = Infinity;
  for (const p of COUPE_PROFILE) {
    const y = p.y * c - p.r * s;
    if (y < lowest) lowest = y;
  }
  return lowest;
}

/** Landing surfaces the teleport floor doesn't know: places you can't
 *  stand but a glass can rest. (Everything standable — booth tables, the
 *  terrace, the still table — already answers through floorYAt.) */
export const PROP_SURFACES: Array<{ minX: number; maxX: number; minZ: number; maxZ: number; y: number }> = [
  // The bar counter top.
  { minX: CLUB.bar.x, maxX: CLUB.bar.x + CLUB.bar.depth, minZ: CLUB.bar.z0, maxZ: CLUB.bar.z1, y: CLUB.bar.top },
  // The stage (a square heart of the crescent — close enough for a glass).
  { minX: -2.6, maxX: 2.6, minZ: CLUB.stage.z - 0.2, maxZ: CLUB.stage.z + 2.6, y: CLUB.stage.h },
  // THE DJ CONSOLE's top. Listed after the stage but it wins anyway: the
  // surface lookup takes the HIGHEST match under the glass, and the desk
  // stands on the stage.
  {
    minX: -CLUB.stage.desk.halfW,
    maxX: CLUB.stage.desk.halfW,
    minZ: CLUB.stage.desk.z - CLUB.stage.desk.halfD,
    maxZ: CLUB.stage.desk.z + CLUB.stage.desk.halfD,
    y: CLUB.stage.desk.top,
  },
];

/** Walls a flying glass reflects off — 2D segments with a HEIGHT, so a
 *  lob clears the bar counter but a line drive rings off it. Axis-aligned
 *  like WALL_SEGMENTS; the heights are why it's a separate table. */
export const PROP_WALLS: Array<{ ax: number; az: number; bx: number; bz: number; h: number }> = [
  // Hall shell.
  { ax: -CLUB.halfW, az: CLUB.minZ, bx: CLUB.halfW, bz: CLUB.minZ, h: 6 },
  { ax: -CLUB.halfW, az: CLUB.maxZ, bx: CLUB.halfW, bz: CLUB.maxZ, h: 6 },
  { ax: -CLUB.halfW, az: CLUB.minZ, bx: -CLUB.halfW, bz: CLUB.maxZ, h: 6 },
  { ax: CLUB.halfW, az: CLUB.minZ, bx: CLUB.halfW, bz: CLUB.maxZ, h: 6 },
  // Still room interior walls (door gap stays open).
  { ax: CLUB.quiet.maxX, az: CLUB.quiet.minZ, bx: CLUB.quiet.maxX, bz: CLUB.quiet.maxZ, h: 2.5 },
  { ax: CLUB.quiet.minX, az: CLUB.quiet.maxZ, bx: CLUB.quiet.doorX0, bz: CLUB.quiet.maxZ, h: 2.5 },
  { ax: CLUB.quiet.doorX1, az: CLUB.quiet.maxZ, bx: CLUB.quiet.maxX, bz: CLUB.quiet.maxZ, h: 2.5 },
  // Arcade interior walls (west, and the north face split by its door).
  { ax: CLUB.arcade.minX, az: CLUB.arcade.minZ, bx: CLUB.arcade.minX, bz: CLUB.arcade.maxZ, h: 2.5 },
  { ax: CLUB.arcade.minX, az: CLUB.arcade.minZ, bx: CLUB.arcade.doorX0, bz: CLUB.arcade.minZ, h: 2.5 },
  { ax: CLUB.arcade.doorX1, az: CLUB.arcade.minZ, bx: CLUB.arcade.maxX, bz: CLUB.arcade.minZ, h: 2.5 },
  // The bar counter's front line — knee-to-top height only.
  { ax: CLUB.bar.x, az: CLUB.bar.z0 - 0.4, bx: CLUB.bar.x, bz: CLUB.bar.z1, h: CLUB.bar.top },
  // The stage face.
  {
    ax: -CLUB.stage.r - 0.4,
    az: CLUB.stage.z + CLUB.stage.r + 0.35,
    bx: CLUB.stage.r + 0.4,
    bz: CLUB.stage.z + CLUB.stage.r + 0.35,
    h: CLUB.stage.h,
  },
  // THE DJ CONSOLE — four sides of oak and brass to ring off. Height is the
  // desk top, so a lob clears it onto the surface and anything flatter
  // clatters off the fascia, which is exactly what a drink thrown at a
  // working booth should do.
  { ax: -CLUB.stage.desk.halfW, az: CLUB.stage.desk.z - CLUB.stage.desk.halfD, bx: CLUB.stage.desk.halfW, bz: CLUB.stage.desk.z - CLUB.stage.desk.halfD, h: CLUB.stage.desk.top },
  { ax: -CLUB.stage.desk.halfW, az: CLUB.stage.desk.z + CLUB.stage.desk.halfD, bx: CLUB.stage.desk.halfW, bz: CLUB.stage.desk.z + CLUB.stage.desk.halfD, h: CLUB.stage.desk.top },
  { ax: -CLUB.stage.desk.halfW, az: CLUB.stage.desk.z - CLUB.stage.desk.halfD, bx: -CLUB.stage.desk.halfW, bz: CLUB.stage.desk.z + CLUB.stage.desk.halfD, h: CLUB.stage.desk.top },
  { ax: CLUB.stage.desk.halfW, az: CLUB.stage.desk.z - CLUB.stage.desk.halfD, bx: CLUB.stage.desk.halfW, bz: CLUB.stage.desk.z + CLUB.stage.desk.halfD, h: CLUB.stage.desk.top },
];

export interface CoupeRefs {
  root: Group;
  /** The cocktail — hidden once drunk. */
  fill: Mesh;
  /** Emissive-lifted while this glass is the aim target. */
  glass: Mesh;
  /** Radius of the invisible grab proxy. */
  proxyR: number;
}

/** A hand-sized coupe with a magenta cocktail and a fat grab proxy. */
export function buildCoupe(): CoupeRefs {
  const root = new Group();
  const pts: Vector2[] = [
    new Vector2(0.001, 0),
    new Vector2(0.042, 0.003),
    new Vector2(0.006, 0.015),
    new Vector2(0.006, 0.112),
    new Vector2(0.03, 0.127),
    new Vector2(0.063, 0.15),
    new Vector2(0.066, 0.187),
  ];
  const glassMat = new MeshStandardMaterial({
    color: 0xd8e0e8,
    transparent: true,
    opacity: 0.34,
    roughness: 0.12,
    metalness: 0.1,
    depthWrite: false, // the room never occludes the drink inside
  });
  const glass = new Mesh(new LatheGeometry(pts, 14), glassMat);
  root.add(glass);

  const fill = new Mesh(
    new LatheGeometry(
      [new Vector2(0.001, 0.132), new Vector2(0.052, 0.145), new Vector2(0.058, 0.168), new Vector2(0.001, 0.169)],
      12,
    ),
    new MeshStandardMaterial({
      color: 0xff2ad5,
      emissive: 0xff2ad5,
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.85,
      roughness: 0.3,
    }),
  );
  root.add(fill);

  // The fix that makes slim props grabbable: a fat invisible proxy.
  const proxyR = 0.085;
  const proxy = new Mesh(new SphereGeometry(proxyR, 8, 6), new MeshStandardMaterial({ visible: false }));
  proxy.position.y = 0.11;
  root.add(proxy);

  return { root, fill, glass, proxyR };
}
