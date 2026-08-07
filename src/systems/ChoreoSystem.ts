/**
 * ChoreoSystem — the raid itself. Runs the deterministic set-list against
 * the live beat clock:
 *
 *   telegraphBeat → hazard shapes bloom on EVERY live platform at once,
 *   filling as the landing approaches (the fill IS the countdown), while the
 *   GOOPLIATH winds up the matching gesture on the centre stage;
 *
 *   landBeat → the zones detonate on the downbeat: strike FX on every deck,
 *   one shared sound, and a judgement per dancer — the local player by their
 *   real tracked body, the groupies by seeded rolls every client computes
 *   identically, the remote humans by their own report (never guessed here).
 *
 * Also owns the score/combo/lives bookkeeping, tutorial clear counting, and
 * the end of the set (song out, or one dancer left standing).
 */

import { createSystem } from '@iwsdk/core';
import { BOTS, CHOREO, MOVES, SCORE, type MoveKind } from '../config.js';
import * as sfx from '../audio/sfx.js';
import { trackById } from '../audio/tracks.js';
import { platformRoot } from '../arena/arena.js';
import { StrikeFx } from '../choreo/strikes.js';
import {
  beamTelegraph,
  circleTelegraph,
  gateTelegraph,
  halfTelegraph,
  novaTelegraph,
  sweepTelegraph,
  type Telegraph,
} from '../choreo/telegraphs.js';
import { generateLesson, generateSetlist, type SetMove, type Zone } from '../choreo/setlist.js';
import { finishRaid, finishTutorial } from '../game/flow.js';
import { roll } from '../game/rng.js';
import { seatBearing } from '../game/ring.js';
import {
  aliveCount,
  barBeats,
  dancerAtSeat,
  liveSpots,
  match,
  pushFlair,
  setEndBeat,
  type Dancer,
  type GestureCue,
} from '../game/state.js';
import {
  OCTAGON_HALF_DEPTH,
  OCTAGON_HALF_WIDTH,
} from '../config.js';

export interface LiveZone {
  moveIdx: number;
  landingIdx: number;
  seat: number;
  zone: Zone;
  kind: MoveKind;
  act: number;
  tgStartBeat: number;
  dueBeat: number;
  tg: Telegraph | null;
  probed: boolean;
  wasInside: boolean;
  resolved: boolean;
  /** Chase runtime: where the hunting disc currently sits (per-seat — the
   *  shared Zone object stays immutable), frozen once `locked`. */
  chase?: { x: number; z: number; locked: boolean };
}

/** Read-only window for other systems (bot movement mirrors the judging). */
export const choreoView: { zones: readonly LiveZone[] } = { zones: [] };

const HEAD_R = 0.1; // projected head radius for floor-zone tests

function angDist(a: number, b: number): number {
  return Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
}

/** Which local-x side a sweep enters from — alternates deterministically so
 *  every client cuts the same way and back-to-back sweeps cross over. The
 *  TELEGRAPH mirrors to this too (its fill runs from the entry side), so the
 *  charge already tells a veteran which way the blade will travel. */
function sweepSide(moveIdx: number, landingIdx: number): 1 | -1 {
  return (moveIdx + landingIdx) % 2 === 0 ? 1 : -1;
}

/** The directional payload a gesture cue carries so the MC's body can ACT
 *  the move out (zones are platform-local and identical for every seat, so
 *  one giant's mime is honest for the whole ring). */
function cueDirection(zone: Zone, moveIdx: number, landingIdx: number): Partial<GestureCue> {
  switch (zone.kind) {
    case 'sweep':
      return { side: sweepSide(moveIdx, landingIdx) };
    case 'half':
      return { side: zone.side, axis: zone.axis };
    case 'gate':
      return { gapX: zone.x };
    default:
      return {};
  }
}

export class ChoreoSystem extends createSystem({}) {
  private generation = -1;
  private setlist: SetMove[] = [];
  private nextMove = 0;
  private zones: LiveZone[] = [];
  private strikes = new StrikeFx();
  private lastBar = -1;
  private landedSfx = new Set<string>();
  private cuedSteps = new Set<string>();
  private tutorialMoveHit = new Map<number, boolean>();
  private ended = false;

  init(): void {
    this.strikesRoot();
  }

  private strikesRoot(): void {
    // StrikeFx spawns under platform roots; nothing to pre-build.
  }

  private rebuild(): void {
    this.generation = match.generation;
    for (const z of this.zones) z.tg?.dispose();
    this.zones = [];
    this.nextMove = 0;
    this.lastBar = -1;
    this.landedSfx.clear();
    this.cuedSteps.clear();
    this.tutorialMoveHit.clear();
    this.ended = false;
    this.setlist =
      match.after === 'tutorial' && match.goopling
        ? generateLesson(match.goopling, match.seed)
        : generateSetlist(match.seed, match.phrases, trackById(match.trackId)?.banned ?? []);
  }

  update(delta: number): void {
    this.strikes.update(delta);

    const inSet = match.screen === 'countdown' || match.screen === 'raid' || match.screen === 'tutorial';
    if (!inSet) {
      if (this.zones.length) {
        for (const z of this.zones) z.tg?.dispose();
        this.zones = [];
      }
      return;
    }
    if (this.generation !== match.generation) this.rebuild();
    if (!match.playing) return;

    const beat = match.beat;
    const time = performance.now() / 1000;

    // Survival trickle: every bar, every dancer still on the floor.
    if (match.screen === 'raid') {
      const bar = Math.floor(beat / barBeats());
      if (bar !== this.lastBar && beat >= 0) {
        this.lastBar = bar;
        for (const p of match.players) if (p.alive) p.score += SCORE.aliveBarBonus;
      }
    }

    // New telegraphs due?
    while (this.nextMove < this.setlist.length && this.setlist[this.nextMove].telegraphBeat <= beat) {
      this.begin(this.setlist[this.nextMove]);
      this.nextMove++;
    }

    // Follow-up gestures: a multi-landing move keeps the GOOPLIATH swinging
    // — every later landing gets its own quick strike cued a couple of beats
    // out, so the boss's body telegraphs the WHOLE cascade, not just its
    // opening. (Keyed per landing, not per seat — one giant, one swing.)
    for (const z of this.zones) {
      if (z.resolved || z.landingIdx === 0) continue;
      const lead = z.dueBeat - beat;
      if (lead > 2 || lead <= 0) continue;
      const key = `${z.moveIdx}:${z.landingIdx}`;
      if (this.cuedSteps.has(key)) continue;
      this.cuedSteps.add(key);
      match.gestures.push({ kind: z.kind, chargeBeats: lead, step: true, ...cueDirection(z.zone, z.moveIdx, z.landingIdx), dueBeat: z.dueBeat });
    }

    // Advance live zones.
    for (const z of this.zones) {
      if (z.resolved) continue;
      const span = Math.max(0.001, z.dueBeat - z.tgStartBeat);
      const fill = Math.min(1, Math.max(0, (beat - z.tgStartBeat) / span));
      if (z.tg) {
        z.tg.update(fill, time);
        // A chained pie stays OFF the floor until its own window opens —
        // the next disc appears exactly as the previous one detonates, so
        // there is only ever ONE pie to read. (No-op for ordinary zones:
        // their window opens with the move's telegraph.)
        z.tg.group.visible = beat >= z.tgStartBeat;
        // The seesaw shows only the imminent pane and the one after — five
        // at once reads as noise, two reads as "THIS side now, THAT next".
        if (z.zone.kind === 'half') z.tg.group.visible = z.dueBeat - beat < 4.2;
      }
      // THE CHASE: the disc hunts its dancer's feet, then FREEZES with
      // chaseLockBeats still on the clock — the freeze is the tell, the
      // juke after it is the dodge.
      if (z.zone.kind === 'chase' && z.chase) {
        if (!z.chase.locked) {
          if (beat >= z.dueBeat - CHOREO.chaseLockBeats) {
            z.chase.locked = true;
            z.chase.x = Math.max(-OCTAGON_HALF_WIDTH + 0.15, Math.min(OCTAGON_HALF_WIDTH - 0.15, z.chase.x));
            z.chase.z = Math.max(-OCTAGON_HALF_DEPTH + 0.12, Math.min(OCTAGON_HALF_DEPTH - 0.12, z.chase.z));
          } else {
            const spot =
              z.seat === match.mySeat ? { x: match.headX, z: match.headZ } : (liveSpots.get(z.seat) ?? { x: 0, z: 0 });
            const k = Math.min(1, delta * 7); // glued, with a hint of lag
            z.chase.x += (spot.x - z.chase.x) * k;
            z.chase.z += (spot.z - z.chase.z) * k;
          }
        }
        if (z.tg) z.tg.group.position.set(z.chase.x, 0.05, z.chase.z);
      }
      // The perfect probe: were you still in the fire one beat out?
      if (!z.probed && z.seat === match.mySeat && beat >= z.dueBeat - SCORE.perfectProbeBeats) {
        z.probed = true;
        z.wasInside = this.touchesLocal(z);
      }
      if (beat >= z.dueBeat) this.resolve(z);
    }
    this.zones = this.zones.filter((z) => !z.resolved);
    choreoView.zones = this.zones;

    // End of the set.
    if (match.screen === 'raid' && !this.ended) {
      const songOver = beat >= setEndBeat() + 8;
      const floorCleared = match.seats > 1 && aliveCount() <= 1 && beat > 0;
      if (songOver || floorCleared) {
        this.ended = true;
        finishRaid();
      }
    }
  }

  /** A move starts telegraphing: zones + shapes on every live platform, and
   *  the GOOPLIATH's wind-up gesture on the stage. */
  private begin(move: SetMove): void {
    const first = move.landings[0];
    match.gestures.push({
      kind: move.kind,
      chargeBeats: MOVES[move.kind].chargeBeats,
      ...(first ? cueDirection(first.zone, move.index, 0) : {}),
      dueBeat: first?.beat,
    });
    sfx.gooCharge(MOVES[move.kind].chargeBeats * match.beatLen * 0.9);

    for (const dancer of match.players) {
      if (!dancer.alive) continue;
      // Remote platforms still get the full show — judgement stays theirs.
      const parent = platformRoot(dancer.seat);
      if (!parent) continue;
      move.landings.forEach((landing, landingIdx) => {
        const tg = this.buildTelegraph(landing.zone, dancer.seat, move.index, landingIdx);
        if (tg) parent.add(tg.group);
        // A chase disc opens on its dancer's current spot (per-seat state —
        // the Zone object itself is shared across all seats).
        const chase =
          landing.zone.kind === 'chase'
            ? dancer.seat === match.mySeat
              ? { x: match.headX, z: match.headZ, locked: false }
              : { ...(liveSpots.get(dancer.seat) ?? { x: 0, z: 0 }), locked: false }
            : undefined;
        // A chained pie (nova landing 2+) opens its telegraph window only
        // as the previous pie detonates — each singular disc rides its own
        // short fuse instead of three discs stacking up from the start.
        const tgStartBeat =
          landing.zone.kind === 'nova' && landingIdx > 0
            ? landing.beat - CHOREO.novaChainBeats
            : move.telegraphBeat;
        this.zones.push({
          moveIdx: move.index,
          landingIdx,
          seat: dancer.seat,
          zone: landing.zone,
          kind: move.kind,
          act: move.act,
          tgStartBeat,
          dueBeat: landing.beat,
          tg,
          probed: false,
          wasInside: false,
          resolved: false,
          chase,
        });
      });
    }
  }

  private buildTelegraph(zone: Zone, seat: number, moveIdx: number, landingIdx: number): Telegraph | null {
    switch (zone.kind) {
      case 'circle': {
        const tg = circleTelegraph(zone.r);
        tg.group.position.set(zone.x, 0.05, zone.z);
        return tg;
      }
      case 'lane': {
        const tg = beamTelegraph(zone.halfW, OCTAGON_HALF_DEPTH * 2 + 0.8);
        // Strip runs down local −Z (toward the stage); origin at the near edge.
        tg.group.position.set(zone.x, 0.05, OCTAGON_HALF_DEPTH + 0.4);
        return tg;
      }
      case 'sweep': {
        const tg = sweepTelegraph(
          OCTAGON_HALF_WIDTH * 2 + 0.5,
          OCTAGON_HALF_DEPTH * 2 + 0.3,
          CHOREO.sweepY,
          CHOREO.sweepThickness,
          sweepSide(moveIdx, landingIdx),
        );
        return tg;
      }
      case 'half': {
        const halfW = (zone.axis ? OCTAGON_HALF_DEPTH : OCTAGON_HALF_WIDTH) + 0.35;
        const depth = (zone.axis ? OCTAGON_HALF_WIDTH : OCTAGON_HALF_DEPTH) * 2 + 0.3;
        const tg = halfTelegraph(zone.side, halfW, depth);
        tg.group.position.y = 0.05;
        // The z-split reuses the x-split pane a quarter-turn round; −90° so
        // the +x-authored pane lands on the +z half (see FIRE FIGHT's note).
        if (zone.axis) tg.group.rotation.y = -Math.PI / 2;
        return tg;
      }
      case 'gate': {
        const tg = gateTelegraph(OCTAGON_HALF_WIDTH, OCTAGON_HALF_DEPTH, zone.x, zone.halfW);
        tg.group.position.y = 0.05;
        return tg;
      }
      case 'chase': {
        // Opens wherever the dancer stands; tracked live in update().
        const tg = circleTelegraph(zone.r);
        tg.group.position.set(0, 0.05, 0);
        return tg;
      }
      case 'nova': {
        const local = zone.bearing - seatBearing(seat, match.seats);
        const tg = novaTelegraph(CHOREO.novaRadius, local, zone.halfAngle);
        tg.group.position.y = 0.05;
        return tg;
      }
    }
  }

  /** Does the local player's tracked body touch a zone RIGHT NOW? */
  private touchesLocal(live: LiveZone): boolean {
    const zone = live.zone;
    const x = match.headX;
    const z = match.headZ;
    switch (zone.kind) {
      case 'circle':
        return Math.hypot(x - zone.x, z - zone.z) <= zone.r + HEAD_R * 0.7;
      case 'lane':
        return Math.abs(x - zone.x) <= zone.halfW + HEAD_R * 0.7;
      case 'sweep':
        return !match.ducked;
      case 'half': {
        const along = zone.axis === 1 ? z : x;
        return along * zone.side > CHOREO.seesawSafeLip;
      }
      case 'gate':
        // Danger is everywhere EXCEPT the column — be in the gap.
        return Math.abs(x - zone.x) > zone.halfW;
      case 'chase': {
        const c = live.chase;
        if (!c) return false;
        return Math.hypot(x - c.x, z - c.z) <= zone.r + HEAD_R * 0.7;
      }
      case 'nova': {
        // Judged on the head alone, forgiving by design (reached the wedge =
        // safe, even if your heels trail).
        if (Math.hypot(x, z) < 0.12) return true; // dead centre is never safe ground
        const ang = Math.atan2(x, z);
        const local = zone.bearing - seatBearing(match.mySeat, match.seats);
        return angDist(ang, local) > zone.halfAngle;
      }
    }
  }

  private resolve(z: LiveZone): void {
    z.resolved = true;
    z.tg?.dispose();
    z.tg = null;

    const parent = platformRoot(z.seat);
    const dancer = dancerAtSeat(z.seat);
    if (parent && dancer?.alive) this.strikeFx(z, parent);

    // One landing → one sound, however many platforms it hit.
    const key = `${z.moveIdx}:${z.landingIdx}`;
    if (!this.landedSfx.has(key)) {
      this.landedSfx.add(key);
      switch (z.zone.kind) {
        case 'circle':
          sfx.gooSlam();
          break;
        case 'lane':
          sfx.beamBlast();
          break;
        case 'sweep':
          sfx.sweepWhoosh();
          break;
        case 'half':
          sfx.floodCrash();
          break;
        case 'gate':
          sfx.slamImpact();
          break;
        case 'chase':
          sfx.pounceSnap();
          break;
        case 'nova':
          sfx.novaBoom();
          break;
      }
    }

    if (!dancer || !dancer.alive) return;

    if (dancer.kind === 'local') {
      this.judgeLocal(z, dancer);
      // Rehearsal bookkeeping runs on every local landing, dodged or not.
      if (match.screen === 'tutorial') this.checkTutorialProgress(z);
    } else if (dancer.kind === 'bot') {
      this.judgeBot(z, dancer);
    }
    // remote: their client judges; scores arrive on the wire.
  }

  private strikeFx(z: LiveZone, parent: NonNullable<ReturnType<typeof platformRoot>>): void {
    switch (z.zone.kind) {
      case 'circle':
        this.strikes.slam(parent, z.zone.x, z.zone.z);
        break;
      case 'lane':
        this.strikes.beam(parent, z.zone.x);
        break;
      case 'sweep':
        this.strikes.sweep(parent, sweepSide(z.moveIdx, z.landingIdx));
        break;
      case 'half':
        this.strikes.halfFlood(parent, z.zone.side, z.zone.axis);
        break;
      case 'gate':
        this.strikes.gate(parent, z.zone.x, z.zone.halfW);
        break;
      case 'chase':
        if (z.chase) this.strikes.chase(parent, z.chase.x, z.chase.z, z.zone.r);
        break;
      case 'nova': {
        const local = z.zone.bearing - seatBearing(z.seat, match.seats);
        this.strikes.nova(parent, local, z.zone.halfAngle);
        break;
      }
    }
  }

  private judgeLocal(z: LiveZone, d: Dancer): void {
    const touching = this.touchesLocal(z);
    if (touching && match.beat >= d.invulnUntilBeat) {
      this.applyHit(z, d);
      return;
    }
    if (touching) return; // clipped inside i-frames — no harm, no reward
    this.applyDodge(z, d, z.wasInside);
  }

  private judgeBot(z: LiveZone, d: Dancer): void {
    if (match.beat < d.invulnUntilBeat) return;
    const chance = Math.max(0.25, d.skill - z.act * BOTS.actPenalty);
    const dodged = roll(match.seed, 0xb0b, z.seat, z.moveIdx, z.landingIdx) < chance;
    if (!dodged) {
      this.applyHit(z, d);
      return;
    }
    const perfect = roll(match.seed, 0x9e4f, z.seat, z.moveIdx, z.landingIdx) < 0.12;
    this.applyDodge(z, d, perfect);
  }

  private applyDodge(_z: LiveZone, d: Dancer, perfect: boolean): void {
    d.combo += 1;
    d.bestCombo = Math.max(d.bestCombo, d.combo);
    d.dodges += 1;
    if (perfect) d.perfects += 1;
    const mult = 1 + SCORE.comboStep * Math.min(d.combo, SCORE.comboCap);
    d.score += Math.round(SCORE.base * mult * (perfect ? SCORE.perfectMult : 1));

    if (d.kind === 'local') {
      if (perfect) {
        pushFlair('PERFECT!', 'perfect');
        sfx.glassClink();
      }
      if (d.combo > 0 && d.combo % 10 === 0) {
        pushFlair(`DODGE STREAK ${d.combo} — ×${mult.toFixed(1)}`, 'milestone');
        sfx.uiClick();
      }
    }
  }

  private applyHit(z: LiveZone, d: Dancer): void {
    d.combo = 0;
    d.invulnUntilBeat = z.dueBeat + SCORE.invulnBeats;

    if (match.screen === 'tutorial') {
      if (d.kind === 'local') {
        this.tutorialMoveHit.set(z.moveIdx, true);
        pushFlair('CLIPPED — AGAIN!', 'hit');
        sfx.hitTaken();
      }
      return;
    }

    d.lives -= 1;
    if (d.kind === 'local') {
      pushFlair(d.lives > 0 ? `HIT — ${d.lives} LEFT` : 'YOU ARE OUT', 'hit');
      sfx.hitTaken();
    }
    if (d.lives <= 0) {
      d.alive = false;
      d.elimAtBeat = z.dueBeat;
      // Their outstanding telegraphs fold with them.
      for (const other of this.zones) {
        if (!other.resolved && other.seat === d.seat) {
          other.resolved = true;
          other.tg?.dispose();
          other.tg = null;
        }
      }
      if (d.kind === 'bot') sfx.koSplat();
    }
  }

  /** Tutorial: a move survived end-to-end is a clear; enough clears wins. */
  private checkTutorialProgress(z: LiveZone): void {
    const pending = this.zones.some((o) => !o.resolved && o.moveIdx === z.moveIdx);
    // Called from resolve — the current zone is already marked resolved.
    if (pending) return;
    const wasHit = this.tutorialMoveHit.get(z.moveIdx) ?? false;
    if (!wasHit) {
      match.tutorialClears += 1;
      const target = match.goopling?.clears ?? 6;
      pushFlair(`${match.tutorialClears} / ${target}`, 'dodge');
      sfx.uiClick();
      if (match.tutorialClears >= target) finishTutorial(true);
    }
    this.tutorialMoveHit.delete(z.moveIdx);
  }
}
