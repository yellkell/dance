/**
 * Landing FX — the goo actually ARRIVING on a platform: slam splashes, the
 * sweeping blade, beam walls, the nova flood, the seesaw's half-deck wave.
 *
 * Everything is seat-local (spawned under a platform's root group), pooled
 * per call, additive, and dead within a second — with up to 24 platforms
 * detonating at once, every strike has to be cheap and self-disposing.
 */

import {
  AdditiveBlending,
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  SphereGeometry,
  type Object3D,
} from 'three';
import { CHOREO, DECAL_Y, OCTAGON_HALF_DEPTH, OCTAGON_HALF_WIDTH, PALETTE } from '../config.js';
import { glowSprite } from '../materials/glow.js';

interface Strike {
  group: Group;
  age: number;
  life: number;
  tick: (k: number, group: Group) => void;
}

const GOO = PALETTE.goopGreen;

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

export class StrikeFx {
  private live: Strike[] = [];

  private spawn(parent: Object3D, life: number, tick: Strike['tick'], build: (g: Group) => void): void {
    const group = new Group();
    build(group);
    parent.add(group);
    this.live.push({ group, age: 0, life, tick });
  }

  /** A goo column crashing on a slam disc. */
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
      },
      (g) => {
        const col = new Mesh(new CylinderGeometry(CHOREO.slamRadius * 0.75, CHOREO.slamRadius, 0.9, 10), basic(GOO, 0.8));
        col.position.set(x, 0.45, z);
        g.add(col);
        const ring = new Mesh(new RingGeometry(CHOREO.slamRadius * 0.85, CHOREO.slamRadius * 1.05, 24), basic(0xbaffc4, 0.8));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(x, DECAL_Y + 0.005, z);
        g.add(ring);
        const halo = glowSprite(GOO, 1.0, 0.9);
        halo.position.set(x, 0.3, z);
        g.add(halo);
      },
    );
  }

  /** The horizontal blade whipping across the deck (duck!). */
  sweep(parent: Object3D): void {
    const w = OCTAGON_HALF_WIDTH * 2 + 0.6;
    this.spawn(
      parent,
      0.4,
      (k, g) => {
        const blade = g.children[0] as Mesh;
        blade.position.x = (k * 2 - 1) * -w * 0.55;
        (blade.material as MeshBasicMaterial).opacity = 0.9 * (1 - k * k);
      },
      (g) => {
        const blade = new Mesh(new BoxGeometry(0.5, CHOREO.sweepThickness * 1.6, OCTAGON_HALF_DEPTH * 2 + 0.5), basic(GOO, 0.9));
        blade.position.set(w * 0.55, CHOREO.sweepY, 0);
        g.add(blade);
      },
    );
  }

  /** A wall of light down a beam lane. */
  beam(parent: Object3D, x: number): void {
    this.spawn(
      parent,
      0.45,
      (k, g) => {
        const wall = g.children[0] as Mesh;
        (wall.material as MeshBasicMaterial).opacity = 0.85 * (1 - k);
        wall.scale.x = 1 - k * 0.55;
      },
      (g) => {
        const wall = new Mesh(
          new BoxGeometry(CHOREO.beamHalfWidth * 2, 2.4, OCTAGON_HALF_DEPTH * 2 + 0.9),
          basic(PALETTE.magenta, 0.85),
        );
        wall.position.set(x, 1.2, 0);
        g.add(wall);
      },
    );
  }

  /** The nova flood: everything flashes except the wedge. */
  nova(parent: Object3D, bearing: number, halfAngle: number): void {
    this.spawn(
      parent,
      0.55,
      (k, g) => {
        const wave = g.children[0] as Mesh;
        wave.scale.setScalar(0.3 + k * 1.5);
        (wave.material as MeshBasicMaterial).opacity = 0.75 * (1 - k);
      },
      (g) => {
        // A ring sparing the wedge: arc from bearing+half to bearing+2π−half.
        const arc = Math.PI * 2 - halfAngle * 2;
        const wave = new Mesh(new RingGeometry(0.5, CHOREO.novaRadius, 40, 1, 0, arc), basic(PALETTE.amber, 0.75));
        wave.rotation.x = -Math.PI / 2;
        // RingGeometry lives in the XY plane (thetaStart from +x toward +y);
        // the −90° X-fold maps plane angle α to world bearing α + π/2 under
        // our atan2(x, z) convention. The arc's GAP centres at plane angle
        // (rotation.z − halfAngle), so solve for the safe bearing:
        wave.rotation.z = bearing - Math.PI / 2 + halfAngle;
        wave.position.y = DECAL_Y + 0.01;
        g.add(wave);
        const boom = new Mesh(new SphereGeometry(0.5, 12, 8), basic(PALETTE.amber, 0.3));
        boom.position.y = 0.5;
        g.add(boom);
      },
    );
  }

  /** The seesaw wave: goo floods one half of the deck and drains. */
  halfFlood(parent: Object3D, side: 1 | -1, axis: 0 | 1): void {
    const halfW = axis ? OCTAGON_HALF_DEPTH : OCTAGON_HALF_WIDTH;
    const depth = (axis ? OCTAGON_HALF_WIDTH : OCTAGON_HALF_DEPTH) * 2 + 0.3;
    this.spawn(
      parent,
      0.6,
      (k, g) => {
        const slab = g.children[0] as Mesh;
        const rise = k < 0.3 ? k / 0.3 : 1 - (k - 0.3) / 0.7;
        slab.scale.y = Math.max(0.02, rise);
        slab.position.y = 0.2 * slab.scale.y;
        (slab.material as MeshBasicMaterial).opacity = 0.7 * (1 - k * 0.6);
      },
      (g) => {
        const slab = new Mesh(new BoxGeometry(halfW + 0.3, 0.4, depth), basic(GOO, 0.7));
        if (axis) {
          slab.rotation.y = Math.PI / 2;
          slab.position.set(0, 0.2, (side * (halfW + 0.3)) / 2);
        } else {
          slab.position.set((side * (halfW + 0.3)) / 2, 0.2, 0);
        }
        g.add(slab);
      },
    );
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const s = this.live[i];
      s.age += dt;
      const k = Math.min(1, s.age / s.life);
      s.tick(k, s.group);
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
