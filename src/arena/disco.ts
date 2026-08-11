/**
 * The light rig — an absolute disco 🪩: the mirror ball over the stage, the
 * sweeping shafts it throws, four laser fans on the stage rim, and the
 * confetti cannons for the podium. Everything additive, everything cheap,
 * everything moving ON THE BEAT (DiscoSystem feeds the song clock in).
 *
 * Perf note: no fullscreen post — the "bloom" is additive sprites and
 * cones over the void's black, which reads shockingly disco on a Quest.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Points,
  PointsMaterial,
  SphereGeometry,
} from 'three';
import { LASER_HUES, PALETTE, RING, hueToColor } from '../config.js';
import { glintTexture, glowSprite } from '../materials/glow.js';

// The GOOPLIATH stands ~4.3 m at raid scale — the ball hangs clear above
// him, and the holo board slots between the two.
const BALL_Y = 7.2;
const SHAFTS = 6;
const FANS = 4;
const BEAMS_PER_FAN = 5;
const CONFETTI = 240;

export class DiscoRig {
  readonly root = new Group();

  private ball!: Group;
  private shaftMats: MeshBasicMaterial[] = [];
  private fans: { pivot: Group; mat: MeshBasicMaterial; phase: number }[] = [];
  private confetti!: Points;
  private confettiPos!: Float32Array;
  private confettiVel!: Float32Array;
  private confettiAge = 999;
  private hueCursor = 0;
  private lastBar = -1;

  constructor() {
    this.root.name = 'disco-rig';
    this.buildBall();
    this.buildFans();
    this.buildConfetti();
  }

  private buildBall(): void {
    this.ball = new Group();
    this.ball.position.y = BALL_Y;

    // Faceted mirror ball. There is no env map to reflect, so the
    // facets are painted on: a bright checker texture over a flat-shaded
    // sphere reads as glitter from across the room (and never goes black).
    const facets = document.createElement('canvas');
    facets.width = facets.height = 128;
    const fg = facets.getContext('2d')!;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const glint = Math.random();
        const l = glint > 0.86 ? 96 : 52 + Math.floor(glint * 28);
        fg.fillStyle = `hsl(${210 + glint * 40}, 18%, ${l}%)`;
        fg.fillRect(x * 8, y * 8, 7, 7);
      }
    }
    const ballTex = new CanvasTexture(facets);
    const ball = new Mesh(
      new SphereGeometry(0.55, 18, 12),
      new MeshBasicMaterial({ map: ballTex, color: PALETTE.mirror }),
    );
    this.ball.add(ball);
    const rod = new Mesh(
      new CylinderGeometry(0.02, 0.02, 2.2, 6),
      new MeshStandardMaterial({ color: 0x22262e, metalness: 0.8, roughness: 0.4 }),
    );
    rod.position.y = 1.55;
    this.ball.add(rod);
    this.ball.add(glowSprite(0xffffff, 1.7, 0.5));

    // The speckle sweep: additive cones hanging off the ball at odd angles —
    // as the ball turns they rake the room like mirror glints.
    for (let i = 0; i < SHAFTS; i++) {
      const mat = new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.1,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      });
      // Long enough to actually rake the floor from the ball's height —
      // short cones read as stubby lampshades, not spotlight beams.
      const len = 12 + (i % 3) * 3;
      const cone = new Mesh(new ConeGeometry(0.5 + (i % 2) * 0.35, len, 10, 1, true), mat);
      cone.translateY(-len / 2);
      const hanger = new Group();
      hanger.rotation.z = 0.5 + (i / SHAFTS) * 0.9;
      hanger.rotation.y = (i / SHAFTS) * Math.PI * 2;
      hanger.add(cone);
      this.ball.add(hanger);
      this.shaftMats.push(mat);
    }
    this.root.add(this.ball);
  }

  private buildFans(): void {
    for (let i = 0; i < FANS; i++) {
      const pivot = new Group();
      const around = (i / FANS) * Math.PI * 2 + Math.PI / FANS;
      pivot.position.set(
        Math.sin(around) * RING.stageRadius * 0.9,
        RING.stageHeight + 0.1,
        Math.cos(around) * RING.stageRadius * 0.9,
      );
      const mat = new MeshBasicMaterial({
        color: hueToColor(LASER_HUES[i % LASER_HUES.length], 0.6),
        transparent: true,
        opacity: 0.65,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      for (let b = 0; b < BEAMS_PER_FAN; b++) {
        const beam = new Mesh(new CylinderGeometry(0.012, 0.012, 15, 4), mat);
        beam.rotation.x = Math.PI / 2 - 0.22; // tipped up-and-out over the ring
        beam.rotation.y = (b - (BEAMS_PER_FAN - 1) / 2) * 0.14;
        beam.translateY(7.5);
        pivot.add(beam);
      }
      // Emitter puck so the beams grow out of something.
      const puck = new Mesh(
        new CylinderGeometry(0.09, 0.12, 0.08, 8),
        new MeshStandardMaterial({ color: 0x171a20, metalness: 0.8, roughness: 0.35 }),
      );
      pivot.add(puck);
      this.root.add(pivot);
      this.fans.push({ pivot, mat, phase: (i / FANS) * Math.PI * 2 });
    }
  }

  private buildConfetti(): void {
    this.confettiPos = new Float32Array(CONFETTI * 3);
    this.confettiVel = new Float32Array(CONFETTI * 3);
    const colors = new Float32Array(CONFETTI * 3);
    const c = new Color();
    for (let i = 0; i < CONFETTI; i++) {
      c.setHex(hueToColor((i / CONFETTI) * 1.0, 0.62));
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
      this.confettiPos[i * 3 + 1] = -50; // parked out of sight
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.confettiPos, 3));
    geo.setAttribute('color', new BufferAttribute(colors, 3));
    // Neon glints, not paper: an unmapped Points material renders literal
    // SQUARES, and squares raining onto the floor read as sprite litter.
    // The lens-glint texture + additive blending turns the same cloud into
    // a sparkler burst that belongs to the light show.
    this.confetti = new Points(
      geo,
      new PointsMaterial({
        size: 0.09,
        map: glintTexture(),
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.confetti.frustumCulled = false;
    this.root.add(this.confetti);
  }

  /** Fire the cannons (podium). Bursts from the stage centre, high. */
  popConfetti(): void {
    this.confettiAge = 0;
    for (let i = 0; i < CONFETTI; i++) {
      this.confettiPos[i * 3] = (Math.random() - 0.5) * 0.6;
      this.confettiPos[i * 3 + 1] = BALL_Y - 0.6;
      this.confettiPos[i * 3 + 2] = (Math.random() - 0.5) * 0.6;
      const a = Math.random() * Math.PI * 2;
      const r = 0.8 + Math.random() * 2.0;
      this.confettiVel[i * 3] = Math.sin(a) * r;
      this.confettiVel[i * 3 + 1] = 0.6 + Math.random() * 1.6;
      this.confettiVel[i * 3 + 2] = Math.cos(a) * r;
    }
  }

  /**
   * Drive the rig. `beat` is the continuous song beat (negative pre-drop),
   * `act` the musical intensity 0..3, `energy` 0..1 (0 in the lobby idle).
   */
  update(dt: number, beat: number, act: number, energy: number): void {
    const beatFrac = beat - Math.floor(beat);
    const pulse = Math.max(0, 1 - beatFrac * 2.2); // hits on the kick, dies fast
    const slow = performance.now() / 1000;

    // The ball turns always (the club never fully sleeps), faster with energy.
    this.ball.rotation.y += dt * (0.25 + energy * 0.55);
    for (let i = 0; i < this.shaftMats.length; i++) {
      this.shaftMats[i].opacity = 0.05 + energy * (0.05 + pulse * 0.1);
    }

    // Laser fans: sweep with the bars, snap hue per bar.
    const bar = Math.floor(beat / 4);
    if (bar !== this.lastBar && beat > 0) {
      this.lastBar = bar;
      this.hueCursor = (this.hueCursor + 1) % LASER_HUES.length;
      for (let i = 0; i < this.fans.length; i++) {
        this.fans[i].mat.color.setHex(
          hueToColor(LASER_HUES[(this.hueCursor + i) % LASER_HUES.length], 0.6),
        );
      }
    }
    for (const fan of this.fans) {
      const sweep = beat > -Infinity && energy > 0 ? Math.sin(beat * 0.7 + fan.phase) : Math.sin(slow * 0.3 + fan.phase);
      fan.pivot.rotation.y = sweep * (0.7 + act * 0.25);
      fan.pivot.rotation.x = Math.sin(beat * 0.35 + fan.phase * 2) * 0.12 * energy;
      fan.mat.opacity = energy > 0 ? 0.3 + pulse * 0.45 : 0.18;
    }

    // Confetti physics.
    if (this.confettiAge < 6) {
      this.confettiAge += dt;
      const pos = this.confettiPos;
      const vel = this.confettiVel;
      for (let i = 0; i < CONFETTI; i++) {
        if (pos[i * 3 + 1] <= -40) continue; // already burnt out
        vel[i * 3 + 1] -= dt * 1.6; // light gravity — it flutters, not falls
        vel[i * 3] *= 1 - dt * 0.4;
        vel[i * 3 + 2] *= 1 - dt * 0.4;
        pos[i * 3] += vel[i * 3] * dt;
        const ny = pos[i * 3 + 1] + vel[i * 3 + 1] * dt;
        // A glint that reaches the floor winks out — the shower never
        // becomes litter lying on the glass.
        pos[i * 3 + 1] = ny <= 0.05 ? -50 : ny;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      }
      (this.confetti.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.root.traverse((o) => {
      const m = o as Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as MeshBasicMaterial | undefined;
      mat?.dispose?.();
    });
  }
}
