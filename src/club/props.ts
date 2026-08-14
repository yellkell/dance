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
} as const;

/** Landing surfaces the teleport floor doesn't know: places you can't
 *  stand but a glass can rest. (Everything standable — booth tables, the
 *  terrace, the still table — already answers through floorYAt.) */
export const PROP_SURFACES: Array<{ minX: number; maxX: number; minZ: number; maxZ: number; y: number }> = [
  // The bar counter top.
  { minX: CLUB.bar.x, maxX: CLUB.bar.x + CLUB.bar.depth, minZ: CLUB.bar.z0, maxZ: CLUB.bar.z1, y: CLUB.bar.top },
  // The stage (a square heart of the crescent — close enough for a glass).
  { minX: -2.6, maxX: 2.6, minZ: CLUB.stage.z - 0.2, maxZ: CLUB.stage.z + 2.6, y: CLUB.stage.h },
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
  // Arcade interior walls.
  { ax: CLUB.arcade.minX, az: CLUB.arcade.minZ, bx: CLUB.arcade.minX, bz: CLUB.arcade.maxZ, h: 2.5 },
  { ax: CLUB.arcade.minX, az: CLUB.arcade.maxZ, bx: CLUB.arcade.doorX0, bz: CLUB.arcade.maxZ, h: 2.5 },
  { ax: CLUB.arcade.doorX1, az: CLUB.arcade.maxZ, bx: CLUB.arcade.maxX, bz: CLUB.arcade.maxZ, h: 2.5 },
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
