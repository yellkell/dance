/**
 * THE CLUB — the venue itself. (It has no name; regulars just call it the
 * club, and the sign over the stage is a moon, not a word.)
 *
 * One double-height Art Deco hall the social floor fills: herringbone
 * parquet under an eclipse of counter-rotating brass rings, a crescent
 * stage under a brass sunburst, a smoked-oak bar with a backlit
 * ribbed-glass wall, oxblood velvet booths, a raised brass-railed terrace,
 * and a hushed STILL ROOM off the north-west corner for coming down. Where
 * FIRE FIGHT's club was diamond-plate and hazard amber, this is plaster,
 * oak, stone and champagne brass — the rave's neon is allowed in only as
 * LIGHT: coves, candles, signage, and the eclipse itself.
 *
 * Detail discipline (the reason it reads expensive): every edge that
 * matters carries thickness — skirting, dado and picture rails on the
 * walls, a nosing on every counter, fluting on every pilaster, joints in
 * the parquet, wear in the terrazzo, condensation rings on the marble.
 * Colour discipline: surfaces stay in the deco palette; saturation lives
 * in light fixtures only.
 *
 * Perf discipline: hundreds of meshes are baked to one draw call per
 * material look (collapseStatic); only the chandelier, the animated
 * materials and the candle flames stay live. Four real lights, everything
 * else emissive.
 */

import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  HemisphereLight,
  LatheGeometry,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  RingGeometry,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3,
  type Object3D,
  type Scene,
} from 'three';
import { PALETTE, hueToColor } from '../config.js';
import { glowTexture } from '../materials/glow.js';
import { FoyerEnvironment } from '../arena/environment.js';
import { CLUB, DECOR } from './config.js';
import {
  blackSteelMat,
  brassGlowMat,
  brassMat,
  bronzeMat,
  marbleTexture,
  oakTexture,
  parquetTexture,
  plasterTexture,
  ribbedGlassTexture,
  runnerTexture,
  terrazzoTexture,
  velvetTexture,
} from './materials.js';
import { collapseStatic } from './merge.js';
import { registerArcade } from './arcade.js';
import { font, onFontsReady } from '../ui/fonts.js';

export interface ChandelierRing {
  pivot: Group;
  glowMat: MeshStandardMaterial;
  speed: number;
}

/** The FOYER — the menu place. Not an antechamber of the club anymore but
 *  a piece of THE VOID (the set's own space, see arena/voidkit.ts): a
 *  floating platform in reactive darkness. The club's door is a button on
 *  the board, not a thing in the room. */
export interface FoyerRefs {
  root: Group;
  /** The world around the platform — ClubSystem idles it on the loop. */
  env: FoyerEnvironment;
}

/** Everything the systems animate or query — kept out of the static bake. */
export interface ClubRefs {
  root: Group;
  chandelier: {
    group: Group;
    rings: ChandelierRing[];
    moonMat: MeshStandardMaterial;
    coronaMat: SpriteMaterial;
  };
  /** The brass inlay rings set into the dance floor (beat shimmer). */
  inlayMat: MeshBasicMaterial;
  /** The backlit ribbed glass behind the bar (slow breathing). */
  barBackMat: MeshStandardMaterial;
  /** Every candle flame in the room shares this sprite material (flicker). */
  candleMat: SpriteMaterial;
  /** The still room's lamp (breathes very slowly — a resting pulse). */
  stillLampMat: MeshStandardMaterial;
  /** The DJ console's fader glow (bar-synced blink). */
  consoleMat: MeshBasicMaterial;
}

const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;

/** A box with its transform applied — the workhorse of the whole build. */
function box(
  parent: Object3D,
  mat: MeshStandardMaterial | MeshBasicMaterial,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  ry = 0,
): Mesh {
  const m = new Mesh(new BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  if (ry) m.rotation.y = ry;
  parent.add(m);
  return m;
}

/** A round upholstered puck with filleted rims (stool + bench cushions). */
function roundedPuck(radius: number, height: number, fillet = 0.03): LatheGeometry {
  const r = Math.min(fillet, radius * 0.49, height * 0.49);
  const hh = height / 2;
  const pts: Vector2[] = [new Vector2(0.001, -hh)];
  for (let i = 0; i <= 4; i++) {
    const a = -Math.PI / 2 + (i / 4) * (Math.PI / 2);
    pts.push(new Vector2(radius - r + Math.cos(a) * r, -hh + r + Math.sin(a) * r));
  }
  for (let i = 0; i <= 4; i++) {
    const a = (i / 4) * (Math.PI / 2);
    pts.push(new Vector2(radius - r + Math.cos(a) * r, hh - r + Math.sin(a) * r));
  }
  pts.push(new Vector2(0.001, hh));
  return new LatheGeometry(pts, 20);
}

/** An elegant canvas sign plane (unlit, so it reads in any gloom). */
function signPlane(w: number, h: number, px: number, draw: (g: CanvasRenderingContext2D, W: number, H: number) => void): Mesh {
  const c = document.createElement('canvas');
  c.width = px;
  c.height = Math.round((px * h) / w);
  const g = c.getContext('2d')!;
  draw(g, c.width, c.height);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  // The venue is built before the house woff2s land — re-ink the signage
  // the moment the real glyphs arrive (first paint used the fallback).
  onFontsReady(() => {
    g.clearRect(0, 0, c.width, c.height);
    draw(g, c.width, c.height);
    tex.needsUpdate = true;
  });
  const mesh = new Mesh(
    new PlaneGeometry(w, h),
    new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  mesh.renderOrder = 6;
  return mesh;
}

/* ═════════════════════════════ THE BUILD ═════════════════════════════════ */

export function buildClub(scene: Scene): ClubRefs {
  const root = new Group();
  root.name = 'the-club';

  const W = CLUB.halfW;
  const NZ = CLUB.minZ;
  const SZ = CLUB.maxZ;
  const H = CLUB.ceilH;

  buildFloors(root);
  buildWalls(root, W, NZ, SZ, H);
  buildCeiling(root, W, NZ, SZ, H);
  const chandelier = buildChandelier(root);
  const consoleMat = buildStage(root);
  const barBackMat = buildBar(root);
  const candleMat = new SpriteMaterial({
    map: glowTexture(),
    color: DECOR.candle,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    opacity: 0.85,
  });
  buildBooths(root, candleMat);
  buildTerrace(root);
  buildVestibule(root);
  const stillLampMat = buildStillRoom(root, candleMat);
  buildArcade(root);
  const inlayMat = buildFloorInlay(root);
  buildLights(root);

  scene.add(root);

  // ── bake the static shell to a handful of draw calls ──────────────────
  // Live things wear a 'live-' name (and lights/sprites never merge).
  collapseStatic(root, (o) => {
    for (let n: Object3D | null = o; n; n = n.parent) {
      if (n.name.startsWith('live-')) return true;
      if (n === root) break;
    }
    return false;
  });

  return {
    root,
    chandelier,
    inlayMat,
    barBackMat,
    candleMat,
    stillLampMat,
    consoleMat,
  };
}

/* ── floors: parquet heart, terrazzo field, runner in the lounge ────────── */

function buildFloors(root: Group): void {
  const F = CLUB.floor;

  // Terrazzo everywhere first (the walkway field the parquet sits into).
  const terrazzo = new MeshStandardMaterial({
    map: terrazzoTexture([9, 8]),
    metalness: 0.25,
    roughness: 0.4,
  });
  const field = new Mesh(new PlaneGeometry(CLUB.halfW * 2, CLUB.maxZ - CLUB.minZ), terrazzo);
  field.rotation.x = -Math.PI / 2;
  field.position.set(0, 0, (CLUB.minZ + CLUB.maxZ) / 2);
  root.add(field);

  // The dance floor: herringbone parquet disc, a hair proud so it never
  // z-fights the field, with a bronze surround ring easing the step.
  const parquet = new Mesh(
    new CircleGeometry(F.r, 56),
    new MeshStandardMaterial({ map: parquetTexture([5, 5]), metalness: 0.16, roughness: 0.5 }),
  );
  parquet.rotation.x = -Math.PI / 2;
  parquet.position.set(F.x, 0.012, F.z);
  root.add(parquet);
  const surround = new Mesh(new RingGeometry(F.r, F.r + 0.14, 56), bronzeMat());
  surround.rotation.x = -Math.PI / 2;
  surround.position.set(F.x, 0.013, F.z);
  root.add(surround);

  // The lounge runner: a deco carpet down the booth aisle.
  const runner = new Mesh(
    new PlaneGeometry(1.7, 7.6),
    new MeshStandardMaterial({ map: runnerTexture([1, 3]), roughness: 0.92, metalness: 0 }),
  );
  runner.rotation.x = -Math.PI / 2;
  runner.position.set(-6.1, 0.011, -3.4);
  root.add(runner);
}

/** The brass inlay set into the parquet — the raid ring's ghost: an outer
 *  ring, an inner ring, and 24 seat ticks. ClubSystem shimmers it. */
function buildFloorInlay(root: Group): MeshBasicMaterial {
  const F = CLUB.floor;
  const mat = new MeshBasicMaterial({
    color: DECOR.brass,
    transparent: true,
    opacity: 0.5,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const holder = new Group();
  holder.name = 'live-floor-inlay';
  holder.position.set(F.x, 0.017, F.z);
  const outer = new Mesh(new RingGeometry(F.r - 0.34, F.r - 0.28, 64), mat);
  outer.rotation.x = -Math.PI / 2;
  holder.add(outer);
  const inner = new Mesh(new RingGeometry(1.05, 1.09, 48), mat);
  inner.rotation.x = -Math.PI / 2;
  holder.add(inner);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const tick = new Mesh(new PlaneGeometry(0.05, 0.3), mat);
    tick.rotation.x = -Math.PI / 2;
    tick.rotation.z = -a;
    tick.position.set(Math.sin(a) * (F.r - 0.62), 0, Math.cos(a) * (F.r - 0.62));
    holder.add(tick);
  }
  root.add(holder);
  return mat;
}

/* ── walls: plaster panels, brass fluting, rails, drapes, sconces ───────── */

function buildWalls(root: Group, W: number, NZ: number, SZ: number, H: number): void {
  const plaster = new MeshStandardMaterial({ map: plasterTexture([5, 1.6]), roughness: 0.94, metalness: 0.02 });
  const wall = (w: number, x: number, z: number, ry: number): void => {
    const m = new Mesh(new PlaneGeometry(w, H + 1.8), plaster);
    // Walls run past the nominal ceiling: the dome steps read against them.
    m.position.set(x, (H + 1.8) / 2, z);
    m.rotation.y = ry;
    root.add(m);
  };
  wall(W * 2, 0, NZ, 0); // north — the stage's drape wall covers most of it
  wall(W * 2, 0, SZ, Math.PI); // south (vestibule)
  wall(SZ - NZ, -W, (NZ + SZ) / 2, Math.PI / 2); // west
  wall(SZ - NZ, W, (NZ + SZ) / 2, -Math.PI / 2); // east

  // Trim lines every wall carries: skirting, dado rail, picture rail — the
  // three horizontal registers that make plaster read as a dressed room.
  const skirt = blackSteelMat();
  const railMat = brassMat(0.34);
  for (const [len, x, z, ry] of [
    [W * 2, 0, NZ + 0.02, 0],
    [W * 2, 0, SZ - 0.02, Math.PI],
    [SZ - NZ, -W + 0.02, (NZ + SZ) / 2, Math.PI / 2],
    [SZ - NZ, W - 0.02, (NZ + SZ) / 2, -Math.PI / 2],
  ] as const) {
    box(root, skirt, len, 0.16, 0.03, x, 0.08, z, ry);
    box(root, railMat, len, 0.035, 0.02, x, 1.0, z, ry);
    box(root, railMat, len, 0.05, 0.025, x, 2.62, z, ry);
  }

  // Fluted brass pilasters pace the long walls — each a slim core wrapped
  // in reeds with a stepped plinth and capital, deco to the bone. Spacing
  // varies subtly (the anti-repetition rule: no five modules identical).
  const coreMat = bronzeMat();
  const reedMat = brassMat(0.3);
  const pilaster = (x: number, z: number): void => {
    const g = new Group();
    g.position.set(x, 0, z);
    const plinthL = new Mesh(new BoxGeometry(0.4, 0.14, 0.24), skirt);
    plinthL.position.y = 0.07;
    g.add(plinthL);
    const core = new Mesh(new CylinderGeometry(0.085, 0.1, 2.44, 10), coreMat);
    core.position.y = 1.36;
    g.add(core);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const reed = new Mesh(new CylinderGeometry(0.02, 0.024, 2.4, 6), reedMat);
      reed.position.set(Math.sin(a) * 0.085, 1.36, Math.cos(a) * 0.085);
      g.add(reed);
    }
    const cap = new Mesh(new BoxGeometry(0.36, 0.09, 0.22), railMat);
    cap.position.y = 2.62;
    g.add(cap);
    const capStep = new Mesh(new BoxGeometry(0.28, 0.07, 0.18), skirt);
    capStep.position.y = 2.71;
    g.add(capStep);
    root.add(g);
  };
  // East wall (between bar and corners) + west wall (pacing the booths).
  for (const z of [-8.1, 1.6, 3.0]) pilaster(W - 0.14, z);
  for (const z of [-7.9, -4.9, -1.9, 1.4, 3.0]) pilaster(-W + 0.14, z);
  // South wall, flanking the vestibule.
  for (const x of [-3.1, 3.1, -6.4, 6.4]) pilaster(x, SZ - 0.14);

  // Sconces: brass stem, half-shade, and a warm double glow (up + down).
  const shadeMat = brassGlowMat(0.55);
  const glowMat = new SpriteMaterial({
    map: glowTexture(),
    color: DECOR.cove,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    opacity: 0.5,
  });
  const sconce = (x: number, z: number, ry: number): void => {
    const g = new Group();
    g.position.set(x, 1.78, z);
    g.rotation.y = ry;
    const back = new Mesh(new BoxGeometry(0.1, 0.34, 0.02), coreMat);
    g.add(back);
    const shade = new Mesh(new CylinderGeometry(0.075, 0.045, 0.2, 10, 1, true), shadeMat);
    shade.position.set(0, 0.06, 0.09);
    g.add(shade);
    const up = new Sprite(glowMat);
    up.scale.setScalar(0.55);
    up.position.set(0, 0.28, 0.1);
    g.add(up);
    const down = new Sprite(glowMat);
    down.scale.setScalar(0.34);
    down.position.set(0, -0.18, 0.1);
    g.add(down);
    root.add(g);
  };
  for (const z of [-7.0, 0.5, 2.4]) sconce(W - 0.16, z, -Math.PI / 2);
  for (const z of [-6.35, -3.45, -0.55, 2.4]) sconce(-W + 0.16, z, Math.PI / 2);
  for (const x of [-4.75, 4.75]) sconce(x, SZ - 0.16, Math.PI);
}

/* ── ceiling: a stepped deco dome over the floor, coved all the way up ──── */

function buildCeiling(root: Group, W: number, NZ: number, SZ: number, H: number): void {
  const F = CLUB.floor;
  const slabMat = new MeshStandardMaterial({ color: DECOR.plasterDeep, roughness: 0.95, metalness: 0.02 });
  const fasciaMat = new MeshStandardMaterial({ color: 0x1c1922, roughness: 0.9, metalness: 0.05 });
  const coveMat = brassGlowMat(1.5);

  // Main slab with a circular opening over the dance floor — built as four
  // rectangles + a ring closing the circle.
  const R0 = 3.3;
  const slab = (w: number, d: number, x: number, z: number): void => {
    const m = new Mesh(new PlaneGeometry(w, d), slabMat);
    m.rotation.x = Math.PI / 2;
    m.position.set(x, H, z);
    root.add(m);
  };
  slab(W * 2, F.z - R0 - NZ, 0, (NZ + F.z - R0) / 2); // north of the opening
  slab(W * 2, SZ - (F.z + R0), 0, (F.z + R0 + SZ) / 2); // south
  slab(W - F.r + (F.r - R0), F.z + R0 - (F.z - R0), -(W + R0) / 2 + 0, F.z); // west strip
  slab(W - R0, R0 * 2, (W + R0) / 2, F.z); // east strip
  const closer = new Mesh(new RingGeometry(R0, R0 + 1.02, 40), slabMat);
  closer.rotation.x = Math.PI / 2;
  closer.position.set(F.x, H - 0.001, F.z);
  root.add(closer);

  // The dome: three stepped rings rising to a cap — each step a vertical
  // fascia + flat ring, with a brass cove strip glowing on every inner lip.
  const steps = [
    { r: R0, up: 0.55 },
    { r: 2.55, up: 0.55 },
    { r: 1.85, up: 0.6 },
  ];
  let y = H;
  for (const s of steps) {
    const fascia = new Mesh(new CylinderGeometry(s.r, s.r, s.up, 40, 1, true), fasciaMat);
    fascia.position.set(F.x, y + s.up / 2, F.z);
    (fascia.material as MeshStandardMaterial).side = DoubleSide;
    root.add(fascia);
    y += s.up;
    const next = steps[steps.indexOf(s) + 1]?.r ?? 1.3;
    const tread = new Mesh(new RingGeometry(next, s.r, 40), slabMat);
    tread.rotation.x = Math.PI / 2;
    tread.position.set(F.x, y, F.z);
    root.add(tread);
    // The cove: a slim glowing torus tucked into each step's corner.
    const cove = new Mesh(new TorusGeometry(s.r - 0.06, 0.022, 6, 48), coveMat);
    cove.rotation.x = Math.PI / 2;
    cove.position.set(F.x, y - 0.05, F.z);
    root.add(cove);
  }
  const cap = new Mesh(new CircleGeometry(1.3, 32), fasciaMat);
  cap.rotation.x = Math.PI / 2;
  cap.position.set(F.x, y, F.z);
  root.add(cap);

  // Perimeter cove where the walls meet the slab — the room's base glow.
  const runMat = brassGlowMat(1.0);
  for (const [len, x, z, ry] of [
    [W * 2 - 0.3, 0, NZ + 0.09, 0],
    [W * 2 - 0.3, 0, SZ - 0.09, 0],
    [SZ - NZ - 0.3, -W + 0.09, (NZ + SZ) / 2, Math.PI / 2],
    [SZ - NZ - 0.3, W - 0.09, (NZ + SZ) / 2, Math.PI / 2],
  ] as const) {
    box(root, runMat, len, 0.045, 0.045, x, H - 0.05, z, ry);
  }
}

/* ── the eclipse chandelier ─────────────────────────────────────────────── */

function buildChandelier(root: Group): ClubRefs['chandelier'] {
  const F = CLUB.floor;
  const group = new Group();
  group.name = 'live-chandelier';
  group.position.set(F.x, CLUB.chandelier.y, F.z);
  root.add(group);

  const cableMat = blackSteelMat();
  const rings: ChandelierRing[] = [];
  CLUB.chandelier.rings.forEach((def, i) => {
    const pivot = new Group();
    // Each ring hangs at its own height — a shallow inverted cone of rings.
    pivot.position.y = i * 0.16;
    group.add(pivot);

    const brass = new Mesh(new TorusGeometry(def.r, 0.028, 10, 56), brassMat(0.22));
    brass.rotation.x = Math.PI / 2;
    pivot.add(brass);

    // The LED channel on the ring's underside — this is what phases.
    const glowMat = brassGlowMat(1.4);
    const glow = new Mesh(new TorusGeometry(def.r, 0.011, 6, 56), glowMat);
    glow.rotation.x = Math.PI / 2;
    glow.position.y = -0.035;
    pivot.add(glow);

    // Three hanger cables per ring, up into the dome.
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + i * 0.6;
      const drop = 1.6 - i * 0.16;
      const cable = new Mesh(new CylinderGeometry(0.004, 0.004, drop, 4), cableMat);
      cable.position.set(Math.sin(a) * def.r, drop / 2, Math.cos(a) * def.r);
      pivot.add(cable);
    }
    rings.push({ pivot, glowMat, speed: def.speed });
  });

  // The moon at the heart — a disc of moon-white with a bronze occluder
  // easing across it: the eclipse. The corona halo breathes on the bar.
  const moonMat = new MeshStandardMaterial({
    color: 0x2a2a33,
    emissive: DECOR.moon,
    emissiveIntensity: 1.1,
    roughness: 0.5,
    metalness: 0.1,
  });
  const moon = new Mesh(new CylinderGeometry(0.3, 0.3, 0.05, 28), moonMat);
  group.add(moon);
  const shadowMat = new MeshStandardMaterial({ color: 0x14100e, roughness: 0.8, metalness: 0.3 });
  const occluder = new Mesh(new CylinderGeometry(0.27, 0.27, 0.056, 28), shadowMat);
  occluder.position.set(0.13, 0, 0.05);
  group.add(occluder);
  const coronaMat = new SpriteMaterial({
    map: glowTexture(),
    color: DECOR.moon,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    opacity: 0.55,
  });
  const corona = new Sprite(coronaMat);
  corona.scale.setScalar(1.5);
  group.add(corona);
  const stem = new Mesh(new CylinderGeometry(0.012, 0.012, 1.6, 6), cableMat);
  stem.position.y = 0.8;
  group.add(stem);

  return { group, rings, moonMat, coronaMat };
}

/* ── the stage: crescent riser, DJ console, sunburst, drapes ────────────── */

function buildStage(root: Group): MeshBasicMaterial {
  const S = CLUB.stage;
  const oakSkirtMat = new MeshStandardMaterial({ map: oakTexture([6, 1]), roughness: 0.55, metalness: 0.05 });
  const topMat = new MeshStandardMaterial({ map: parquetTexture([3, 3]), metalness: 0.2, roughness: 0.42 });

  // Riser: a half-drum bulging SOUTH toward the crowd. Skirt, lid and
  // nosing all cover the SAME half now — the three used to be authored a
  // half-turn apart, so the curved skirt hid inside the wall and the whole
  // front of the stage was an open see-through shell.
  const drum = new Mesh(new CylinderGeometry(S.r, S.r, S.h, 40, 1, true, -Math.PI / 2, Math.PI), oakSkirtMat);
  drum.position.set(0, S.h / 2, S.z);
  root.add(drum);
  const lid = new Mesh(new CircleGeometry(S.r, 40, Math.PI, Math.PI), topMat);
  lid.rotation.x = -Math.PI / 2;
  lid.position.set(0, S.h + 0.001, S.z);
  root.add(lid);
  // The flat back of the half-drum, closed — the backstage walk sees a
  // panelled face, not the underside of the lid.
  box(root, oakSkirtMat, S.r * 2, S.h, 0.07, 0, S.h / 2, S.z - 0.03);
  // Brass nosing along the curved lip + two shallow guest steps at centre.
  const nose = new Mesh(new TorusGeometry(S.r, 0.02, 8, 40, Math.PI), brassMat(0.25));
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, S.h, S.z);
  root.add(nose);
  const stepMat = blackSteelMat();
  box(root, stepMat, 1.6, 0.15, 0.34, 0, 0.075, S.z + S.r + 0.14);
  box(root, stepMat, 1.2, 0.3, 0.3, 0, 0.15, S.z + S.r - 0.05);

  // THE SUNBURST: brass ribs fanning from a half-disc hub on the wall — the
  // deco signature, sized to crown the whole stage.
  const hubY = S.h + 1.15;
  const wallZ = CLUB.minZ + 0.1;
  const ribMat = brassMat(0.3);
  const RIBS = 21;
  for (let i = 0; i < RIBS; i++) {
    const a = (i / (RIBS - 1)) * Math.PI - Math.PI / 2; // −90°…+90° fan
    const len = 2.5 + (i % 2) * 0.5; // alternating lengths — a real burst
    const rib = new Mesh(new BoxGeometry(0.05, len, 0.03), ribMat);
    rib.position.set(Math.sin(a) * (len / 2 + 0.42), hubY + Math.cos(a) * (len / 2 + 0.42), wallZ);
    rib.rotation.z = -a;
    root.add(rib);
  }
  const hub = new Mesh(new CircleGeometry(0.42, 24, 0, Math.PI), brassGlowMat(0.8));
  hub.position.set(0, hubY, wallZ + 0.01);
  root.add(hub);

  // Velvet drapes across the whole north wall behind the burst: full-height
  // panels hung in alternating relief so the pleats catch the cove light.
  const drapeMat = new MeshStandardMaterial({ map: velvetTexture([2, 1], 6), roughness: 0.96, metalness: 0 });
  for (let i = 0; i < 12; i++) {
    const x = -8.25 + i * 1.5;
    const panel = new Mesh(new PlaneGeometry(1.56, 4.6), drapeMat);
    panel.position.set(x, 2.3, CLUB.minZ + 0.05 + (i % 2) * 0.05);
    root.add(panel);
  }
  // Brass drape rail with finials.
  box(root, brassMat(0.3), 16.9, 0.05, 0.05, 0, 4.62, CLUB.minZ + 0.09);

  // The DJ console: an angled smoked-oak desk with a glowing fader strip
  // and two platters — where the MC earns the name.
  const deskMat = new MeshStandardMaterial({ map: oakTexture([2, 1]), roughness: 0.5, metalness: 0.08 });
  const console = new Group();
  console.position.set(0, S.h, S.z + 0.9);
  // The desk WORKS for the MC: fascia, fader surface and platters face HIM
  // (he stands north of it, deeper on the stage) — the crowd gets the oak
  // back of a working console, the way a real booth reads.
  console.rotation.y = Math.PI;
  const body = new Mesh(new BoxGeometry(2.2, 0.92, 0.6), deskMat);
  body.position.y = 0.46;
  console.add(body);
  const fascia = new Mesh(new BoxGeometry(2.24, 0.2, 0.62), brassMat(0.35));
  fascia.position.y = 0.86;
  console.add(fascia);
  // The lit control surface (canvas: faders, dials, a spectrum bar).
  const cc = document.createElement('canvas');
  cc.width = 512;
  cc.height = 128;
  const g = cc.getContext('2d')!;
  g.fillStyle = '#0c0a12';
  g.fillRect(0, 0, 512, 128);
  for (let i = 0; i < 9; i++) {
    const x = 36 + i * 40;
    g.strokeStyle = 'rgba(201,168,106,0.8)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(x, 22);
    g.lineTo(x, 106);
    g.stroke();
    g.fillStyle = i % 3 === 0 ? css(PALETTE.magenta) : i % 3 === 1 ? css(PALETTE.cyan) : css(DECOR.cove);
    g.fillRect(x - 9, 34 + ((i * 37) % 52), 18, 10);
  }
  for (let i = 0; i < 4; i++) {
    g.strokeStyle = 'rgba(201,168,106,0.9)';
    g.beginPath();
    g.arc(420 + (i % 2) * 52, 40 + Math.floor(i / 2) * 52, 14, 0, Math.PI * 2);
    g.stroke();
  }
  const consoleTex = new CanvasTexture(cc);
  consoleTex.colorSpace = SRGBColorSpace;
  const consoleMat = new MeshBasicMaterial({ map: consoleTex, transparent: true });
  const surface = new Mesh(new PlaneGeometry(2.0, 0.5), consoleMat);
  surface.rotation.x = -Math.PI / 2 + 0.42;
  surface.position.set(0, 0.97, 0.06);
  surface.name = 'live-console';
  console.add(surface);
  for (const sx of [-0.62, 0.62]) {
    const platter = new Mesh(new CylinderGeometry(0.22, 0.22, 0.03, 24), blackSteelMat());
    platter.position.set(sx, 0.945, 0.02);
    platter.rotation.x = 0.42 * 0.5;
    console.add(platter);
    const pip = new Mesh(new CylinderGeometry(0.035, 0.035, 0.036, 12), brassMat(0.2));
    pip.position.set(sx, 0.95, 0.02);
    pip.rotation.x = 0.42 * 0.5;
    console.add(pip);
  }
  root.add(console);

  // Nothing hangs over the stage: the wall behind the MC is his backdrop,
  // not a billboard. (The moon-phase house mark used to live here.)

  // Footlights along the stage lip: a run of small warm scallops so the
  // riser face reads and the MC gets his uplight.
  const footMat = brassGlowMat(1.6);
  for (let i = -3; i <= 3; i++) {
    const a = (i / 8) * Math.PI; // spread across the crescent's front
    const fx = Math.sin(a) * (S.r - 0.12);
    const fz = S.z + Math.cos(a) * (S.r - 0.12);
    const scallop = new Mesh(new CylinderGeometry(0.05, 0.07, 0.045, 10, 1, false, 0, Math.PI), footMat);
    scallop.position.set(fx, S.h + 0.02, fz);
    scallop.rotation.y = Math.PI - a;
    root.add(scallop);
  }

  return consoleMat;
}

/* ── the bar: smoked oak, honed marble, backlit ribbed glass ────────────── */

function buildBar(root: Group): MeshStandardMaterial {
  const B = CLUB.bar;
  const len = B.z1 - B.z0;
  const zc = (B.z0 + B.z1) / 2;

  // Counter: fluted oak front (slats), marble slab, brass nosing, foot rail.
  const oakMat = new MeshStandardMaterial({ map: oakTexture([4, 1]), roughness: 0.52, metalness: 0.06 });
  box(root, oakMat, 0.1, B.top - 0.05, len, B.x + 0.26, (B.top - 0.05) / 2, zc);
  const slatMat = new MeshStandardMaterial({ color: DECOR.oakDark, roughness: 0.6, metalness: 0.05 });
  const slats = Math.floor(len / 0.14);
  for (let i = 0; i < slats; i++) {
    box(root, slatMat, 0.05, B.top - 0.14, 0.07, B.x + 0.005, (B.top - 0.14) / 2, B.z0 + 0.1 + i * 0.14);
  }
  const marble = new MeshStandardMaterial({ map: marbleTexture([4, 1]), metalness: 0.2, roughness: 0.22 });
  box(root, marble, 0.78, 0.045, len + 0.16, B.x + 0.32, B.top - 0.0225, zc);
  box(root, brassMat(0.25), 0.035, 0.05, len + 0.1, B.x - 0.02, B.top - 0.03, zc);
  const railBrass = brassMat(0.3);
  const foot = new Mesh(new CylinderGeometry(0.021, 0.021, len - 0.2, 8), railBrass);
  foot.rotation.x = Math.PI / 2;
  foot.position.set(B.x - 0.12, 0.22, zc);
  root.add(foot);
  for (const z of [B.z0 + 0.3, zc, B.z1 - 0.3]) {
    const bracket = new Mesh(new CylinderGeometry(0.014, 0.014, 0.16, 6), railBrass);
    bracket.rotation.z = Math.PI / 2 - 0.5;
    bracket.position.set(B.x - 0.05, 0.16, z);
    root.add(bracket);
  }

  // Condensation rings on the marble — the loved-in detail at 0.3 m.
  const ringStain = new MeshBasicMaterial({
    color: 0xbfc8d8,
    transparent: true,
    opacity: 0.1,
    depthWrite: false,
  });
  for (const [rx, rz] of [
    [B.x + 0.3, zc - 1.3],
    [B.x + 0.42, zc + 0.6],
    [B.x + 0.24, zc + 2.1],
  ] as const) {
    const stain = new Mesh(new RingGeometry(0.035, 0.046, 20), ringStain);
    stain.rotation.x = -Math.PI / 2;
    stain.position.set(rx, B.top + 0.002, rz);
    root.add(stain);
  }

  // The back bar: a backlit ribbed-glass wall in a brass grid, three marble
  // shelves of lathe-turned bottles, and the spirits ladder lighting them.
  const glassMat = new MeshStandardMaterial({
    map: ribbedGlassTexture([7, 1]),
    emissive: DECOR.cove,
    emissiveIntensity: 0.42,
    emissiveMap: ribbedGlassTexture([7, 1]),
    roughness: 0.4,
    metalness: 0.1,
  });
  const back = new Mesh(new PlaneGeometry(len + 0.4, 2.5), glassMat);
  back.rotation.y = -Math.PI / 2;
  back.position.set(B.backX, 1.5, zc);
  back.name = 'live-bar-back';
  root.add(back);
  // Brass grid over the glass.
  for (let i = 0; i <= 4; i++) {
    box(root, railBrass, 0.03, 2.5, 0.03, B.backX - 0.02, 1.5, B.z0 - 0.2 + (i * (len + 0.4)) / 4, 0);
  }
  box(root, railBrass, 0.04, 0.04, len + 0.44, B.backX - 0.02, 2.76, zc);
  box(root, railBrass, 0.04, 0.04, len + 0.44, B.backX - 0.02, 0.26, zc);

  // Shelves + bottles. Profiles vary (squat rum, tall spirit, bulb liqueur);
  // tints are the drinks' — the one place saturated colour touches glass.
  const shelfMat = new MeshStandardMaterial({ map: marbleTexture([3, 0.4]), metalness: 0.2, roughness: 0.25 });
  const bottleTints = [0xc97a1e, 0x8a3a10, 0x4fb7ff, 0x7dff5a, 0xb06bff, 0xe8352a, 0xf2e9d4, 0xffd24a];
  const bottleProfile = (h: number, r: number, kind: number): Vector2[] => {
    const bodyTop = h * (kind === 0 ? 0.62 : kind === 1 ? 0.5 : 0.42);
    const neckR = r * (kind === 2 ? 0.24 : 0.3);
    return [
      new Vector2(0.001, 0),
      new Vector2(r * 0.88, 0),
      new Vector2(r, h * 0.06),
      new Vector2(r, bodyTop),
      new Vector2(r * (kind === 2 ? 0.9 : 0.66), h * (bodyTop / h + 0.16)),
      new Vector2(neckR, h * 0.85),
      new Vector2(neckR, h * 0.94),
      new Vector2(neckR * 1.5, h * 0.95),
      new Vector2(neckR * 1.5, h),
      new Vector2(0.001, h),
    ];
  };
  for (let shelf = 0; shelf < 3; shelf++) {
    const y = 0.62 + shelf * 0.56;
    box(root, shelfMat, 0.26, 0.03, len - 0.3, B.backX - 0.16, y, zc);
    const count = 9 - shelf;
    for (let i = 0; i < count; i++) {
      const tint = bottleTints[(i * 3 + shelf * 5) % bottleTints.length];
      const h = 0.24 + ((i + shelf) % 3) * 0.035;
      const bottle = new Mesh(
        new LatheGeometry(bottleProfile(h, 0.036, (i + shelf) % 3), 10),
        new MeshStandardMaterial({
          color: tint,
          emissive: tint,
          emissiveIntensity: 0.32,
          transparent: true,
          opacity: 0.88,
          roughness: 0.18,
          metalness: 0.05,
        }),
      );
      bottle.position.set(B.backX - 0.16, y + 0.015, B.z0 + 0.55 + i * ((len - 1.1) / (count - 1)));
      root.add(bottle);
    }
  }

  // Five brass pendants over the counter — cones on long stems, glowing.
  const pendantShade = brassGlowMat(1.15);
  const glow = new SpriteMaterial({
    map: glowTexture(),
    color: DECOR.candle,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    opacity: 0.55,
  });
  for (let i = 0; i < 5; i++) {
    const z = B.z0 + 0.7 + i * ((len - 1.4) / 4);
    const stem = new Mesh(new CylinderGeometry(0.006, 0.006, CLUB.ceilH - 1.9, 4), blackSteelMat());
    stem.position.set(B.x + 0.3, CLUB.ceilH - (CLUB.ceilH - 1.9) / 2, z);
    root.add(stem);
    const shade = new Mesh(new CylinderGeometry(0.028, 0.11, 0.16, 12, 1, true), pendantShade);
    shade.position.set(B.x + 0.3, 1.86, z);
    root.add(shade);
    const halo = new Sprite(glow);
    halo.scale.setScalar(0.5);
    halo.position.set(B.x + 0.3, 1.76, z);
    root.add(halo);
  }

  // Stools: velvet pucks on brass columns, footring included.
  const seatMat = new MeshStandardMaterial({ map: velvetTexture([1, 1]), roughness: 0.95, metalness: 0 });
  for (let i = 0; i < 6; i++) {
    const z = B.z0 + 0.75 + i * ((len - 1.5) / 5);
    const g = new Group();
    g.position.set(B.x - 0.55, 0, z);
    const column = new Mesh(new CylinderGeometry(0.03, 0.05, 0.66, 10), railBrass);
    column.position.y = 0.33;
    g.add(column);
    const base = new Mesh(new CylinderGeometry(0.17, 0.19, 0.025, 14), bronzeMat());
    base.position.y = 0.0125;
    g.add(base);
    const ring = new Mesh(new TorusGeometry(0.12, 0.011, 6, 14), railBrass);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.24;
    g.add(ring);
    const seat = new Mesh(roundedPuck(0.17, 0.09, 0.035), seatMat);
    seat.position.y = 0.7;
    g.add(seat);
    root.add(g);
  }

  // A quiet little BAR sign in the deco manner, on the east wall's rail.
  const barSign = signPlane(0.8, 0.26, 512, (s, sw, sh) => {
    s.textAlign = 'center';
    s.textBaseline = 'middle';
    s.fillStyle = '#e8d9b0';
    s.shadowColor = 'rgba(255,196,110,0.9)';
    s.shadowBlur = 14;
    s.font = `500 88px Georgia, serif`;
    s.fillText('B A R', sw / 2, sh / 2 + 4);
  });
  barSign.name = 'live-bar-sign';
  barSign.rotation.y = -Math.PI / 2;
  barSign.position.set(CLUB.halfW - 0.1, 2.9, zc);
  root.add(barSign);

  return glassMat;
}

/* ── booths: velvet horseshoes, marble tables, candlelight ──────────────── */

function buildBooths(root: Group, candleMat: SpriteMaterial): void {
  const bx = CLUB.boothX;
  const seatVelvet = new MeshStandardMaterial({ map: velvetTexture([2, 1]), roughness: 0.96, metalness: 0 });
  const backVelvet = new MeshStandardMaterial({
    map: velvetTexture([3, 1], 9),
    roughness: 0.96,
    metalness: 0,
    side: DoubleSide,
  });
  const marble = new MeshStandardMaterial({ map: marbleTexture([1, 1]), metalness: 0.2, roughness: 0.22 });

  for (const bz of CLUB.boothZs) {
    const g = new Group();
    g.position.set(bx, 0, bz);
    g.rotation.y = Math.PI / 2; // horseshoe opens east, into the room

    // Plinth + curved bench: a half-torus seat ring on a low base drum.
    // EVERY arc here covers the same half now — the drums and the torus
    // rings used to be authored a quarter-turn apart, which left the seat
    // hanging past the plinth with see-through gaps flanking each booth.
    const plinth = new Mesh(new CylinderGeometry(1.16, 1.2, 0.14, 26, 1, false, Math.PI / 2, Math.PI), blackSteelMat());
    plinth.position.y = 0.07;
    g.add(plinth);
    const seat = new Mesh(new TorusGeometry(0.92, 0.2, 10, 26, Math.PI), seatVelvet);
    seat.rotation.x = -Math.PI / 2;
    seat.position.y = 0.42;
    g.add(seat);
    // The seat ring's open tube mouths, closed with velvet bolsters.
    for (const ex of [-0.92, 0.92]) {
      const bolster = new Mesh(new SphereGeometry(0.2, 12, 10), seatVelvet);
      bolster.position.set(ex, 0.42, 0);
      g.add(bolster);
    }
    // The channel-tufted back wall wraps the horseshoe, capped in brass.
    const backWall = new Mesh(new CylinderGeometry(1.18, 1.18, 0.95, 26, 1, true, Math.PI / 2, Math.PI), backVelvet);
    backWall.position.y = 0.85;
    g.add(backWall);
    const cap = new Mesh(new TorusGeometry(1.18, 0.028, 8, 26, Math.PI), brassMat(0.3));
    cap.rotation.x = -Math.PI / 2;
    cap.position.y = 1.33;
    g.add(cap);
    // Bronze edge posts where the back wall ends at the mouth — a finished
    // entry instead of a raw shell edge.
    for (const ex of [-1.18, 1.18]) {
      const post = new Mesh(new CylinderGeometry(0.035, 0.04, 0.95, 10), bronzeMat());
      post.position.set(ex, 0.85, 0);
      g.add(post);
    }

    // Table: honed marble on a brass pedestal, dressed for the evening.
    const pedestal = new Mesh(new CylinderGeometry(0.045, 0.1, 0.72, 12), brassMat(0.3));
    pedestal.position.y = 0.36;
    g.add(pedestal);
    const top = new Mesh(new CylinderGeometry(0.42, 0.42, 0.035, 24), marble);
    top.position.y = 0.745;
    g.add(top);
    const edge = new Mesh(new TorusGeometry(0.42, 0.014, 8, 24), brassMat(0.25));
    edge.rotation.x = Math.PI / 2;
    edge.position.y = 0.75;
    g.add(edge);

    // The candle: a low tumbler, a wax pip, and the shared flame sprite.
    const tumbler = new Mesh(new CylinderGeometry(0.04, 0.034, 0.07, 10, 1, true), new MeshStandardMaterial({
      color: 0x8a7a5a,
      transparent: true,
      opacity: 0.5,
      roughness: 0.2,
      metalness: 0.1,
    }));
    tumbler.position.y = 0.8;
    g.add(tumbler);
    const wax = new Mesh(new CylinderGeometry(0.026, 0.03, 0.035, 8), new MeshStandardMaterial({
      color: 0xe8ddc0,
      emissive: DECOR.candle,
      emissiveIntensity: 0.6,
      roughness: 0.7,
    }));
    wax.position.y = 0.79;
    g.add(wax);
    const flameHolder = new Group();
    flameHolder.name = 'live-candle';
    const flame = new Sprite(candleMat);
    flame.scale.setScalar(0.22);
    flame.position.y = 0.85;
    flameHolder.add(flame);
    g.add(flameHolder);

    // Two coupe glasses waiting — the table is set, the night is young.
    for (const [gx, gz] of [
      [0.16, 0.1],
      [-0.13, -0.14],
    ] as const) {
      const coupePts: Vector2[] = [
        new Vector2(0.001, 0),
        new Vector2(0.028, 0.002),
        new Vector2(0.004, 0.01),
        new Vector2(0.004, 0.075),
        new Vector2(0.02, 0.085),
        new Vector2(0.042, 0.1),
        new Vector2(0.044, 0.125),
      ];
      const coupe = new Mesh(
        new LatheGeometry(coupePts, 10),
        new MeshStandardMaterial({
          color: 0xd8e0e8,
          transparent: true,
          opacity: 0.34,
          roughness: 0.12,
          metalness: 0.1,
        }),
      );
      coupe.position.set(gx, 0.765, gz);
      g.add(coupe);
    }

    root.add(g);
  }
}

/* ── terrace: the raised south gallery behind the spawn ─────────────────── */

function buildTerrace(root: Group): void {
  const T = CLUB.terrace;
  const stoneMat = new MeshStandardMaterial({ map: terrazzoTexture([5, 1.4]), metalness: 0.25, roughness: 0.42 });
  const faceMat = new MeshStandardMaterial({ map: oakTexture([6, 0.6]), roughness: 0.6, metalness: 0.05 });
  const rail = brassMat(0.26);

  for (const side of [-1, 1] as const) {
    const x0 = side < 0 ? -CLUB.halfW : T.gapHalfW;
    const x1 = side < 0 ? -T.gapHalfW : CLUB.halfW;
    const cx = (x0 + x1) / 2;
    const wdt = x1 - x0;
    // Deck + face + brass nosing.
    box(root, stoneMat, wdt, T.h, T.z1 - T.z0, cx, T.h / 2, (T.z0 + T.z1) / 2);
    box(root, faceMat, wdt, T.h, 0.04, cx, T.h / 2, T.z0 - 0.02);
    box(root, rail, wdt, 0.03, 0.05, cx, T.h - 0.015, T.z0 - 0.02);
    // Railing along the deck edge: posts, double rail, finished newels.
    const posts = Math.max(2, Math.round(wdt / 0.95));
    for (let i = 0; i <= posts; i++) {
      const px = x0 + (i / posts) * wdt;
      if (Math.abs(px) > CLUB.halfW - 0.15) continue;
      const post = new Mesh(new CylinderGeometry(0.016, 0.02, 0.62, 8), rail);
      post.position.set(px, T.h + 0.31, T.z0 + 0.06);
      root.add(post);
    }
    box(root, rail, wdt, 0.035, 0.035, cx, T.h + 0.62, T.z0 + 0.06);
    box(root, rail, wdt, 0.022, 0.022, cx, T.h + 0.34, T.z0 + 0.06);
    // Steps at the inner corner, easing the wing down to the vestibule gap.
    const sx = side < 0 ? -T.gapHalfW - 0.5 : T.gapHalfW + 0.5;
    box(root, stoneMat, 1.0, T.h / 2, 0.42, sx, T.h / 4, T.z0 - 0.23);

    // A brass planter with broad dark leaves anchors each wing's far end.
    const px = side < 0 ? x0 + 0.75 : x1 - 0.75;
    const planter = new Mesh(new CylinderGeometry(0.3, 0.24, 0.42, 14), brassMat(0.35));
    planter.position.set(px, T.h + 0.21, (T.z0 + T.z1) / 2 + 0.3);
    root.add(planter);
    const leafMat = new MeshStandardMaterial({ color: 0x1e3a26, roughness: 0.8, metalness: 0.05, side: DoubleSide });
    for (let leaf = 0; leaf < 6; leaf++) {
      const a = (leaf / 6) * Math.PI * 2;
      const shape = new Shape();
      shape.moveTo(0, 0);
      shape.bezierCurveTo(0.1, 0.18, 0.09, 0.5, 0, 0.72);
      shape.bezierCurveTo(-0.09, 0.5, -0.1, 0.18, 0, 0);
      const leafMesh = new Mesh(new ShapeGeometry(shape, 6), leafMat);
      leafMesh.position.set(px + Math.sin(a) * 0.1, T.h + 0.4, (T.z0 + T.z1) / 2 + 0.3 + Math.cos(a) * 0.1);
      leafMesh.rotation.set(0.5 + (leaf % 3) * 0.22, a, 0);
      root.add(leafMesh);
    }
  }
}

/* ── vestibule: the way in — stepped brass portal, oak doors, the rope ──── */

function buildVestibule(root: Group): void {
  const SZ = CLUB.maxZ;
  const doorW = 2.2;
  const doorH = 2.5;

  // Three nested portal frames stepping outward — the deco doorway.
  for (let i = 0; i < 3; i++) {
    const w = doorW + 0.3 + i * 0.36;
    const h = doorH + 0.22 + i * 0.28;
    const t = 0.09 - i * 0.02;
    const mat = i === 0 ? brassMat(0.25) : i === 1 ? bronzeMat() : blackSteelMat();
    const z = SZ - 0.16 + i * 0.05;
    box(root, mat, t, h, t, -w / 2, h / 2, z);
    box(root, mat, t, h, t, w / 2, h / 2, z);
    box(root, mat, w + t, t, t, 0, h, z);
  }
  // Double oak doors, closed on the night, brass push plates + kick plates.
  const doorMat = new MeshStandardMaterial({ map: oakTexture([1, 2]), roughness: 0.55, metalness: 0.05 });
  for (const side of [-1, 1] as const) {
    const leaf = new Mesh(new BoxGeometry(doorW / 2 - 0.03, doorH, 0.06), doorMat);
    leaf.position.set((side * doorW) / 4, doorH / 2, SZ - 0.1);
    root.add(leaf);
    box(root, brassMat(0.3), 0.05, 0.34, 0.02, side * 0.16, 1.12, SZ - 0.14);
    box(root, brassMat(0.4), doorW / 2 - 0.1, 0.16, 0.02, (side * doorW) / 4, 0.12, SZ - 0.14);
  }
  // The fanlight: a half-sunburst window over the doors, softly lit.
  const fanMat = brassGlowMat(0.7);
  for (let i = 0; i < 7; i++) {
    const a = (i / 6) * Math.PI - Math.PI / 2;
    const spoke = new Mesh(new BoxGeometry(0.03, 0.62, 0.02), fanMat);
    spoke.position.set(Math.sin(a) * 0.36, doorH + 0.36 + Math.cos(a) * 0.28, SZ - 0.13);
    spoke.rotation.z = -a;
    root.add(spoke);
  }

  // The velvet rope and the members-&-dancers plaque used to stand here.
  // The way in is a doorway, not a queue: nothing to sidestep, nothing to
  // read on your way past.
}

/* ── THE STILL ROOM: the quiet decompression corner ─────────────────────── */

function buildStillRoom(root: Group, candleMat: SpriteMaterial): MeshStandardMaterial {
  const Q = CLUB.quiet;
  const H = 2.5;
  const plaster = new MeshStandardMaterial({ map: plasterTexture([3, 1.4]), roughness: 0.95, metalness: 0.02 });

  // Its two interior walls (east + south), split around the doorway, plus a
  // low lintel — the hall's plaster continues inside.
  const eWall = new Mesh(new PlaneGeometry(Q.maxZ - Q.minZ, H), plaster);
  eWall.position.set(Q.maxX, H / 2, (Q.minZ + Q.maxZ) / 2);
  eWall.rotation.y = Math.PI / 2;
  (eWall.material as MeshStandardMaterial).side = DoubleSide;
  root.add(eWall);
  const south = (x0: number, x1: number): void => {
    const m = new Mesh(new PlaneGeometry(x1 - x0, H), plaster);
    m.position.set((x0 + x1) / 2, H / 2, Q.maxZ);
    (m.material as MeshStandardMaterial).side = DoubleSide;
    root.add(m);
  };
  south(Q.minX, Q.doorX0);
  south(Q.doorX1, Q.maxX);
  const lintel = new Mesh(new PlaneGeometry(Q.doorX1 - Q.doorX0, H - 2.05), plaster);
  lintel.position.set((Q.doorX0 + Q.doorX1) / 2, (H + 2.05) / 2, Q.maxZ);
  (lintel.material as MeshStandardMaterial).side = DoubleSide;
  root.add(lintel);
  // Ceiling cap at door height — the room is a lower, closer volume.
  const cap = new Mesh(new PlaneGeometry(Q.maxX - Q.minX, Q.maxZ - Q.minZ), new MeshStandardMaterial({
    color: 0x191720,
    roughness: 0.95,
  }));
  cap.rotation.x = Math.PI / 2;
  cap.position.set((Q.minX + Q.maxX) / 2, H, (Q.minZ + Q.maxZ) / 2);
  root.add(cap);
  // Door dressing: bronze jambs + a hushed nameplate.
  for (const x of [Q.doorX0, Q.doorX1]) box(root, bronzeMat(), 0.08, 2.05, 0.1, x, 1.025, Q.maxZ);
  box(root, bronzeMat(), Q.doorX1 - Q.doorX0 + 0.08, 0.09, 0.1, (Q.doorX0 + Q.doorX1) / 2, 2.05, Q.maxZ);
  // The nameplate: the house face, two words, on its own backing bar so it
  // reads from across the hall — the old serif whisper sat flush with the
  // plaster and lost the fight with the lintel trim.
  const plate = signPlane(0.96, 0.24, 512, (g, sw, sh) => {
    g.fillStyle = 'rgba(13,10,18,0.85)';
    g.beginPath();
    g.roundRect(4, 4, sw - 8, sh - 8, 14);
    g.fill();
    g.strokeStyle = 'rgba(201,168,106,0.55)';
    g.lineWidth = 2.5;
    g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#e8d9b0';
    g.font = font(600, 64);
    g.letterSpacing = '10px';
    g.fillText('STILL ROOM', sw / 2, sh / 2 + 2);
    g.letterSpacing = '0px';
  });
  plate.name = 'live-still-plate';
  plate.position.set((Q.doorX0 + Q.doorX1) / 2, 2.34, Q.maxZ + 0.06);
  root.add(plate);

  // Inside: a wide curved bench with deep cushions, a low table, a slow
  // lamp. Nothing performs in here — that's the point.
  const cx = (Q.minX + Q.maxX) / 2;
  const cz = (Q.minZ + Q.maxZ) / 2 - 0.25;
  const bench = new Group();
  bench.position.set(cx, 0, cz);
  bench.rotation.y = Math.PI / 2 + Math.PI; // horseshoe opens toward the door
  const seatMat = new MeshStandardMaterial({ map: velvetTexture([3, 1]), roughness: 0.97, metalness: 0 });
  // Same half for every arc (the booths' bug lived in here too): the bench
  // hugs the room's deep side and genuinely opens toward the door.
  const plinth = new Mesh(new CylinderGeometry(1.35, 1.4, 0.13, 24, 1, false, Math.PI, Math.PI), blackSteelMat());
  plinth.position.y = 0.065;
  bench.add(plinth);
  const seat = new Mesh(new TorusGeometry(1.1, 0.23, 10, 24, Math.PI), seatMat);
  seat.rotation.x = -Math.PI / 2;
  seat.rotation.z = Math.PI / 2;
  seat.position.y = 0.4;
  bench.add(seat);
  for (const [px, pz] of [
    [0, -1.1],
    [0, 1.1],
  ] as const) {
    const bolster = new Mesh(new SphereGeometry(0.23, 12, 10), seatMat);
    bolster.position.set(px, 0.4, pz);
    bench.add(bolster);
  }
  const backW = new Mesh(new CylinderGeometry(1.38, 1.38, 0.8, 24, 1, true, Math.PI, Math.PI), new MeshStandardMaterial({
    map: velvetTexture([3, 1], 11),
    roughness: 0.97,
    metalness: 0,
    side: DoubleSide,
  }));
  backW.position.y = 0.75;
  bench.add(backW);
  root.add(bench);

  const table = new Mesh(new CylinderGeometry(0.34, 0.3, 0.36, 14), new MeshStandardMaterial({
    map: oakTexture([1, 1]),
    roughness: 0.6,
  }));
  table.position.set(cx, 0.18, cz + 0.75);
  root.add(table);

  // The lamp: a moon-egg on the table, breathing at a resting heart rate.
  const lampMat = new MeshStandardMaterial({
    color: 0x3a3630,
    emissive: DECOR.candle,
    emissiveIntensity: 0.9,
    roughness: 0.6,
  });
  const lamp = new Mesh(new CylinderGeometry(0.085, 0.11, 0.16, 14), lampMat);
  lamp.name = 'live-still-lamp';
  lamp.position.set(cx, 0.44, cz + 0.75);
  root.add(lamp);
  const lampGlowHolder = new Group();
  lampGlowHolder.name = 'live-still-glow';
  const lampGlow = new Sprite(candleMat);
  lampGlow.scale.setScalar(0.75);
  lampGlow.position.set(cx, 0.52, cz + 0.75);
  lampGlowHolder.add(lampGlow);
  root.add(lampGlowHolder);

  return lampMat;
}

/* ── THE ARCADE: SUPER OCTAGON's room, the still room's loud mirror ─────── */

function buildArcade(root: Group): void {
  const A = CLUB.arcade;
  const H = 2.5;
  const plaster = new MeshStandardMaterial({ map: plasterTexture([3, 1.4]), roughness: 0.95, metalness: 0.02 });

  // Interior walls (west + south split around the door), lintel, low cap —
  // the same envelope as the still room, mirrored across the hall.
  const wWall = new Mesh(new PlaneGeometry(A.maxZ - A.minZ, H), plaster);
  wWall.position.set(A.minX, H / 2, (A.minZ + A.maxZ) / 2);
  wWall.rotation.y = Math.PI / 2;
  (wWall.material as MeshStandardMaterial).side = DoubleSide;
  root.add(wWall);
  const south = (x0: number, x1: number): void => {
    const m = new Mesh(new PlaneGeometry(x1 - x0, H), plaster);
    m.position.set((x0 + x1) / 2, H / 2, A.maxZ);
    (m.material as MeshStandardMaterial).side = DoubleSide;
    root.add(m);
  };
  south(A.minX, A.doorX0);
  south(A.doorX1, A.maxX);
  const lintel = new Mesh(new PlaneGeometry(A.doorX1 - A.doorX0, H - 2.05), plaster);
  lintel.position.set((A.doorX0 + A.doorX1) / 2, (H + 2.05) / 2, A.maxZ);
  (lintel.material as MeshStandardMaterial).side = DoubleSide;
  root.add(lintel);
  const cap = new Mesh(new PlaneGeometry(A.maxX - A.minX, A.maxZ - A.minZ), new MeshStandardMaterial({
    color: 0x191720,
    roughness: 0.95,
  }));
  cap.rotation.x = Math.PI / 2;
  cap.position.set((A.minX + A.maxX) / 2, H, (A.minZ + A.maxZ) / 2);
  root.add(cap);
  // Door dressing + nameplate, the still room's twin — but this door
  // promises noise, so the plate glows the cabinet's magenta.
  for (const x of [A.doorX0, A.doorX1]) box(root, bronzeMat(), 0.08, 2.05, 0.1, x, 1.025, A.maxZ);
  box(root, bronzeMat(), A.doorX1 - A.doorX0 + 0.08, 0.09, 0.1, (A.doorX0 + A.doorX1) / 2, 2.05, A.maxZ);
  const plate = signPlane(0.96, 0.24, 512, (g, sw, sh) => {
    g.fillStyle = 'rgba(13,10,18,0.85)';
    g.beginPath();
    g.roundRect(4, 4, sw - 8, sh - 8, 14);
    g.fill();
    g.strokeStyle = 'rgba(255,42,213,0.5)';
    g.lineWidth = 2.5;
    g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffd9f6';
    g.shadowColor = css(PALETTE.magenta);
    g.shadowBlur = 10;
    g.font = font(600, 58);
    g.letterSpacing = '8px';
    g.fillText('ARCADE', sw / 2, sh / 2 + 2);
    g.letterSpacing = '0px';
    g.shadowBlur = 0;
  });
  plate.name = 'live-arcade-plate';
  plate.position.set((A.doorX0 + A.doorX1) / 2, 2.34, A.maxZ + 0.06);
  root.add(plate);

  // ── THE CABINET: SUPER OCTAGON, against the north wall, facing the door.
  //
  // ONE SILHOUETTE. The first cut stacked boxes — a marquee hovering over
  // a gap, glowing magenta slabs bolted to the sides — and it read exactly
  // like what it was. A real upright is a single sheet of ply cut to a
  // profile: kick, control deck, screen slope, marquee, canopy, all one
  // continuous edge. So this is that profile, extruded across the width;
  // the headboard can't float because it isn't a separate object.
  const cx = (A.minX + A.maxX) / 2;
  const cz = A.minZ + 0.45;
  const CW = 0.66; // cabinet width
  const cab = new Group();
  cab.position.set(cx, 0, cz);
  const shellMat = blackSteelMat();

  // The side profile, drawn in (depth, height) — front is +depth. It gets
  // extruded along the cabinet's width, so the shape's own faces become
  // the two side panels and the extrusion wrap becomes front/top/back.
  const P: [number, number][] = [
    [-0.30, 0.0],   // back foot
    [0.30, 0.0],    // front foot (kick plate)
    [0.30, 0.90],   // front panel, up to the shelf
    [0.315, 0.95],  // a shallow shelf where a control deck would be — this
    [0.315, 0.99],  // cabinet is played with the lasers, so it's a ledge,
    [0.12, 1.09],   // not a console: no stick, no buttons, nothing fake to
    [0.12, 1.13],   // reach for and find isn't there.
    [0.215, 1.20],  // the monitor bay leans out at the bottom...
    [0.115, 1.78],  // ...and back in at the top, the way a CRT sits
    [0.265, 1.86],  // the marquee shelf steps forward again
    [0.265, 2.10],  // the marquee face
    [0.30, 2.15],   // canopy lip over the lights
    [-0.26, 2.19],  // the top, sloping gently back
    [-0.30, 2.12],
  ];
  const profile = new Shape();
  profile.moveTo(P[0][0], P[0][1]);
  for (let i = 1; i < P.length; i++) profile.lineTo(P[i][0], P[i][1]);
  profile.closePath();
  const shell = new Mesh(
    new ExtrudeGeometry(profile, { depth: CW, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 1, steps: 1 }),
    shellMat,
  );
  // Stand the profile up facing the door: local +depth → world +z.
  shell.rotation.y = -Math.PI / 2;
  shell.position.x = CW / 2;
  cab.add(shell);

  // Brass edge trim following the cabinet's front line — the venue's metal,
  // where a real cabinet wears its T-molding. It replaces the neon siding:
  // the shape reads on its own, so the light can stay in the marquee.
  const trimMat = brassMat(0.3);
  const edge = (d0: number, h0: number, d1: number, h1: number): void => {
    const len = Math.hypot(d1 - d0, h1 - h0);
    for (const sx of [-CW / 2 + 0.012, CW / 2 - 0.012]) {
      const bar = new Mesh(new BoxGeometry(0.016, len, 0.016), trimMat);
      bar.position.set(sx, (h0 + h1) / 2, (d0 + d1) / 2);
      bar.rotation.x = -Math.atan2(d1 - d0, h1 - h0);
      cab.add(bar);
    }
  };
  edge(0.30, 0.06, 0.30, 0.88); // the front panel's two corners

  // Marquee: the game's name, backlit, sitting ON the shelf the profile cut.
  const marquee = signPlane(0.56, 0.2, 512, (g, sw, sh) => {
    g.fillStyle = '#0d0a14';
    g.fillRect(0, 0, sw, sh);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffd9f6';
    g.shadowColor = css(PALETTE.magenta);
    g.shadowBlur = 16;
    g.font = font(700, 64);
    g.letterSpacing = '4px';
    g.fillText('SUPER OCTAGON', sw / 2, sh / 2 + 2, sw - 24);
    g.letterSpacing = '0px';
    g.shadowBlur = 0;
  });
  marquee.name = 'live-octagon-marquee';
  // Proud of the bevel — the extrusion's rounded edge pushes the shell's
  // face out by bevelSize, and a sign flush to the drawn profile vanishes
  // inside it.
  marquee.position.set(0, 1.985, 0.279);
  cab.add(marquee);
  // The lamp under the canopy, washing the header from above.
  const header = new Mesh(new BoxGeometry(0.5, 0.012, 0.012), brassGlowMat(1.8));
  header.position.set(0, 2.135, 0.272);
  cab.add(header);

  // The CRT: a black bay recessed into the profile's monitor slope, and the
  // live screen plane the lasers aim at. The slope is ~9.8° off vertical
  // ((0.215,1.20) → (0.115,1.78)), so the glass matches it.
  const tilt = Math.atan2(0.215 - 0.115, 1.78 - 1.20);
  const screenCanvas = document.createElement('canvas');
  screenCanvas.width = 384;
  screenCanvas.height = 300;
  const sg = screenCanvas.getContext('2d')!;
  sg.fillStyle = '#08060e';
  sg.fillRect(0, 0, 384, 300);
  const screenTex = new CanvasTexture(screenCanvas);
  screenTex.colorSpace = SRGBColorSpace;
  screenTex.minFilter = LinearFilter;
  // A surface, not a hole: the bezel takes light so the bay doesn't read as
  // a black void with a picture hanging in it.
  const bezel = new Mesh(
    new PlaneGeometry(0.58, 0.57),
    new MeshStandardMaterial({ color: 0x171320, roughness: 0.5, metalness: 0.35 }),
  );
  bezel.position.set(0, 1.49, 0.182);
  bezel.rotation.x = -tilt;
  cab.add(bezel);
  const screen = new Mesh(new PlaneGeometry(0.52, 0.41), new MeshBasicMaterial({ map: screenTex }));
  screen.name = 'live-octagon-screen';
  screen.position.set(0, 1.505, 0.188);
  screen.rotation.x = -tilt;
  cab.add(screen);

  // The ledge gets a brushed plate and nothing else. Fake hardware you
  // can't touch is worse than no hardware: in a room where everything is
  // reached with the lasers, a stick and a row of buttons only promise a
  // control scheme that doesn't exist.
  const ledgeTilt = Math.atan2(0.315 - 0.12, 1.09 - 0.99) - Math.PI / 2;
  const ledgeMat = new MeshStandardMaterial({ color: 0x1a1720, roughness: 0.42, metalness: 0.65 });
  const ledge = new Mesh(new PlaneGeometry(0.58, 0.2), ledgeMat);
  ledge.position.set(0, 1.043, 0.222);
  ledge.rotation.x = ledgeTilt;
  cab.add(ledge);

  // A coin door, because the eye looks for one on a cabinet this size.
  const coinDoor = new Mesh(new PlaneGeometry(0.2, 0.13), new MeshStandardMaterial({ color: 0x241f2b, roughness: 0.6, metalness: 0.5 }));
  coinDoor.position.set(0, 0.5, 0.302);
  cab.add(coinDoor);
  for (const sx of [-0.045, 0.045]) {
    const slot = new Mesh(new BoxGeometry(0.006, 0.03, 0.004), trimMat);
    slot.position.set(sx, 0.53, 0.305);
    cab.add(slot);
  }
  root.add(cab);

  // ── THE BOARD: the wall leaderboard beside the cabinet.
  const boardCanvas = document.createElement('canvas');
  boardCanvas.width = 512;
  boardCanvas.height = 736;
  const bg = boardCanvas.getContext('2d')!;
  bg.fillStyle = '#0d0a14';
  bg.fillRect(0, 0, 512, 736);
  const boardTex = new CanvasTexture(boardCanvas);
  boardTex.colorSpace = SRGBColorSpace;
  boardTex.minFilter = LinearFilter;
  const board = new Mesh(new PlaneGeometry(0.82, 1.18), new MeshBasicMaterial({ map: boardTex, transparent: true }));
  board.name = 'live-octagon-board';
  board.position.set(A.maxX - 0.03, 1.55, (A.minZ + A.maxZ) / 2 + 0.5);
  board.rotation.y = -Math.PI / 2;
  root.add(board);

  // A cove strip so the room reads arcade-warm from the hall — and the
  // cabinet's own glow, the fifth (and last) real light in the venue: the
  // room is a sealed box under its low cap, and plaster with no light is
  // just black (FIRE FIGHT's cabinet carried its own marquee light for
  // exactly this reason).
  // Warm, not pink: a magenta bulb was the only light in this sealed room,
  // so every steel and brass surface in it — the cabinet's buttons most of
  // all — came out the colour of the bulb. The house's own warm light lets
  // the metal read as metal and leaves magenta to the marquee and the game.
  const cove = new Mesh(new BoxGeometry(A.maxX - A.minX - 0.4, 0.03, 0.03), brassGlowMat(1.5));
  cove.position.set(cx, H - 0.12, A.minZ + 0.08);
  root.add(cove);
  const glow = new PointLight(0xffcb96, 1.7, 5.5, 1.4);
  glow.position.set(cx, 2.1, cz + 0.9);
  root.add(glow);

  registerArcade({
    screen,
    screenCanvas,
    screenTex,
    boardCanvas,
    boardTex,
    cabinetPos: new Vector3(cx, 0, cz),
  });
}

/* ═════════════════════════════ THE FOYER ═════════════════════════════════
 * The menu place — and a piece of THE VOID, not of the club. You arrive on
 * a floating platform in the set's own abstract space (arena/voidkit.ts):
 * darkness shaped by light — a neon-edged deck, monolith pylons breathing
 * in the distance, two great hexes turning slowly overhead, shards adrift,
 * a horizon band with no land under it, and a grid far below where ground
 * would be. The board floats at the platform's heart, the MC poses beside
 * it, and the PORTAL stands at the north edge: a moon-gate of light,
 * closed to a shimmer until a room of yours is open on the other side —
 * host or join, and the warm room takes you. Solo sets launch from here
 * and the platform gives way to the raid's void.
 */

export function buildFoyer(scene: Scene): FoyerRefs {
  const root = new Group();
  root.name = 'club-foyer';

  const R = 4.0; // platform radius (hex)

  // ── the platform: a dark gloss hex deck with a neon rim ───────────────
  const deck = new Mesh(
    new CylinderGeometry(R, R * 0.94, 0.3, 6),
    new MeshStandardMaterial({ color: 0x0b0a12, metalness: 0.85, roughness: 0.3 }),
  );
  deck.position.y = -0.15;
  root.add(deck);
  const rim = new Mesh(new TorusGeometry(R - 0.03, 0.035, 4, 6), new MeshStandardMaterial({
    color: 0x0c0b12,
    emissive: hueToColor(0.55, 0.55),
    emissiveIntensity: 1.2,
    metalness: 0.3,
    roughness: 0.4,
  }));
  rim.rotation.x = Math.PI / 2;
  rim.rotation.z = Math.PI / 6; // flats align with the deck's
  rim.position.y = 0.012;
  root.add(rim);

  // The platform is FLOATING, so its underside is half of what anyone sees
  // of it — give it a build: six radial ribs under the deck and a tapered
  // keel hanging below, lit along their lower edges.
  const structMat = new MeshStandardMaterial({ color: 0x090810, metalness: 0.8, roughness: 0.4 });
  const ribGlow = new MeshStandardMaterial({
    color: 0x0b0a12,
    emissive: hueToColor(0.75, 0.5),
    emissiveIntensity: 0.7,
    metalness: 0.3,
    roughness: 0.5,
  });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const rib = new Mesh(new BoxGeometry(0.2, 0.62, R * 1.68), structMat);
    rib.position.set(0, -0.52, 0);
    rib.rotation.y = a;
    root.add(rib);
    const lip = new Mesh(new BoxGeometry(0.07, 0.05, R * 1.62), ribGlow);
    lip.position.set(0, -0.83, 0);
    lip.rotation.y = a;
    root.add(lip);
  }
  const keel = new Mesh(new CylinderGeometry(R * 0.52, 0.18, 2.6, 6), structMat);
  keel.position.y = -2.0;
  root.add(keel);
  const keelTip = new Mesh(new CylinderGeometry(0.2, 0.02, 0.5, 6), ribGlow);
  keelTip.position.y = -3.4;
  root.add(keelTip);

  // Deck inlay: two hairline rings and a crown of radial ticks near the
  // rim. Near-field detail is what the eye actually audits — you stand on
  // this thing for the whole menu.
  for (const [ir, op] of [
    [R * 0.55, 0.4],
    [R * 0.82, 0.28],
  ] as const) {
    const ring = new Mesh(
      new RingGeometry(ir - 0.02, ir + 0.02, 72),
      new MeshBasicMaterial({
        color: hueToColor(0.55, 0.5),
        transparent: true,
        opacity: op,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.006;
    root.add(ring);
  }
  const tickMat = new MeshBasicMaterial({
    color: hueToColor(0.75, 0.5),
    transparent: true,
    opacity: 0.35,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const tick = new Mesh(new PlaneGeometry(0.045, i % 4 === 0 ? 0.34 : 0.17), tickMat);
    tick.rotation.set(-Math.PI / 2, 0, -a);
    tick.position.set(Math.sin(a) * (R * 0.9), 0.006, Math.cos(a) * (R * 0.9));
    root.add(tick);
  }

  // Two step-slabs trailing off behind the spawn — the way you "came in".
  for (const [sx, sy, sz, sr] of [
    [0.5, -0.5, 5.1, 0.9],
    [-0.4, -1.1, 6.3, 0.7],
  ] as const) {
    const slab = new Mesh(
      new CylinderGeometry(sr, sr * 0.9, 0.16, 6),
      new MeshStandardMaterial({ color: 0x0b0a12, metalness: 0.8, roughness: 0.35 }),
    );
    slab.position.set(sx, sy, sz);
    root.add(slab);
  }

  // ── the void around: a lit plain far below with a world standing on it
  const env = new FoyerEnvironment(-7);
  env.root.name = 'live-foyer-void';
  root.add(env.root);

  // ── THE PORTAL: the moon-gate to the club floor ───────────────────────
  // A ring of light standing on the deck's north edge; its inner shimmer
  // breathes while the way is shut, flares while the relay is being rung,
  // and the room swap IS the passage.
  // (The TONIGHT bill that used to float off the east edge is gone — the
  // tour map on the board already tells that story, better.)

  // ── light: a cool wash + one soft key — the board does the reading ────
  root.add(new HemisphereLight(0x8a90c8, 0x05040a, 0.6));
  const key = new PointLight(0xc8d4ff, 1.2, 10, 1.6);
  key.position.set(0, 3.1, -1.4);
  root.add(key);

  scene.add(root);
  collapseStatic(root, (o) => {
    for (let n: Object3D | null = o; n; n = n.parent) {
      if (n.name.startsWith('live-')) return true;
      if (n === root) break;
    }
    return false;
  });

  return { root, env };
}

/* ── real lights: four points + a hemisphere, and not one more ──────────── */

function buildLights(root: Group): void {
  // The base wash: cool sky, near-black ground — the plaster stays charcoal.
  root.add(new HemisphereLight(0x8f88b0, 0x0e0a12, 0.62));

  const F = CLUB.floor;
  // The chandelier's warmth over the dance floor — the room's key.
  const key = new PointLight(0xffd9ac, 1.9, 16, 1.55);
  key.position.set(F.x, CLUB.chandelier.y - 0.4, F.z);
  root.add(key);
  // The bar's own pool — hung out OVER the counter so the marble and the
  // drinkers catch it, not just the glass wall behind them.
  const barLight = new PointLight(0xffc48a, 1.5, 11, 1.55);
  barLight.position.set(CLUB.bar.x - 0.5, 2.2, (CLUB.bar.z0 + CLUB.bar.z1) / 2);
  root.add(barLight);
  // The lounge's softer amber, warm enough to read a face in a booth.
  const lounge = new PointLight(0xffb87e, 1.35, 10, 1.55);
  lounge.position.set(CLUB.boothX + 1.3, 2.2, -3.4);
  root.add(lounge);
  // The still room's ember — small, low, warm.
  const still = new PointLight(0xffa868, 0.9, 7, 1.6);
  still.position.set((CLUB.quiet.minX + CLUB.quiet.maxX) / 2, 1.6, (CLUB.quiet.minZ + CLUB.quiet.maxZ) / 2);
  root.add(still);
}
