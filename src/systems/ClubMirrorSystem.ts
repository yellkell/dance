/**
 * ClubMirrorSystem — the pier glass on the club's north wall, and the only
 * place in the game you can see your own body.
 *
 * The trick is theatre, not render-to-texture: behind the glass is a dark
 * recess (built with the club), and this system stands REAL mirrored rigs
 * in it — your own figure solved from your live head + hands (exactly the
 * body everyone else is shown), plus whoever's near you, reflected across
 * the wall plane. Geometry mirrors are stereo-correct in VR for free,
 * which a Reflector render-to-texture is not, and they cost nothing when
 * nobody's looking.
 *
 * Performance is the design: the glass SLEEPS as near-black smoke until
 * your head is within CLUB.mirror.range of it. Asleep: zero rigs posed,
 * recess contents hidden, the recess light off — the whole feature is one
 * tinted quad. Awake: at most 1 + maxFigures slender rigs, one point
 * light, three murk planes. Reflections beyond reflectRange simply aren't
 * cast (the murk swallows the boundary), so a packed dance floor never
 * pours 20 extra rigs into the glass.
 *
 * Honest by construction: your reflection is driven by the SAME head/hand
 * frame sendClubPose() streams (full framerate, unsmoothed), in the hue
 * the room sees you in; room-mates' reflections reuse the exact pose
 * objects their floor puppets dance with — blocked dancers cast no
 * reflection because their figures aren't shown. The one lie is chirality
 * (a true mirror flips left/right; posing a normal rig with swapped hand
 * targets flips everything that matters — asymmetric haircuts stay on
 * their built side), which nobody has ever noticed in a nightclub.
 */

import { createSystem } from '@iwsdk/core';
import { Euler, Plane, Quaternion, Vector3, type Material, type Mesh } from 'three';
import { mirrorRefs } from '../club/build.js';
import { CLUB } from '../club/config.js';
import { buildCoupe, type CoupeRefs } from '../club/props.js';
import { buildDancer, type DancerPose, type DancerRig } from '../game/avatars.js';
import { danceHue } from '../game/profile.js';
import { match } from '../game/state.js';
import { memberHue, net } from '../net/session.js';
import { liveGlasses } from './ClubPropsSystem.js';
import { clubFloorFigures } from './ClubSocialSystem.js';

const _v = new Vector3();
const _q = new Quaternion();
const _fwd = new Vector3();
const _e = new Euler(0, 0, 0, 'YXZ');

/** How fast the smoke thins/thickens (per-second exponential chase). */
const WAKE_RATE = 5;
/** Pane opacity: asleep (black glass) → awake (light smoke over the room). */
const SMOKE_ASLEEP = 0.93;
const SMOKE_AWAKE = 0.26;

/**
 * The glass, as a clipping plane: keep everything at or BEHIND z = the
 * north wall, discard the rest. A reflection stands as deep as you are
 * far, so pressing up to the pane brings its toes (0.16 m ahead of the
 * face standing, 0.29 m in a crouch) out through the glass and into the
 * room — the one thing that cannot be allowed to happen to a mirror.
 * Clipping is the guarantee: the reflection still walks all the way in to
 * meet you, and simply stops existing in front of the frame.
 */
const GLASS_CLIP = [new Plane(new Vector3(0, 0, -1), CLUB.minZ)];

/** Turn through π about Y — the sagittal flip the swapped hands stand in
 *  for, as a quaternion. See castGlasses(). */
const Y_FLIP = new Quaternion(0, 1, 0, 0);

interface PoolEntry {
  rig: DancerRig;
  hue: number;
}

/** buildCoupe() hands back a Group with no disposer of its own; a mirrored
 *  one is built and dropped with the floor it stands on, so it needs one. */
function disposeCoupe(cup: CoupeRefs): void {
  cup.root.traverse((o) => {
    const mesh = o as Mesh;
    mesh.geometry?.dispose();
    const mat = mesh.material as Material | Material[] | undefined;
    if (!mat) return;
    for (const m of Array.isArray(mat) ? mat : [mat]) m.dispose();
  });
  cup.root.removeFromParent();
}

const freshPose = (): DancerPose => ({
  hx: 0, hy: 1.55, hz: 0, yaw: 0, pitch: 0, roll: 0,
  lx: -0.25, ly: 1.0, lz: 0, rx: 0.25, ry: 1.0, rz: 0,
  slump: 0,
});

export class ClubMirrorSystem extends createSystem({}) {
  init(): void {
    // Per-material clipping is off by default; the mirror is the only
    // thing in the game that wants it, and it costs nothing for materials
    // that carry no planes.
    this.renderer.localClippingEnabled = true;
  }

  /** 0 asleep … 1 awake — drives the smoke, the light and the rig work. */
  private wake = 0;
  /** Mirrored rigs by member idx; −1 is me. Kept while the floor is open
   *  (hidden when asleep — posing stops, building doesn't churn). */
  private pool = new Map<number, PoolEntry>();
  /** Mirrored drinks by GLASS id — at most one per glass in the room's
   *  pool, so a figure with one in each hand casts both. */
  private cups = new Map<number, CoupeRefs>();
  /** Were reflections standing last frame? (Stand them down exactly once
   *  on the way to sleep, rather than every frame we're asleep.) */
  private lit = false;
  private mine = freshPose();
  private out = freshPose();

  update(delta: number): void {
    const refs = mirrorRefs.current;
    if (!refs) return;
    const M = CLUB.mirror;
    const glassZ = CLUB.minZ;

    const onFloor =
      (match.screen === 'lobby' || match.screen === 'tour') &&
      (net.phase === 'hosting' || net.phase === 'joined');

    // Head → glass distance (to the pane's span, not its centre — a wide
    // mirror wakes for someone at its corner too), with hysteresis so the
    // boundary doesn't flicker.
    const dx = Math.max(0, Math.abs(match.headX - M.x) - M.w / 2);
    const dz = Math.max(0, match.headZ - glassZ);
    const near = Math.hypot(dx, dz) < M.range + (this.wake > 0.5 ? 0.4 : 0);
    const want = onFloor && near ? 1 : 0;
    this.wake += (want - this.wake) * Math.min(1, WAKE_RATE * delta);
    const awake = this.wake > 0.03;

    refs.pane.opacity = SMOKE_ASLEEP + (SMOKE_AWAKE - SMOKE_ASLEEP) * this.wake;
    refs.figures.visible = awake;
    refs.haze.visible = awake;
    refs.light.visible = awake;
    refs.light.intensity = 3.2 * this.wake;

    if (!onFloor) {
      // The floor is gone (set out, room left) — give the rigs back.
      if (this.pool.size) {
        for (const p of this.pool.values()) p.rig.dispose();
        this.pool.clear();
        for (const cup of this.cups.values()) disposeCoupe(cup);
        this.cups.clear();
      }
      this.lit = false;
      return;
    }
    if (!awake) {
      // Asleep: the figures group is hidden, so nothing draws either way —
      // but leave the rigs flagged visible and the graph lies about what
      // the mirror is holding. Stand them down once, then do no work at
      // all until someone walks back over. (The rigs stay BUILT: a pool
      // that rebuilds on every approach would hitch at the one moment
      // you're looking straight at it.)
      if (this.lit) {
        for (const p of this.pool.values()) p.rig.root.visible = false;
        for (const cup of this.cups.values()) cup.root.visible = false;
        this.lit = false;
      }
      return;
    }
    this.lit = true;

    /* ── cast the room into the glass ── */
    const used = new Set<number>();
    /* Whose reflections are standing — only THEIR drinks get cast, or a
     * blocked dancer's pint would float across the glass on its own. */
    const holders = new Set<number>();

    // ME — the reflection this mirror exists for.
    if (this.readMyPose()) {
      const myIdx = net.myIdx;
      const me = net.members.find((m) => m.idx === myIdx);
      const hue = me ? memberHue(me) : danceHue(Math.max(0, myIdx), true);
      this.cast(-1, hue, this.mine, glassZ);
      used.add(-1);
      holders.add(myIdx);
    }

    // Room-mates near the glass, nearest first up to the cap.
    const nearby: { idx: number; hue: number; pose: DancerPose; d: number }[] = [];
    for (const [idx, f] of clubFloorFigures) {
      if (!f.shown) continue;
      const d = Math.max(0, f.pose.hz - glassZ);
      if (d > M.reflectRange || Math.abs(f.pose.hx - M.x) > M.reflectRange) continue;
      nearby.push({ idx, hue: f.hue, pose: f.pose, d });
    }
    nearby.sort((a, b) => a.d - b.d);
    for (const n of nearby.slice(0, M.maxFigures)) {
      this.cast(n.idx, n.hue, n.pose, glassZ);
      used.add(n.idx);
      holders.add(n.idx);
    }

    // …and every glass those figures are carrying, plus any stood down
    // near the pane. (After the figures, because it needs to know whose
    // reflections actually made it into the glass.)
    this.castGlasses(holders, glassZ, M);

    // Everyone else's reflection stands down (kept built, hidden).
    for (const [idx, p] of this.pool) {
      if (!used.has(idx)) p.rig.root.visible = false;
      if (idx >= 0 && !clubFloorFigures.has(idx)) {
        p.rig.dispose(); // left the room — the pool lets go too
        this.pool.delete(idx);
      }
    }
  }

  /** My live head + hands → this.mine, the same frame sendClubPose streams.
   *  False (nothing to cast) until the head entity exists. */
  private readMyPose(): boolean {
    const headObj = this.playerHeadEntity?.object3D;
    if (!headObj) return false;
    const p = this.mine;
    headObj.getWorldPosition(_v);
    headObj.getWorldQuaternion(_q);
    _e.setFromQuaternion(_q, 'YXZ');
    p.hx = _v.x;
    p.hy = _v.y;
    p.hz = _v.z;
    p.yaw = _e.y;
    p.pitch = _e.x;
    p.roll = _e.z;
    for (const hand of ['left', 'right'] as const) {
      const obj = this.world.playerSpaceEntities?.raySpaces?.[hand]?.object3D;
      let x: number;
      let y: number;
      let z: number;
      if (obj) {
        obj.getWorldPosition(_fwd);
        x = _fwd.x;
        y = _fwd.y;
        z = _fwd.z;
      } else {
        // No controllers (headless walks): the same resting-hands guess
        // pumpClubPose() streams, so the glass agrees with the room.
        x = p.hx + (hand === 'left' ? -0.25 : 0.25);
        y = Math.max(0.6, p.hy - 0.6);
        z = p.hz - 0.1;
      }
      if (hand === 'left') {
        p.lx = x;
        p.ly = y;
        p.lz = z;
      } else {
        p.rx = x;
        p.ry = y;
        p.rz = z;
      }
    }
    return true;
  }

  /** Reflect `src` across the glass plane and pose idx's pooled rig with
   *  it (building the rig on first sight, rebuilding on a hue change). */
  private cast(idx: number, hue: number, src: DancerPose, glassZ: number): void {
    let entry = this.pool.get(idx);
    if (entry && Math.abs(entry.hue - hue) > 1e-4) {
      entry.rig.dispose();
      entry = undefined;
    }
    if (!entry) {
      entry = { rig: buildDancer(hue), hue };
      // Clip every surface of this reflection at the pane (set before the
      // rig has ever been drawn, so no shader recompiles mid-approach).
      entry.rig.root.traverse((o) => {
        const mat = (o as Mesh).material as Material | Material[] | undefined;
        if (!mat) return;
        for (const m of Array.isArray(mat) ? mat : [mat]) m.clippingPlanes = GLASS_CLIP;
      });
      mirrorRefs.current!.figures.add(entry.rig.root);
      this.pool.set(idx, entry);
    }
    // Mirror across z = glassZ: positions reflect, yaw flips through the
    // plane, and the HANDS SWAP — the reflection's arm on your left is
    // fed by your right hand, or it reaches across its own chest.
    //
    // The head's nod and tilt follow from the same swap. Reflecting a frame
    // across z and then flipping it back through its own sagittal plane
    // (which is what feeding a normal rig swapped hands amounts to) works
    // out to yaw → π − yaw, pitch → pitch, roll → −roll: nod down and the
    // reflection nods down with you; tilt toward your right shoulder and it
    // tilts toward the shoulder facing yours.
    const o = this.out;
    o.hx = src.hx;
    o.hy = src.hy;
    o.hz = 2 * glassZ - src.hz;
    o.yaw = Math.PI - src.yaw;
    o.pitch = src.pitch;
    o.roll = -src.roll;
    o.lx = src.rx;
    o.ly = src.ry;
    o.lz = 2 * glassZ - src.rz;
    o.rx = src.lx;
    o.ry = src.ly;
    o.rz = 2 * glassZ - src.lz;
    o.slump = src.slump;
    entry.rig.root.visible = true;
    entry.rig.pose(o);
  }

  /**
   * EVERY glass the glass should be holding.
   *
   * Pooled by GLASS, not by figure: keyed by holder it was one drink each,
   * so a second in your other hand, or one set down on the ledge while
   * three of you posed, simply wasn't there. A drink in somebody's hand is
   * cast only if THEY are cast — a blocked dancer's pint must not float
   * across the mirror on its own — and a glass nobody is carrying is cast
   * on the same proximity rule the bodies use.
   *
   * It needs no hand-swapping of its own: the reflection's left hand is
   * already standing where your right hand's mirror image is, so a glass
   * reflected purely by POSITION lands in it. Orientation is the body's
   * transform written for a quaternion — negate x and y (the mirror across
   * z) and turn the result through π about Y (the sagittal flip the swapped
   * hands stand in for). For a coupe, a surface of revolution, that flip
   * changes nothing you can see; what it buys is a glass that leans the way
   * the arm holding it leans.
   */
  private castGlasses(holders: Set<number>, glassZ: number, M: typeof CLUB.mirror): void {
    const shown = new Set<number>();
    for (const g of liveGlasses) {
      const cast =
        g.heldBy !== null
          ? holders.has(g.heldBy)
          : g.pos.z - glassZ <= M.reflectRange && Math.abs(g.pos.x - M.x) <= M.reflectRange;
      if (!cast) continue;
      let cup = this.cups.get(g.id);
      if (!cup) {
        cup = buildCoupe();
        // Clipped at the pane like the bodies: press a drink to the glass
        // and it must stop existing at the frame, not poke into the room.
        cup.root.traverse((o) => {
          const mat = (o as Mesh).material as Material | Material[] | undefined;
          if (!mat) return;
          for (const m of Array.isArray(mat) ? mat : [mat]) m.clippingPlanes = GLASS_CLIP;
        });
        mirrorRefs.current!.figures.add(cup.root);
        this.cups.set(g.id, cup);
      }
      cup.root.visible = true;
      cup.root.position.set(g.pos.x, g.pos.y, 2 * glassZ - g.pos.z);
      cup.root.quaternion.set(-g.quat.x, -g.quat.y, g.quat.z, g.quat.w).multiply(Y_FLIP);
      cup.fill.visible = g.full; // drink it and the reflection's empties too
      shown.add(g.id);
    }
    for (const [id, cup] of this.cups) if (!shown.has(id)) cup.root.visible = false;
  }
}
