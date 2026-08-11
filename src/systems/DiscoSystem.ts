/**
 * DiscoSystem — parks the light rig on the stage, feeds it the beat, and
 * owns the SET's whole look:
 *
 *  - THE VOID (arena/environment.ts): the actual environment the raid
 *    happens in — pylon circle, turning hexes, grid floor, shard drift,
 *    horizon glow — shown at SET VOID levels VOID/DEEP, driven by the same
 *    beat/act/energy the light rig gets (energy carries the telegraph
 *    duck, so danger dims the world). OFF keeps raw passthrough.
 *  - THE DIM SHELL: an enormous inside-out black sphere rendered behind
 *    everything (renderOrder −100, no depth write); the compositor
 *    alpha-blends it over the passthrough, backing the void with darkness
 *    and, at OFF, doing nothing at all.
 *  - Fog while the void is up (DEEP pulls it tighter), handed back cleanly
 *    when the set ends — the club's fog is ClubSystem's business.
 *
 * The rig idles nowhere: menus pack it away (the club and foyer are their
 * own places), and it goes full rave the moment the set drops.
 */

import { createSystem } from '@iwsdk/core';
import { BackSide, FogExp2, Mesh, MeshBasicMaterial, SphereGeometry, type Scene } from 'three';
import { ROOM_DIM } from '../config.js';
import { arena } from '../arena/arena.js';
import { DiscoRig } from '../arena/disco.js';
import { SetEnvironment } from '../arena/environment.js';
import { VOID_BG } from '../arena/voidkit.js';
import { actOfBeat } from '../choreo/setlist.js';
import { match } from '../game/state.js';
import { choreoView } from './ChoreoSystem.js';

let rig: DiscoRig | null = null;

/** RankSystem pops the podium confetti through this. */
export function discoRig(): DiscoRig | null {
  return rig;
}

let dimLevel = ((): number => {
  try {
    const raw = localStorage.getItem(ROOM_DIM.key);
    if (raw !== null) {
      // (Number(null) is 0 — the unset case must fall through to the default.)
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0 && n < ROOM_DIM.levels.length) return Math.floor(n);
    }
  } catch {
    /* storage may be unavailable */
  }
  return ROOM_DIM.defaultLevel;
})();

export function roomDimName(): string {
  return ROOM_DIM.names[dimLevel] ?? 'OFF';
}

export function roomDimLevel(): number {
  return dimLevel;
}

export function cycleRoomDim(): void {
  dimLevel = (dimLevel + 1) % ROOM_DIM.levels.length;
  try {
    localStorage.setItem(ROOM_DIM.key, String(dimLevel));
  } catch {
    /* fine */
  }
}

export class DiscoSystem extends createSystem({}) {
  private dimMat!: MeshBasicMaterial;
  private env!: SetEnvironment;
  private fog = new FogExp2(VOID_BG, 0.02);
  private fogOn = false;
  /** 0..1 — how far the party stands back while a telegraph owns MY deck. */
  private duck = 0;

  init(): void {
    rig = new DiscoRig();
    this.scene.add(rig.root);
    this.env = new SetEnvironment(this.scene);

    // The dim shell: 60 m of inside-out black around the play space.
    // Drawn first (renderOrder −100) with no depth write, so every platform,
    // laser and telegraph paints over it — only the passthrough behind the
    // game darkens.
    this.dimMat = new MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0,
      side: BackSide,
      depthWrite: false,
    });
    const shell = new Mesh(new SphereGeometry(60, 24, 16), this.dimMat);
    shell.renderOrder = -100;
    shell.frustumCulled = false;
    this.scene.add(shell);
  }

  update(delta: number): void {
    if (!rig) return;
    const a = arena();
    // Follow every frame — the stage sinks as the ranks rise, and the
    // whole light rig (ball, shafts, fans, confetti) stays with the show.
    if (a) rig.root.position.copy(a.stage.position);

    // The rig is part of the SET — packed away while you're in the menus'
    // places (the foyer and the club are ClubSystem's rooms).
    const menuRoom = match.screen === 'lobby' || match.screen === 'map' || match.screen === 'tour';
    rig.root.visible = !menuRoom;

    const live = match.playing && (match.screen === 'raid' || match.screen === 'tutorial');
    const onBeat = Number.isFinite(match.beat);
    let energy = live ? 1 : match.screen === 'countdown' ? 0.6 : onBeat ? 0.45 : 0.25;
    const beat = onBeat ? match.beat : performance.now() / 1000 / match.beatLen / 4;
    const act = match.screen === 'raid' ? actOfBeat(beat, match.phrases) : 0;

    // THE DUCK: while a telegraph charges on MY deck the disco stands back —
    // lasers, shafts and the whole void drop away so the hazard shapes own
    // the room, then the party slams back in when the landing resolves.
    const danger = live && choreoView.zones.some((z) => !z.resolved && z.seat === match.mySeat);
    this.duck += ((danger ? 1 : 0) - this.duck) * Math.min(1, delta * 6);
    energy *= 1 - this.duck * 0.75;

    // A hidden rig doesn't animate — no ball spin, shaft sweeps or confetti
    // math for a show that's packed away.
    if (!menuRoom) rig.update(delta, beat, act, energy);

    // ── THE VOID: the set's environment (SET VOID levels 1+) ────────────
    const inSet =
      match.screen === 'countdown' || match.screen === 'raid' || match.screen === 'tutorial' || match.screen === 'podium';
    const envOn = inSet && dimLevel > 0;
    this.env.setActive(envOn);
    if (envOn) {
      // The void centres on the stage, like the rig.
      if (a) this.env.root.position.copy(a.stage.position);
      this.env.update(delta, beat, act, energy);
    }
    // Fog belongs to whoever's place is up: ours during a void set, the
    // club's in the menus — never clobber a fog we didn't set.
    const scene = this.scene as Scene;
    if (envOn && !this.fogOn) {
      this.fog.density = ROOM_DIM.fog[dimLevel] ?? 0.02;
      scene.fog = this.fog;
      this.fogOn = true;
    } else if (!envOn && this.fogOn) {
      if (scene.fog === this.fog) scene.fog = null;
      this.fogOn = false;
    } else if (envOn) {
      this.fog.density = ROOM_DIM.fog[dimLevel] ?? 0.02;
    }

    const pulse = Math.max(0, 1 - (beat - Math.floor(beat)) * 2.2);

    // The stage ring breathes with the bar.
    if (a) {
      a.stageRingMat.opacity = energy > 0.5 ? 0.75 + 0.25 * pulse : 0.5;
    }

    // THE DIM SHELL: ease toward the level for the moment — deeper for the
    // live set, lighter in the lobby, breathing a whisper on the kick.
    const base = ROOM_DIM.levels[dimLevel] ?? 0;
    let target = base * (inSet ? 1 : ROOM_DIM.lobbyFactor);
    if (live && base > 0) target += pulse * ROOM_DIM.beatPulse;
    this.dimMat.opacity += (target - this.dimMat.opacity) * Math.min(1, delta * 2.2);
  }
}
