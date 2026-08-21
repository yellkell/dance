/**
 * GoopBodySystem — THE EXPERIMENT: you wear the goop.
 *
 * In a SOLO or TOUR set the local player gets a body — the same raymarched
 * gel creature as the GOOPLIATH, man-sized at 1:1, driven live from the
 * only three points VR knows (head + two hands) through the EmbodyRig
 * vendored home from SLUGFEST. Look down mid-dodge and you're gel: the
 * trunk leans after your duck, the puddle-skirt legs drag across the deck
 * behind your sidestep, your glowstick hands ride pinned gel fists, and a
 * landing that clips you visibly dents and ripples the body.
 *
 * Strictly first-person and strictly offline: club floors and online raids
 * keep the mannequin figures (and the mirror keeps yours) — this body is
 * your own view of yourself and nothing else reads it, so it cannot desync
 * a room. Scoring never touches it either: the judge reads match.headX/Z,
 * the body is spectacle.
 *
 * Body language: it POURS UP from a glob during the count-in (the uFade
 * reveal keeps the morph out of your eyes), dances the set formed, and if
 * the chain takes you out it slumps back into a breathing glob at your
 * feet — the same body language as the fallen boss, and the ghost of it
 * stays faintly visible so looking down never reads as empty.
 *
 * Perf: the raymarched gel is the most expensive draw in the game, so the
 * body runs leaner than the boss (BODY.quality, a lower step floor its
 * tight bounds can afford, leaner again on finale nights when the GOOP
 * shares the frame) and is torn down whole in the menu rooms — same law
 * as the boss: he appears where he performs, and so do you.
 */

import { createSystem, Quaternion, Vector3 } from '@iwsdk/core';
import type { Object3D } from 'three';
import { BODY, hueToColor } from '../config.js';
import { danceHue } from '../game/profile.js';
import { match, me } from '../game/state.js';
import { GelCreature } from '../goopliath/GelCreature.js';
import { EmbodyRig, type TrackedPose } from '../goopliath/embody.js';
import { GooFx } from '../goopliath/splats.js';

/** Hand speed is measured across a short window — long enough to flatten
 *  tracking jitter, short enough that a snapped reach reads at full speed
 *  (the SLUGFEST recipe). */
const WINDOW_S = 0.07;
const SAMPLES = 16;

const _p = new Vector3();
const _dir = new Vector3();

class HandTracker {
  private buf = new Float32Array(SAMPLES * 4); // t,x,y,z rings
  private head = 0;
  private count = 0;

  feed(t: number, p: Vector3): void {
    const o = this.head * 4;
    this.buf[o] = t;
    this.buf[o + 1] = p.x;
    this.buf[o + 2] = p.y;
    this.buf[o + 3] = p.z;
    this.head = (this.head + 1) % SAMPLES;
    this.count = Math.min(this.count + 1, SAMPLES);
  }

  /** Speed (m/s) across the window. */
  measure(t: number): number {
    if (this.count < 2) return 0;
    const newest = (this.head - 1 + SAMPLES) % SAMPLES;
    const no = newest * 4;
    let pick = newest;
    for (let i = 1; i < this.count; i++) {
      const idx = (this.head - 1 - i + SAMPLES) % SAMPLES;
      if (t - this.buf[idx * 4] > WINDOW_S) break;
      pick = idx;
    }
    const po = pick * 4;
    const dt = this.buf[no] - this.buf[po];
    if (dt < 1e-4) return 0;
    const dist = Math.hypot(
      this.buf[no + 1] - this.buf[po + 1],
      this.buf[no + 2] - this.buf[po + 2],
      this.buf[no + 3] - this.buf[po + 3],
    );
    return dist / dt;
  }

  reset(): void {
    this.count = 0;
  }
}

/** Your body's colours, derived from your seat hue — the same wheel your
 *  sticks, trim and deck already wear, at three depths of gel. */
function bodyTint(hue: number): { shallow: number; deep: number; nucleus: number; splat: number } {
  return {
    shallow: hueToColor(hue, 0.78),
    deep: hueToColor(hue, 0.2),
    nucleus: hueToColor(hue, 0.55),
    splat: hueToColor(hue, 0.6),
  };
}

/** Probes reach the live body through this (the fightersView pattern). */
export const bodyView: { creature: GelCreature | null } = { creature: null };

export class GoopBodySystem extends createSystem({}) {
  private body?: GelCreature;
  private fx?: GooFx;
  private rig?: EmbodyRig;
  private generation = -1;
  private handL = new HandTracker();
  private handR = new HandTracker();
  private clock = 0;
  private lastHits = 0;

  private pose: TrackedPose = {
    head: new Vector3(),
    headQuat: new Quaternion(),
    handL: new Vector3(),
    handR: new Vector3(),
    speedL: 0,
    speedR: 0,
  };

  private teardown(): void {
    if (!this.body && !this.fx) return;
    this.body?.dispose();
    this.fx?.dispose();
    this.body = undefined;
    this.fx = undefined;
    this.rig = undefined;
    bodyView.creature = null;
  }

  private rebuild(): void {
    this.generation = match.generation;
    this.teardown();

    const tint = bodyTint(danceHue(match.mySeat, true));
    this.fx = new GooFx(tint.splat);
    this.scene.add(this.fx.group);
    this.body = new GelCreature(this.fx, { tint, firstPerson: true });
    // Leaner than the boss — and leaner again when he shares the frame.
    this.body.qualityOverride = match.bossKind === 'goop' ? BODY.finaleQuality : BODY.quality;
    this.body.stepFloor = BODY.stepFloor;
    this.body.sim.impactScale = BODY.hitImpact;
    this.scene.add(this.body.group);
    this.rig = new EmbodyRig(this.body); // sets puppet mode

    // Arrive where I stand, facing where I look; the glob pours itself up
    // into a body through the count-in (uFade keeps it out of my eyes).
    this.handL.reset();
    this.handR.reset();
    const p = this.pose;
    this.readTracked(p);
    this.body.group.position.set(p.head.x, 0, p.head.z);
    this.body.moveTo(this.body.group.position);
    _dir.set(0, 0, -1).applyQuaternion(p.headQuat);
    const fxz = Math.hypot(_dir.x, _dir.z);
    this.body.snapYaw(fxz > 0.05 ? Math.atan2(_dir.x / fxz, _dir.z / fxz) : 0);

    this.lastHits = me()?.hits ?? 0;
    bodyView.creature = this.body;
  }

  /** Head + hands off the live rig. My platform IS the world origin, so
   *  these world poses are already platform-local — no transforms. */
  private readTracked(p: TrackedPose): void {
    const headObj = this.playerHeadEntity?.object3D;
    if (headObj) {
      headObj.getWorldPosition(p.head);
      headObj.getWorldQuaternion(p.headQuat);
    }
    const spaces = (
      this.world as {
        playerSpaceEntities?: {
          gripSpaces?: Record<'left' | 'right', { object3D?: Object3D } | undefined>;
          raySpaces?: Record<'left' | 'right', { object3D?: Object3D } | undefined>;
        };
      }
    ).playerSpaceEntities;
    for (const hand of ['left', 'right'] as const) {
      // Grip is the fist; ray is the fallback the emulator always has.
      const obj = spaces?.gripSpaces?.[hand]?.object3D ?? spaces?.raySpaces?.[hand]?.object3D;
      if (!obj) continue;
      obj.getWorldPosition(_p);
      (hand === 'left' ? p.handL : p.handR).copy(_p);
      const tracker = hand === 'left' ? this.handL : this.handR;
      tracker.feed(this.clock, _p);
      const speed = tracker.measure(this.clock);
      if (hand === 'left') p.speedL = speed;
      else p.speedR = speed;
    }
  }

  update(delta: number): void {
    this.clock += delta;

    // The gate: YOUR body dances solo and tour sets only. Online raids and
    // the club keep the mannequins; menu rooms are goop-free (the boss's
    // own law — the marcher idling on a menu was pure lag).
    const raidish =
      match.after === 'raid' &&
      (match.screen === 'countdown' || match.screen === 'raid' || match.screen === 'podium');
    if (!BODY.enabled || match.online || !raidish) {
      this.teardown();
      return;
    }
    if (!this.body || this.generation !== match.generation) this.rebuild();
    const body = this.body!;

    this.fx?.update(delta);

    // Body language: formed while I'm in the set; slumped into a breathing
    // glob once the chain takes me out (the fallen dim, they don't vanish).
    const d = me();
    body.setFormTarget(d?.alive === false ? 0 : 1);

    // A landing clipped me since last frame: the body takes the hit —
    // dent, ripple, a spray of my own colour. Spectacle only; the judge
    // already did its work on match state.
    if (d && d.hits !== this.lastHits) {
      this.lastHits = d.hits;
      if (body.formValue > 0.5) {
        const ang = Math.random() * Math.PI * 2;
        _dir.set(Math.cos(ang) * 0.8, -0.6, Math.sin(ang) * 0.8).normalize();
        _p.copy(this.pose.head);
        _p.y -= 0.45; // into the chest
        body.receivePunchWorld(_p, _dir, 2.3);
      }
    }

    this.readTracked(this.pose);
    this.rig?.drive(this.pose);
    body.update(delta * BODY.timeScale, this.pose.head);
  }
}
