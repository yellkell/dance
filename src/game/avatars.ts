/**
 * The other dancers — couture rave mannequins, one per occupied platform.
 * One dark suit in the seat's colour — bodice and trousers cut from the
 * same cloth, so the figure reads as an outfit rather than a black vest
 * over glowing tights — with LIT sleeves and a lit midriff, dark gloss
 * accessories (helm, gauntlets, heeled boots) and hot neon trim at every
 * seam. The body is shaped, not stacked: a cinched waist under a broad
 * shoulder yoke, hips that flow into the thighs, an elliptical
 * cross-section so the torso has a front, and a sculpted mannequin head —
 * tapered chin, full cranium, a goggle bezel framing a hot scan-slit. Four
 * style variants of neon hair (mohawk / twin blades / horn / twin spikes)
 * derive deterministically from the hue so a full ring isn't 24 clones.
 *
 * The rig is driven entirely from a HEAD position and two HAND targets —
 * exactly what VR actually knows about a person. Everything else is solved:
 * the hips hang under the head, two-bone arms bend at solved elbows,
 * two-bone legs bend at solved KNEES (so crouching folds the figure instead
 * of telescoping it), and elimination melts the whole thing floorward.
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

/**
 * One drivable material plus the brightness the figure was AUTHORED at,
 * relative to `ACCENT_REST`. Callers drive one intensity for the whole rig
 * (alive / flashing / eliminated) and multiply by `gain`, so the trim
 * hierarchy — hot blades over lit jewellery over a glowing suit over dark
 * leather — survives every state instead of flattening to one temperature.
 */
export interface DancerAccent {
  mat: MeshStandardMaterial | MeshBasicMaterial;
  gain: number;
  /** True for the NEON — collar, belt, cuffs, seams, blades, visor slit,
   *  halos — and false for the cloth it is sewn to (suit, sleeves, helm).
   *  A caller repainting the figure for a state (the MC's warn amber) can
   *  then light up the jewellery alone: recolouring the whole body turns
   *  the dancer into a different dancer, which is not what "he's winding
   *  up" should look like. */
  trim: boolean;
}

export interface DancerRig {
  root: Group;
  /** Every drivable material (dim on elimination, flash on hit). */
  accents: DancerAccent[];
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
const SHOULDER_W = 0.155; // half-width
const SHOULDER_DROP = 0.15; // head centre → shoulder line
const HIP_W = 0.082; // half-width
const ANKLE = 0.085; // ankle height — legs end here, boots own the rest
/** Femur (and shin) while the figure stands — see legBone(). Sized just
 *  over half the standing hip→ankle span, so a dancer at rest STANDS UP
 *  STRAIGHT (a few centimetres of knee, not a permanent half-squat) and
 *  the fold is saved for an actual crouch. */
const LEG_BONE = 0.392;

/* The torso's CROSS-SECTION. A lathe is round, and a round torso is a
 * bottle; broad across the chest and slim front-to-back is what makes the
 * same profile read as a body. Applied to the bodice, the basque and their
 * rings — never to the limbs, which really are round. */
const TORSO_X = 1.18;
const TORSO_Z = 0.8;

/** The emissive intensity the systems drive accents to at rest; materials
 *  are authored here × their gain, so the dev preview matches the game.
 *  Exported so a caller holding some accents at rest (the MC's warn, which
 *  lights the trim only) can put the cloth back exactly where it started. */
export const ACCENT_REST = 1.1;
/** The suit is DARK — gloss cloth carrying only a sheen of the seat colour,
 *  the same near-black as the helm. Bodice and trousers are cut from it, so
 *  the top and the legs finally match instead of reading as a black vest
 *  over glowing tights. */
const SUIT_GAIN = 0.2;
/** Helm, gauntlets and boots, a hair darker still — glossier leather next
 *  to the suit's cloth. */
const SHELL_GAIN = 0.18;
/** …and the LIT panels: sleeves, midriff, hair. A figure in head-to-toe
 *  black is a hole in a dark room, and a near-black arm with a glowing
 *  stick on the end of it reads as a DETACHED hand. Lighting exactly the
 *  sleeves, the waist and the crest keeps every stick visibly attached to
 *  the body swinging it, crowns the silhouette, and puts a bright band at
 *  the figure's own centre of motion — the part that sells a dance across
 *  thirty metres of arena. */
const LIT_GAIN = 0.62;

const UP = new Vector3(0, 1, 0);
const SIDES = [-1, 1] as const;
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _dir = new Vector3();
const _mid = new Vector3();
const _hint = new Vector3();
const _fwd = new Vector3();
const _right = new Vector3();
const _target = new Vector3();
/* twoBone()'s outputs — read them before the next call. */
const _solved = new Vector3();
const _tip = new Vector3();
/* Owned by twoBone() alone — never aliased by the pose solve. */
const _chain = new Vector3();
const _bend = new Vector3();
const _q = new Quaternion();
const _yawQ = new Quaternion();
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
 * Radii are real metres (before the TORSO_X/Z cross-section); height is
 * unit, and align() stretches it to whatever the solve asks for. */
const BODICE = [
  // waist cinch → ribs → chest → SHOULDER YOKE → neck root.
  // An S, not a cone: lean through the ribs, filling late into the chest —
  // a straight taper reads as a funnel. The yoke is the widest ring in the
  // whole figure (shoulder balls need something to hang off) and closes
  // over the top as a trapezius DOME rather than a flat shelf.
  [0.03, 0.0],
  [0.043, 0.09],
  [0.053, 0.26],
  [0.064, 0.46],
  [0.073, 0.66],
  [0.077, 0.8],
  [0.073, 0.9],
  [0.06, 0.96],
  [0.042, 0.99],
  [0.028, 1.0],
];
const BASQUE = [
  // hip line → flared basque → back up to the same 0.03 waist cinch.
  // Wide at the BOTTOM so the thighs emerge from inside the hips, and
  // never wider than the chest — hips that outrun the shoulders read as a
  // bulb on a stick.
  [0.054, 0.0],
  [0.065, 0.14],
  [0.066, 0.32],
  [0.057, 0.56],
  [0.041, 0.83],
  [0.03, 1.0],
];
/* The head, chin-up: a soft point at the jaw, cheekbones, a full cranium.
 * A scaled sphere is an egg on its side — widest at the equator with no
 * chin at all — and it reads as a lollipop on the neck. This profile is
 * the classic mannequin head: narrow below, weight above. */
const HEAD = [
  [0, 0],
  [0.028, 0.05],
  [0.048, 0.16],
  [0.06, 0.33],
  [0.067, 0.55],
  [0.066, 0.73],
  [0.057, 0.87],
  [0.04, 0.95],
  [0.021, 0.99],
  [0, 1.0],
];
/** Head height (m); the lathe above is unit-height like the others. */
const HEAD_H = 0.19;

/** Stretch a base-at-origin unit segment from `a` to `b`. */
function align(seg: Mesh, a: Vector3, b: Vector3, sx = 1, sz = 1): void {
  seg.position.copy(a);
  _dir.copy(b).sub(a);
  const len = Math.max(0.02, _dir.length());
  seg.scale.set(sx, len, sz);
  _q.setFromUnitVectors(UP, _dir.normalize());
  seg.quaternion.copy(_q);
}

/**
 * Solve a two-bone chain root → joint → tip. `hint` is the direction the
 * joint gets pushed toward; it is projected perpendicular to the chain
 * first, so an arm bends out-and-down and a knee bends forward no matter
 * how the chain is turned. The solved joint lands in `joint` and the
 * (possibly clamped) tip in `end` — placing meshes is the caller's job,
 * because arms hang DOWN from the shoulder while legs are built UP from the
 * floor and each wants its segments aligned its own way.
 */
function twoBone(
  root: Vector3,
  tip: Vector3,
  upper: number,
  lower: number,
  hint: Vector3,
  joint: Vector3,
  end: Vector3,
  slack = 0.015,
): void {
  _chain.copy(tip).sub(root);
  // Out of reach: bring the tip in to full extension rather than snapping.
  // `slack` keeps a chain off its own dead-straight singularity — worth it
  // for an arm at full stretch, but a leg pays for it in permanent knee
  // bend, and a foot that floats a centimetre off its target is worse than
  // a straight one, so legs pass 0.
  const d = Math.min(upper + lower - slack, Math.max(0.05, _chain.length()));
  _chain.normalize();
  end.copy(root).addScaledVector(_chain, d);

  const along = (d * d + upper * upper - lower * lower) / (2 * d);
  const push = Math.sqrt(Math.max(0.0004, upper * upper - along * along));
  _bend.copy(hint).addScaledVector(_chain, -hint.dot(_chain));
  if (_bend.lengthSq() < 1e-6) _bend.set(-_chain.y, _chain.x, 0); // hint parallel to the chain
  _bend.normalize();
  joint.copy(root).addScaledVector(_chain, along).addScaledVector(_bend, push);
}

/**
 * Bone length for a hip→ankle span. A FIXED femur while the figure stands,
 * so a crouch bends the knee instead of telescoping the leg; stretched for
 * players taller than the reference figure (the floor term, which keeps a
 * constant sliver of bend at any height); and folded down inside a deep
 * melt, where a full-length femur would fire the knees out sideways.
 *
 * The floor is barely over half the span — with twoBone's slack at 0 for
 * legs that is all it takes to keep the ankle exactly on its target, and
 * the knee then sits a few centimetres proud instead of the ten it used
 * to, which is the difference between standing and half-squatting.
 */
function legBone(span: number): number {
  return Math.max(span * 0.5 + 0.004, Math.min(LEG_BONE, span * 0.62 + 0.12));
}

/** How finely the hue is diced to pick a crest — one step is far too small
 *  a colour change to see, which is what lets the dev preview line up all
 *  four crests without disturbing its hue spread. */
export const STYLE_STEP = 1 / 4096;

/** Style variant 0..3 — a pure function of the hue, so every client agrees. */
export function styleVariant(hue: number): number {
  const h = ((hue % 1) + 1) % 1;
  return Math.floor(h * 4096) % 4;
}

export function buildDancer(hue: number): DancerRig {
  const root = new Group();
  const color = hueToColor(hue, 0.6);
  const variant = styleVariant(hue);
  const accents: DancerAccent[] = [];
  const accent = <T extends MeshStandardMaterial | MeshBasicMaterial>(mat: T, gain: number, trim = false): T => {
    accents.push({ mat, gain, trim });
    return mat;
  };

  /* ── the material families ──
   * The costume is CUT, not patchworked: bodice and trousers share one dark
   * cloth (that match is the whole point — a black top over glowing legs
   * reads as two different outfits), and the light lives in the sleeves and
   * the midriff, where the dancing is. */
  const suit = accent(
    new MeshStandardMaterial({
      color: 0x1b1f28,
      emissive: color,
      emissiveIntensity: ACCENT_REST * SUIT_GAIN,
      metalness: 0.6,
      roughness: 0.32,
    }),
    SUIT_GAIN,
  );
  // Sleeves and midriff — the same cloth, lit.
  const lit = accent(
    new MeshStandardMaterial({
      color: 0x20242e,
      emissive: color,
      emissiveIntensity: ACCENT_REST * LIT_GAIN,
      metalness: 0.6,
      roughness: 0.32,
    }),
    LIT_GAIN,
  );
  // The accessories: helm, gauntlets, boots, sculpted hair — gloss near-black
  // with just enough of the seat colour in it to stay a surface rather than
  // a silhouette-shaped hole.
  const shell = accent(
    new MeshStandardMaterial({
      color: 0x171a21,
      emissive: color,
      emissiveIntensity: ACCENT_REST * SHELL_GAIN,
      metalness: 0.85,
      roughness: 0.24,
    }),
    SHELL_GAIN,
  );
  // Neon trim, two temperatures: standard (lit jewellery — collar, choker,
  // belt, cuffs, seams) and flat (the hottest slits and blades).
  const neonStd = accent(
    new MeshStandardMaterial({
      color: 0x101218,
      emissive: color,
      emissiveIntensity: ACCENT_REST,
      metalness: 0.35,
      roughness: 0.4,
    }),
    1,
    true,
  );
  const neonFlat = accent(new MeshBasicMaterial({ color }), 1, true);
  // Halo sprites join the accent list too (structurally a color-only
  // material), so eliminated dancers' glows die with them and hit flashes
  // tint the halos red.
  const glow = (size: number, opacity: number) => {
    const s = glowSprite(color, size, opacity);
    accent(s.material as unknown as MeshBasicMaterial, 1, true);
    return s;
  };

  const M = (geo: BufferGeometry, mat: MeshStandardMaterial | MeshBasicMaterial): Mesh => new Mesh(geo, mat);
  const seg = (rt: number, rb: number, mat: MeshStandardMaterial): Mesh => M(segGeo(rt, rb), mat);

  /* ── head: sculpted dark skull, lit visor band, jewellery, crest ── */
  const head = new Group();
  const skull = M(latheGeo('head', HEAD), shell);
  // Narrower across than deep, like a head — and the lathe is authored
  // base-at-0, so it drops half its height to centre on the group origin.
  skull.scale.set(0.92, HEAD_H, 1.04);
  skull.position.y = -HEAD_H / 2;
  head.add(skull);
  // Visor: a structured goggle ACROSS THE FACE — a gloss bezel framing the
  // hot scan-slit, both proud of the skull. (A lit band wrapping the whole
  // head got tried and cut: it read as a blindfold, not eyewear.) The bezel
  // is sized so its back corners bury into the cheeks of the NEW narrower
  // skull instead of poking out at the temples the way the original did.
  const visorShell = M(boxGeo(), shell);
  visorShell.scale.set(0.105, 0.044, 0.05);
  visorShell.position.set(0, 0.014, -0.054);
  head.add(visorShell);
  const visorSlit = M(boxGeo(), neonFlat);
  visorSlit.scale.set(0.088, 0.011, 0.02);
  visorSlit.position.set(0, 0.014, -0.074);
  head.add(visorSlit);
  // Ear pips — the little jewellery that catches at close range,
  // half-buried beads riding the skull at the temples.
  for (const side of [-1, 1]) {
    const pip = M(sphereGeo(8), neonStd);
    pip.scale.setScalar(0.012);
    pip.position.set(side * 0.063, 0.004, -0.006);
    head.add(pip);
  }
  // Variant crest — deterministic from the hue. Hair carries neon: the
  // sweeps wear the lit cloth so the haircut is part of the costume's
  // signature, and the horn keeps a single hot pip at its tip.
  if (variant === 0) {
    // Swept mohawk: a main blade rising from the scalp, a trailing shard
    // down the back of the skull — both rooted inside the head.
    const fin = M(boxGeo(), lit);
    fin.scale.set(0.011, 0.105, 0.13);
    fin.position.set(0, 0.06, 0.012);
    fin.rotation.x = 0.4;
    head.add(fin);
    const tail = M(boxGeo(), lit);
    tail.scale.set(0.009, 0.06, 0.085);
    tail.position.set(0, 0.02, 0.082);
    tail.rotation.x = 1.0;
    head.add(tail);
  } else if (variant === 1) {
    // Side-swept twin blades — an undercut read, raked hard to one side.
    for (const [ox, oy, len, rake] of [
      [0.018, 0.055, 0.115, 0.55],
      [0.04, 0.035, 0.085, 0.75],
    ] as const) {
      const blade = M(boxGeo(), lit);
      blade.scale.set(0.01, len, 0.1);
      blade.position.set(ox, oy, 0.01);
      blade.rotation.z = -rake * 0.5;
      blade.rotation.x = rake;
      head.add(blade);
    }
  } else if (variant === 2) {
    // Swept horn crest: a flattened cone rooted in the crown — thin across,
    // deep front-to-back, so it reads as sculpted hair, not an antenna —
    // standing UP and raked back, with a neon pip riding its exact tip.
    // This one variant keeps its hair DARK: the single hot point at the top
    // is the whole silhouette, and lighting the cone loses it.
    const RAKE = 0.8;
    const LEN = 0.128;
    const spire = M(segGeo(0.004, 0.026), shell);
    spire.scale.set(0.5, LEN, 1.7);
    spire.position.set(0, 0.046, 0.02);
    spire.rotation.x = RAKE;
    head.add(spire);
    const tip = M(sphereGeo(8), neonFlat);
    tip.scale.setScalar(0.0075);
    tip.position.set(0, 0.046 + LEN * Math.cos(RAKE), 0.02 + LEN * Math.sin(RAKE));
    head.add(tip);
  } else {
    // Twin swept spikes: a matched pair of tapered cones off the crown,
    // raked back and splayed out — a V from the front, where the mohawk is
    // one centre blade and the twin blades both rake to the SAME side. All
    // four crests are edges, never volume; a rounded mass on this head
    // reads as a swelling, not a haircut.
    for (const side of [-1, 1]) {
      const spike = M(segGeo(0.003, 0.016), lit);
      spike.scale.set(0.7, 0.092, 1.5);
      spike.position.set(side * 0.028, 0.05, 0.014);
      spike.rotation.z = -side * 0.34;
      spike.rotation.x = 0.72;
      head.add(spike);
    }
  }
  head.add(glow(0.3, 0.3));
  root.add(head);

  /* ── torso: neck → bodice → basque, one sculpted line ──
   * Two lathes meet at the cinched waist under a neon belt; the collar and
   * choker bound the neck; a clavicle V and shoulder caps hang the arms.
   * Both lathes are squashed to TORSO_X/Z and TURNED WITH THE YAW — an
   * elliptical torso, unlike a round one, has a front. */
  const neck = seg(0.023, 0.031, suit);
  const bodice = M(latheGeo('bodice', BODICE), suit);
  const basque = M(latheGeo('basque', BASQUE), lit); // the lit midriff
  root.add(neck, bodice, basque);
  // The sternum seam — the garment's own centre line, riding the bodice so
  // it stretches and turns with the chest. Without it a one-colour suit is
  // a blank; with it the figure is wearing something.
  // Local z is scaled by TORSO_Z with the rest of the bodice, so the seam
  // is authored to sit a whisker outside the lathe's own front radius.
  const sternum = M(boxGeo(), neonStd);
  sternum.scale.set(0.013, 0.34, 0.012);
  sternum.position.set(0, 0.6, -0.075);
  bodice.add(sternum);
  const collar = M(torusGeo(0.062, 0.009), neonStd);
  const choker = M(torusGeo(0.033, 0.005), neonStd);
  const belt = M(torusGeo(0.04, 0.007), neonStd);
  collar.scale.set(TORSO_X, TORSO_Z, 1);
  belt.scale.set(TORSO_X, TORSO_Z, 1);
  root.add(collar, choker, belt);
  const clavL = seg(0.015, 0.021, suit);
  const clavR = seg(0.015, 0.021, suit);
  root.add(clavL, clavR);
  const capL = M(sphereGeo(8), lit);
  const capR = M(sphereGeo(8), lit);
  capL.scale.set(0.046, 0.042, 0.046);
  capR.scale.set(0.046, 0.042, 0.046);
  root.add(capL, capR);

  /* ── arms: shoulder → elbow → hand, solved each pose — LIT sleeves ── */
  const upperL = seg(0.03, 0.024, lit);
  const upperR = seg(0.03, 0.024, lit);
  const foreL = seg(0.024, 0.018, lit);
  const foreR = seg(0.024, 0.018, lit);
  root.add(upperL, upperR, foreL, foreR);
  const elbowL = M(sphereGeo(8), lit);
  const elbowR = M(sphereGeo(8), lit);
  elbowL.scale.setScalar(0.024);
  elbowR.scale.setScalar(0.024);
  root.add(elbowL, elbowR);

  /* ── hands: faceted gauntlet mitt + neon cuff + glowstick blade ── */
  const mkHand = (): Group => {
    const hand = new Group();
    const mitt = M(hexGeo(), shell);
    mitt.scale.set(0.075, 0.05, 0.095);
    mitt.position.set(0, 0.004, -0.028);
    mitt.rotation.x = -0.12;
    hand.add(mitt);
    const fingers = M(boxGeo(), shell);
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

  /* ── legs: hip → KNEE → ankle, with a piped seam down the shin ──
   * Two bones, not one: the old single taper telescoped on every crouch,
   * which is the one thing a leg never does. Both segments are aligned
   * UPWARD (ankle → knee → hip) so their local frames stay the right way
   * up and the piping rides the front of the calf. */
  const mkLeg = (): { thigh: Mesh; shin: Mesh; knee: Mesh } => {
    const thigh = seg(0.045, 0.034, suit); // full at the hip, narrow at the knee
    const shin = seg(0.031, 0.018, suit); // calf at the knee, slim at the ankle
    const knee = M(sphereGeo(8), suit);
    knee.scale.set(0.032, 0.03, 0.032);
    const pipe = M(segGeo(0.0055, 0.0055, 5), neonStd);
    pipe.position.set(0, 0.06, -0.021);
    pipe.scale.y = 0.85; // proportional: children inherit the align() stretch
    shin.add(pipe);
    root.add(thigh, shin, knee);
    return { thigh, shin, knee };
  };
  const legL = mkLeg();
  const legR = mkLeg();

  /* ── boots: shaft + raked toe + chunky heel on a neon sole ── */
  const mkBoot = (): Group => {
    const boot = new Group(); // origin at the ankle, ANKLE above the floor
    // The shaft rises PAST the ankle so its collar swallows the shin's
    // bottom cap at any crouch angle — no daylight at the joint. Boots
    // themselves stay flat: the feet are planted, and a pitched sole either
    // floats or saws through the deck.
    const shaft = M(segGeo(0.028, 0.032), shell);
    shaft.scale.y = 0.089;
    shaft.position.y = -0.071;
    boot.add(shaft);
    const sole = M(boxGeo(), neonFlat);
    sole.scale.set(0.06, 0.015, 0.16);
    sole.position.set(0, -ANKLE + 0.0075, -0.025);
    boot.add(sole);
    const toe = M(boxGeo(), shell);
    toe.scale.set(0.054, 0.036, 0.075);
    toe.position.set(0, -0.059, -0.072);
    toe.rotation.x = 0.16;
    boot.add(toe);
    const heel = M(boxGeo(), shell);
    heel.scale.set(0.042, 0.05, 0.038);
    heel.position.set(0, -0.06, 0.042);
    boot.add(heel);
    root.add(boot);
    return boot;
  };
  const bootL = mkBoot();
  const bootR = mkBoot();

  /** Solve one arm: elbow pushed out-and-down, hand riding the solved tip. */
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
    _target.set(hx, hy, hz);
    // The natural bend of an arm holding something up: out to the side of
    // THE BODY it belongs to — the body's own right axis, not the world's
    // +x — and biased downward. Hinting along world x splayed the elbows
    // toward a fixed compass point, so any dancer not facing −z bent their
    // arms across their own chest; a figure turned all the way round (a
    // mirror reflection, half the club floor) got them backwards.
    _hint.copy(_right).multiplyScalar(side);
    _hint.y = -0.7;
    _hint.normalize();
    twoBone(shoulder, _target, UPPER_ARM, FOREARM, _hint, _solved, _tip);
    align(upper, shoulder, _solved);
    align(fore, _solved, _tip);
    elbow.position.copy(_solved);
    hand.position.copy(_tip);
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
    // The hips hang UNDER THE HEAD. They used to be scaled toward the
    // origin (`p.hx * 0.94`), which reads as a subtle lean only while the
    // origin is the body's own rest position — true on a platform, false
    // everywhere else. On the CLUB floor, where poses are world-space, a
    // dancer standing at x 6.6 got their hips dragged 0.4 m across the
    // room and their legs splayed out from under them; the mirror made it
    // impossible to miss, because you were finally looking at yourself.
    const hipX = p.hx;
    const hipZ = p.hz;

    head.position.set(p.hx, hy, p.hz);
    head.rotation.set(melt * 0.9, p.yaw, melt * 0.35);

    const cos = Math.cos(p.yaw);
    const sin = Math.sin(p.yaw);
    // The body's own axes at this yaw (yaw 0 faces −Z, toward the stage).
    _right.set(cos, 0, -sin);
    _fwd.set(-sin, 0, -cos);
    _yawQ.setFromAxisAngle(UP, p.yaw);

    // Shoulder line under the head, turned with the yaw.
    const shY = hy - SHOULDER_DROP;
    shoulderL.set(p.hx - SHOULDER_W * cos, shY, p.hz + SHOULDER_W * sin);
    shoulderR.set(p.hx + SHOULDER_W * cos, shY, p.hz - SHOULDER_W * sin);

    // Torso line: neck → bodice (shoulder mid → waist) → basque (→ hips).
    // The neck buries its top in the JAW, not the old sphere's equator —
    // the chin taper means the head's underside is higher and narrower.
    _a.set(p.hx, hy - HEAD_R * 0.85, p.hz);
    _b.set((shoulderL.x + shoulderR.x) / 2, shY, (shoulderL.z + shoulderR.z) / 2);
    align(neck, _b, _a);
    choker.position.copy(_a).lerp(_b, 0.32);
    choker.quaternion.copy(neck.quaternion).multiply(X90);
    _mid.set(hipX * 0.35 + _b.x * 0.65, hipY + (shY - hipY) * 0.42, hipZ * 0.35 + _b.z * 0.65);
    align(bodice, _mid, _b, TORSO_X, TORSO_Z);
    bodice.quaternion.multiply(_yawQ); // an elliptical torso has a FRONT
    _a.set(hipX, hipY, hipZ);
    align(basque, _a, _mid, TORSO_X, TORSO_Z);
    basque.quaternion.multiply(_yawQ);
    collar.position.copy(_b);
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

    // Legs: ankles plant a shade inside the hips (real legs converge), and
    // trail the body a touch. Knees bend FORWARD with a slight outward
    // splay, so a duck folds into a squat and the two never cross.
    for (const side of SIDES) {
      hip.set(hipX + _right.x * side * HIP_W, hipY, hipZ + _right.z * side * HIP_W);
      const spread = side * (HIP_W - 0.006);
      foot.set(hipX + _right.x * spread - _fwd.x * 0.02, ANKLE, hipZ + _right.z * spread - _fwd.z * 0.02);
      const bone = legBone(hip.distanceTo(foot));
      _hint.copy(_fwd).addScaledVector(_right, side * 0.32);
      const leg = side < 0 ? legL : legR;
      twoBone(hip, foot, bone, bone, _hint, _solved, _tip, 0);
      // Built from the floor up: shin ankle → knee, thigh knee → hip.
      align(leg.shin, _tip, _solved);
      align(leg.thigh, _solved, hip);
      leg.knee.position.copy(_solved);
      const boot = side < 0 ? bootL : bootR;
      boot.position.copy(_tip);
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
