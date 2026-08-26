/**
 * DiscoSystem — parks the light rig on the stage, feeds it the beat, and
 * owns the SET's world:
 *
 *  - THE VOID (arena/environment.ts): the environment every set plays
 *    inside — pylon circle, turning hexes, grid floor, shard drift,
 *    horizon glow — driven by the same beat/act/energy the light rig gets
 *    (energy carries the telegraph duck, so danger dims the world). This
 *    is full VR: there is no passthrough mode and no dim toggle anymore;
 *    the scene's opaque backdrop (main.ts) sits behind everything.
 *  - Fog while the set is up, handed back cleanly when it ends — the
 *    club's and foyer's fogs are ClubSystem's business.
 *
 * The rig idles nowhere: menus pack it away (the club and foyer are their
 * own places), and it goes full rave the moment the set drops.
 */

import { createSystem } from '@iwsdk/core';
import { FogExp2, type Scene } from 'three';
import { arena } from '../arena/arena.js';
import { DiscoRig } from '../arena/disco.js';
import { SetEnvironment } from '../arena/environment.js';
import { VOID_BG } from '../arena/voidkit.js';
import { actOfBeat } from '../choreo/setlist.js';
import { LASER_HUES, hueToColor } from '../config.js';
import { match, showBeat } from '../game/state.js';
import { choreoView } from './ChoreoSystem.js';

let rig: DiscoRig | null = null;

/** RankSystem pops the podium confetti through this. */
export function discoRig(): DiscoRig | null {
  return rig;
}

export class DiscoSystem extends createSystem({}) {
  private env!: SetEnvironment;
  private fog = new FogExp2(VOID_BG, 0.022);
  private fogOn = false;
  /** 0..1 — how far the party stands back while a telegraph owns MY deck. */
  private duck = 0;
  /** Bar edge for snapping the stage floor's hues. */
  private stageBar = -1;
  private stageHue = 0;

  init(): void {
    rig = new DiscoRig();
    this.scene.add(rig.root);
    this.env = new SetEnvironment(this.scene);
  }

  update(delta: number): void {
    if (!rig) return;
    const a = arena();
    // Follow every frame — the stage sinks as the ranks rise, and the
    // whole light rig (ball, shafts, fans, confetti) stays with the show.
    if (a) rig.root.position.copy(a.stage.position);

    // The rig is part of the SET — packed away while you're in the menus'
    // places (the foyer and the club are ClubSystem's rooms).
    const menuRoom = match.screen === 'lobby' || match.screen === 'tour';
    rig.root.visible = !menuRoom;

    const live = match.playing && match.screen === 'raid';
    const onBeat = Number.isFinite(match.beat);
    let energy = live ? 1 : match.screen === 'countdown' ? 0.6 : onBeat ? 0.45 : 0.25;
    // The rig dances to the RECORD (showBeat); the ACT — an escalation
    // boundary in chart phrases — keeps the chart's own clock.
    const beat = onBeat ? showBeat() : performance.now() / 1000 / match.beatLen / 4;
    const act = match.screen === 'raid' && onBeat ? actOfBeat(match.beat, match.phrases) : 0;

    // THE DUCK: while a telegraph charges on MY deck the disco stands back —
    // lasers, shafts and the whole void drop away so the hazard shapes own
    // the room, then the party slams back in when the landing resolves.
    const danger = live && choreoView.zones.some((z) => !z.resolved && z.seat === match.mySeat);
    this.duck += ((danger ? 1 : 0) - this.duck) * Math.min(1, delta * 6);
    energy *= 1 - this.duck * 0.75;

    // A hidden rig doesn't animate — no ball spin, shaft sweeps or confetti
    // math for a show that's packed away.
    if (!menuRoom) rig.update(delta, beat, act, energy);

    // ── THE VOID: the set's world, whenever a set (or its podium) is up ──
    const inSet =
      match.screen === 'countdown' || match.screen === 'raid' || match.screen === 'podium';
    this.env.setActive(inSet);
    if (inSet) {
      // The void centres on the stage, like the rig.
      if (a) this.env.root.position.copy(a.stage.position);
      this.env.update(delta, beat, act, energy);
    }
    // Fog belongs to whoever's place is up: ours during the set, the
    // club's in the menus — never clobber a fog we didn't set.
    const scene = this.scene as Scene;
    if (inSet && !this.fogOn) {
      scene.fog = this.fog;
      this.fogOn = true;
    } else if (!inSet && this.fogOn) {
      if (scene.fog === this.fog) scene.fog = null;
      this.fogOn = false;
    }

    const pulse = Math.max(0, 1 - (beat - Math.floor(beat)) * 2.2);

    // ── The stage floor is an instrument too ──────────────────────────
    if (a) {
      // The identity ring breathes with the bar, as always.
      a.stageRingMat.opacity = energy > 0.5 ? 0.75 + 0.25 * pulse : 0.5;

      // The tick ring chases one way, the dash ring sweeps the other — the floor
      // visibly TURNS, and the whole mechanism leans harder with the act.
      const drive = 0.5 + act * 0.25;
      a.stageChase.rotation.y = -beat * (Math.PI / 8) * drive;
      a.stageChase2.rotation.y = beat * (Math.PI / 12) * drive;
      a.stageTickMat.opacity = 0.3 + (0.25 + 0.45 * pulse) * energy;
      a.stageInnerMat.opacity = 0.25 + 0.4 * energy;
      a.stagePoolMat.opacity = 0.1 + (0.08 + 0.14 * pulse) * energy;

      // Hue snaps with the bars, marching the same wheel as the laser fans
      // (the magenta identity ring never changes — it's the signature).
      const bar = Math.floor(beat / 4);
      if (bar !== this.stageBar && beat > 0) {
        this.stageBar = bar;
        this.stageHue = (this.stageHue + 1) % LASER_HUES.length;
        a.stageTickMat.color.setHex(hueToColor(LASER_HUES[this.stageHue], 0.6));
        a.stageInnerMat.color.setHex(
          hueToColor(LASER_HUES[(this.stageHue + 2) % LASER_HUES.length], 0.6),
        );
      }
    }
  }
}
