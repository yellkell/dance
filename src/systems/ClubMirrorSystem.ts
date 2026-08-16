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
import { Quaternion, Vector3 } from 'three';
import { mirrorRefs } from '../club/build.js';
import { CLUB } from '../club/config.js';
import { buildDancer, type DancerPose, type DancerRig } from '../game/avatars.js';
import { danceHue } from '../game/profile.js';
import { match } from '../game/state.js';
import { memberHue, net } from '../net/session.js';
import { clubFloorFigures } from './ClubSocialSystem.js';

const _v = new Vector3();
const _q = new Quaternion();
const _fwd = new Vector3();

/** How fast the smoke thins/thickens (per-second exponential chase). */
const WAKE_RATE = 5;
/** Pane opacity: asleep (black glass) → awake (light smoke over the room). */
const SMOKE_ASLEEP = 0.93;
const SMOKE_AWAKE = 0.26;

const freshPose = (): DancerPose => ({
  hx: 0, hy: 1.55, hz: 0, yaw: 0,
  lx: -0.25, ly: 1.0, lz: 0, rx: 0.25, ry: 1.0, rz: 0,
  slump: 0,
});

export class ClubMirrorSystem extends createSystem({}) {
  /** 0 asleep … 1 awake — drives the smoke, the light and the rig work. */
  private wake = 0;
  /** Mirrored rigs by member idx; −1 is me. Kept while the floor is open
   *  (hidden when asleep — posing stops, building doesn't churn). */
  private pool = new Map<number, { rig: DancerRig; hue: number }>();
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
        this.lit = false;
      }
      return;
    }
    this.lit = true;

    /* ── cast the room into the glass ── */
    const used = new Set<number>();

    // ME — the reflection this mirror exists for.
    if (this.readMyPose()) {
      const myIdx = net.myIdx;
      const me = net.members.find((m) => m.idx === myIdx);
      const hue = me ? memberHue(me) : danceHue(Math.max(0, myIdx), true);
      this.cast(-1, hue, this.mine, glassZ);
      used.add(-1);
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
    }

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
    _fwd.set(0, 0, -1).applyQuaternion(_q);
    p.hx = _v.x;
    p.hy = _v.y;
    p.hz = _v.z;
    p.yaw = Math.atan2(-_fwd.x, -_fwd.z);
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
      mirrorRefs.current!.figures.add(entry.rig.root);
      this.pool.set(idx, entry);
    }
    // Mirror across z = glassZ: positions reflect, yaw flips through the
    // plane, and the HANDS SWAP — the reflection's arm on your left is
    // fed by your right hand, or it reaches across its own chest.
    const o = this.out;
    o.hx = src.hx;
    o.hy = src.hy;
    o.hz = 2 * glassZ - src.hz;
    o.yaw = Math.PI - src.yaw;
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
}
