/**
 * CoursePlatformSystem — the ground itself: quantized travel, decks, and the
 * whole countdown grammar.
 *
 * With no landings out here the floor is the only thing that ever speaks, so
 * it speaks in the club's own colours — CYAN is ground you may step on, AMBER
 * is ground counting itself out, RED is ground in motion and the burn of a
 * step you missed. Red is not decoration: a deck that is travelling cannot be
 * boarded (the handover gate refuses it), so one painted like a docked deck
 * would be a hazard you can't see, which is the one thing the floor is never
 * allowed to be.
 *
 * It says all of it three ways at once, and none of them can be hidden by the
 * angle you happen to be standing at:
 *
 *   1. CORNER POSTS, one extinguished per beat — vertical, so they read
 *      edge-on, from below, and over the fences;
 *   2. RIMS that WRAP the deck edge rather than sitting on top of it, so
 *      the warning survives being looked at from the side;
 *   3. the DECK FACE washing amber — the instruction on the surface you are
 *      already looking at, which is where the club puts its telegraphs too
 *      (research/01 §3).
 *
 * The decks ride the void's black glass and their reflection SHARES the live
 * instance buffers (banks.ts), so the circuit hangs over its own image the
 * whole way round for one extra draw per bank.
 */

import { createSystem } from '@iwsdk/core';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import { COLOR, COUNTDOWN, GRID, SLIP_FLASH } from '../course/config.js';
import { conductor } from '../course/conductor.js';
import { Bank, mirrorBank, shadedBoxGeometry } from '../course/banks.js';
import { registerDim } from '../course/dimmer.js';
import { patternTexture } from '../course/textures.js';
import {
  anchorAt,
  dwellInfo,
  endpointsOf,
  fencesOf,
  INDEX,
  PLATFORMS,
  sqOffset,
} from '../course/score.js';
import { course, G } from '../course/state.js';
import { courseRoot } from '../course/world.js';
import { courseView } from './CourseSystem.js';
import { FLOOR_Y } from './CourseVoidSystem.js';

const EDGE_OFF: Record<string, [number, number, number, number]> = {
  // cx, cz, sx, sz for a rim strip on each edge of a tile
  N: [0, -1, 1, 0],
  S: [0, 1, 1, 0],
  E: [1, 0, 0, 1],
  W: [-1, 0, 0, 1],
};
const FILL_ORDER = ['N', 'E', 'S', 'W'] as const;
const POST_CORNERS: [number, number][] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

interface TileSlot {
  platform: number;
  ox: number;
  oz: number;
  deck: number;
  rims: Record<string, number>;
  posts: number[];
}

interface FenceSlot {
  platform: number;
  x: number;
  z: number;
  edge: string;
  rail: number;
  posts: [number, number];
}

export class CoursePlatformSystem extends createSystem({}) {
  private decks!: Bank;
  private rims!: Bank;
  private posts!: Bank;
  private fences!: Bank;
  private tiles: TileSlot[] = [];
  private fenceSlots: FenceSlot[] = [];
  private ghostGroup!: Group;
  /** platform index → its first deck instance, for the colour read-back. */
  private firstDeck: number[] = [];
  private rigPattern!: Mesh;
  private lastBeat = -1;

  init(): void {
    const root = courseRoot();
    courseView.deckTint = (id) => {
      const pi = INDEX[id];
      const slot = pi === undefined ? undefined : this.firstDeck[pi];
      const a = this.decks?.mesh.instanceColor;
      if (slot === undefined || !a) return null;
      return { r: a.getX(slot), g: a.getY(slot), b: a.getZ(slot) };
    };
    G.platforms = PLATFORMS.map(() => ({
      anchor: { x: 0, y: 0, z: 0 },
      moving: false,
      departIn: Infinity,
      aligned: false,
    }));

    const box = shadedBoxGeometry();
    const deckMat = new MeshBasicMaterial({ vertexColors: true });
    const rimMat = new MeshBasicMaterial({});
    const postMat = new MeshBasicMaterial({});
    const fenceMat = new MeshBasicMaterial({});
    registerDim(deckMat, 'scenery');
    registerDim(rimMat, 'ground');
    registerDim(postMat, 'ground');
    registerDim(fenceMat, 'ground');

    let tileCount = 0;
    for (const p of PLATFORMS) tileCount += p.claim.length;

    this.decks = new Bank(box, deckMat, tileCount);
    this.rims = new Bank(box, rimMat, tileCount * 4);
    this.posts = new Bank(box, postMat, tileCount * 4);

    const fenceLists = PLATFORMS.map((p) => fencesOf(p));
    let fenceCount = 0;
    for (const l of fenceLists) fenceCount += l.length;
    this.fences = new Bank(box, fenceMat, fenceCount * 3);

    PLATFORMS.forEach((spec, pi) => {
      for (const sq of spec.claim) {
        const o = sqOffset(sq);
        const slot: TileSlot = {
          platform: pi,
          ox: o.x,
          oz: o.z,
          deck: this.decks.add(0, 0, 0, GRID.tile, 0.1, GRID.tile, 0xffffff),
          rims: {},
          posts: [],
        };
        for (const e of FILL_ORDER) {
          slot.rims[e] = this.rims.add(0, 0, 0, 0.05, 0.09, 0.05, COLOR.rimSafe);
        }
        for (let k = 0; k < 4; k++) {
          slot.posts.push(
            this.posts.add(0, 0, 0, COUNTDOWN.postSize, COUNTDOWN.postIdle, COUNTDOWN.postSize, COLOR.rimSafe),
          );
        }
        if (this.firstDeck[pi] === undefined) this.firstDeck[pi] = slot.deck;
        this.tiles.push(slot);
      }
      for (const f of fenceLists[pi]) {
        this.fenceSlots.push({
          platform: pi,
          x: f.x,
          z: f.z,
          edge: f.edge,
          rail: this.fences.add(0, 0, 0, 1, 1, 1, COLOR.fence),
          posts: [
            this.fences.add(0, 0, 0, 1, 1, 1, COLOR.fence),
            this.fences.add(0, 0, 0, 1, 1, 1, COLOR.fence),
          ],
        });
      }
    });

    root.add(this.decks.mesh, this.rims.mesh, this.posts.mesh, this.fences.mesh);
    root.add(mirrorBank(this.decks, FLOOR_Y), mirrorBank(this.rims, FLOOR_Y, 0.22));

    this.buildGhosts(root);
  }

  /**
   * THE GHOST OVERLAYS (research/03 §3): every platform stamped with the
   * play-area pattern crop of its claim, at every stop of its travel,
   * deduplicated where two machines share a berth. It is the authoring view
   * that made the score correct in the first place, and it costs one mesh
   * to leave in — so it stays, on a hold of the squeeze.
   */
  private buildGhosts(root: Group): void {
    const tex = patternTexture();
    const positions: number[] = [];
    const uvs: number[] = [];
    const index: number[] = [];
    let vi = 0;
    const half = GRID.pitch / 2;
    const seen = new Set<string>();
    const stamp = (a: { x: number; y: number; z: number }, sq: readonly [number, number]): void => {
      const key = `${a.x.toFixed(3)},${a.y.toFixed(3)},${a.z.toFixed(3)}:${sq[0]},${sq[1]}`;
      if (seen.has(key)) return;
      seen.add(key);
      const o = sqOffset(sq);
      const cx = a.x + o.x;
      const cz = a.z + o.z;
      const y = a.y + 0.012;
      const u0 = (sq[0] + 1) / 3;
      const v0 = 1 - (sq[1] + 2) / 3;
      positions.push(
        cx - half, y, cz - half,
        cx + half, y, cz - half,
        cx + half, y, cz + half,
        cx - half, y, cz + half,
      );
      uvs.push(u0, v0 + 1 / 3, u0 + 1 / 3, v0 + 1 / 3, u0 + 1 / 3, v0, u0, v0);
      index.push(vi, vi + 2, vi + 1, vi, vi + 3, vi + 2);
      vi += 4;
    };
    for (const spec of PLATFORMS) {
      for (const a of endpointsOf(spec)) {
        for (const sq of spec.claim) stamp(a, sq);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    geo.setIndex(index);
    const endpointMesh = new Mesh(
      geo,
      new MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        side: DoubleSide,
      }),
    );

    const rp = GRID.pitch * 3;
    const rigGeo = new BufferGeometry();
    rigGeo.setAttribute(
      'position',
      new BufferAttribute(
        new Float32Array([
          -rp / 2, 0, -rp / 2, rp / 2, 0, -rp / 2, rp / 2, 0, rp / 2, -rp / 2, 0, rp / 2,
        ]),
        3,
      ),
    );
    rigGeo.setAttribute('uv', new BufferAttribute(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), 2));
    rigGeo.setIndex([0, 2, 1, 0, 3, 2]);
    this.rigPattern = new Mesh(
      rigGeo,
      new MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    this.ghostGroup = new Group();
    this.ghostGroup.add(endpointMesh, this.rigPattern);
    this.ghostGroup.visible = false;
    root.add(this.ghostGroup);
  }

  update(dt: number): void {
    if (!course.active) return;
    const bar = G.transport.bars;
    const beatPulse = 0.75 + 0.25 * Math.cos(G.transport.barPhase * Math.PI * 8);

    for (let i = 0; i < PLATFORMS.length; i++) {
      const st = G.platforms[i];
      anchorAt(PLATFORMS[i], bar, st.anchor);
      const d = dwellInfo(PLATFORMS[i], bar);
      st.moving = d.moving;
      st.departIn = d.departIn;
    }

    // The ground you own counting itself out is the standing hazard on the
    // circuit, and the void ducks for it (CourseVoidSystem).
    G.groundLeaving = G.platforms[G.tracked]?.departIn <= 1;
    if (G.slipFlash > 0) G.slipFlash = Math.max(0, G.slipFlash - dt);

    // The countdown is audible too: ticks on each beat of the final dwell
    // bar, for the ground you own or the ground you're being invited onto.
    const beatNow = Math.floor(bar * 4);
    if (beatNow !== this.lastBeat) {
      this.lastBeat = beatNow;
      for (const idx of [G.tracked, G.wayfind.targetIndex]) {
        if (idx < 0) continue;
        const st = G.platforms[idx];
        if (st.departIn <= 1) {
          conductor.tick(Math.ceil(st.departIn * 4));
          break;
        }
      }
    }

    for (const t of this.tiles) {
      const st = G.platforms[t.platform];
      const x = st.anchor.x + t.ox;
      const y = st.anchor.y;
      const z = st.anchor.z + t.oz;
      this.decks.set(t.deck, x, y - 0.05, z, GRID.tile, 0.1, GRID.tile);

      const warn = st.departIn <= 1;
      const fill = warn ? 1 - st.departIn : 0;
      // The burn of a missed step, on the deck that went without you.
      const burn = G.slipAt === t.platform ? G.slipFlash / SLIP_FLASH : 0;

      if (burn > 0) {
        this.decks.color(t.deck, COLOR.rimDanger, 0.35 + 0.65 * burn);
      } else if (warn) {
        this.decks.color(t.deck, COLOR.rimWarn, (0.1 + 0.5 * fill) * (0.7 + 0.45 * beatPulse));
      } else if (st.moving) {
        // IN MOTION — the gate refuses it, so stepping on is a miss. It
        // wears the same red a landing does in a set.
        this.decks.color(t.deck, COLOR.rimDanger, 0.16);
      } else {
        this.decks.color(t.deck, COLOR.deckTop);
      }

      // Rims wrap the deck edge — visible from the side and from below.
      for (let e = 0; e < FILL_ORDER.length; e++) {
        const edge = FILL_ORDER[e];
        const [cx, cz, sx, sz] = EDGE_OFF[edge];
        const half = GRID.tile / 2 + 0.012;
        const idx = t.rims[edge];
        this.rims.set(
          idx,
          x + cx * half,
          y - 0.01,
          z + cz * half,
          sx === 1 ? GRID.tile + 0.05 : 0.045,
          0.09,
          sz === 1 ? GRID.tile + 0.05 : 0.045,
        );
        if (burn > 0) {
          this.rims.color(idx, COLOR.rimDanger, 0.6 + burn);
        } else if (warn) {
          // One quarter of the rim lights per beat gone — the wrap fills
          // like a clock face.
          const lit = (e + 1) / 4 <= fill + 0.001;
          this.rims.color(idx, lit ? COLOR.rimWarn : COLOR.rimSafe, lit ? 1.2 + beatPulse * 0.4 : 0.35);
        } else if (st.moving) {
          this.rims.color(idx, COLOR.rimDanger, 0.9 + 0.5 * beatPulse);
        } else if (st.aligned) {
          this.rims.color(idx, COLOR.rimSafe, 0.55 + 0.45 * beatPulse);
        } else {
          this.rims.color(idx, COLOR.rimSafe, 0.16);
        }
      }

      // Corner posts — the beat countdown no angle can hide. One dies per
      // beat of the final bar; departure is four dead posts.
      const beatsLeft = warn ? Math.max(1, Math.ceil(st.departIn * 4)) : 0;
      for (let k = 0; k < 4; k++) {
        const [pcx, pcz] = POST_CORNERS[k];
        const inset = GRID.tile / 2 - 0.04;
        const h = warn ? COUNTDOWN.postWarn : st.moving ? 0.1 : COUNTDOWN.postIdle;
        this.posts.set(
          t.posts[k],
          x + pcx * inset,
          y + h / 2 + 0.03,
          z + pcz * inset,
          COUNTDOWN.postSize,
          h,
          COUNTDOWN.postSize,
        );
        if (burn > 0) {
          this.posts.color(t.posts[k], COLOR.rimDanger, 0.5 + burn);
        } else if (warn) {
          this.posts.color(t.posts[k], COLOR.rimWarn, k < beatsLeft ? 1.35 + 0.5 * beatPulse : 0.08);
        } else if (st.moving) {
          this.posts.color(t.posts[k], COLOR.rimDanger, 0.5);
        } else if (st.aligned) {
          this.posts.color(t.posts[k], COLOR.rimSafe, 0.5 + 0.3 * beatPulse);
        } else {
          this.posts.color(t.posts[k], COLOR.rimSafe, 0.12);
        }
      }
    }

    for (const f of this.fenceSlots) {
      const st = G.platforms[f.platform];
      const [cx, cz, sx, sz] = EDGE_OFF[f.edge];
      const half = GRID.tile / 2;
      const x = st.anchor.x + f.x + cx * half;
      const y = st.anchor.y;
      const z = st.anchor.z + f.z + cz * half;
      this.fences.set(
        f.rail,
        x,
        y + 0.15,
        z,
        sx === 1 ? GRID.tile * 0.94 : 0.02,
        0.02,
        sz === 1 ? GRID.tile * 0.94 : 0.02,
      );
      const px = sx === 1 ? GRID.tile * 0.44 : 0;
      const pz = sz === 1 ? GRID.tile * 0.44 : 0;
      this.fences.set(f.posts[0], x - px, y + 0.08, z - pz, 0.026, 0.15, 0.026);
      this.fences.set(f.posts[1], x + px, y + 0.08, z + pz, 0.026, 0.15, 0.026);
    }

    this.ghostGroup.visible = G.ghosts;
    if (G.ghosts) this.rigPattern.position.set(G.rig.x, G.rig.y + 0.016, G.rig.z);
  }
}
