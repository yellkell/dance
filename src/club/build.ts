/**
 * THE GILDED ECLIPSE — the venue itself.
 *
 * One double-height Art Deco hall the menus live in and the social floor
 * fills: herringbone parquet under an eclipse of counter-rotating brass
 * rings, a crescent stage under a brass sunburst, a smoked-oak bar with a
 * backlit ribbed-glass wall, oxblood velvet booths, a raised brass-railed
 * terrace, and a hushed STILL ROOM off the north-west corner for coming
 * down. Where FIRE FIGHT's club was diamond-plate and hazard amber, this is
 * plaster, oak, stone and champagne brass — the rave's neon is allowed in
 * only as LIGHT: coves, candles, signage, and the eclipse itself.
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
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  type Object3D,
  type Scene,
} from 'three';
import { PALETTE } from '../config.js';
import { glowTexture } from '../materials/glow.js';
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

export interface ChandelierRing {
  pivot: Group;
  glowMat: MeshStandardMaterial;
  speed: number;
}

/** The FOYER — the menu place. A separate, compact antechamber: the front
 *  desk of the club, not the club. Its doors open on the social floor the
 *  moment your room does. */
export interface FoyerRefs {
  root: Group;
  /** The brass door-crack glow — warms when a room is open beyond. */
  doorGlowMat: MeshStandardMaterial;
  /** The desk lamp + candle flames share the club's flicker material. */
  candleMat: SpriteMaterial;
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
  root.name = 'gilded-eclipse';

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

  // Riser: a half-drum against the north wall.
  const drum = new Mesh(new CylinderGeometry(S.r, S.r, S.h, 40, 1, false, Math.PI / 2, Math.PI), oakSkirtMat);
  drum.position.set(0, S.h / 2, S.z);
  root.add(drum);
  const lid = new Mesh(new CircleGeometry(S.r, 40, Math.PI / 2, Math.PI), topMat);
  lid.rotation.x = -Math.PI / 2;
  lid.rotation.z = Math.PI;
  lid.position.set(0, S.h + 0.001, S.z);
  root.add(lid);
  // Brass nosing along the curved lip + two shallow guest steps at centre.
  const nose = new Mesh(new TorusGeometry(S.r, 0.02, 8, 40, Math.PI), brassMat(0.25));
  nose.rotation.x = Math.PI / 2;
  nose.rotation.z = Math.PI;
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

  // "THE GILDED ECLIPSE" — the house sign, floating over the stage: thin
  // double keyline, serif smallcaps, the eclipse glyph at centre.
  const sign = signPlane(4.2, 0.85, 1024, (s, sw, sh) => {
    s.strokeStyle = 'rgba(201,168,106,0.9)';
    s.lineWidth = 3;
    s.strokeRect(10, 10, sw - 20, sh - 20);
    s.lineWidth = 1.5;
    s.strokeRect(20, 20, sw - 40, sh - 40);
    s.textAlign = 'center';
    s.textBaseline = 'middle';
    s.fillStyle = '#e8d9b0';
    s.shadowColor = 'rgba(255,196,110,0.8)';
    s.shadowBlur = 18;
    s.font = `500 68px Georgia, 'Times New Roman', serif`;
    s.fillText('T H E   G I L D E D', sw / 2, sh * 0.32);
    s.font = `600 86px Georgia, 'Times New Roman', serif`;
    s.fillText('E C L I P S E', sw / 2, sh * 0.68);
    // The glyph: a moon disc bitten by its shadow, either side.
    for (const gx of [70, sw - 70]) {
      s.shadowBlur = 12;
      s.beginPath();
      s.arc(gx, sh / 2, 26, 0, Math.PI * 2);
      s.fillStyle = '#f2ecff';
      s.fill();
      s.beginPath();
      s.arc(gx + 11, sh / 2, 23, 0, Math.PI * 2);
      s.fillStyle = '#0d0a14';
      s.shadowBlur = 0;
      s.fill();
    }
  });
  sign.name = 'live-house-sign';
  sign.position.set(0, 2.95, CLUB.minZ + 0.6);
  root.add(sign);

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
    const plinth = new Mesh(new CylinderGeometry(1.16, 1.2, 0.14, 26, 1, false, 0, Math.PI), blackSteelMat());
    plinth.position.y = 0.07;
    g.add(plinth);
    const seat = new Mesh(new TorusGeometry(0.92, 0.2, 10, 26, Math.PI), seatVelvet);
    seat.rotation.x = -Math.PI / 2;
    seat.position.y = 0.42;
    g.add(seat);
    // The channel-tufted back wall wraps the horseshoe, capped in brass.
    const backWall = new Mesh(new CylinderGeometry(1.18, 1.18, 0.95, 26, 1, true, 0, Math.PI), backVelvet);
    backWall.position.y = 0.85;
    g.add(backWall);
    const cap = new Mesh(new TorusGeometry(1.18, 0.028, 8, 26, Math.PI), brassMat(0.3));
    cap.rotation.x = -Math.PI / 2;
    cap.position.y = 1.33;
    g.add(cap);

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

  // The velvet rope: two brass stanchions and a lazy catenary swag — the
  // little theatre of arrival, just inside the doors.
  const post = (x: number): void => {
    const g = new Group();
    g.position.set(x, 0, SZ - 1.05);
    const stem = new Mesh(new CylinderGeometry(0.02, 0.025, 0.95, 10), brassMat(0.25));
    stem.position.y = 0.475;
    g.add(stem);
    const ball = new Mesh(new CylinderGeometry(0.045, 0.045, 0.05, 12), brassMat(0.2));
    ball.position.y = 0.97;
    g.add(ball);
    const foot = new Mesh(new CylinderGeometry(0.13, 0.15, 0.03, 14), bronzeMat());
    foot.position.y = 0.015;
    g.add(foot);
    root.add(g);
  };
  post(-0.85);
  post(0.85);
  const ropeMat = new MeshStandardMaterial({ color: DECOR.velvet, roughness: 0.9, metalness: 0.05 });
  const SEGS = 9;
  for (let i = 0; i < SEGS; i++) {
    const t0 = i / SEGS;
    const t1 = (i + 1) / SEGS;
    const sag = (t: number): number => 0.95 - Math.sin(t * Math.PI) * 0.16;
    const xa = -0.85 + t0 * 1.7;
    const xb = -0.85 + t1 * 1.7;
    const ya = sag(t0);
    const yb = sag(t1);
    const seg = new Mesh(new CylinderGeometry(0.018, 0.018, Math.hypot(xb - xa, yb - ya) + 0.01, 6), ropeMat);
    seg.position.set((xa + xb) / 2, (ya + yb) / 2, SZ - 1.05);
    seg.rotation.z = Math.atan2(xb - xa, yb - ya);
    root.add(seg);
  }

  // House plaque beside the portal.
  const plaque = signPlane(0.92, 0.5, 512, (g, sw, sh) => {
    g.strokeStyle = 'rgba(201,168,106,0.85)';
    g.lineWidth = 3;
    g.strokeRect(8, 8, sw - 16, sh - 16);
    g.textAlign = 'center';
    g.fillStyle = '#e8d9b0';
    g.font = `500 54px Georgia, serif`;
    g.fillText('THE GILDED ECLIPSE', sw / 2, sh * 0.36);
    g.font = `400 34px Georgia, serif`;
    g.fillStyle = 'rgba(232,217,176,0.75)';
    g.fillText('members & dancers', sw / 2, sh * 0.62);
    g.fillStyle = css(PALETTE.magenta);
    g.shadowColor = css(PALETTE.magenta);
    g.shadowBlur = 12;
    g.font = `700 30px 'Arial Black', system-ui, sans-serif`;
    g.fillText('RAVE RAID', sw / 2, sh * 0.85);
  });
  plaque.name = 'live-plaque';
  plaque.rotation.y = Math.PI;
  plaque.position.set(-1.75, 1.6, SZ - 0.12);
  root.add(plaque);
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
  const plate = signPlane(0.62, 0.16, 384, (g, sw, sh) => {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(232,217,176,0.9)';
    g.font = `400 44px Georgia, serif`;
    g.fillText('T H E   S T I L L   R O O M', sw / 2, sh / 2);
  });
  plate.name = 'live-still-plate';
  plate.position.set((Q.doorX0 + Q.doorX1) / 2, 2.2, Q.maxZ + 0.01);
  root.add(plate);

  // Inside: a wide curved bench with deep cushions, a low table, a slow
  // lamp. Nothing performs in here — that's the point.
  const cx = (Q.minX + Q.maxX) / 2;
  const cz = (Q.minZ + Q.maxZ) / 2 - 0.25;
  const bench = new Group();
  bench.position.set(cx, 0, cz);
  bench.rotation.y = Math.PI / 2 + Math.PI; // horseshoe opens toward the door
  const seatMat = new MeshStandardMaterial({ map: velvetTexture([3, 1]), roughness: 0.97, metalness: 0 });
  const plinth = new Mesh(new CylinderGeometry(1.35, 1.4, 0.13, 24, 1, false, 0, Math.PI), blackSteelMat());
  plinth.position.y = 0.065;
  bench.add(plinth);
  const seat = new Mesh(new TorusGeometry(1.1, 0.23, 10, 24, Math.PI), seatMat);
  seat.rotation.x = -Math.PI / 2;
  seat.position.y = 0.4;
  bench.add(seat);
  const backW = new Mesh(new CylinderGeometry(1.38, 1.38, 0.8, 24, 1, true, 0, Math.PI), new MeshStandardMaterial({
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

/* ═════════════════════════════ THE FOYER ═════════════════════════════════
 * The menu place — a different room from the club. You arrive HERE: a
 * compact antechamber in the same wardrobe (plaster, brass, oxblood), the
 * board floating at the desk, the MC posing beside it, the coat check on
 * the west wall, and the double doors to THE FLOOR — closed until a room
 * of yours is open on the other side. Solo raids launch from here and the
 * foyer packs away into passthrough; host or join, and the doors are the
 * transition to the social area.
 */

export function buildFoyer(scene: Scene, candleMat: SpriteMaterial): FoyerRefs {
  const root = new Group();
  root.name = 'eclipse-foyer';

  const HW = 3.6; // half width
  const NZ = -3.6; // the doors-to-the-floor wall
  const SZ = 2.4; // the street doors behind you
  const H = 3.0;

  // ── shell ─────────────────────────────────────────────────────────────
  const plaster = new MeshStandardMaterial({ map: plasterTexture([3, 1.4]), roughness: 0.94, metalness: 0.02 });
  const wall = (w: number, x: number, z: number, ry: number): void => {
    const m = new Mesh(new PlaneGeometry(w, H), plaster);
    m.position.set(x, H / 2, z);
    m.rotation.y = ry;
    root.add(m);
  };
  wall(HW * 2, 0, NZ, 0);
  wall(HW * 2, 0, SZ, Math.PI);
  wall(SZ - NZ, -HW, (NZ + SZ) / 2, Math.PI / 2);
  wall(SZ - NZ, HW, (NZ + SZ) / 2, -Math.PI / 2);

  const floor = new Mesh(
    new PlaneGeometry(HW * 2, SZ - NZ),
    new MeshStandardMaterial({ map: parquetTexture([4, 3]), metalness: 0.16, roughness: 0.5 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, (NZ + SZ) / 2);
  root.add(floor);
  const rug = new Mesh(
    new PlaneGeometry(1.7, 4.6),
    new MeshStandardMaterial({ map: runnerTexture([1, 2]), roughness: 0.92, metalness: 0 }),
  );
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, 0.012, -0.6);
  root.add(rug);

  const ceil = new Mesh(
    new PlaneGeometry(HW * 2, SZ - NZ),
    new MeshStandardMaterial({ color: DECOR.plasterDeep, roughness: 0.95 }),
  );
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, H, (NZ + SZ) / 2);
  root.add(ceil);

  // Trim registers + a perimeter cove, same law as the hall.
  const skirtM = blackSteelMat();
  const railM = brassMat(0.34);
  const coveM = brassGlowMat(1.0);
  for (const [len, x, z, ry] of [
    [HW * 2, 0, NZ + 0.02, 0],
    [HW * 2, 0, SZ - 0.02, Math.PI],
    [SZ - NZ, -HW + 0.02, (NZ + SZ) / 2, Math.PI / 2],
    [SZ - NZ, HW - 0.02, (NZ + SZ) / 2, -Math.PI / 2],
  ] as const) {
    box(root, skirtM, len, 0.16, 0.03, x, 0.08, z, ry);
    box(root, railM, len, 0.035, 0.02, x, 1.0, z, ry);
    box(root, coveM, len - 0.2, 0.04, 0.04, x, H - 0.05, z, ry);
  }

  // A single eclipse ring overhead — the house motif, foreshadowed.
  const ring = new Mesh(new TorusGeometry(0.8, 0.024, 8, 40), brassMat(0.22));
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, H - 0.55, -1.2);
  root.add(ring);
  const ringGlow = new Mesh(new TorusGeometry(0.8, 0.01, 6, 40), brassGlowMat(1.3));
  ringGlow.rotation.x = Math.PI / 2;
  ringGlow.position.set(0, H - 0.585, -1.2);
  root.add(ringGlow);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const cable = new Mesh(new CylinderGeometry(0.004, 0.004, 0.55, 4), blackSteelMat());
    cable.position.set(Math.sin(a) * 0.8, H - 0.28, -1.2 + Math.cos(a) * 0.8);
    root.add(cable);
  }

  // ── THE DOORS TO THE FLOOR (north, beyond the board) ──────────────────
  // Closed double doors in a stepped brass portal; a warm crack of light
  // glows between them — brighter when a room of yours is open beyond.
  const doorW = 2.0;
  const doorH = 2.4;
  for (let i = 0; i < 2; i++) {
    const w = doorW + 0.26 + i * 0.3;
    const h = doorH + 0.18 + i * 0.24;
    const t = 0.08 - i * 0.02;
    const mat = i === 0 ? brassMat(0.25) : bronzeMat();
    box(root, mat, t, h, t, -w / 2, h / 2, NZ + 0.14 - i * 0.04);
    box(root, mat, t, h, t, w / 2, h / 2, NZ + 0.14 - i * 0.04);
    box(root, mat, w + t, t, t, 0, h, NZ + 0.14 - i * 0.04);
  }
  const doorMat = new MeshStandardMaterial({ map: oakTexture([1, 2]), roughness: 0.55, metalness: 0.05 });
  for (const side of [-1, 1] as const) {
    const leaf = new Mesh(new BoxGeometry(doorW / 2 - 0.028, doorH, 0.06), doorMat);
    leaf.position.set((side * doorW) / 4, doorH / 2, NZ + 0.1);
    root.add(leaf);
    box(root, brassMat(0.3), 0.05, 0.32, 0.02, side * 0.14, 1.12, NZ + 0.14);
    // Porthole: a small round window with the club's glow behind it.
    const port = new Mesh(new TorusGeometry(0.11, 0.018, 8, 20), brassMat(0.25));
    port.position.set((side * doorW) / 4, 1.7, NZ + 0.135);
    root.add(port);
  }
  const doorGlowMat = new MeshStandardMaterial({
    color: 0x201812,
    emissive: DECOR.cove,
    emissiveIntensity: 0.5,
    roughness: 0.5,
  });
  const crack = new Mesh(new PlaneGeometry(0.035, doorH - 0.08), doorGlowMat);
  crack.name = 'live-door-crack';
  crack.position.set(0, doorH / 2, NZ + 0.135);
  root.add(crack);
  for (const side of [-1, 1] as const) {
    const portGlow = new Mesh(new CircleGeometry(0.095, 16), doorGlowMat);
    portGlow.name = 'live-door-port';
    portGlow.position.set((side * doorW) / 4, 1.7, NZ + 0.132);
    root.add(portGlow);
  }
  const floorSign = signPlane(1.42, 0.3, 768, (g, sw, sh) => {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#e8d9b0';
    g.shadowColor = 'rgba(255,196,110,0.85)';
    g.shadowBlur = 16;
    g.font = `500 74px Georgia, serif`;
    g.fillText('T H E   F L O O R', sw / 2, sh * 0.4);
    g.shadowBlur = 0;
    g.font = `400 30px Georgia, serif`;
    g.fillStyle = 'rgba(232,217,176,0.7)';
    g.fillText('host or join a room — the doors do the rest', sw / 2, sh * 0.82);
  });
  floorSign.name = 'live-floor-sign';
  floorSign.position.set(0, 2.72, NZ + 0.12);
  root.add(floorSign);

  // ── THE COAT CHECK (west wall) ────────────────────────────────────────
  // A counter under a brass-framed hatch, numbered tags, a call bell, and
  // a rail of checked coats fading into the dark behind it.
  const counterMat = new MeshStandardMaterial({ map: oakTexture([2, 1]), roughness: 0.5, metalness: 0.06 });
  box(root, counterMat, 0.5, 0.98, 1.9, -HW + 0.35, 0.49, -1.0);
  box(root, new MeshStandardMaterial({ map: marbleTexture([1, 1]), metalness: 0.2, roughness: 0.22 }), 0.56, 0.04, 2.0, -HW + 0.37, 1.0, -1.0);
  // Hatch: a dark opening with a brass frame and half-drawn ribbed shade.
  const hatch = new Mesh(new PlaneGeometry(1.7, 1.1), new MeshBasicMaterial({ color: 0x07060a }));
  hatch.rotation.y = Math.PI / 2;
  hatch.position.set(-HW + 0.02, 1.65, -1.0);
  root.add(hatch);
  box(root, brassMat(0.3), 0.05, 0.06, 1.8, -HW + 0.06, 2.22, -1.0);
  box(root, brassMat(0.3), 0.05, 0.06, 1.8, -HW + 0.06, 1.08, -1.0);
  const shade = new Mesh(
    new PlaneGeometry(1.7, 0.42),
    new MeshStandardMaterial({ map: ribbedGlassTexture([4, 1]), emissive: DECOR.cove, emissiveIntensity: 0.2, roughness: 0.45 }),
  );
  shade.rotation.y = Math.PI / 2;
  shade.position.set(-HW + 0.04, 2.0, -1.0);
  root.add(shade);
  // Coats on a rail inside the dark: simple hung silhouettes.
  const coatMat = new MeshStandardMaterial({ color: 0x17151c, roughness: 0.95 });
  const railRod = new Mesh(new CylinderGeometry(0.012, 0.012, 1.5, 6), brassMat(0.4));
  railRod.rotation.x = Math.PI / 2;
  railRod.position.set(-HW - 0.25, 1.9, -1.0);
  root.add(railRod);
  for (let i = 0; i < 5; i++) {
    const coat = new Mesh(new CylinderGeometry(0.07, 0.13, 0.7, 8), coatMat);
    coat.position.set(-HW - 0.25, 1.5, -1.62 + i * 0.3);
    root.add(coat);
  }
  // The call bell + a stack of numbered tags on the counter.
  const bell = new Mesh(new CylinderGeometry(0.045, 0.055, 0.045, 14), brassMat(0.18));
  bell.position.set(-HW + 0.4, 1.045, -0.5);
  root.add(bell);
  const bellPip = new Mesh(new CylinderGeometry(0.008, 0.008, 0.02, 6), blackSteelMat());
  bellPip.position.set(-HW + 0.4, 1.08, -0.5);
  root.add(bellPip);
  for (let i = 0; i < 3; i++) {
    box(root, brassMat(0.45), 0.07, 0.008, 0.1, -HW + 0.42, 1.026 + i * 0.009, -1.5 + i * 0.012);
  }
  const checkSign = signPlane(0.72, 0.2, 512, (g, sw, sh) => {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(232,217,176,0.92)';
    g.font = `400 52px Georgia, serif`;
    g.fillText('C O A T   C H E C K', sw / 2, sh / 2);
  });
  checkSign.name = 'live-check-sign';
  checkSign.rotation.y = Math.PI / 2;
  checkSign.position.set(-HW + 0.09, 2.42, -1.0);
  root.add(checkSign);

  // ── the east side: velvet bench, poster frames, a mirror that isn't ───
  const benchSeat = new MeshStandardMaterial({ map: velvetTexture([2, 1]), roughness: 0.96, metalness: 0 });
  box(root, blackSteelMat(), 1.7, 0.12, 0.5, HW - 0.55, 0.2, -0.6);
  const cushion = new Mesh(roundedPuck(0.26, 0.1, 0.04), benchSeat);
  cushion.scale.set(3.2, 1, 0.9);
  cushion.position.set(HW - 0.55, 0.31, -0.6);
  root.add(cushion);
  for (const bx of [HW - 1.25, HW + 0.15]) {
    box(root, brassMat(0.35), 0.05, 0.34, 0.05, bx, 0.17, -0.6);
  }
  // Aged "mirror" — a dark gloss panel in a brass frame (reflection implied).
  const mirror = new Mesh(
    new PlaneGeometry(0.7, 1.5),
    new MeshStandardMaterial({ color: 0x11141c, metalness: 0.9, roughness: 0.08 }),
  );
  mirror.rotation.y = -Math.PI / 2;
  mirror.position.set(HW - 0.03, 1.6, 0.6);
  root.add(mirror);
  box(root, brassMat(0.3), 0.03, 1.58, 0.78, HW - 0.02, 1.6, 0.6);
  // Tonight's bill, framed: three set names in house type.
  const bill = signPlane(0.82, 1.1, 512, (g, sw, sh) => {
    g.strokeStyle = 'rgba(201,168,106,0.9)';
    g.lineWidth = 4;
    g.strokeRect(8, 8, sw - 16, sh - 16);
    g.textAlign = 'center';
    g.fillStyle = 'rgba(232,217,176,0.95)';
    g.font = `500 44px Georgia, serif`;
    g.fillText('TONIGHT', sw / 2, 90);
    g.font = `400 34px Georgia, serif`;
    g.fillStyle = 'rgba(232,217,176,0.8)';
    ['OPENING SET', 'PEAK HOURS', 'AFTER HOURS'].forEach((line, i) => {
      g.fillText(line, sw / 2, 210 + i * 100);
    });
    g.fillStyle = css(PALETTE.magenta);
    g.shadowColor = css(PALETTE.magenta);
    g.shadowBlur = 10;
    g.font = `700 24px 'Arial Black', system-ui, sans-serif`;
    g.fillText('THE GOOP GUARDS EVERY THIRD', sw / 2, sh - 80, sw - 70);
  });
  bill.name = 'live-bill';
  bill.rotation.y = -Math.PI / 2;
  bill.position.set(HW - 0.04, 1.62, -1.9);
  root.add(bill);

  // ── the street doors behind you + plaque ──────────────────────────────
  for (const side of [-1, 1] as const) {
    const leaf = new Mesh(new BoxGeometry(0.85, 2.3, 0.06), doorMat);
    leaf.position.set(side * 0.45, 1.15, SZ - 0.1);
    root.add(leaf);
    box(root, brassMat(0.3), 0.05, 0.3, 0.02, side * 0.14, 1.1, SZ - 0.14);
  }
  box(root, brassMat(0.25), 2.1, 0.08, 0.08, 0, 2.34, SZ - 0.1);
  const nightSign = signPlane(1.05, 0.34, 512, (g, sw, sh) => {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgba(232,217,176,0.6)';
    g.font = `400 34px Georgia, serif`;
    g.fillText('outside is a rumour', sw / 2, sh / 2);
  });
  nightSign.name = 'live-night-sign';
  nightSign.rotation.y = Math.PI;
  nightSign.position.set(0, 2.62, SZ - 0.08);
  root.add(nightSign);

  // A desk candle by the board (shares the club's flicker material).
  const candleHolder = new Group();
  candleHolder.name = 'live-foyer-candle';
  const flame = new Sprite(candleMat);
  flame.scale.setScalar(0.14);
  flame.position.set(HW - 0.55, 0.5, -0.6);
  candleHolder.add(flame);
  root.add(candleHolder);

  // ── light: one warm point + hemi, a room you can read faces in ────────
  root.add(new HemisphereLight(0x9a92b8, 0x100c16, 0.66));
  const key = new PointLight(0xffd9ac, 1.35, 9, 1.6);
  key.position.set(0, H - 0.5, -1.2);
  root.add(key);

  scene.add(root);
  collapseStatic(root, (o) => {
    for (let n: Object3D | null = o; n; n = n.parent) {
      if (n.name.startsWith('live-')) return true;
      if (n === root) break;
    }
    return false;
  });

  return { root, doorGlowMat, candleMat };
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
