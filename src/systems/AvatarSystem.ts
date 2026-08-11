/**
 * AvatarSystem — everybody else on the floor.
 *
 * Groupies (bots) dance: they bob on the kick, wave glowsticks, and when a
 * telegraph blooms on their deck they MOVE — to the safe ground if their
 * seeded roll says they'll live, square into the fire if it says they won't.
 * The roll here is the exact roll ChoreoSystem judges with, so what you see
 * a groupie do across the ring always matches what the leaderboard says
 * happened. Remote humans stream their real head/hands into the same rigs.
 *
 * The rigs themselves are the slender humanoids in game/avatars.ts, driven
 * purely by a head position and two hand targets — this system is the brain,
 * that module is the body. The LOCAL player gets no rig at all: you never
 * see your own body, only your controllers.
 *
 * Rigs live in platform-local space under each seat's platform root — rank
 * lifts and eliminations carry them automatically.
 */

import { createSystem } from '@iwsdk/core';
import type { MeshStandardMaterial } from 'three';
import { BOTS, OCTAGON_HALF_DEPTH, OCTAGON_HALF_WIDTH } from '../config.js';
import { platformRoot } from '../arena/arena.js';
import { choreoView } from './ChoreoSystem.js';
import type { Zone } from '../choreo/setlist.js';
import { buildDancer, type DancerPose, type DancerRig } from '../game/avatars.js';
import { roll } from '../game/rng.js';
import { seatBearing } from '../game/ring.js';
import { liveSpots, match, type Dancer } from '../game/state.js';
import { remotePoses } from '../net/poses.js';

interface Puppet {
  rig: DancerRig;
  seat: number;
  phase: number;
  /** The live pose, eased toward targets every frame. */
  pose: DancerPose;
  /** Dance/dodge destination on the deck. */
  tx: number;
  tz: number;
  duck: boolean;
  lastHits: number;
  flash: number;
  slump: number;
}

const CLAMP_X = OCTAGON_HALF_WIDTH - 0.18;
const CLAMP_Z = OCTAGON_HALF_DEPTH - 0.15;
const STAND_HEAD = 1.56;
const DUCK_HEAD = 1.02;

export class AvatarSystem extends createSystem({}) {
  private generation = -1;
  private puppets: Puppet[] = [];

  private rebuild(): void {
    this.generation = match.generation;
    for (const p of this.puppets) p.rig.dispose();
    this.puppets = [];
    for (const d of match.players) {
      if (d.kind === 'local') continue; // you never see your own body
      const parent = platformRoot(d.seat);
      if (!parent) continue;
      const rig = buildDancer(d.hue);
      parent.add(rig.root);
      this.puppets.push({
        rig,
        seat: d.seat,
        phase: (d.seat * 1.7) % (Math.PI * 2),
        pose: {
          hx: 0, hy: STAND_HEAD, hz: 0, yaw: 0,
          lx: -0.3, ly: 1.0, lz: -0.1,
          rx: 0.3, ry: 1.0, rz: -0.1,
          slump: 0,
        },
        tx: 0,
        tz: 0,
        duck: false,
        lastHits: d.hits,
        flash: 0,
        slump: 0,
      });
    }
  }

  update(delta: number): void {
    if (this.generation !== match.generation) this.rebuild();
    const beat = Number.isFinite(match.beat) ? match.beat : 0;

    for (const p of this.puppets) {
      const d = match.players.find((x) => x.seat === p.seat);
      if (!d) continue;

      // Hit flash: a landing clipped them since last frame.
      if (d.hits > p.lastHits) p.flash = 0.45;
      p.lastHits = d.hits;
      p.flash = Math.max(0, p.flash - delta);

      // Melt on elimination (and reform if a new match revives the rig).
      const slumpTarget = d.alive ? 0 : 1;
      p.slump += (slumpTarget - p.slump) * Math.min(1, delta * 2.5);
      p.pose.slump = p.slump;

      for (const m of p.rig.accents) {
        const std = m as MeshStandardMaterial;
        if (std.emissive) {
          std.emissiveIntensity = d.alive ? 1.1 + (p.flash > 0 ? 1.6 : 0) : 0.14;
          if (p.flash > 0) std.emissive.setHex(0xff4033);
          else std.emissive.setHex(p.rig.baseColor);
        } else {
          std.color.setHex(p.flash > 0 ? 0xff4033 : d.alive ? p.rig.baseColor : 0x3a3f4a);
        }
      }

      if (d.kind === 'remote') {
        this.driveRemote(p, delta);
      } else {
        this.driveBot(p, d, beat, delta);
      }

      // Where this dancer stands on their own deck — the chase discs hunt it.
      liveSpots.set(p.seat, { x: p.pose.hx, z: p.pose.hz });

      p.rig.pose(p.pose);
    }
  }

  private driveRemote(p: Puppet, delta: number): void {
    const pose = remotePoses.get(p.seat);
    if (!pose) return;
    const k = Math.min(1, delta * 14);
    const t = p.pose;
    t.hx += (pose.hx - t.hx) * k;
    t.hy += (pose.hy - t.hy) * k;
    t.hz += (pose.hz - t.hz) * k;
    t.yaw += (pose.hyaw - t.yaw) * k;
    t.lx += (pose.lx - t.lx) * k;
    t.ly += (pose.ly - t.ly) * k;
    t.lz += (pose.lz - t.lz) * k;
    t.rx += (pose.rx - t.rx) * k;
    t.ry += (pose.ry - t.ry) * k;
    t.rz += (pose.rz - t.rz) * k;
  }

  private driveBot(p: Puppet, d: Dancer, beat: number, delta: number): void {
    const t = p.pose;

    // What's coming for this seat? Mirror the judgement roll so the body
    // language always matches the outcome.
    p.duck = false;
    let want: { x: number; z: number } | null = null;
    if (d.alive && match.playing) {
      let soonest: (typeof choreoView.zones)[number] | null = null;
      for (const z of choreoView.zones) {
        if (z.seat !== p.seat || z.resolved) continue;
        if (!soonest || z.dueBeat < soonest.dueBeat) soonest = z;
      }
      if (soonest) {
        // The judge's exact formula and exact roll — body language never lies.
        const chance = Math.max(0.25, d.skill - soonest.act * BOTS.actPenalty);
        const willDodge = roll(match.seed, 0xb0b, soonest.seat, soonest.moveIdx, soonest.landingIdx) < chance;
        want = this.spotFor(soonest, p, willDodge);
      }
    }
    if (!want) {
      // Idle wander: a lazy seeded orbit around the deck centre.
      want = {
        x: Math.sin(beat * 0.22 + p.phase) * 0.28,
        z: Math.cos(beat * 0.17 + p.phase * 1.3) * 0.22,
      };
    }
    p.tx = Math.max(-CLAMP_X, Math.min(CLAMP_X, want.x));
    p.tz = Math.max(-CLAMP_Z, Math.min(CLAMP_Z, want.z));

    // Glide toward the destination (the figure leans into its own steps).
    const speed = 2.3;
    const dx = p.tx - t.hx;
    const dz = p.tz - t.hz;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.01) {
      const step = Math.min(dist, speed * delta);
      t.hx += (dx / dist) * step;
      t.hz += (dz / dist) * step;
    }

    // Face the stage (−Z), glancing toward travel.
    const targetYaw = dist > 0.05 ? Math.atan2(-dx, -dz) * 0.35 : 0;
    t.yaw += (targetYaw - t.yaw) * Math.min(1, delta * 6);

    // The bob: down ON the kick, up off it — plus the duck when needed.
    const bounce = d.alive ? Math.abs(Math.sin(beat * Math.PI + p.phase)) * 0.05 : 0;
    const standY = p.duck ? DUCK_HEAD : STAND_HEAD;
    t.hy += (standY - bounce - t.hy) * Math.min(1, delta * 8);

    // Glowsticks: alternate arms per beat — one punches the air, one rests.
    const wave = Math.sin(beat * Math.PI + p.phase);
    const upL = Math.max(0, wave);
    const upR = Math.max(0, -wave);
    t.lx = t.hx - 0.28 - upL * 0.06;
    t.ly = t.hy - 0.5 + upL * 0.62;
    t.lz = t.hz - 0.08 - upL * 0.05;
    t.rx = t.hx + 0.28 + upR * 0.06;
    t.ry = t.hy - 0.5 + upR * 0.62;
    t.rz = t.hz - 0.08 - upR * 0.05;
  }

  /** Where a groupie stands for a zone, given whether it intends to live. */
  private spotFor(live: (typeof choreoView.zones)[number], p: Puppet, dodge: boolean): { x: number; z: number } {
    const zone: Zone = live.zone;
    switch (zone.kind) {
      case 'circle': {
        if (!dodge) return { x: zone.x, z: zone.z };
        // Step to the far side of the deck from the disc.
        const away = Math.hypot(zone.x, zone.z) > 0.01 ? -1 : 1;
        return { x: Math.sign(zone.x || 0.3) * away * 0.45, z: Math.sign(zone.z || 0.3) * away * 0.35 };
      }
      case 'lane': {
        if (!dodge) return { x: zone.x, z: p.tz };
        const clear = zone.x > 0 ? zone.x - zone.halfW - 0.38 : zone.x + zone.halfW + 0.38;
        return { x: clear, z: p.tz };
      }
      case 'rail': {
        if (!dodge) return { x: p.tx, z: zone.z };
        // Step off the strip toward whichever side of it has more deck.
        const clear = zone.z > 0 ? zone.z - zone.halfD - 0.32 : zone.z + zone.halfD + 0.32;
        return { x: p.tx, z: clear };
      }
      case 'sweep': {
        p.duck = dodge;
        return { x: p.tx, z: p.tz };
      }
      case 'half': {
        const target = dodge ? -zone.side * 0.42 : zone.side * 0.42;
        return zone.axis === 1 ? { x: p.tx, z: target } : { x: target, z: p.tz };
      }
      case 'gate': {
        // Live: into the safe column. Doomed: square in a danger field.
        if (dodge) return { x: zone.x, z: p.tz };
        return { x: zone.x > 0 ? zone.x - zone.halfW - 0.4 : zone.x + zone.halfW + 0.4, z: p.tz };
      }
      case 'chase': {
        const c = live.chase;
        if (!c) return { x: p.tx, z: p.tz };
        if (!c.locked) {
          // Being hunted: keep drifting (the disc follows anyway).
          return { x: Math.sin(p.phase * 3) * 0.35, z: Math.cos(p.phase * 2) * 0.28 };
        }
        // Locked: the juke — away from the frozen disc, or freeze in it.
        if (!dodge) return { x: c.x, z: c.z };
        const away = Math.atan2(-c.x, -c.z);
        return { x: c.x + Math.sin(away) * 0.55, z: c.z + Math.cos(away) * 0.45 };
      }
      case 'nova': {
        const local = zone.bearing - seatBearing(p.seat, match.seats);
        const r = dodge ? 0.55 : -0.55;
        return { x: Math.sin(local) * r, z: Math.cos(local) * r };
      }
      case 'quad': {
        // The whole ring performing the same routine in unison is the best
        // picture this game makes — and the ones who forgot are visibly in
        // the wrong corner a beat before the blocks find them.
        const c = dodge ? zone.corner : (zone.corner + 2) % 4;
        const sx = c & 1 ? 1 : -1;
        const sz = c & 2 ? 1 : -1;
        return { x: sx * 0.46, z: sz * 0.4 };
      }
      case 'donut': {
        // Everyone piles into the middle — with a little seeded scatter so
        // twenty-four decks aren't twenty-four identical statues.
        if (dodge) return { x: Math.sin(p.phase * 2) * 0.1, z: Math.cos(p.phase * 3) * 0.09 };
        const out = zone.innerR + 0.28;
        return { x: Math.sin(p.phase) * out, z: Math.cos(p.phase) * out };
      }
    }
  }
}
