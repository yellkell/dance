/**
 * GoopliathSystem — the star of the show. The vendored gel creature stands
 * on the centre stage at titan scale and DANCES:
 *
 *  - the sim's agitation pulses on every kick (the whole body jiggles in time),
 *  - each 8-bar phrase he re-pours himself into a new fighting-style
 *    silhouette (the FIRE FIGHT styles, repurposed as dance stances),
 *  - he drifts a lazy orbit around his stage and always faces YOU (every
 *    client sees him watching them — the holo-club conceit),
 *  - and when the choreography telegraphs a move he winds up the matching
 *    gesture, so the far tell is his BODY and the near tell is your floor.
 *
 * In the lobby he's an idle glob; in a tutorial he shrinks to the goopling's
 * scale — same creature, smaller pour.
 */

import { createSystem, Group, Vector3 } from '@iwsdk/core';
import { GOOP, RING, ringRadius, type MoveKind } from '../config.js';
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

const _head = new Vector3();
const _target = new Vector3();
const _local = new Vector3();

export class GoopliathSystem extends createSystem({}) {
  private goop?: GelCreature;
  private fx?: GooFx;
  private root?: Group;
  private generation = -1;
  private lastKick = -1;
  private lastPhrase = -1;
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
    this.lastPhrase = -1;
  }

  update(delta: number): void {
    if (this.generation !== match.generation) this.rebuild();
    const goop = this.goop;
    const root = this.root;
    if (!goop || !root) return;

    this.fx?.update(delta);

    const inSet = match.playing && (match.screen === 'raid' || match.screen === 'tutorial' || match.screen === 'countdown');
    const beat = Number.isFinite(match.beat) ? match.beat : 0;

    // Form: a chilled glob in the lobby, up on his feet for the set.
    goop.setFormTarget(match.screen === 'lobby' || match.screen === 'map' ? 0 : 1);

    // Gestures queued by the choreography.
    for (const cue of match.gestures.splice(0)) {
      const name = GESTURE[cue.kind];
      const chargeSeconds = cue.chargeBeats * match.beatLen;
      goop.tempoScale = Math.max(0.4, (chargeSeconds * GOOP.timeScale) / ATTACKS[name].telegraph);
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

    // The dance: agitation on the kick, a new pour every phrase, a lazy orbit.
    if (inSet && beat >= 0) {
      const kick = Math.floor(beat);
      if (kick !== this.lastKick) {
        this.lastKick = kick;
        goop.sim.agitation = Math.min(1, goop.sim.agitation + GOOP.danceBounce);
      }
      const phrase = Math.floor(beat / phraseBeats());
      if (phrase !== this.lastPhrase) {
        this.lastPhrase = phrase;
        const style = this.styleOrder[phrase % this.styleOrder.length];
        goop.setFightStyle(match.screen === 'tutorial' ? null : style.pose);
      }
      // Orbit drift in parent-local space (the steering APIs live there).
      const orbitR = 0.22;
      _local.set(Math.sin(beat * 0.18) * orbitR, 0, Math.cos(beat * 0.13) * orbitR);
      goop.moveTo(_local);
    } else {
      goop.moveTo(_local.set(0, 0, 0));
    }

    // Always watching YOU (parent-local, like the FIRE FIGHT boss rig).
    _head.set(match.headX, match.headY, match.headZ);
    _local.copy(_head).sub(root.position).divideScalar(root.scale.x || 1);
    goop.faceToward(_local);

    // A mid-swing limb balloons the raymarch bounds — shed steps exactly then.
    goop.qualityOverride = goop.isPunching ? GOOP.attackQuality : GOOP.quality;

    goop.update(delta * GOOP.timeScale, _head);
  }
}
