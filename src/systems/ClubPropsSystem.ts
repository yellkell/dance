/**
 * ClubPropsSystem — THE DUMBWAITER and the drinks it serves.
 *
 * No bartender in this house: a brass square set into the bar top RISES
 * with a coupe on it. Take the drink and the square sinks away, pauses,
 * and comes back up carrying another — the venue's quiet little theatre,
 * on a loop, for as long as the floor is open.
 *
 * The holding and throwing is FIRE FIGHT's pub feel, ported whole:
 *
 *  - RANGE GRAB: aim within a 30° cone at a glass inside a metre and
 *    squeeze (or trigger) — it snaps to your hand. The aimable glass
 *    glows so the affordance is never a mystery.
 *  - THROW: a five-frame ring buffer of real hand positions becomes the
 *    release velocity (capped — a coupe is not a fastball), with tumble
 *    seeded from the throw.
 *  - FLIGHT: gravity, wall reflections with per-wall heights (a lob
 *    clears the bar counter; a line drive rings off it), landings on any
 *    surface the venue knows — bar top, booth tables, terrace, stage,
 *    the floor — with bounce-or-settle split by speed and a glass that
 *    eases upright rather than snapping.
 *  - DRINK: bring it to your face and the cocktail's gone (the fill
 *    empties with a slurp). New glasses come full.
 *
 * Local-only for now: every dancer runs their own dumbwaiter and sees
 * their own glasses. Syncing props across the room needs relay verbs
 * (grab/release/stream/settle) the wire doesn't carry yet — the FIRE
 * FIGHT server has the pattern when we want it.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import * as sfx from '../audio/sfx.js';
import { CLUB, DECOR, floorYAt } from '../club/config.js';
import { buildCoupe, PROP_PHYS, PROP_SURFACES, PROP_WALLS, type CoupeRefs } from '../club/props.js';
import { match } from '../game/state.js';
import { net } from '../net/session.js';

const HANDS = ['left', 'right'] as const;
type Hand = (typeof HANDS)[number];

const POOL = 6;
/** The dumbwaiter's square, set into the bar top mid-counter. */
const WAITER = {
  x: CLUB.bar.x + CLUB.bar.depth / 2,
  z: -3.2,
  top: CLUB.bar.top,
  size: 0.26,
  drop: 0.32,
  sinkS: 0.7,
  holdS: 0.9,
  riseS: 0.7,
};
/** Drink detection: glass near your face while held. */
const SIP_DIST = 0.28;

type Mode = 'idle' | 'pedestal' | 'held' | 'flight' | 'rest';

interface Glass {
  refs: CoupeRefs;
  mode: Mode;
  vel: Vector3;
  /** Tumble axis+rate while flying. */
  spinAxis: Vector3;
  spin: number;
  hand: Hand | null;
  full: boolean;
  /** Ring buffer of recent world positions while held. */
  ring: { pos: Vector3; t: number }[];
  /** Age counter for recycling the oldest resting glass. */
  restedAt: number;
}

type WaiterPhase = 'up' | 'sinking' | 'holding' | 'rising';

export class ClubPropsSystem extends createSystem({}) {
  private group = new Group();
  private glasses: Glass[] = [];
  private plate!: Mesh;
  private waiterPhase: WaiterPhase = 'holding';
  private waiterT = 0;
  private served: Glass | null = null;
  private highlight: Partial<Record<Hand, Glass | null>> = {};
  private clock = 0;

  init(): void {
    this.group.name = 'club-props';
    this.group.visible = false;
    this.scene.add(this.group);

    // The collar: a dark square frame in the counter, reading as the hatch.
    const collar = new Mesh(
      new BoxGeometry(WAITER.size + 0.06, 0.012, WAITER.size + 0.06),
      new MeshStandardMaterial({ color: 0x14121a, roughness: 0.6, metalness: 0.3 }),
    );
    collar.position.set(WAITER.x, WAITER.top + 0.006, WAITER.z);
    this.group.add(collar);

    // The plate itself — champagne brass, like everything that moves here.
    this.plate = new Mesh(
      new BoxGeometry(WAITER.size, 0.024, WAITER.size),
      new MeshStandardMaterial({ color: DECOR.brass, roughness: 0.35, metalness: 0.75 }),
    );
    this.plate.position.set(WAITER.x, WAITER.top - WAITER.drop, WAITER.z);
    this.group.add(this.plate);

    for (let i = 0; i < POOL; i++) {
      const refs = buildCoupe();
      refs.root.visible = false;
      this.group.add(refs.root);
      this.glasses.push({
        refs,
        mode: 'idle',
        vel: new Vector3(),
        spinAxis: new Vector3(0, 1, 0),
        spin: 0,
        hand: null,
        full: true,
        ring: [],
        restedAt: 0,
      });
    }
  }

  update(delta: number): void {
    const inClub =
      (match.screen === 'lobby' || match.screen === 'tour') &&
      (net.phase === 'hosting' || net.phase === 'joined');
    if (this.group.visible !== inClub) {
      this.group.visible = inClub;
      if (!inClub) this.packAway();
    }
    if (!inClub) return;

    this.clock += delta;
    this.stepWaiter(delta);
    this.stepHands(delta);
    for (const glass of this.glasses) {
      if (glass.mode === 'flight') this.stepFlight(glass, delta);
      else if (glass.mode === 'rest') this.stepRest(glass, delta);
    }
  }

  /** A set booked the floor (or we left the room): everything goes home. */
  private packAway(): void {
    for (const g of this.glasses) {
      g.mode = 'idle';
      g.hand = null;
      g.refs.root.visible = false;
      if (g.refs.root.parent !== this.group) this.group.attach(g.refs.root);
    }
    this.served = null;
    this.waiterPhase = 'holding';
    this.waiterT = 0;
  }

  /* ── the dumbwaiter ───────────────────────────────────────────────────── */

  private stepWaiter(delta: number): void {
    const plateY = (k: number): number => WAITER.top - WAITER.drop + (WAITER.drop + 0.012) * k;
    this.waiterT += delta;

    if (this.waiterPhase === 'up') {
      // Waiting with a drink on offer. The moment it's taken, sink.
      if (!this.served || this.served.mode !== 'pedestal') {
        this.served = null;
        this.waiterPhase = 'sinking';
        this.waiterT = 0;
        sfx.dumbwaiter(false);
      }
    } else if (this.waiterPhase === 'sinking') {
      const k = Math.min(1, this.waiterT / WAITER.sinkS);
      this.plate.position.y = plateY(1 - k * k);
      if (k >= 1) {
        this.waiterPhase = 'holding';
        this.waiterT = 0;
      }
    } else if (this.waiterPhase === 'holding') {
      this.plate.position.y = plateY(0);
      if (this.waiterT >= WAITER.holdS) {
        const next = this.takeIdleGlass();
        if (next) {
          this.served = next;
          next.mode = 'pedestal';
          next.full = true;
          next.refs.fill.visible = true;
          next.refs.root.visible = true;
          next.refs.root.quaternion.identity();
          this.waiterPhase = 'rising';
          this.waiterT = 0;
          sfx.dumbwaiter(true);
        } else {
          this.waiterT = 0; // every glass is out on the floor — bide time
        }
      }
    } else {
      const k = Math.min(1, this.waiterT / WAITER.riseS);
      const e = 1 - (1 - k) * (1 - k);
      this.plate.position.y = plateY(e);
      if (k >= 1) {
        this.waiterPhase = 'up';
        this.waiterT = 0;
        sfx.glassTap(false);
      }
    }

    // The served glass rides the plate.
    if (this.served && this.served.mode === 'pedestal') {
      this.served.refs.root.position.set(WAITER.x, this.plate.position.y + 0.012, WAITER.z);
    }
  }

  /** An unused glass for the pedestal — idle first, else the longest-
   *  resting one on the floor (the house quietly tidies). */
  private takeIdleGlass(): Glass | null {
    const idle = this.glasses.find((g) => g.mode === 'idle');
    if (idle) return idle;
    let oldest: Glass | null = null;
    for (const g of this.glasses) {
      if (g.mode !== 'rest') continue;
      if (!oldest || g.restedAt < oldest.restedAt) oldest = g;
    }
    return oldest;
  }

  /* ── hands: highlight, grab, hold, drink, release ─────────────────────── */

  private stepHands(_delta: number): void {
    for (const hand of HANDS) {
      const gp = this.input.xr.gamepads[hand];
      const rayObj = this.world.playerSpaceEntities?.raySpaces?.[hand]?.object3D;
      if (!gp || !rayObj) continue;

      const held = this.glasses.find((g) => g.mode === 'held' && g.hand === hand) ?? null;

      if (held) {
        // Sample the hand's motion for the throw, and watch for the sip.
        held.refs.root.getWorldPosition(_p);
        held.ring.push({ pos: _p.clone(), t: this.clock });
        if (held.ring.length > 5) held.ring.shift();

        if (held.full) {
          this.camera.getWorldPosition(_head);
          if (_p.distanceTo(_head) < SIP_DIST) {
            held.full = false;
            held.refs.fill.visible = false;
            sfx.slurp();
          }
        }

        const holding =
          gp.getButtonPressed(InputComponent.Squeeze) || gp.getButtonPressed(InputComponent.Trigger);
        if (!holding) this.release(held);
        continue;
      }

      // Nothing in this hand: find the aimable glass (cone + reach).
      const target = this.findRangeTarget(rayObj);
      const prev = this.highlight[hand] ?? null;
      if (prev !== target) {
        if (prev) this.setGlow(prev, false);
        if (target) this.setGlow(target, true);
        this.highlight[hand] = target;
      }
      if (
        target &&
        (gp.getButtonDown(InputComponent.Squeeze) || gp.getButtonDown(InputComponent.Trigger))
      ) {
        this.grab(target, hand, rayObj);
      }
    }
  }

  private findRangeTarget(rayObj: import('three').Object3D): Glass | null {
    rayObj.getWorldPosition(_o);
    rayObj.getWorldDirection(_d).negate().normalize();
    let best: Glass | null = null;
    let bestScore = -Infinity;
    for (const g of this.glasses) {
      if (g.mode !== 'rest' && g.mode !== 'pedestal') continue;
      g.refs.root.getWorldPosition(_p);
      _p.y += 0.11; // aim at the bowl, not the foot
      _v.copy(_p).sub(_o);
      const dist = _v.length();
      if (dist > PROP_PHYS.grabMaxDist || dist < 0.02) continue;
      const aim = _v.normalize().dot(_d);
      if (aim < PROP_PHYS.grabConeCos) continue;
      const score = aim - dist * 0.1;
      if (score > bestScore) {
        bestScore = score;
        best = g;
      }
    }
    return best;
  }

  private setGlow(glass: Glass, on: boolean): void {
    const mat = glass.refs.glass.material as MeshStandardMaterial;
    mat.emissive.setHex(on ? 0xfff2dc : 0x000000);
    mat.emissiveIntensity = on ? 0.45 : 0;
  }

  private grab(glass: Glass, hand: Hand, rayObj: import('three').Object3D): void {
    if (glass === this.served) this.served = null; // the waiter notices
    glass.mode = 'held';
    glass.hand = hand;
    glass.ring.length = 0;
    this.setGlow(glass, false);
    this.highlight[hand] = null;
    rayObj.attach(glass.refs.root);
    // Settle it into the palm: just below the grip, upright.
    glass.refs.root.position.set(0, -0.03, -0.06);
    glass.refs.root.quaternion.identity();
    sfx.glassTap(false);
  }

  private release(glass: Glass): void {
    glass.hand = null;
    this.scene.attach(glass.refs.root);

    // The throw: displacement across the ring buffer over its time span.
    const ring = glass.ring;
    if (ring.length >= 2) {
      const first = ring[0];
      const last = ring[ring.length - 1];
      const dt = Math.max(last.t - first.t, 1 / 90);
      glass.vel.copy(last.pos).sub(first.pos).divideScalar(dt);
      if (glass.vel.length() > PROP_PHYS.maxThrowSpeed) glass.vel.setLength(PROP_PHYS.maxThrowSpeed);
    } else {
      glass.vel.set(0, 0, 0);
    }
    const speed = glass.vel.length();
    if (speed > 2) sfx.throwWhoosh();
    // Tumble seeded from the throw: axis = up × velocity.
    glass.spinAxis.set(0, 1, 0).cross(glass.vel);
    if (glass.spinAxis.lengthSq() < 1e-6) glass.spinAxis.set(1, 0, 0);
    glass.spinAxis.normalize();
    glass.spin = Math.min(PROP_PHYS.spinMax, speed * PROP_PHYS.spinFromThrow);
    glass.mode = 'flight';
  }

  /* ── flight, landing, rest ────────────────────────────────────────────── */

  private restingYAt(x: number, z: number): number {
    let y = floorYAt(x, z);
    for (const s of PROP_SURFACES) {
      if (x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ && s.y > y) y = s.y;
    }
    return y;
  }

  private stepFlight(glass: Glass, delta: number): void {
    const root = glass.refs.root;
    _prev.copy(root.position);
    glass.vel.y -= PROP_PHYS.gravity * delta;
    root.position.addScaledVector(glass.vel, delta);

    // Tumble.
    if (glass.spin > 0.01) {
      _q.setFromAxisAngle(glass.spinAxis, glass.spin * delta);
      root.quaternion.premultiply(_q);
    }

    // Walls: axis-aligned segments with heights — reflect the crossing
    // component, damp, and ring the glass.
    for (const w of PROP_WALLS) {
      if (root.position.y > w.h) continue;
      if (w.ax === w.bx) {
        // Vertical (constant-x) wall.
        const z0 = Math.min(w.az, w.bz);
        const z1 = Math.max(w.az, w.bz);
        const crossed =
          (_prev.x - w.ax) * (root.position.x - w.ax) < 0 &&
          root.position.z >= z0 &&
          root.position.z <= z1;
        if (crossed) {
          root.position.x = w.ax + Math.sign(_prev.x - w.ax) * 0.03;
          glass.vel.x *= -PROP_PHYS.restitution;
          glass.vel.z *= 0.8;
          sfx.glassTap(Math.abs(glass.vel.x) > 0.8);
        }
      } else {
        const x0 = Math.min(w.ax, w.bx);
        const x1 = Math.max(w.ax, w.bx);
        const crossed =
          (_prev.z - w.az) * (root.position.z - w.az) < 0 &&
          root.position.x >= x0 &&
          root.position.x <= x1;
        if (crossed) {
          root.position.z = w.az + Math.sign(_prev.z - w.az) * 0.03;
          glass.vel.z *= -PROP_PHYS.restitution;
          glass.vel.x *= 0.8;
          sfx.glassTap(Math.abs(glass.vel.z) > 0.8);
        }
      }
    }

    // The ground (or whatever surface is under it). Fall-through gating:
    // only land when the base was above the surface last frame.
    const restY = this.restingYAt(root.position.x, root.position.z);
    if (root.position.y <= restY && _prev.y >= restY - 0.01) {
      root.position.y = restY;
      const vy = Math.abs(glass.vel.y);
      if (glass.vel.length() < PROP_PHYS.settleSpeed || vy < 0.5) {
        glass.mode = 'rest';
        glass.restedAt = this.clock;
        glass.vel.set(0, 0, 0);
        glass.spin = 0;
        sfx.glassTap(false);
      } else {
        glass.vel.y = vy * PROP_PHYS.restitution;
        glass.vel.x *= 0.7;
        glass.vel.z *= 0.7;
        glass.spin *= 0.6;
        sfx.glassTap(vy > 1.2);
      }
    } else if (root.position.y < -2) {
      // Fell out of the world somehow — back to the pool.
      glass.mode = 'idle';
      glass.refs.root.visible = false;
    }
  }

  private stepRest(glass: Glass, delta: number): void {
    const root = glass.refs.root;
    // Ease upright — never snap.
    const k = Math.min(1, PROP_PHYS.uprightEase * delta);
    _q.identity();
    root.quaternion.slerp(_q, k);
    // Keep glasses from sharing a coaster: gently push apart resting pairs.
    for (const other of this.glasses) {
      if (other === glass || other.mode !== 'rest') continue;
      _v.copy(root.position).sub(other.refs.root.position);
      _v.y = 0;
      const d = _v.length();
      if (d > 0.001 && d < 0.09) {
        _v.setLength((0.09 - d) * 0.5);
        root.position.add(_v);
      }
    }
  }
}

const _o = new Vector3();
const _d = new Vector3();
const _p = new Vector3();
const _v = new Vector3();
const _prev = new Vector3();
const _head = new Vector3();
const _q = new Quaternion();
