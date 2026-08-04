/**
 * The other dancers — slender, elegant humanoid figures, one per occupied
 * platform. Mannequin-sleek: a gloss-black body with a neon collar, waist
 * line, wrist rings and visor in the seat's colour, glowsticks in hand.
 *
 * The rig is driven entirely from a HEAD position and two HAND targets —
 * exactly what VR actually knows about a person. Everything else is solved:
 * the hips hang under the head, two-bone arms bend at solved elbows, long
 * legs stretch from hip to floor (crouching shortens them naturally), and
 * elimination melts the whole figure floorward.
 *
 * YOU have no figure. The local player never sees their own body — your
 * platform shows only your controllers; the elegance is for everyone else's
 * view of you (and the groupies).
 *
 * Everything is authored in PLATFORM-LOCAL space and parented to the seat's
 * platform root, so rank lifts and eliminations carry the dancer with the
 * deck for free.
 */

import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
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

/* Figure proportions (metres) — deliberately long-limbed and narrow. */
const UPPER_ARM = 0.29;
const FOREARM = 0.27;
const HEAD_R = 0.085;
const HEAD_DROP = 0.7; // head centre → hip line, standing
const SHOULDER_W = 0.155; // half-width
const SHOULDER_DROP = 0.14; // head centre → shoulder line
const HIP_W = 0.075; // half-width

const UP = new Vector3(0, 1, 0);
const _a = new Vector3();
const _b = new Vector3();
const _dir = new Vector3();
const _mid = new Vector3();
const _perp = new Vector3();
const _q = new Quaternion();

/** A unit segment: a slim cylinder authored base-at-origin along +Y. */
function segment(rTop: number, rBottom: number, mat: MeshStandardMaterial): Mesh {
  const geo = new CylinderGeometry(rTop, rBottom, 1, 7);
  geo.translate(0, 0.5, 0);
  return new Mesh(geo, mat);
}

/** Stretch a segment from `a` to `b`. */
function align(seg: Mesh, a: Vector3, b: Vector3): void {
  seg.position.copy(a);
  _dir.copy(b).sub(a);
  const len = Math.max(0.02, _dir.length());
  seg.scale.set(1, len, 1);
  _q.setFromUnitVectors(UP, _dir.normalize());
  seg.quaternion.copy(_q);
}

export function buildDancer(hue: number): DancerRig {
  const root = new Group();
  const color = hueToColor(hue, 0.6);
  const accents: DancerRig['accents'] = [];

  // The body: dark gloss with a faint sheen of the seat's own colour — the
  // neon trim owns the silhouette, but the figure never vanishes into a dark
  // room (or a dark real room, in passthrough).
  const body = new MeshStandardMaterial({
    color: 0x1a1e26,
    emissive: color,
    emissiveIntensity: 0.07,
    metalness: 0.65,
    roughness: 0.28,
  });
  const neonStd = (): MeshStandardMaterial => {
    const m = new MeshStandardMaterial({
      color: 0x14161c,
      emissive: color,
      emissiveIntensity: 1.1,
      metalness: 0.3,
      roughness: 0.4,
    });
    accents.push(m);
    return m;
  };
  const neonFlat = (): MeshBasicMaterial => {
    const m = new MeshBasicMaterial({ color });
    accents.push(m);
    return m;
  };

  /* ── head ── */
  const head = new Group();
  const skull = new Mesh(new SphereGeometry(HEAD_R, 14, 10), body);
  skull.scale.set(0.86, 1.12, 0.92); // a slender oval, not a beach ball
  head.add(skull);
  const visor = new Mesh(new BoxGeometry(0.115, 0.03, 0.02), neonFlat());
  visor.position.set(0, 0.012, -HEAD_R * 0.92);
  head.add(visor);
  head.add(glowSprite(color, 0.4, 0.4));
  root.add(head);

  /* ── torso: neck → chest → waist, one tapering line ── */
  const neck = segment(0.028, 0.034, body);
  root.add(neck);
  const chest = segment(0.062, 0.045, body); // shoulders → waist (inverted: top wider)
  root.add(chest);
  const waist = segment(0.045, 0.06, body); // waist → hips flare, subtle
  root.add(waist);
  const collar = new Mesh(new TorusGeometry(0.075, 0.008, 6, 16), neonStd());
  collar.rotation.x = Math.PI / 2;
  root.add(collar);
  const waistRing = new Mesh(new TorusGeometry(0.062, 0.006, 6, 14), neonStd());
  waistRing.rotation.x = Math.PI / 2;
  root.add(waistRing);

  /* ── arms: shoulder → elbow → hand, solved each pose ── */
  const upperL = segment(0.024, 0.02, body);
  const upperR = segment(0.024, 0.02, body);
  const foreL = segment(0.019, 0.016, body);
  const foreR = segment(0.019, 0.016, body);
  root.add(upperL, upperR, foreL, foreR);

  const mkHand = (): Group => {
    const hand = new Group();
    hand.add(new Mesh(new SphereGeometry(0.032, 8, 6), body));
    const ring = new Mesh(new TorusGeometry(0.038, 0.006, 6, 12), neonStd());
    ring.rotation.x = Math.PI / 2;
    hand.add(ring);
    const stick = new Mesh(new CylinderGeometry(0.011, 0.011, 0.26, 6), neonFlat());
    stick.position.y = 0.1;
    hand.add(stick);
    hand.add(glowSprite(color, 0.3, 0.55));
    root.add(hand);
    return hand;
  };
  const handL = mkHand();
  const handR = mkHand();

  /* ── legs: hip → floor, one long line each ── */
  const legL = segment(0.03, 0.02, body);
  const legR = segment(0.03, 0.02, body);
  root.add(legL, legR);
  const footL = new Mesh(new SphereGeometry(0.045, 8, 6), body);
  const footR = new Mesh(new SphereGeometry(0.045, 8, 6), body);
  footL.scale.set(0.9, 0.45, 1.6);
  footR.scale.set(0.9, 0.45, 1.6);
  root.add(footL, footR);

  /** Solve one two-bone arm and place its meshes. */
  const solveArm = (
    side: -1 | 1,
    shoulder: Vector3,
    hand: Group,
    hx: number,
    hy: number,
    hz: number,
    upper: Mesh,
    fore: Mesh,
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

    // Torso line: neck → chest (shoulder mid) → waist → hips.
    _a.set(p.hx, hy - HEAD_R * 1.05, p.hz);
    _b.set((shoulderL.x + shoulderR.x) / 2, shY, (shoulderL.z + shoulderR.z) / 2);
    align(neck, _b, _a);
    _mid.set(hipX * 0.35 + _b.x * 0.65, hipY + (shY - hipY) * 0.42, hipZ * 0.35 + _b.z * 0.65);
    align(chest, _mid, _b);
    _a.set(hipX, hipY, hipZ);
    align(waist, _a, _mid);
    collar.position.set(_b.x, shY - 0.015, _b.z);
    collar.rotation.y = p.yaw;
    waistRing.position.set(_mid.x, _mid.y, _mid.z);
    waistRing.rotation.y = p.yaw;

    // Arms.
    solveArm(-1, shoulderL, handL, p.lx, p.ly * (1 - melt * 0.6), p.lz, upperL, foreL);
    solveArm(1, shoulderR, handR, p.rx, p.ry * (1 - melt * 0.6), p.rz, upperR, foreR);

    // Legs: feet plant a touch wider than the hips and trail the body.
    for (const side of [-1, 1] as const) {
      hip.set(hipX + side * HIP_W * cos, hipY, hipZ - side * HIP_W * sin);
      foot.set(hipX + side * (HIP_W + 0.035) * cos, 0.025, hipZ - side * (HIP_W + 0.035) * sin + 0.02);
      const leg = side < 0 ? legL : legR;
      align(leg, foot, hip);
      const shoe = side < 0 ? footL : footR;
      shoe.position.copy(foot);
      shoe.rotation.y = p.yaw;
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
      root.traverse((o) => {
        const m = o as Mesh;
        m.geometry?.dispose?.();
        (m.material as MeshBasicMaterial)?.dispose?.();
      });
    },
  };
}
