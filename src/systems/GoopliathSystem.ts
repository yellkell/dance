/**
 * GoopliathSystem — the star of the show. The vendored gel creature stands
 * on the centre stage at titan scale and NEVER STOPS DANCING:
 *
 *  - he two-steps: his whole mass lurches side to side ON the beat, dipping
 *    hard on downbeats (the sim's agitation is the body-jiggle),
 *  - every four bars he re-pours himself into a new fighting-style
 *    silhouette (the FIRE FIGHT styles, repurposed as dance stances),
 *  - his gaze grooves too — he watches YOU but sways off you with the bar,
 *    and rides a full spin out of every second phrase,
 *  - and the ATTACKS are his big moves: the amber-eyed wind-up gestures are
 *    reserved for real telegraphs, so when he rears up you KNOW. Multi-part
 *    moves keep him swinging — every seesaw half and drumline step gets its
 *    own quick strike, cued from the choreography.
 *
 * In the lobby he's an idle glob nodding to the room loop; in a tutorial he
 * shrinks to the goopling's scale — same creature, smaller pour.
 */

import { createSystem, Group, Vector3 } from '@iwsdk/core';
import { GOOP, MUSIC, RING, ringRadius, type MoveKind } from '../config.js';
import { GelCreature } from '../goopliath/GelCreature.js';
import { CREATURE, ATTACKS, type AttackName } from '../goopliath/goopConfig.js';
import { GooFx } from '../goopliath/splats.js';
import { FIGHT_STYLES } from '../goopliath/styles.js';
import { match, phraseBeats } from '../game/state.js';

const GESTURE: Record<MoveKind, AttackName> = {
  slam: 'overhand',
  beam: 'cross',
  sweep: 'backfist',
  seesaw: 'clap',
  surge: 'spinkick',
  nova: 'uppercut',
};

/** The quick follow-up strikes inside a multi-landing move. */
const STEP_GESTURE: Record<MoveKind, AttackName> = {
  slam: 'jab',
  beam: 'jab',
  sweep: 'hook',
  seesaw: 'hook',
  surge: 'roundhouse',
  nova: 'jab',
};

/** The two-step floor pattern, one target per beat of the bar (sim units):
 *  step left, gather, step right, gather — with a little push-back on the
 *  gathers so the mass visibly rocks. */
const STEPS: ReadonlyArray<readonly [number, number]> = [
  [-0.34, 0.06],
  [-0.08, -0.12],
  [0.34, 0.06],
  [0.08, -0.12],
];

const _head = new Vector3();
const _target = new Vector3();
const _local = new Vector3();

export class GoopliathSystem extends createSystem({}) {
  private goop?: GelCreature;
  private fx?: GooFx;
  private root?: Group;
  private generation = -1;
  private lastKick = -1;
  private lastStance = -1;
  private hand: 'left' | 'right' = 'left';
  private styleOrder = [...FIGHT_STYLES];

  private rebuild(): void {
    this.generation = match.generation;
    const scale = match.goopling ? match.goopling.scale : GOOP.scale;
    const z = -ringRadius(match.seats);

    if (!this.goop) {
      this.fx = new GooFx();
      this.scene.add(this.fx.group);
      this.goop = new GelCreature(this.fx);
      this.goop.qualityOverride = GOOP.quality;
      this.root = new Group();
      this.root.add(this.goop.group);
      this.scene.add(this.root);
    }
    // Parent scale converts the man-sized sim into the boss (or a goopling).
    this.root!.scale.setScalar((scale * 1.78) / CREATURE.height);
    this.root!.position.set(0, RING.stageHeight, z);
    this.lastStance = -1;
  }

  update(delta: number): void {
    if (this.generation !== match.generation) this.rebuild();
    const goop = this.goop;
    const root = this.root;
    if (!goop || !root) return;

    this.fx?.update(delta);

    // He bounces to whatever is playing — including the lobby loop, so he's
    // already nodding along on his stage before anyone starts a set.
    const inSet = Number.isFinite(match.beat) && match.screen !== 'podium';
    const beat = Number.isFinite(match.beat) ? match.beat : 0;

    // Form: a chilled glob in the lobby, up on his feet for the set.
    goop.setFormTarget(match.screen === 'lobby' || match.screen === 'map' ? 0 : 1);

    // Gestures queued by the choreography. Big wind-ups open a move; the
    // quick step-strikes ride every later landing of a cascade.
    for (const cue of match.gestures.splice(0)) {
      const name = cue.step ? STEP_GESTURE[cue.kind] : GESTURE[cue.kind];
      const chargeSeconds = Math.max(0.25, cue.chargeBeats * match.beatLen);
      goop.tempoScale = Math.max(0.35, (chargeSeconds * GOOP.timeScale) / ATTACKS[name].telegraph);
      this.hand = this.hand === 'left' ? 'right' : 'left';
      // Swing at head height toward my seat — a SHORT lunge; the floor
      // zones carry the real danger (and the raymarch bounds stay tight).
      _head.set(match.headX, match.headY, match.headZ);
      _target.copy(_head).sub(root.position);
      _target.y = 0;
      const len = _target.length() || 1;
      _target.multiplyScalar((root.scale.x * GOOP.gestureReach) / len).add(root.position);
      _target.y = 1.6;
      goop.throwAttack(name, this.hand, _target);
    }

    /* ── the dance ─────────────────────────────────────────────────────── */
    const punching = goop.isPunching;
    if (inSet && beat >= 0) {
      const beatInBar = ((Math.floor(beat) % 4) + 4) % 4;
      const kick = Math.floor(beat);
      if (kick !== this.lastKick) {
        this.lastKick = kick;
        // Jiggle every beat, HIT the downbeat, slam the phrase turn.
        const phraseTurn = kick % phraseBeats() === 0;
        const bounce = phraseTurn ? 0.85 : beatInBar === 0 ? 0.55 : GOOP.danceBounce;
        goop.sim.agitation = Math.min(1, goop.sim.agitation + bounce);
      }

      // A new stance every four bars — he re-pours himself mid-groove.
      const stance = Math.floor(beat / (MUSIC.beatsPerBar * 4));
      if (stance !== this.lastStance) {
        this.lastStance = stance;
        const style = this.styleOrder[stance % this.styleOrder.length];
        goop.setFightStyle(match.screen === 'tutorial' ? null : style.pose);
      }

      // THE TWO-STEP: a discrete floor target per beat — the whole tonnage
      // lurches onto it and gathers for the next. Attacks plant his feet
      // (mid-swing steps read as stumbling, and the swing must aim true).
      if (punching) {
        goop.moveSpeedScale = 1;
        goop.moveTo(_local.set(0, 0, 0));
      } else {
        goop.moveSpeedScale = 2.4; // lurch ON the beat, not toward it
        const step = STEPS[beatInBar];
        _local.set(step[0], 0, step[1]);
        goop.moveTo(_local);
      }
    } else {
      goop.moveSpeedScale = 1;
      goop.moveTo(_local.set(0, 0, 0));
      this.lastKick = -1;
    }

    /* ── the gaze ──────────────────────────────────────────────────────── */
    // He watches YOU — but the watching grooves: his gaze sways off you with
    // the bar, and out of every second phrase he throws a full spin. Mid-
    // attack the sway dies and he squares up dead-on (that's the tell).
    _head.set(match.headX, match.headY, match.headZ);
    _local.copy(_head).sub(root.position).divideScalar(root.scale.x || 1);
    if (inSet && beat >= 0 && !punching) {
      const pb = phraseBeats();
      const inPhrase = beat % pb;
      const oddPhrase = Math.floor(beat / pb) % 2 === 1;
      let sway = Math.sin(beat * Math.PI * 0.5) * 0.5;
      if (oddPhrase && inPhrase > pb - 8) {
        // The spin: the gaze point orbits him once across the last two bars.
        sway += ((inPhrase - (pb - 8)) / 8) * Math.PI * 2;
      }
      const dist = Math.hypot(_local.x, _local.z) || 1;
      const ang = Math.atan2(_local.x, _local.z) + sway;
      _local.set(Math.sin(ang) * dist, _local.y, Math.cos(ang) * dist);
    }
    goop.faceToward(_local);

    // A mid-swing limb balloons the raymarch bounds — shed steps exactly then.
    goop.qualityOverride = goop.isPunching ? GOOP.attackQuality : GOOP.quality;

    goop.update(delta * GOOP.timeScale, _head);
  }
}
