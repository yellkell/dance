/**
 * PoseMotion — the one place a DancerPose learns how to MOVE.
 *
 * Every humanoid in the game — the MC, the groupies, remote humans on the
 * ring, the club floor (and the mirror, which copies their finished poses) —
 * is the same rig driven by a DancerPose. Until now each driver smoothed its
 * own pose with its own per-frame lerp, which gave every figure the same
 * dead delivery: velocity greatest the instant a motion starts, zero at
 * arrival — a strike that is fastest LEAVING and limp on impact, and hands
 * that turn hard corners on every network packet. This class is the shared
 * motion layer that carries a rendered pose toward a target pose with real
 * dynamics:
 *
 *  - HANDS are damped springs with persistent velocity. Bots and the MC run
 *    underdamped (ζ < 1): a thrown stick whips PAST its mark and settles —
 *    follow-through, the difference between gesturing and teleporting
 *    between gestures. Remote humans run critically damped (ζ = 1): their
 *    hands carry real human motion already, so the spring's whole job is
 *    velocity-continuous tracking of a 10 Hz wire — it rounds the corners
 *    the old snap-to-latest-sample lerp scalloped into every swing, and it
 *    never invents bounce that didn't happen.
 *  - HEAD + TORSO channels chase exponentially (necks are damped by their
 *    owners; an overshooting head reads drunk, not springy) — with yaw
 *    taken the SHORT way round, so a figure turning across ±π never whips
 *    the long way through a full spin.
 *  - NON-FINITE INPUT NEVER STICKS. A NaN or ±Infinity target channel is
 *    ignored (the limb holds its course) and a non-finite CURRENT channel
 *    heals to the target on the next step. An exponential ease can never
 *    recover from one poisoned frame — c += (NaN − c)·k is NaN forever —
 *    and exactly that erased the MC from every night he headlined (see
 *    McSystem). Here the immunity is structural, for every figure at once.
 */

import type { DancerPose } from './avatars.js';

export interface MotionTuning {
  /** Exponential chase rate (per second) for head/torso channels. */
  headRate: number;
  /** Hand spring frequency (Hz) — how briskly a hand closes on its mark. */
  handHz: number;
  /** Damping ratio: 1 critically damped (remote humans — pure tracking),
   *  < 1 underdamped (bots and the MC — visible follow-through). */
  zeta: number;
}

/** Spring integration substep cap — semi-implicit Euler is stable well past
 *  this at the frequencies used here; the cap keeps a hitched frame (or a
 *  headless capture's long one) from ever kicking a spring. */
const MAX_SUBSTEP = 1 / 90;
/** A frame longer than this integrates as this — beyond it the figure
 *  would have finished the motion anyway. */
const MAX_STEP = 0.1;

const HAND_KEYS = ['lx', 'ly', 'lz', 'rx', 'ry', 'rz'] as const;
const EXPO_KEYS = ['hx', 'hy', 'hz', 'pitch', 'roll', 'slump'] as const;

/** A finite target, or the safest stand-in for a poisoned one. */
function sane(target: number, current: number): number {
  if (Number.isFinite(target)) return target;
  return Number.isFinite(current) ? current : 0;
}

export class PoseMotion {
  /** Hand velocities, one per HAND_KEYS channel. */
  private readonly vel = new Float64Array(6);

  /** Land exactly on the target and be at rest there (first sightings —
   *  a figure should appear where they stand, not glide in from spawn). */
  snap(pose: DancerPose, tgt: DancerPose): void {
    for (const k of EXPO_KEYS) pose[k] = sane(tgt[k], pose[k]);
    pose.yaw = sane(tgt.yaw, pose.yaw);
    for (let i = 0; i < HAND_KEYS.length; i++) {
      pose[HAND_KEYS[i]] = sane(tgt[HAND_KEYS[i]], pose[HAND_KEYS[i]]);
      this.vel[i] = 0;
    }
  }

  /** Advance `pose` toward `tgt` by `dt` seconds. */
  step(pose: DancerPose, tgt: DancerPose, dt: number, tuning: MotionTuning): void {
    if (!(dt > 0)) return;
    const h = Math.min(dt, MAX_STEP);

    // Head + torso: exponential chase — smooth, never overshoots.
    const k = 1 - Math.exp(-tuning.headRate * h);
    for (const key of EXPO_KEYS) {
      const want = sane(tgt[key], pose[key]);
      pose[key] = Number.isFinite(pose[key]) ? pose[key] + (want - pose[key]) * k : want;
    }
    // Yaw chases the same way but the SHORT way round.
    {
      const want = sane(tgt.yaw, pose.yaw);
      if (!Number.isFinite(pose.yaw)) pose.yaw = want;
      let d = (want - pose.yaw) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      pose.yaw += d * k;
    }

    // Hands: damped springs, substepped for stability.
    const w = Math.PI * 2 * tuning.handHz;
    const damp = 2 * tuning.zeta * w;
    const subs = Math.min(12, Math.ceil(h / MAX_SUBSTEP));
    const hs = h / subs;
    for (let i = 0; i < HAND_KEYS.length; i++) {
      const key = HAND_KEYS[i];
      const want = sane(tgt[key], pose[key]);
      let x = pose[key];
      let v = this.vel[i];
      if (!Number.isFinite(x) || !Number.isFinite(v)) {
        x = want;
        v = 0;
      }
      for (let s = 0; s < subs; s++) {
        v += (w * w * (want - x) - damp * v) * hs;
        x += v * hs;
      }
      pose[key] = x;
      this.vel[i] = v;
    }
  }
}
