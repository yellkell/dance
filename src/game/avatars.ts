/**
 * The other dancers — couture rave mannequins, one per occupied platform.
 * Gloss-black lathe-sculpted body (cinched waist, flared hip basque, a real
 * clavicle line), a structured visor with a neon scan-slit, faceted gauntlet
 * hands with tapered glowstick blades, heeled boots on neon soles — all in
 * the seat's colour. Four style variants (crest fin / halo / spire / bare)
 * derive deterministically from the hue so a full ring isn't 24 clones.
 *
 * The rig is driven entirely from a HEAD position and two HAND targets —
 * exactly what VR actually knows about a person. Everything else is solved:
 * the hips hang under the head, two-bone arms bend at solved elbows, long
 * legs stretch from hip to ankle (crouching shortens them naturally), and
 * elimination melts the whole figure floorward.
 *
 * YOU have no figure. The local player never sees their own body — your
 * platform shows only your controllers; the elegance is for everyone else's
 * view of you (and the groupies).
 *
 * Everything is authored in PLATFORM-LOCAL space and parented to the seat's
 * platform root, so rank lifts and eliminations carry the dancer with the
 * deck for free. All geometry is procedural and shared module-wide (unit
 * primitives + lathe profiles, cached by key); materials are per-rig (they
 * carry the seat colour and get mutated for hit-flash / elimination).
 */

import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import { hueToColor } from '../config.js';
import { glowSprite } from '../materials/glow.js';

export interface DancerPose {
  /** Head centre, platform-local. */
  hx: number;
  hy: number;
  hz: number;
  /** Head yaw (radians about +Y; 0 faces −Z, toward the stage). */
  yaw: number;
  /** Hand targets, platform-local. */
  lx: number;
  ly: number;
  lz: number;
  rx: number;
  ry: number;
  rz: number;
  /** 0 dancing … 1 melted on the deck (eliminated). */
  slump: number;
}

export interface DancerRig {
  root: Group;
  /** Every accent material (dim on elimination, flash on hit). */
  accents: (MeshStandardMaterial | MeshBasicMaterial)[];
  baseColor: number;
  /** Solve the whole figure from head + hands. */
  pose(p: DancerPose): void;
  dispose(): void;
}

/* Figure proportions (metres) — deliberately long-limbed and narrow:
 * fashion-sketch legs (high hip line), slim arms, a small oval head. */
const UPPER_ARM = 0.29;
const FOREARM = 0.27;
const HEAD_R = 0.085;
const HEAD_DROP = 0.66; // head centre → hip line, standing (high hips = long legs)
const SHOULDER_W = 0.15; // half-width
const SHOULDER_DROP = 0.15; // head centre → shoulder line
const HIP_W = 0.072; // half-width
const ANKLE = 0.085; // ankle height — legs end here, boots own the rest

const UP = new Vector3(0, 1, 0);
const SIDES = [-1, 1] as const;
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _dir = new Vector3();
const _mid = new Vector3();
const _perp = new Vector3();
const _q = new Quaternion();
/** Pre-rotation that turns a torus (axis +Z) into a ring around +Y. */
const X90 = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);

/* ── shared unit geometry, cached module-wide ──
 * 24 rigs can be live at once; every mesh here draws one of a small fixed
 * set of unit primitives, scaled per-mesh. Cached geometries are never
 * disposed by rigs (dispose() releases materials only). */
const geoCache = new Map<string, BufferGeometry>();
function cached(key: string, make: () => BufferGeometry): BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}
/** Unit-height cylinder authored base-at-origin along +Y (for align()). */
function segGeo(rTop: number, rBottom: number, sides = 8): BufferGeometry {
  return cached(`seg:${rTop}:${rBottom}:${sides}`, () => {
    const g = new CylinderGeometry(rTop, rBottom, 1, sides);
    g.translate(0, 0.5, 0);
    return g;
  });
}
function sphereGeo(detail: 8 | 16): BufferGeometry {
  return cached(`sph:${detail}`, () => new SphereGeometry(1, detail, detail === 8 ? 6 : 12));
}
function boxGeo(): BufferGeometry {
  return cached('box', () => new BoxGeometry(1, 1, 1));
}
function torusGeo(r: number, tube: number): BufferGeometry {
  return cached(`tor:${r}:${tube}`, () => new TorusGeometry(r, tube, 8, 20));
}
function hexGeo(): BufferGeometry {
  return cached('hex', () => new CylinderGeometry(0.5, 0.5, 1, 6));
}
/** Unit-height lathe (base at y=0, top at y=1) from (radius, height) pairs. */
function latheGeo(key: string, profile: number[][]): BufferGeometry {
  return cached(key, () => new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), 16));
}

/* The couture torso, two stacked lathes meeting at a cinched waist.
 * Radii are real metres; height is unit (align() stretches to fit). */
const BODICE = [
  // waist cinch → ribcage → bust → shoulder root
  [0.024, 0.0],
  [0.048, 0.06],
  [0.063, 0.3],
  [0.078, 0.6],
  [0.076, 0.8],
  [0.058, 0.94],
  [0.028, 1.0],
];
const BASQUE = [
  // hip line → flared basque → back up to the same waist cinch
  [0.03, 0.0],
  [0.069, 0.1],
  [0.079, 0.28],
  [0.067, 0.55],
  [0.038, 0.86],
  [0.025, 1.0],
];

/** Stretch a base-at-origin unit segment from `a` to `b`. */
function align(seg: Mesh, a: Vector3, b: Vector3): void {
  seg.position.copy(a);
  _dir.copy(b).sub(a);
  const len = Math.max(0.02, _dir.length());
  seg.scale.set(1, len, 1);
  _q.setFromUnitVectors(UP, _dir.normalize());
  seg.quaternion.copy(_q);
}

/** Style variant 0..3 — a pure function of the hue, so every client agrees. */
function styleVariant(hue: number): number {
  const h = ((hue % 1) + 1) % 1;
  return Math.floor(h * 4096) % 4;
}

export function buildDancer(hue: number): DancerRig {
  const root = new Group();
  const color = hueToColor(hue, 0.6);
  const variant = styleVariant(hue);
  const accents: DancerRig['accents'] = [];

  /* ── the three material families ── */
  // Couture body: gloss-black with a faint sheen of the seat's own colour —
  // the neon trim owns the silhouette, but the figure never vanishes into a
  // dark room (or a dark real room, in passthrough).
  const body = new MeshStandardMaterial({
    color: 0x171a21,
    emissive: color,
    emissiveIntensity: 0.055,
    metalness: 0.85,
    roughness: 0.24,
  });
  // Lit limbs: in a dark club a near-black arm disappears and the glowing
  // hand reads as DETACHED — lit limbs keep every stick visibly connected
  // to the body that swings it. Accent-registered, so hit flashes and
  // elimination dims run down the arms too.
  const limb = new MeshStandardMaterial({
    color: 0x20242e,
    emissive: color,
    emissiveIntensity: 0.55,
    metalness: 0.6,
    roughness: 0.32,
  });
  accents.push(limb);
  // Neon trim, two temperatures: standard (lit jewellery — collar, choker,
  // belt, cuffs) and flat (the hottest slits and blades).
  const neonStd = new MeshStandardMaterial({
    color: 0x101218,
    emissive: color,
    emissiveIntensity: 1.25,
    metalness: 0.35,
    roughness: 0.4,
  });
  accents.push(neonStd);
  const neonFlat = new MeshBasicMaterial({ color });
  accents.push(neonFlat);
  // Halo sprites join the accent list too (structurally a color-only
  // material), so eliminated dancers' glows die with them and hit flashes
  // tint the halos red.
  const glow = (size: number, opacity: number) => {
    const s = glowSprite(color, size, opacity);
    accents.push(s.material as unknown as MeshBasicMaterial);
    return s;
  };

  const M = (geo: BufferGeometry, mat: MeshStandardMaterial | MeshBasicMaterial): Mesh => new Mesh(geo, mat);
  const seg = (rt: number, rb: number, mat: MeshStandardMaterial): Mesh => M(segGeo(rt, rb), mat);

  /* ── head: dark gloss oval, structured visor, jewellery, variant crest ── */
  const head = new Group();
  const skull = M(sphereGeo(16), body);
  skull.scale.set(HEAD_R * 0.86, HEAD_R * 1.12, HEAD_R * 0.94);
  head.add(skull);
  // Visor: a gloss shell wrapping the face, framing a hot scan-slit that
  // sits proud of the front face — a lit line in a dark bezel.
  const visorShell = M(boxGeo(), body);
  visorShell.scale.set(0.122, 0.048, 0.052);
  visorShell.position.set(0, 0.012, -0.05);
  head.add(visorShell);
  const visorSlit = M(boxGeo(), neonFlat);
  visorSlit.scale.set(0.108, 0.009, 0.02);
  visorSlit.position.set(0, 0.012, -0.072);
  head.add(visorSlit);
  // Ear pips — the little jewellery that catches at close range.
  for (const side of [-1, 1]) {
    const pip = M(sphereGeo(8), neonStd);
    pip.scale.setScalar(0.012);
    pip.position.set(side * 0.069, 0.004, -0.006);
    head.add(pip);
  }
  // Variant crest — deterministic from the hue.
  if (variant === 0) {
    // Swept mohawk: a main blade rising from the scalp, a trailing shard
    // down the back of the skull — both rooted inside the head.
    const fin = M(boxGeo(), limb);
    fin.scale.set(0.011, 0.105, 0.13);
    fin.position.set(0, 0.06, 0.012);
    fin.rotation.x = 0.4;
    head.add(fin);
    const tail = M(boxGeo(), limb);
    tail.scale.set(0.009, 0.06, 0.085);
    tail.position.set(0, 0.02, 0.082);
    tail.rotation.x = 1.0;
    head.add(tail);
  } else if (variant === 1) {
    // Floating halo.
    const halo = M(torusGeo(0.075, 0.006), neonStd);
    halo.position.set(0, 0.155, 0);
    halo.rotation.x = Math.PI / 2;
    halo.rotation.z = 0.1;
    head.add(halo);
  } else if (variant === 2) {
    // Swept horn crest: a flattened cone rooted in the crown — thin across,
    // deep front-to-back, so it reads as sculpted hair, not an antenna —
    // raked back hard with a neon pip riding its exact tip.
    const RAKE = 0.8;
    const LEN = 0.155;
    const spire = M(segGeo(0.004, 0.03), body);
    spire.scale.set(0.5, LEN, 1.7);
    spire.position.set(0, 0.045, 0.02);
    spire.rotation.x = RAKE;
    head.add(spire);
    const tip = M(sphereGeo(8), neonFlat);
    tip.scale.setScalar(0.008);
    tip.position.set(0, 0.045 + LEN * Math.cos(RAKE), 0.02 + LEN * Math.sin(RAKE));
    head.add(tip);
  } else {
    // Bare — the shaved-head look; double up the jewellery to carry it.
    for (const side of [-1, 1]) {
      const stud = M(sphereGeo(8), neonStd);
      stud.scale.setScalar(0.008);
      stud.position.set(side * 0.062, -0.048, -0.032);
      head.add(stud);
    }
  }
  head.add(glow(0.3, 0.3));
  root.add(head);

  /* ── torso: neck → bodice → basque, one sculpted line ──
   * Two lathes meet at the cinched waist under a neon belt; the collar and
   * choker bound the neck; a clavicle V and shoulder caps hang the arms. */
  const neck = seg(0.023, 0.031, body);
  const bodice = M(latheGeo('bodice', BODICE), body);
  const basque = M(latheGeo('basque', BASQUE), limb);
  root.add(neck, bodice, basque);
  const collar = M(torusGeo(0.06, 0.009), neonStd);
  const choker = M(torusGeo(0.033, 0.005), neonStd);
  const belt = M(torusGeo(0.04, 0.007), neonStd);
  root.add(collar, choker, belt);
  const clavL = seg(0.015, 0.021, limb);
  const clavR = seg(0.015, 0.021, limb);
  root.add(clavL, clavR);
  const capL = M(sphereGeo(8), limb);
  const capR = M(sphereGeo(8), limb);
  capL.scale.set(0.05, 0.036, 0.05);
  capR.scale.set(0.05, 0.036, 0.05);
  root.add(capL, capR);

  /* ── arms: shoulder → elbow → hand, solved each pose ── */
  const upperL = seg(0.026, 0.021, limb);
  const upperR = seg(0.026, 0.021, limb);
  const foreL = seg(0.021, 0.016, limb);
  const foreR = seg(0.021, 0.016, limb);
  root.add(upperL, upperR, foreL, foreR);
  const elbowL = M(sphereGeo(8), limb);
  const elbowR = M(sphereGeo(8), limb);
  elbowL.scale.setScalar(0.026);
  elbowR.scale.setScalar(0.026);
  root.add(elbowL, elbowR);

  /* ── hands: faceted gauntlet mitt + neon cuff + glowstick blade ── */
  const mkHand = (): Group => {
    const hand = new Group();
    const mitt = M(hexGeo(), body);
    mitt.scale.set(0.075, 0.05, 0.095);
    mitt.position.set(0, 0.004, -0.028);
    mitt.rotation.x = -0.12;
    hand.add(mitt);
    const fingers = M(boxGeo(), body);
    fingers.scale.set(0.06, 0.017, 0.05);
    fingers.position.set(0, -0.012, -0.072);
    fingers.rotation.x = -0.5;
    hand.add(fingers);
    const cuff = M(torusGeo(0.034, 0.0065), neonStd);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.set(0, 0.008, -0.008);
    hand.add(cuff);
    // The glowstick: a tapered blade rising out of the fist to a near-point.
    const blade = M(segGeo(0.006, 0.0125, 7), neonFlat);
    blade.scale.y = 0.3;
    blade.position.y = 0.015;
    hand.add(blade);
    hand.add(glow(0.26, 0.5));
    root.add(hand);
    return hand;
  };
  const handL = mkHand();
  const handR = mkHand();

  /* ── legs: hip → ankle, one long tapered line + a front piping seam ── */
  const mkLeg = (): Mesh => {
    const leg = seg(0.037, 0.019, limb);
    const pipe = M(segGeo(0.0055, 0.0055, 5), neonStd);
    pipe.position.set(0, 0.03, -0.0235);
    pipe.scale.y = 0.9; // proportional: children inherit the align() stretch
    leg.add(pipe);
    root.add(leg);
    return leg;
  };
  const legL = mkLeg();
  const legR = mkLeg();
  const hipBallL = M(sphereGeo(8), limb);
  const hipBallR = M(sphereGeo(8), limb);
  hipBallL.scale.setScalar(0.033);
  hipBallR.scale.setScalar(0.033);
  root.add(hipBallL, hipBallR);

  /* ── boots: shaft + raked toe + chunky heel on a neon sole ── */
  const mkBoot = (): Group => {
    const boot = new Group(); // origin at the ankle, ANKLE above the floor
    const shaft = M(segGeo(0.021, 0.03), body);
    shaft.scale.y = 0.069;
    shaft.position.y = -0.069; // base sits on the sole, slim top meets the leg line
    boot.add(shaft);
    const sole = M(boxGeo(), neonFlat);
    sole.scale.set(0.06, 0.015, 0.16);
    sole.position.set(0, -ANKLE + 0.0075, -0.025);
    boot.add(sole);
    const toe = M(boxGeo(), body);
    toe.scale.set(0.054, 0.036, 0.075);
    toe.position.set(0, -0.059, -0.072);
    toe.rotation.x = 0.16;
    boot.add(toe);
    const heel = M(boxGeo(), body);
    heel.scale.set(0.042, 0.05, 0.038);
    heel.position.set(0, -0.06, 0.042);
    boot.add(heel);
    root.add(boot);
    return boot;
  };
  const bootL = mkBoot();
  const bootR = mkBoot();

  /** Solve one two-bone arm and place its meshes (elbow ball included). */
  const solveArm = (
    side: -1 | 1,
    shoulder: Vector3,
    hand: Group,
    hx: number,
    hy: number,
    hz: number,
    upper: Mesh,
    fore: Mesh,
    elbow: Mesh,
  ): void => {
    _b.set(hx, hy, hz);
    _dir.copy(_b).sub(shoulder);
    const reach = UPPER_ARM + FOREARM - 0.015;
    if (_dir.length() > reach) {
      // Out of reach: bring the hand to full elegant extension.
      _dir.setLength(reach);
      _b.copy(shoulder).add(_dir);
    }
    const d = Math.max(0.05, _b.distanceTo(shoulder));
    // Elbow: on the shoulder→hand chord, pushed out-and-down — the
    // natural bend of an arm holding something up.
    const along = (d * d + UPPER_ARM * UPPER_ARM - FOREARM * FOREARM) / (2 * d);
    const lift = Math.sqrt(Math.max(0.0004, UPPER_ARM * UPPER_ARM - along * along));
    _dir.copy(_b).sub(shoulder).normalize();
    _perp.crossVectors(_dir, UP);
    if (_perp.lengthSq() < 1e-6) _perp.set(side, 0, 0);
    _perp.normalize().multiplyScalar(side);
    _perp.y -= 0.7; // bias the bend downward
    _perp.normalize();
    _mid.copy(shoulder).addScaledVector(_dir, along).addScaledVector(_perp, lift);
    align(upper, shoulder, _mid);
    align(fore, _mid, _b);
    elbow.position.copy(_mid);
    hand.position.copy(_b);
    // The glowstick leans with the forearm, flared slightly outward.
    hand.quaternion.setFromUnitVectors(UP, _dir.set(side * 0.35, 1, -0.15).normalize());
  };

  const shoulderL = new Vector3();
  const shoulderR = new Vector3();
  const hip = new Vector3();
  const foot = new Vector3();

  const pose = (p: DancerPose): void => {
    // Melt: the whole solve runs on a squashed frame — head sinks, hips
    // sink faster, and the figure puddles.
    const melt = p.slump;
    const hy = p.hy * (1 - melt * 0.62);
    const hipY = Math.max(0.12, (p.hy - HEAD_DROP) * (1 - melt * 0.85));
    const hipX = p.hx * 0.94;
    const hipZ = p.hz * 0.94;

    head.position.set(p.hx, hy, p.hz);
    head.rotation.set(melt * 0.9, p.yaw, melt * 0.35);

    const cos = Math.cos(p.yaw);
    const sin = Math.sin(p.yaw);

    // Shoulder line under the head, turned with the yaw.
    const shY = hy - SHOULDER_DROP;
    shoulderL.set(p.hx - SHOULDER_W * cos, shY, p.hz + SHOULDER_W * sin);
    shoulderR.set(p.hx + SHOULDER_W * cos, shY, p.hz - SHOULDER_W * sin);

    // Torso line: neck → bodice (shoulder mid → waist) → basque (→ hips).
    _a.set(p.hx, hy - HEAD_R * 1.05, p.hz);
    _b.set((shoulderL.x + shoulderR.x) / 2, shY, (shoulderL.z + shoulderR.z) / 2);
    align(neck, _b, _a);
    choker.position.copy(_a).lerp(_b, 0.32);
    choker.quaternion.copy(neck.quaternion).multiply(X90);
    _mid.set(hipX * 0.35 + _b.x * 0.65, hipY + (shY - hipY) * 0.42, hipZ * 0.35 + _b.z * 0.65);
    align(bodice, _mid, _b);
    _a.set(hipX, hipY, hipZ);
    align(basque, _a, _mid);
    collar.position.copy(_b);
    collar.position.y -= 0.02;
    collar.quaternion.copy(bodice.quaternion).multiply(X90);
    belt.position.copy(_mid);
    belt.quaternion.copy(basque.quaternion).multiply(X90);

    // Clavicle V from the sternum notch out to each shoulder; caps pin the
    // arms to the torso at any pose angle.
    _c.set(_b.x - sin * 0.045, shY - 0.02, _b.z - cos * 0.045);
    align(clavL, _c, shoulderL);
    align(clavR, _c, shoulderR);
    capL.position.copy(shoulderL);
    capR.position.copy(shoulderR);
    capL.rotation.y = p.yaw;
    capR.rotation.y = p.yaw;

    // Arms.
    solveArm(-1, shoulderL, handL, p.lx, p.ly * (1 - melt * 0.6), p.lz, upperL, foreL, elbowL);
    solveArm(1, shoulderR, handR, p.rx, p.ry * (1 - melt * 0.6), p.rz, upperR, foreR, elbowR);

    // Legs: ankles plant a touch wider than the hips and trail the body;
    // boots stand on the floor beneath each ankle.
    for (const side of SIDES) {
      hip.set(hipX + side * HIP_W * cos, hipY, hipZ - side * HIP_W * sin);
      foot.set(hipX + side * (HIP_W + 0.032) * cos, ANKLE, hipZ - side * (HIP_W + 0.032) * sin + 0.02);
      const leg = side < 0 ? legL : legR;
      align(leg, foot, hip);
      (side < 0 ? hipBallL : hipBallR).position.copy(hip);
      const boot = side < 0 ? bootL : bootR;
      boot.position.copy(foot);
      boot.rotation.y = p.yaw;
    }
  };

  // Park in a neutral stance so a rig never renders unsolved.
  pose({ hx: 0, hy: 1.52, hz: 0, yaw: 0, lx: -0.3, ly: 1.0, lz: -0.1, rx: 0.3, ry: 1.0, rz: -0.1, slump: 0 });

  return {
    root,
    accents,
    baseColor: color,
    pose,
    dispose() {
      root.removeFromParent();
      // Geometry is module-shared (see geoCache) — release materials only.
      root.traverse((o) => {
        ((o as Mesh).material as MeshBasicMaterial | undefined)?.dispose?.();
      });
    },
  };
}
