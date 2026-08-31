/**
 * CourseWayfindSystem — where to stand, and the ledger that closes the lap.
 *
 * Two signs, both on the ground, both wordless:
 *
 *   THE INVITATION — a breathing circle of light on the next tile of the
 *   route, whenever that ground is actually here and steppable. At the very
 *   start it sits on the home pad itself: begin here.
 *
 *   THE BERTH — dim corner brackets marking where the route's next machine
 *   will dock while it is still away, so you aim your body at ground that
 *   is COMING rather than ground that has gone.
 *
 * The route is one ring — the circuit — so this system also keeps the lap
 * ledger: stepping home off the west runner closes it and rings the bell,
 * and CourseSystem takes that as the cue to open the door back to the club.
 */

import { createSystem } from '@iwsdk/core';
import { AdditiveBlending, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import { glowTexture } from '../materials/glow.js';
import { COLOR, GRID, WAYFIND } from '../course/config.js';
import { conductor } from '../course/conductor.js';
import { Bank, shadedBoxGeometry } from '../course/banks.js';
import { registerDim } from '../course/dimmer.js';
import { endpointsOf, HOME_INDEX, INDEX, PLATFORMS, ROUTE, sqOffset } from '../course/score.js';
import { course, G } from '../course/state.js';
import { courseRoot } from '../course/world.js';
import { courseView } from './CourseSystem.js';

interface BerthSlot {
  platform: number;
  stop: { x: number; y: number; z: number };
  nubs: { idx: number; x: number; y: number; z: number }[];
}

export class CourseWayfindSystem extends createSystem({}) {
  private invitation!: Mesh;
  private invitationMat!: MeshBasicMaterial;
  private berths!: Bank;
  private berthSlots: BerthSlot[] = [];
  private lastTracked = 0;
  /** The invitation's tile in play-area coordinates, or null when the
   *  route's next ground isn't here — the dev window's step hint. */
  private next: { x: number; z: number } | null = null;

  init(): void {
    courseView.nextStep = () => (this.next ? { ...this.next } : null);
    const root = courseRoot();
    this.invitationMat = new MeshBasicMaterial({
      map: glowTexture(),
      color: COLOR.rimSafe,
      transparent: true,
      opacity: 0.55,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.invitation = new Mesh(
      new PlaneGeometry(GRID.tile * 0.95, GRID.tile * 0.95),
      this.invitationMat,
    );
    this.invitation.rotation.x = -Math.PI / 2;
    this.invitation.visible = false;
    registerDim(this.invitationMat, 'ground');
    root.add(this.invitation);

    // Every stop of every moving platform gets a set of corner nubs; per
    // frame only the route-relevant berth is shown.
    const moving = PLATFORMS.map((p, i) => ({ p, i })).filter(({ p }) => p.keys.length > 1);
    let cap = 0;
    for (const { p } of moving) cap += endpointsOf(p).length * p.claim.length * 4;
    const mat = new MeshBasicMaterial({});
    registerDim(mat, 'ground');
    this.berths = new Bank(shadedBoxGeometry(), mat, cap);
    for (const { p, i } of moving) {
      for (const stop of endpointsOf(p)) {
        const nubs: BerthSlot['nubs'] = [];
        for (const sq of p.claim) {
          const o = sqOffset(sq);
          for (const [cx, cz] of [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ]) {
            const inset = GRID.tile / 2 - 0.02;
            const x = stop.x + o.x + cx * inset;
            const y = stop.y + 0.05;
            const z = stop.z + o.z + cz * inset;
            nubs.push({ idx: this.berths.add(x, y, z, 0.04, 0.1, 0.04, COLOR.rimSafe), x, y, z });
          }
        }
        this.berthSlots.push({ platform: i, stop, nubs });
      }
    }
    root.add(this.berths.mesh);
  }

  update(): void {
    if (!course.active) return;

    // THE LEDGER: arriving home off the west runner closes the circuit —
    // the last step east repays the first, and the body ends the lap
    // exactly where it began, which is why the door can be waiting there.
    if (G.tracked !== this.lastTracked) {
      if (G.tracked === HOME_INDEX && this.lastTracked === INDEX['runner-home']) {
        course.laps++;
        conductor.bell(course.laps);
      }
      this.lastTracked = G.tracked;
    }

    const trackedId = PLATFORMS[G.tracked].id;
    let at = -1;
    for (let i = 0; i < ROUTE.length - 1; i++) {
      if (ROUTE[i] === trackedId) {
        at = i;
        break;
      }
    }
    const target = at >= 0 ? INDEX[ROUTE[at + 1]] : -1;
    G.wayfind.targetIndex = target;
    G.wayfind.targetAligned = target >= 0 && G.platforms[target].aligned;

    let invTile: { x: number; y: number; z: number } | undefined;
    if (G.handovers === 0) {
      invTile = { x: G.rig.x, y: G.rig.y, z: G.rig.z };
    } else if (target >= 0) {
      const st = G.platforms[target];
      if (st.aligned && !st.moving) {
        const spec = PLATFORMS[target];
        let best: { x: number; y: number; z: number } | undefined;
        let bestD = Infinity;
        for (const sq of spec.claim) {
          const o = sqOffset(sq);
          const px = st.anchor.x + o.x;
          const pz = st.anchor.z + o.z;
          const d = Math.hypot(px - (G.rig.x + G.body.x), pz - (G.rig.z + G.body.z));
          if (d < bestD) {
            bestD = d;
            best = { x: px, y: st.anchor.y, z: pz };
          }
        }
        invTile = best;
      }
    }
    // The same tile, in the coordinates a body actually stands in.
    this.next =
      invTile && G.handovers > 0
        ? { x: invTile.x - G.rig.x, z: invTile.z - G.rig.z }
        : null;

    if (invTile) {
      const urgent = target >= 0 && G.platforms[target].departIn <= 1;
      const breath =
        0.86 +
        0.14 * Math.sin((G.transport.bars / WAYFIND.breathBars) * Math.PI * 2 * (urgent ? 4 : 1));
      this.invitation.visible = true;
      this.invitation.position.set(invTile.x, invTile.y + 0.025, invTile.z);
      this.invitation.scale.setScalar(breath);
      this.invitationMat.color.setHex(urgent ? COLOR.rimWarn : COLOR.rimSafe);
    } else {
      this.invitation.visible = false;
    }

    // The berth: brackets only where the route's next machine will dock,
    // and only while it is away from that dock. Most of the time that is
    // NOWHERE — and an instanced bank with every instance parked off-world
    // still costs its draw call, so the whole bank goes dark instead.
    let anyBerth = false;
    for (const slot of this.berthSlots) {
      const st = G.platforms[slot.platform];
      const relevant =
        slot.platform === target &&
        !st.aligned &&
        Math.hypot(slot.stop.x - G.rig.x, slot.stop.z - G.rig.z) + Math.abs(slot.stop.y - G.rig.y) <
          1.2;
      anyBerth ||= relevant;
      const pulse = WAYFIND.berthPulse * (0.7 + 0.3 * Math.sin(G.transport.bars * Math.PI * 2));
      for (const n of slot.nubs) {
        if (relevant) {
          this.berths.set(n.idx, n.x, n.y, n.z, 0.04, 0.1, 0.04);
          this.berths.color(n.idx, COLOR.rimSafe, pulse);
        } else {
          // Parked, not merely hidden: a berth's nubs stand at fixed world
          // stops, so leaving them placed would light every dock the route
          // has ever used the next time the bank comes back on.
          this.berths.set(n.idx, n.x, -999, n.z, 0.0001, 0.0001, 0.0001);
        }
      }
    }
    this.berths.mesh.visible = anyBerth;
  }
}
