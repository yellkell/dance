/**
 * Landing FX — the goo actually ARRIVING on a platform.
 *
 * The sweep, nova and flood are ported from FIRE FIGHT's latest strike kit
 * (the blade you can WATCH travel, the expanding shock ring, the settling
 * tide) — that readability contract survived a lot of playtesting and we
 * take it as-is. Two deliberate departures, kept because ours read better
 * for this game:
 *  - the BEAM stays a straight lane wall down the deck, never aimed;
 *  - the SLAM stays the goo column popping out of the disc.
 *
 * Palette discipline (see config.ts): danger speaks hazard amber→red and
 * goo green ONLY — never the disco's magenta/cyan — so a strike can't be
 * mistaken for a laser even mid-lightshow.
 *
 * Everything is seat-local (spawned under a platform's root group), cheap,
 * and dead within a second — with up to 24 platforms detonating at once,
 * every strike self-disposes.
 */

import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  RingGeometry,
  type Object3D,
} from 'three';
import { CHOREO, DECAL_Y, OCTAGON_HALF_DEPTH, OCTAGON_HALF_WIDTH, PALETTE } from '../config.js';
import { glowSprite } from '../materials/glow.js';

interface Strike {
  group: Group;
  age: number;
  life: number;
  tick: (k: number, group: Group) => void;
  /** Real-time step for particle physics (k alone can't integrate). */
  step?: (dt: number) => void;
}

const GOO = PALETTE.goopGreen;
const WARN = PALETTE.amber;
const HOT = PALETTE.whiteHot;

function basic(color: number, opacity = 0.85): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
}

/** A tiny per-strike spark pool: N additive points with gravity, emitted in
 *  puffs along the strike (the fire-fight ember trick, in goo colours). */
class Sparks {
  readonly points: Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private cursor = 0;

  constructor(private n: number, color: number) {
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    for (let i = 0; i < n; i++) this.pos[i * 3 + 1] = -99; // parked
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.points = new Points(
      geo,
      new PointsMaterial({
        color,
        size: 0.035,
        transparent: true,
        opacity: 0.95,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.points.frustumCulled = false;
  }

  emit(x: number, y: number, z: number, count: number, speed = 1.4): void {
    for (let c = 0; c < count; c++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.n;
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * speed;
      this.vel[i * 3] = Math.sin(a) * r * 0.6;
      this.vel[i * 3 + 1] = 0.6 + Math.random() * speed;
      this.vel[i * 3 + 2] = Math.cos(a) * r * 0.6;
      this.life[i] = 0.4 + Math.random() * 0.25;
    }
  }

  step(dt: number): void {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -99;
        continue;
      }
      this.vel[i * 3 + 1] -= dt * 5.2;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] = Math.max(0.02, this.pos[i * 3 + 1] + this.vel[i * 3 + 1] * dt);
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    (this.points.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as PointsMaterial).dispose();
  }
}

export class StrikeFx {
  private live: Strike[] = [];

  private spawn(parent: Object3D, life: number, tick: Strike['tick'], build: (g: Group) => void, step?: Strike['step']): void {
    const group = new Group();
    build(group);
    parent.add(group);
    this.live.push({ group, age: 0, life, tick, step });
  }

  /** OURS, kept: the goo column crashing out of the slam disc — plus a
   *  white-hot floor flash so the landing frame is unmistakable. */
  slam(parent: Object3D, x: number, z: number): void {
    this.spawn(
      parent,
      0.5,
      (k, g) => {
        const col = g.children[0] as Mesh;
        col.scale.set(1 + k * 0.4, Math.max(0.05, 1 - k * k), 1 + k * 0.4);
        (col.material as MeshBasicMaterial).opacity = 0.8 * (1 - k);
        const ring = g.children[1] as Mesh;
        ring.scale.setScalar(1 + k * 2.4);
        (ring.material as MeshBasicMaterial).opacity = 0.8 * (1 - k);
        const flash = g.children[2] as Mesh;
        (flash as unknown as { material: { opacity: number } }).material.opacity = 0.95 * (1 - k) * (1 - k);
        flash.scale.setScalar(1.1 * (1 + k * 1.6));
      },
      (g) => {
        const col = new Mesh(new CylinderGeometry(CHOREO.slamRadius * 0.75, CHOREO.slamRadius, 0.9, 10), basic(GOO, 0.8));
        col.position.set(x, 0.45, z);
        g.add(col);
        const ring = new Mesh(new RingGeometry(CHOREO.slamRadius * 0.85, CHOREO.slamRadius * 1.05, 24), basic(0xbaffc4, 0.8));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(x, DECAL_Y + 0.005, z);
        g.add(ring);
        const flash = glowSprite(HOT, 1.1, 0.95);
        flash.position.set(x, 0.12, z);
        g.add(flash);
        const halo = glowSprite(GOO, 1.0, 0.9);
        halo.position.set(x, 0.3, z);
        g.add(halo);
      },
    );
  }

  /** PORTED: the slice — a tall goo blade scythes across the whole deck at
   *  the marked height, edge glow riding it, sparks shedding along the cut.
   *  A cut you can WATCH travel, not a flicker. `fromSide` = which local-x
   *  side the swing enters from. */
  sweep(parent: Object3D, fromSide: 1 | -1): void {
    const span = OCTAGON_HALF_WIDTH + 0.7;
    const sparks = new Sparks(26, GOO);
    let emberClock = 0;
    this.spawn(
      parent,
      0.42,
      (k, g) => {
        const travel = Math.min(1, k / 0.81); // done travelling at age 0.34
        const bx = fromSide * span * (1 - 2 * travel);
        const blade = g.children[0] as Mesh;
        blade.position.set(bx, CHOREO.sweepY, 0);
        (blade.material as MeshBasicMaterial).opacity = 0.9 * (1 - k * k * k);
        const edge = g.children[1] as Mesh;
        edge.position.set(bx, CHOREO.sweepY, 0);
        // Sparks shed along the cut.
        const age = k * 0.42;
        if (age > emberClock) {
          emberClock = age + 0.045;
          const zr = (Math.random() * 2 - 1) * OCTAGON_HALF_DEPTH;
          sparks.emit(bx, CHOREO.sweepY - 0.1, zr, 4, 1.2);
        }
      },
      (g) => {
        const blade = new Mesh(new BoxGeometry(0.09, 0.5, OCTAGON_HALF_DEPTH * 2 + 0.7), basic(GOO, 0.9));
        blade.position.set(fromSide * span, CHOREO.sweepY, 0);
        g.add(blade);
        const edge = glowSprite(HOT, 0.55, 0.85);
        edge.position.copy(blade.position);
        g.add(edge);
        g.add(sparks.points);
      },
      (dt) => sparks.step(dt),
    );
  }

  /** OURS, kept: a straight wall of light down the lane — never aimed,
   *  exactly where the strip said. Recoloured out of the disco's magenta
   *  into the hazard palette, with a white-hot core so it reads as danger
   *  and not as one more laser. */
  beam(parent: Object3D, x: number): void {
    this.spawn(
      parent,
      0.45,
      (k, g) => {
        const wall = g.children[0] as Mesh;
        (wall.material as MeshBasicMaterial).opacity = 0.7 * (1 - k);
        wall.scale.x = 1 - k * 0.55;
        const core = g.children[1] as Mesh;
        (core.material as MeshBasicMaterial).opacity = 0.95 * (1 - k * k);
        core.scale.x = 1 - k * 0.4;
      },
      (g) => {
        const wall = new Mesh(
          new BoxGeometry(CHOREO.beamHalfWidth * 2, 2.4, OCTAGON_HALF_DEPTH * 2 + 0.9),
          basic(WARN, 0.7),
        );
        wall.position.set(x, 1.2, 0);
        g.add(wall);
        const core = new Mesh(
          new BoxGeometry(CHOREO.beamHalfWidth * 0.7, 2.4, OCTAGON_HALF_DEPTH * 2 + 0.9),
          basic(HOT, 0.95),
        );
        core.position.set(x, 1.2, 0);
        g.add(core);
      },
    );
  }

  /** The gate slams shut: both danger fields flash as walls of light and
   *  the doorposts of the safe column burn white-hot — the gap is exactly
   *  where the telegraph promised. */
  gate(parent: Object3D, x: number, halfW: number): void {
    const edge = OCTAGON_HALF_WIDTH + 0.25;
    const leftW = Math.max(0.05, x - halfW + edge);
    const rightW = Math.max(0.05, edge - (x + halfW));
    this.spawn(
      parent,
      0.45,
      (k, g) => {
        const fade = 1 - k;
        (g.children[0] as Mesh & { material: MeshBasicMaterial }).material.opacity = 0.6 * fade;
        (g.children[1] as Mesh & { material: MeshBasicMaterial }).material.opacity = 0.6 * fade;
        (g.children[2] as Mesh & { material: MeshBasicMaterial }).material.opacity = 0.95 * (1 - k * k);
        (g.children[3] as Mesh & { material: MeshBasicMaterial }).material.opacity = 0.95 * (1 - k * k);
      },
      (g) => {
        const depth = OCTAGON_HALF_DEPTH * 2 + 0.6;
        const wallL = new Mesh(new BoxGeometry(leftW, 2.2, depth), basic(WARN, 0.6));
        wallL.position.set(x - halfW - leftW / 2, 1.1, 0);
        g.add(wallL);
        const wallR = new Mesh(new BoxGeometry(rightW, 2.2, depth), basic(WARN, 0.6));
        wallR.position.set(x + halfW + rightW / 2, 1.1, 0);
        g.add(wallR);
        for (const side of [-1, 1] as const) {
          const post = new Mesh(new BoxGeometry(0.045, 2.3, depth), basic(HOT, 0.95));
          post.position.set(x + side * halfW, 1.15, 0);
          g.add(post);
        }
      },
    );
  }

  /** The chase pounces: the hunter's column crashes on the LOCKED spot —
   *  amber, not goo green, because this one was aimed at a dancer. */
  chase(parent: Object3D, x: number, z: number, r: number): void {
    const sparks = new Sparks(16, WARN);
    let pounced = false;
    this.spawn(
      parent,
      0.5,
      (k, g) => {
        const col = g.children[0] as Mesh;
        col.scale.set(1 + k * 0.3, Math.max(0.05, 1 - k * k), 1 + k * 0.3);
        (col.material as MeshBasicMaterial).opacity = 0.85 * (1 - k);
        const ring = g.children[1] as Mesh;
        ring.scale.setScalar(1 + k * 2.0);
        (ring.material as MeshBasicMaterial).opacity = 0.85 * (1 - k);
        if (!pounced) {
          pounced = true;
          sparks.emit(x, 0.15, z, 10, 1.4);
        }
      },
      (g) => {
        const col = new Mesh(new CylinderGeometry(r * 0.7, r, 1.1, 10), basic(WARN, 0.85));
        col.position.set(x, 0.55, z);
        g.add(col);
        const ring = new Mesh(new RingGeometry(r * 0.85, r * 1.05, 24), basic(HOT, 0.85));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(x, DECAL_Y + 0.005, z);
        g.add(ring);
        g.add(sparks.points);
      },
      (dt) => sparks.step(dt),
    );
  }

  /** PORTED: the nova lands as an expanding SHOCK RING — an open tube wall
   *  racing out from the centre — over the floor flash that spares the
   *  wedge, with sparks erupting along the front everywhere but the safe
   *  ground. */
  nova(parent: Object3D, bearing: number, halfAngle: number): void {
    const sparks = new Sparks(30, WARN);
    let burstClock = 0;
    this.spawn(
      parent,
      0.5,
      (k, g) => {
        const grow = Math.min(1, k / 0.84);
        const tube = g.children[0] as Mesh;
        const r = 0.15 + grow * CHOREO.novaRadius;
        tube.scale.set(r, 1, r);
        (tube.material as MeshBasicMaterial).opacity = 0.9 * (1 - k * k);
        const wave = g.children[1] as Mesh;
        wave.scale.setScalar(0.3 + grow * 1.5);
        (wave.material as MeshBasicMaterial).opacity = 0.7 * (1 - k);
        // Fire along the expanding front — everywhere but the wedge.
        const age = k * 0.5;
        if (age > burstClock) {
          burstClock = age + 0.05;
          for (let i = 0; i < 3; i++) {
            const a = Math.random() * Math.PI * 2 - Math.PI;
            const d = Math.abs(((a - bearing + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
            if (d <= halfAngle) continue; // the safe ground stays safe
            sparks.emit(Math.sin(a) * r * 0.9, 0.1, Math.cos(a) * r * 0.9, 3, 1.1);
          }
        }
      },
      (g) => {
        const tube = new Mesh(new CylinderGeometry(1, 1, 0.5, 32, 1, true), basic(WARN, 0.9));
        tube.position.y = 0.25;
        tube.scale.set(0.15, 1, 0.15);
        g.add(tube);
        // The floor flash that SPARES the wedge (ring arc, gap on the bearing).
        const arc = Math.PI * 2 - halfAngle * 2;
        const wave = new Mesh(new RingGeometry(0.5, CHOREO.novaRadius, 40, 1, 0, arc), basic(WARN, 0.7));
        wave.rotation.x = -Math.PI / 2;
        wave.rotation.z = bearing - Math.PI / 2 + halfAngle;
        wave.position.y = DECAL_Y + 0.01;
        g.add(wave);
        // (No centre burst — the danger is the RING racing outward; a blob
        // of light in the middle read as an explosion where nobody was.)
        g.add(sparks.points);
      },
      (dt) => sparks.step(dt),
    );
  }

  /** PORTED: the tide lands and SETTLES — a slab of goo light floods the
   *  doomed half and sinks into the deck, shedding sparks as it drains. */
  halfFlood(parent: Object3D, side: 1 | -1, axis: 0 | 1): void {
    const halfW = (axis ? OCTAGON_HALF_DEPTH : OCTAGON_HALF_WIDTH) + 0.35;
    const other = axis ? OCTAGON_HALF_WIDTH : OCTAGON_HALF_DEPTH;
    const depth = other * 2 + 0.3;
    const sparks = new Sparks(22, GOO);
    let burstClock = 0;
    this.spawn(
      parent,
      0.5,
      (k, g) => {
        const slab = g.children[0] as Mesh;
        slab.scale.y = 1 - 0.7 * Math.min(1, k / 0.84); // the wave settles in
        (slab.material as MeshBasicMaterial).opacity = 0.55 * (1 - k * k);
        const age = k * 0.5;
        if (age > burstClock) {
          burstClock = age + 0.09;
          const sx = side * (0.1 + Math.random() * (halfW - 0.3));
          const sz = (Math.random() * 2 - 1) * other;
          if (axis) sparks.emit(sz, 0.12, sx, 4, 1.0);
          else sparks.emit(sx, 0.12, sz, 4, 1.0);
        }
      },
      (g) => {
        const slab = new Mesh(new BoxGeometry(halfW, 0.5, depth), basic(GOO, 0.55));
        if (axis) {
          slab.rotation.y = Math.PI / 2;
          slab.position.set(0, 0.25, (side * halfW) / 2);
        } else {
          slab.position.set((side * halfW) / 2, 0.25, 0);
        }
        g.add(slab);
        g.add(sparks.points);
      },
      (dt) => sparks.step(dt),
    );
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const s = this.live[i];
      s.age += dt;
      const k = Math.min(1, s.age / s.life);
      s.tick(k, s.group);
      s.step?.(dt);
      if (k >= 1) {
        s.group.removeFromParent();
        s.group.traverse((o) => {
          const m = o as Mesh;
          m.geometry?.dispose?.();
          (m.material as MeshBasicMaterial)?.dispose?.();
        });
        this.live.splice(i, 1);
      }
    }
  }
}
