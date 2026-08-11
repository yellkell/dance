/**
 * THE SET's environment — the void the raid happens in.
 *
 * Deep Beat-Saber-background inspiration, bent around a radial arena:
 * where their runways march pylons toward a sun, our ring stands inside a
 * CIRCLE of them — twelve monolith towers pulsing on the kick, three huge
 * hexagonal rings turning slowly over the stage, a grid floor dissolving
 * into fog where your real floor used to be, angular shards adrift in the
 * middle distance, and a horizon of light with no land under it. Abstract,
 * music-reactive, enormous — and honest scenery: everything lives OUTSIDE
 * the platform ring, so nothing ever reads as a telegraph.
 *
 * Palette discipline holds: the void speaks the disco vocabulary
 * (magenta/cyan/violet off LASER_HUES, snapping hue per bar) and DUCKS with
 * the rig while a hazard owns your deck — `energy` arrives pre-ducked from
 * DiscoSystem, so danger dims the whole world, never competes with it.
 *
 * The SYSTEM board's SET VOID row decides whether this exists at all:
 * OFF rides raw passthrough exactly as before; VOID and DEEP wrap the set
 * (DEEP pulls the fog in tighter). DiscoSystem owns the switch, the beat
 * and the fog handoff.
 */

import { Group, type MeshBasicMaterial, type Scene } from 'three';
import { LASER_HUES, hueToColor } from '../config.js';
import {
  buildGridFloor,
  buildHorizon,
  buildPylon,
  buildRingStack,
  buildShards,
  type GridFloor,
  type Pylon,
  type Shard,
  type VoidRing,
} from './voidkit.js';

const PYLONS = 12;
const PYLON_R = 17;

export class SetEnvironment {
  readonly root = new Group();

  private pylons: Pylon[] = [];
  private rings: VoidRing[] = [];
  private shards: Shard[] = [];
  private grid!: GridFloor;
  private horizonMat!: MeshBasicMaterial;
  private hueCursor = 0;
  private lastBar = -1;
  private clock = 0;

  constructor(scene: Scene) {
    this.root.name = 'set-void';
    this.root.visible = false;

    // The ground the void almost has — spread wide under the whole ring.
    this.grid = buildGridFloor(34, hueToColor(LASER_HUES[1], 0.5), 1.4, 0.14);
    this.grid.group.position.y = -0.06;
    this.root.add(this.grid.group);

    // The pylon circle, heights alternating so the skyline staggers.
    for (let i = 0; i < PYLONS; i++) {
      const a = (i / PYLONS) * Math.PI * 2 + Math.PI / PYLONS;
      const h = 7 + (i % 3) * 2.6;
      const pylon = buildPylon(h, hueToColor(LASER_HUES[i % LASER_HUES.length], 0.55), 1.1);
      pylon.group.position.set(Math.sin(a) * PYLON_R, -0.06, Math.cos(a) * PYLON_R);
      pylon.group.rotation.y = a + Math.PI; // faces the arena
      this.root.add(pylon.group);
      this.pylons.push(pylon);
    }

    // Three great hexes turning over the stage.
    const stack = buildRingStack(3, 8.5, 1.6, 8.2, 1.9, hueToColor(LASER_HUES[0], 0.55));
    this.root.add(stack.group);
    this.rings = stack.rings;

    // Drifting shards in the middle distance, clear of the sightlines.
    const drift = buildShards(14, 10.5, 15, 3.5, 9, hueToColor(LASER_HUES[2], 0.5), 0xd4);
    this.root.add(drift.group);
    this.shards = drift.shards;

    // The horizon band.
    const horizon = buildHorizon(60, 26, hueToColor(LASER_HUES[3], 0.5), 0.4);
    this.root.add(horizon.mesh);
    this.horizonMat = horizon.mat;

    scene.add(this.root);
  }

  setActive(on: boolean): void {
    if (this.root.visible !== on) this.root.visible = on;
  }

  get active(): boolean {
    return this.root.visible;
  }

  /**
   * Drive the void. `beat` is the continuous song beat, `act` 0..3, and
   * `energy` 0..1 already carries the telegraph duck.
   */
  update(dt: number, beat: number, act: number, energy: number): void {
    if (!this.root.visible) return;
    this.clock += dt;
    const beatFrac = beat - Math.floor(beat);
    const pulse = Math.max(0, 1 - beatFrac * 2.2);

    // Hue snaps per bar, marching around the wheel with the light rig.
    const bar = Math.floor(beat / 4);
    if (bar !== this.lastBar && beat > 0) {
      this.lastBar = bar;
      this.hueCursor = (this.hueCursor + 1) % LASER_HUES.length;
      this.pylons.forEach((p, i) => {
        const hue = LASER_HUES[(this.hueCursor + i) % LASER_HUES.length];
        for (const m of p.glowMats) m.emissive.setHex(hueToColor(hue, 0.55));
      });
      this.rings.forEach((r, i) => {
        r.mat.emissive.setHex(hueToColor(LASER_HUES[(this.hueCursor + i * 2) % LASER_HUES.length], 0.55));
      });
    }

    // Pylons breathe on the kick — a travelling wave so the circle rolls.
    this.pylons.forEach((p, i) => {
      const wave = Math.sin(beat * Math.PI * 0.5 + (i / PYLONS) * Math.PI * 2);
      const glow = 0.5 + energy * (0.5 + pulse * 0.9 + Math.max(0, wave) * 0.35);
      for (const m of p.glowMats) m.emissiveIntensity = glow;
    });

    // The hexes turn — faster as the acts climb, snapping brighter on the
    // kick without ever strobing.
    for (const r of this.rings) {
      r.mesh.rotation.z += r.speed * (1 + act * 0.5) * dt;
      r.mat.emissiveIntensity = 0.55 + energy * (0.35 + pulse * 0.5);
    }

    // Shards drift and slowly tumble; the grid and horizon breathe low.
    for (const s of this.shards) {
      s.mesh.rotation.y += s.spin * dt;
      s.mesh.position.y = s.baseY + Math.sin(this.clock * 0.4 + s.phase) * s.bob;
    }
    this.grid.mat.opacity = 0.09 + energy * (0.06 + pulse * 0.05);
    this.horizonMat.opacity = 0.3 + energy * 0.16;
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}
