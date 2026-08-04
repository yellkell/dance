/**
 * McSystem — the headliner most nights: a GIANT of the dancers' own kind.
 *
 * Same sleek neon humanoid as the groupies (game/avatars.ts), scaled to
 * ~3.4 m on the centre stage — and his whole body ACTS OUT every attack
 * while it charges, so the tell lives at EYE LEVEL in silhouette instead of
 * on the floor:
 *
 *  slam   : both sticks pump OVERHEAD, then crash down on the landing.
 *  beam   : both sticks thrust straight forward, parallel — a lane.
 *  sweep  : one arm out FLAT at neck height on the entry side, cocked back —
 *           then swung across on the landing while HE DUCKS UNDER IT himself.
 *  seesaw : both sticks point at the DOOMED half, then shove the flood in.
 *  surge  : same grammar front/back — a beckon (far half dies) or a
 *           palms-out push (near half dies).
 *  gate   : sticks straight up, parallel and narrow — the gap itself —
 *           leaning to stand the "doorway" over the safe column's side.
 *  chase  : one stick tracks you, wagging on the beat — and FREEZES rigid
 *           the moment the disc locks. The freeze is the juke cue.
 *  nova   : arms spread wide and the whole figure winds a slow full spin,
 *           snapping arms down on the burst.
 *
 * While a move charges, his sticks and trim burn WARN amber (danger speaks
 * amber, always); between moves he does exactly the groupies' dance — one
 * stick up, one down, swapping on the beat — so the crowd's motion and the
 * boss's motion are one language. Zones are platform-local and identical
 * for every seat, so one giant's mime is honest for the whole ring.
 *
 * He faces YOU (me-relative rendering — every dancer sees the show head-on),
 * which means platform-local +x (my right) is HIS left: every directional
 * mime mirrors through `mir()`.
 *
 * On finale nights he only works the count-in: the goop drops in, EATS him
 * (a panicked squash into the rising gel), and runs the set instead.
 */

import { createSystem } from '@iwsdk/core';
import type { MeshBasicMaterial, MeshStandardMaterial } from 'three';
import { MC, RING, hueToColor, ringRadius } from '../config.js';
import { arena } from '../arena/arena.js';
import { buildDancer, type DancerPose, type DancerRig } from '../game/avatars.js';
import { match, type GestureCue } from '../game/state.js';

/** The eat window (song beats, negative = count-in) — mirrors GoopliathSystem. */
const EAT_START = -2.8;
const EAT_LAND = -1.2;

/** Head heights in rig-local (human) metres. */
const STAND = 1.56;
const DUCK = 0.98;

interface ActiveMime {
  cue: GestureCue;
  startBeat: number;
  dueBeat: number;
}

export class McSystem extends createSystem({}) {
  private rig: DancerRig | null = null;
  private pose: DancerPose = {
    hx: 0, hy: STAND, hz: 0, yaw: 0,
    lx: -0.3, ly: 1.0, lz: -0.1,
    rx: 0.3, ry: 1.0, rz: -0.1,
    slump: 0,
  };
  private generation = -1;
  private mime: ActiveMime | null = null;
  private warn = 0;
  private baseColor = 0;
  private eaten = false;

  private rebuild(): void {
    this.generation = match.generation;
    if (!this.rig) {
      this.rig = buildDancer(MC.hue);
      this.rig.root.scale.setScalar(MC.scale);
      // He faces the crowd — every client renders him looking at THEM.
      this.rig.root.rotation.y = Math.PI;
      this.baseColor = hueToColor(MC.hue, 0.6);
      this.scene.add(this.rig.root);
    }
    this.mime = null;
    this.warn = 0;
    this.eaten = false;
  }

  update(delta: number): void {
    if (this.generation !== match.generation) this.rebuild();
    const rig = this.rig;
    if (!rig) return;

    // The MC works raid nights (and their podiums). The goop keeps the
    // lobby, the map and every rehearsal — and takes the stage mid-count-in
    // on finale nights, over the MC's dead body.
    const raidish =
      match.after === 'raid' &&
      (match.screen === 'countdown' || match.screen === 'raid' || match.screen === 'podium');
    const finaleNight = raidish && match.bossKind === 'goop';
    const show = raidish && (match.bossKind === 'mc' || (finaleNight && match.eatIntro && !this.eaten));
    rig.root.visible = show;
    if (!show) return;

    const beat = Number.isFinite(match.beat) ? match.beat : -8;
    const stage = arena()?.stage;
    const stageY = stage?.position.y ?? 0;
    rig.root.position.set(0, RING.stageHeight + stageY, -ringRadius(match.seats));

    /* ── the finale count-in: hyping, then eaten ── */
    if (finaleNight) {
      if (beat >= EAT_LAND) {
        // Swallowed. The goop's touchdown owns the moment from here.
        this.eaten = true;
        rig.root.visible = false;
        return;
      }
      if (beat >= EAT_START) {
        // The drop is coming down on him: panic — hands up, shaking, a
        // squash as the mass arrives.
        const t = (beat - EAT_START) / (EAT_LAND - EAT_START);
        const tremble = Math.sin(beat * 40) * 0.05 * t;
        this.pose.hy = STAND - t * 0.5;
        this.pose.hx = tremble;
        this.pose.lx = -0.34 + tremble;
        this.pose.rx = 0.34 + tremble;
        this.pose.ly = this.pose.ry = STAND + 0.45 - t * 0.6;
        this.pose.lz = this.pose.rz = -0.1;
        rig.root.scale.set(MC.scale * (1 + t * 0.25), MC.scale * (1 - t * 0.55), MC.scale * (1 + t * 0.25));
        this.applyAccents(1); // full alarm
        rig.pose(this.pose);
        return;
      }
      // Before the drop: an oblivious idle groove (poor guy).
      rig.root.scale.setScalar(MC.scale);
    }

    /* ── gestures in, mime state forward ── */
    if (match.bossKind === 'mc') this.drainGestures(beat);
    if (this.mime && beat > this.mime.dueBeat + 0.45) this.mime = null;

    /* ── choreography: the mime if one is charging, else the groove ── */
    if (this.mime && match.screen === 'raid') this.performMime(this.mime, beat);
    else this.idleGroove(beat);

    // WARN burn while charging, seat-cyan otherwise.
    const warnTarget = this.mime && match.screen === 'raid' ? 1 : 0;
    this.warn += (warnTarget - this.warn) * Math.min(1, delta * 8);
    this.applyAccents(this.warn);

    rig.pose(this.pose);
  }

  private drainGestures(beat: number): void {
    for (const cue of match.gestures.splice(0)) {
      const due = cue.dueBeat ?? beat + cue.chargeBeats;
      // Step cues extend the running mime's life; full cues replace it.
      if (cue.step && this.mime && this.mime.cue.kind === cue.kind) {
        this.mime.dueBeat = due;
        this.mime.cue = { ...this.mime.cue, side: cue.side ?? this.mime.cue.side };
        continue;
      }
      this.mime = { cue, startBeat: beat, dueBeat: due };
    }
  }

  /** Platform-local x-sign → HIS side of the stage (he faces the crowd). */
  private mir(side: number): number {
    return -side;
  }

  /* ── the language ─────────────────────────────────────────────────────── */

  private idleGroove(beat: number): void {
    const p = this.pose;
    const bounce = Math.abs(Math.sin(beat * Math.PI)) * 0.06;
    p.hx = Math.sin(beat * 0.5) * 0.1;
    p.hz = 0;
    p.hy = STAND - bounce;
    p.yaw = Math.sin(beat * 0.25) * 0.2;
    p.slump = 0;
    // The groupies' exact move, giant-sized: one stick up, one down.
    const wave = Math.sin(beat * Math.PI);
    const upL = Math.max(0, wave);
    const upR = Math.max(0, -wave);
    p.lx = p.hx - 0.3 - upL * 0.08;
    p.ly = p.hy - 0.5 + upL * 0.75;
    p.lz = -0.08 - upL * 0.06;
    p.rx = p.hx + 0.3 + upR * 0.08;
    p.ry = p.hy - 0.5 + upR * 0.75;
    p.rz = -0.08 - upR * 0.06;
  }

  private performMime(mime: ActiveMime, beat: number): void {
    const p = this.pose;
    const span = Math.max(0.001, mime.dueBeat - mime.startBeat);
    const u = Math.min(1, Math.max(0, (beat - mime.startBeat) / span));
    /** Strike phase: the last ~0.9 beats snap from wind-up into the hit. */
    const strike = Math.min(1, Math.max(0, (beat - (mime.dueBeat - 0.9)) / 0.9));
    const pump = Math.abs(Math.sin(beat * Math.PI)); // charges throb on the beat
    p.slump = 0;
    p.hx = 0;
    p.hz = 0;
    p.yaw = 0;
    p.hy = STAND;

    switch (mime.cue.kind) {
      case 'slam': {
        // Overhead pump → crash down.
        const lift = 0.55 + u * 0.35 + pump * 0.12;
        const y = strike < 1 ? STAND + lift * (1 - strike * 1.6) : STAND - 0.75;
        p.hy = STAND - strike * 0.35;
        p.lx = -0.22; p.rx = 0.22;
        p.ly = p.ry = Math.max(0.45, y);
        p.lz = p.rz = -0.15 - strike * 0.2;
        break;
      }
      case 'beam': {
        // Twin rails, dead ahead (his forward IS toward the crowd).
        const reach = 0.35 + u * 0.3 + strike * 0.25;
        p.lx = -0.18; p.rx = 0.18;
        p.ly = p.ry = 1.15 - strike * 0.1;
        p.lz = p.rz = -reach - pump * 0.05;
        break;
      }
      case 'sweep': {
        // One arm FLAT at neck height on the entry side, cocked further
        // back as it charges — then swung across while he ducks under it.
        const s = this.mir(mime.cue.side ?? 1);
        const cock = 0.55 + u * 0.35;
        const swing = strike * 2 - 1; // −1 cocked … +1 followed through
        const armX = strike < 0.02 ? s * cock : s * cock * -swing;
        const lead = s < 0 ? 'l' : 'r';
        if (lead === 'l') {
          p.lx = armX; p.ly = 1.32; p.lz = -0.18;
          p.rx = 0.3; p.ry = 0.85 - strike * 0.2; p.rz = -0.05;
        } else {
          p.rx = armX; p.ry = 1.32; p.rz = -0.18;
          p.lx = -0.3; p.ly = 0.85 - strike * 0.2; p.lz = -0.05;
        }
        // He limbos under his own blade on the hit — do as he does.
        p.hy = STAND - strike * (STAND - DUCK);
        break;
      }
      case 'seesaw': {
        // Both sticks point the DOOMED half out, then shove the flood in.
        const s = this.mir(mime.cue.side ?? 1);
        const reach = 0.5 + u * 0.3 + strike * 0.3;
        p.lx = s * reach - 0.12;
        p.rx = s * reach + 0.12;
        p.ly = p.ry = 1.2 + pump * 0.08;
        p.lz = p.rz = -0.15;
        p.yaw = s * (0.35 + strike * 0.25);
        break;
      }
      case 'surge': {
        // Front/back grammar: far half doomed → a beckon (come close!);
        // near half doomed → palms-out push (get back!). zone side +1 = the
        // near half (platform +z, behind the dancer).
        const nearDoomed = (mime.cue.side ?? 1) > 0;
        const reach = 0.4 + u * 0.3 + strike * 0.3;
        p.lx = -0.2; p.rx = 0.2;
        if (nearDoomed) {
          // Push: hands high, palms out, shoving toward the crowd.
          p.ly = p.ry = 1.3 + pump * 0.06;
          p.lz = p.rz = -reach;
        } else {
          // Beckon: hands low, drawing in.
          p.ly = p.ry = 1.0 - strike * 0.2;
          p.lz = p.rz = -0.55 + reach * 0.4;
          p.hy = STAND - 0.1 - strike * 0.15;
        }
        break;
      }
      case 'gate': {
        // The doorway: sticks straight up, tight and parallel, the whole
        // figure leaning to hold the "gap" over the safe column's side.
        const s = this.mir(Math.sign(mime.cue.gapX ?? 0) || 0);
        const gap = 0.14 + pump * 0.03;
        p.hx = s * 0.25;
        p.lx = p.hx - gap; p.rx = p.hx + gap;
        p.ly = p.ry = STAND + 0.75 + u * 0.15 - strike * 0.5;
        p.lz = p.rz = -0.1;
        p.yaw = s * 0.2;
        break;
      }
      case 'chase': {
        // The hunt: one stick tracking, wagging on the beat — FROZEN rigid
        // from the lock beat (the disc under your feet freezes at the same
        // moment; his stillness IS the juke cue).
        const locked = beat >= mime.dueBeat - 1.25;
        const wag = locked ? 0 : Math.sin(beat * Math.PI * 2) * 0.12;
        p.rx = 0.15 + wag;
        p.ry = 1.25 - strike * 0.45;
        p.rz = -0.55 - u * 0.15 - strike * 0.2;
        p.lx = -0.32; p.ly = 0.85; p.lz = -0.05;
        p.hy = STAND - (locked ? 0.08 : 0);
        break;
      }
      case 'nova': {
        // The shockwave: arms spread flat, a slow wind-up spin, arms
        // snapping down on the burst.
        const spin = u * Math.PI * 2 * (0.75 + strike);
        const spread = 0.72 + pump * 0.05 - strike * 0.25;
        p.yaw = Math.sin(spin) * 0.6;
        p.lx = -spread; p.rx = spread;
        p.ly = p.ry = 1.3 - strike * 0.75;
        p.lz = p.rz = -0.1 - Math.cos(spin) * 0.12;
        break;
      }
    }
  }

  private applyAccents(warn: number): void {
    const rig = this.rig;
    if (!rig) return;
    const color = warn > 0.5 ? MC.warnColor : this.baseColor;
    for (const m of rig.accents) {
      const std = m as MeshStandardMaterial;
      if (std.emissive) {
        std.emissive.setHex(color);
        std.emissiveIntensity = 1.1 + warn * 1.5;
      } else {
        (m as MeshBasicMaterial).color.setHex(color);
      }
    }
  }
}
