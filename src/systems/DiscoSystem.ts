/**
 * DiscoSystem — parks the light rig on the stage, feeds it the beat, and
 * owns the ROOM DIM: the Laser Dance move, done the WebXR way. An enormous
 * inside-out black shell renders behind everything else (renderOrder −100,
 * no depth write); the compositor alpha-blends it over the passthrough and
 * your real room drops to club lighting, with the neon suddenly doing all
 * the work. Three levels — OFF / CLUB / CAVE — cycled from the lobby panel
 * and persisted; the lobby keeps a bit more of your room than the live set,
 * and the darkness breathes a whisper on the kick.
 *
 * The club idles warm in the lobby (ball turning, lasers lazy) and goes
 * full rave the moment the set drops.
 */

import { createSystem } from '@iwsdk/core';
import { BackSide, Mesh, MeshBasicMaterial, SphereGeometry } from 'three';
import { ROOM_DIM } from '../config.js';
import { arena } from '../arena/arena.js';
import { DiscoRig } from '../arena/disco.js';
import { actOfBeat } from '../choreo/setlist.js';
import { match } from '../game/state.js';

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

  init(): void {
    rig = new DiscoRig();
    this.scene.add(rig.root);

    // The room-dim shell: 60 m of inside-out black around the play space.
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

    const live = match.playing && (match.screen === 'raid' || match.screen === 'tutorial');
    // The lobby loop publishes a beat too, so the room grooves between sets.
    const onBeat = Number.isFinite(match.beat);
    const energy = live ? 1 : match.screen === 'countdown' ? 0.6 : onBeat ? 0.45 : 0.25;
    const beat = onBeat ? match.beat : performance.now() / 1000 / match.beatLen / 4;
    const act = match.screen === 'raid' ? actOfBeat(beat, match.phrases) : 0;
    rig.update(delta, beat, act, energy);

    const pulse = Math.max(0, 1 - (beat - Math.floor(beat)) * 2.2);

    // The stage ring breathes with the bar.
    if (a) {
      a.stageRingMat.opacity = energy > 0.5 ? 0.75 + 0.25 * pulse : 0.5;
    }

    // ROOM DIM: ease toward the level for the moment — deeper for the live
    // set, lighter in the lobby, breathing a whisper on the kick.
    const base = ROOM_DIM.levels[dimLevel] ?? 0;
    const inSet = match.screen === 'countdown' || match.screen === 'raid' || match.screen === 'tutorial' || match.screen === 'podium';
    let target = base * (inSet ? 1 : ROOM_DIM.lobbyFactor);
    if (live && base > 0) target += pulse * ROOM_DIM.beatPulse;
    this.dimMat.opacity += (target - this.dimMat.opacity) * Math.min(1, delta * 2.2);
  }
}
