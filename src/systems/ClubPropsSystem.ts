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
 * And SHARED, the FIRE FIGHT server pattern (server/index.mjs, DRINKS):
 * the relay brokers ownership and owns the serve clock, so the whole room
 * watches ONE plate raise ONE glass:
 *
 *  - GRAB is optimistic — the hand takes the glass instantly and asks the
 *    relay; if somebody's claim landed first, the relay names the real
 *    holder and the glass leaves the loser's hand. Mid-FLIGHT glasses
 *    are fair game — a catch — exactly the FIRE FIGHT grant rule.
 *  - One owner simulates each moving glass and streams pose + fill at
 *    ~20 Hz; everyone else eases toward the stream (k = 1 − e^(−18Δ),
 *    snapping across big jumps). A settled throw posts its final pose;
 *    resting glasses are server-remembered and walk into late joiners'
 *    'props' snapshots. Dancers dealt onto the ring drop what they held.
 *  - An older relay with no drink words? The plate just stays down.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import * as sfx from '../audio/sfx.js';
import { CLUB, DECOR, floorYAt } from '../club/config.js';
import { buildCoupe, PROP_PHYS, PROP_SURFACES, PROP_WALLS, type CoupeRefs } from '../club/props.js';
import { match } from '../game/state.js';
import {
  net,
  onProp,
  sendPropGrab,
  sendPropPose,
  sendPropRelease,
  sendPropRest,
  type PropWire,
} from '../net/session.js';

const HANDS = ['left', 'right'] as const;
type Hand = (typeof HANDS)[number];

/** Glass pool size — MUST match the relay's PROP_COUNT (server/index.mjs). */
const POOL = 6;
/** The dumbwaiter's square, set into the bar top mid-counter. The relay owns
 *  its clock; this side only plays the plate's travel (exp ease). */
const WAITER = {
  x: CLUB.bar.x + CLUB.bar.depth / 2,
  z: -3.2,
  top: CLUB.bar.top,
  size: 0.26,
  drop: 0.32,
  ease: 8,
};
/** Drink detection: glass near your face while held. */
const SIP_DIST = 0.28;
/** Owner pose stream cadence (s) — ~20 Hz, FIRE FIGHT's rate. */
const STREAM_S = 0.05;
/** Remote glasses ease toward the stream at this rate; snap beyond 2 m. */
const NET_EASE = 18;

type Mode = 'idle' | 'pedestal' | 'held' | 'flight' | 'rest';

interface Glass {
  id: number;
  refs: CoupeRefs;
  mode: Mode;
  /** Who simulates it while it moves: my idx, a room-mate's, or nobody. */
  owner: number | null;
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
  /** The owner's streamed pose (world), and when it last arrived. */
  netPos: Vector3;
  netQuat: Quaternion;
  netAt: number;
}

type WaiterPhase = 'down' | 'sinking' | 'rising' | 'up';

export class ClubPropsSystem extends createSystem({}) {
  private group = new Group();
  private glasses: Glass[] = [];
  private plate!: Mesh;
  private waiterPhase: WaiterPhase = 'down';
  private served: Glass | null = null;
  private highlight: Partial<Record<Hand, Glass | null>> = {};
  private clock = 0;
  private streamT = 0;
  private hadRoom = false;

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
        id: i,
        refs,
        mode: 'idle',
        owner: null,
        vel: new Vector3(),
        spinAxis: new Vector3(0, 1, 0),
        spin: 0,
        hand: null,
        full: true,
        ring: [],
        restedAt: 0,
        netPos: new Vector3(),
        netQuat: new Quaternion(),
        netAt: 0,
      });
    }

    // The wire mutates the glasses directly — even while we're away on the
    // ring (the group hides, but the state stays true to the room).
    onProp((msg) => this.onWire(msg));
  }

  update(delta: number): void {
    const inRoom = net.phase === 'hosting' || net.phase === 'joined' || net.phase === 'live';
    if (!inRoom) {
      if (this.hadRoom) {
        this.hadRoom = false;
        this.packAway();
      }
      return;
    }
    this.hadRoom = true;
    const onFloor = match.screen === 'lobby' || match.screen === 'tour';
    if (this.group.visible !== onFloor) this.group.visible = onFloor;

    this.clock += delta;
    this.stepWaiter(delta);

    if (onFloor) {
      this.stepHands(delta);
      this.streamOwned(delta);
    } else {
      this.shelveHeld();
    }

    for (const glass of this.glasses) {
      const mine = glass.owner === net.myIdx;
      if ((glass.mode === 'held' || glass.mode === 'flight') && !mine) {
        this.easeToStream(glass, delta);
      } else if (glass.mode === 'flight' && mine) {
        this.stepFlight(glass, delta);
      } else if (glass.mode === 'rest') {
        this.stepRest(glass, delta);
      }
    }
  }

  /** We left the room entirely: everything goes home, the plate parks. */
  private packAway(): void {
    for (const g of this.glasses) {
      g.mode = 'idle';
      g.owner = null;
      g.hand = null;
      g.netAt = 0;
      g.refs.root.visible = false;
      this.toGroup(g);
    }
    this.served = null;
    this.waiterPhase = 'down';
    this.plate.position.y = WAITER.top - WAITER.drop;
    this.highlight = {};
    this.group.visible = false;
  }

  /** Dealt onto the ring mid-drink: nothing rides the controllers into the
   *  set. Unhand locally; the relay's drop ('prop-rest') places the glass. */
  private shelveHeld(): void {
    for (const glass of this.glasses) {
      if (glass.owner !== net.myIdx) continue;
      if (glass.mode !== 'held' && glass.mode !== 'flight') continue;
      glass.mode = 'rest';
      glass.owner = null;
      glass.hand = null;
      glass.restedAt = this.clock;
      this.toGroup(glass);
    }
  }

  /* ── the dumbwaiter (event-driven: 'serve' raises, a grab sinks) ──────── */

  private stepWaiter(delta: number): void {
    const topY = WAITER.top + 0.012;
    const downY = WAITER.top - WAITER.drop;
    const up = this.waiterPhase === 'rising' || this.waiterPhase === 'up';
    const target = up ? topY : downY;
    const y = this.plate.position.y;
    const next = y + (target - y) * (1 - Math.exp(-WAITER.ease * delta));
    this.plate.position.y = next;
    if (this.waiterPhase === 'rising' && Math.abs(target - next) < 0.004) {
      this.waiterPhase = 'up';
      if (this.group.visible) sfx.glassTap(false);
    } else if (this.waiterPhase === 'sinking' && Math.abs(target - next) < 0.004) {
      this.waiterPhase = 'down';
    }

    // The served glass rides the plate.
    if (this.served && this.served.mode === 'pedestal') {
      this.served.refs.root.position.set(WAITER.x, this.plate.position.y + 0.012, WAITER.z);
    }
  }

  /* ── hands: highlight, grab, hold, drink, release ─────────────────────── */

  private stepHands(_delta: number): void {
    for (const hand of HANDS) {
      const gp = this.input.xr.gamepads[hand];
      const rayObj = this.world.playerSpaceEntities?.raySpaces?.[hand]?.object3D;
      if (!gp || !rayObj) continue;

      const held =
        this.glasses.find(
          (g) => g.mode === 'held' && g.hand === hand && g.owner === net.myIdx,
        ) ?? null;

      if (held) {
        // Sample the hand's motion for the throw, and watch for the sip.
        held.refs.root.getWorldPosition(_p);
        held.ring.push({ pos: _p.clone(), t: this.clock });
        if (held.ring.length > 5) held.ring.shift();

        if (held.full) {
          this.camera.getWorldPosition(_head);
          if (_p.distanceTo(_head) < SIP_DIST) {
            held.full = false; // the stream carries the empty to the room
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
      // Resting, on the pedestal, or mid-air (anyone's throw — a catch).
      // Never out of someone's closed hand.
      if (g.mode !== 'rest' && g.mode !== 'pedestal' && g.mode !== 'flight') continue;
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

  /** Take it on spec — the relay's grant (or correction) follows. */
  private grab(glass: Glass, hand: Hand, rayObj: import('three').Object3D): void {
    glass.mode = 'held';
    glass.owner = net.myIdx;
    glass.hand = hand;
    glass.ring.length = 0;
    this.setGlow(glass, false);
    this.highlight[hand] = null;
    rayObj.attach(glass.refs.root);
    // Settle it into the palm: just below the grip, upright.
    glass.refs.root.position.set(0, -0.03, -0.06);
    glass.refs.root.quaternion.identity();
    sfx.glassTap(false);
    sendPropGrab(glass.id);
  }

  private release(glass: Glass): void {
    glass.hand = null;
    this.toGroup(glass);

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
    glass.mode = 'flight'; // still mine to simulate — and now catchable
    sendPropRelease(glass.id);
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
        glass.owner = null;
        glass.restedAt = this.clock;
        glass.vel.set(0, 0, 0);
        glass.spin = 0;
        sfx.glassTap(false);
        // The pose sticks room-wide — and frees the glass for anyone.
        sendPropRest(
          glass.id,
          [root.position.x, root.position.y, root.position.z],
          [root.quaternion.x, root.quaternion.y, root.quaternion.z, root.quaternion.w],
        );
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
      glass.owner = null;
      glass.refs.root.visible = false;
      sendPropRest(glass.id, null, null);
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

  /* ── the wire: the room's glasses, kept true ──────────────────────────── */

  /** Remote-owned glasses ease toward the owner's stream. */
  private easeToStream(glass: Glass, delta: number): void {
    if (glass.netAt <= 0) return; // no pose yet — hold still until one lands
    const root = glass.refs.root;
    const k = 1 - Math.exp(-NET_EASE * delta);
    if (root.position.distanceToSquared(glass.netPos) > 4) root.position.copy(glass.netPos);
    else root.position.lerp(glass.netPos, k);
    root.quaternion.slerp(glass.netQuat, k);
  }

  /** Ship poses of everything I simulate, ~20 Hz. */
  private streamOwned(delta: number): void {
    this.streamT += delta;
    if (this.streamT < STREAM_S) return;
    this.streamT = 0;
    for (const glass of this.glasses) {
      if (glass.owner !== net.myIdx) continue;
      if (glass.mode !== 'held' && glass.mode !== 'flight') continue;
      glass.refs.root.getWorldPosition(_p);
      glass.refs.root.getWorldQuaternion(_wq);
      sendPropPose(glass.id, [_p.x, _p.y, _p.z, _wq.x, _wq.y, _wq.z, _wq.w, glass.full ? 1 : 0]);
    }
  }

  private onWire(msg: PropWire): void {
    if (msg.t === 'props') {
      for (const p of msg.props) this.applyWireState(p);
      return;
    }
    const glass = this.glasses[msg.id];
    if (!glass) return;
    switch (msg.t) {
      case 'serve':
        this.applyServe(glass);
        break;
      case 'prop-grab':
        this.applyGrabbed(glass, msg.idx);
        break;
      case 'prop-release':
        // Their throw: catchable, and still theirs to fly.
        if (msg.idx !== net.myIdx) {
          glass.owner = msg.idx;
          glass.mode = 'flight';
        }
        break;
      case 'prop':
        this.applyStream(glass, msg.idx, msg.d);
        break;
      case 'prop-rest':
        this.applyRest(glass, msg);
        break;
    }
  }

  /** A fresh coupe rises — wherever this glass was, it's the pedestal's. */
  private applyServe(glass: Glass): void {
    // The sub-RTT race: the server picked a glass MY optimistic grab was
    // already holding. Don't rip it from the hand — my in-flight claim
    // lands right behind this serve, and its grant sinks the plate again.
    if (glass.owner === net.myIdx && glass.mode === 'held') {
      this.served = glass;
      this.waiterPhase = 'rising';
      return;
    }
    this.disown(glass);
    glass.mode = 'pedestal';
    glass.full = true;
    glass.refs.fill.visible = true;
    glass.refs.root.visible = true;
    glass.refs.root.quaternion.identity();
    glass.refs.root.position.set(WAITER.x, this.plate.position.y + 0.012, WAITER.z);
    glass.vel.set(0, 0, 0);
    glass.spin = 0;
    glass.netAt = 0;
    this.served = glass;
    this.waiterPhase = 'rising';
    if (this.group.visible) sfx.dumbwaiter(true);
  }

  /** The relay's word on who holds a glass — grant, echo, or correction. */
  private applyGrabbed(glass: Glass, idx: number): void {
    // Whoever took the plate's drink, the plate reacts the same way.
    if (glass === this.served) {
      this.served = null;
      this.waiterPhase = 'sinking';
      if (this.group.visible) sfx.dumbwaiter(false);
    }
    if (idx === net.myIdx) return; // my own grant — it's already in hand
    // Someone else's hand (their claim landed first, or plain theirs).
    this.disown(glass);
    glass.owner = idx;
    glass.mode = 'held';
    glass.refs.root.visible = true;
    glass.netAt = 0; // hold this pose until their stream lands
  }

  /** The owner's ~20 Hz pose+fill line. */
  private applyStream(glass: Glass, idx: number, d: number[]): void {
    if (idx === net.myIdx || !Array.isArray(d) || d.length < 8) return;
    for (let i = 0; i < 8; i++) if (!Number.isFinite(d[i])) return; // no NaN poses
    glass.owner = idx;
    if (glass.mode !== 'held' && glass.mode !== 'flight') glass.mode = 'held';
    this.toGroup(glass);
    glass.refs.root.visible = true;
    glass.netPos.set(d[0], d[1], d[2]);
    glass.netQuat.set(d[3], d[4], d[5], d[6]);
    glass.netAt = this.clock;
    const full = d[7] > 0.5;
    if (full !== glass.full) {
      glass.full = full;
      glass.refs.fill.visible = full;
    }
  }

  /** A settled (or dropped, or lost) glass: the pose sticks, ownership ends. */
  private applyRest(glass: Glass, msg: { idle?: boolean; pos?: number[]; quat?: number[] }): void {
    this.disown(glass);
    if (msg.idle || !Array.isArray(msg.pos) || msg.pos.length < 3 || msg.pos.some((n) => !Number.isFinite(n))) {
      glass.mode = 'idle';
      glass.refs.root.visible = false;
      glass.netAt = 0;
      return;
    }
    glass.mode = 'rest';
    glass.refs.root.visible = true;
    // Recompute the shelf height locally: a drop streamed at chest height
    // still lands on whatever surface is under it, same on every client.
    glass.refs.root.position.set(msg.pos[0], this.restingYAt(msg.pos[0], msg.pos[2]), msg.pos[2]);
    if (Array.isArray(msg.quat) && msg.quat.length >= 4 && msg.quat.every((n) => Number.isFinite(n))) {
      glass.refs.root.quaternion.set(msg.quat[0], msg.quat[1], msg.quat[2], msg.quat[3]);
    } else {
      glass.refs.root.quaternion.identity();
    }
    glass.vel.set(0, 0, 0);
    glass.spin = 0;
    glass.restedAt = this.clock;
    glass.netAt = 0;
  }

  /** A late joiner's snapshot line — one glass, as the room knows it. */
  private applyWireState(p: {
    id: number;
    holder: number | null;
    mode: string;
    pos: number[] | null;
    quat: number[] | null;
    full: boolean;
  }): void {
    const glass = this.glasses[p.id];
    if (!glass) return;
    glass.full = p.full !== false;
    glass.refs.fill.visible = glass.full;
    glass.hand = null;
    glass.vel.set(0, 0, 0);
    glass.spin = 0;
    if (p.mode === 'pedestal') {
      glass.mode = 'pedestal';
      glass.owner = null;
      this.toGroup(glass);
      glass.refs.root.visible = true;
      glass.refs.root.quaternion.identity();
      this.served = glass;
      // Walked in mid-serve: the plate is simply up — no theatre to replay.
      this.waiterPhase = 'up';
      this.plate.position.y = WAITER.top + 0.012;
      glass.refs.root.position.set(WAITER.x, this.plate.position.y + 0.012, WAITER.z);
    } else if ((p.mode === 'held' || p.mode === 'flight') && p.holder !== null && p.holder !== net.myIdx) {
      glass.mode = p.mode;
      glass.owner = p.holder;
      this.toGroup(glass);
      if (p.pos && p.pos.length >= 3) {
        glass.refs.root.position.set(p.pos[0], p.pos[1], p.pos[2]);
        glass.netPos.set(p.pos[0], p.pos[1], p.pos[2]);
        if (p.quat && p.quat.length >= 4) {
          glass.refs.root.quaternion.set(p.quat[0], p.quat[1], p.quat[2], p.quat[3]);
          glass.netQuat.set(p.quat[0], p.quat[1], p.quat[2], p.quat[3]);
        }
        glass.netAt = this.clock;
        glass.refs.root.visible = true;
      } else {
        // No pose yet — it appears with the owner's first stream packet.
        glass.netAt = 0;
        glass.refs.root.visible = false;
      }
    } else if (p.mode === 'rest' && p.pos && p.pos.length >= 3) {
      glass.mode = 'rest';
      glass.owner = null;
      this.toGroup(glass);
      glass.refs.root.position.set(p.pos[0], this.restingYAt(p.pos[0], p.pos[2]), p.pos[2]);
      if (p.quat && p.quat.length >= 4) {
        glass.refs.root.quaternion.set(p.quat[0], p.quat[1], p.quat[2], p.quat[3]);
      } else {
        glass.refs.root.quaternion.identity();
      }
      glass.restedAt = this.clock;
      glass.refs.root.visible = true;
    } else {
      glass.mode = 'idle';
      glass.owner = null;
      this.toGroup(glass);
      glass.refs.root.visible = false;
      glass.netAt = 0;
    }
  }

  /* ── little helpers ───────────────────────────────────────────────────── */

  /** Out of any hand of mine, glow off, back under the props group. */
  private disown(glass: Glass): void {
    glass.hand = null;
    this.setGlow(glass, false);
    for (const hand of HANDS) {
      if (this.highlight[hand] === glass) this.highlight[hand] = null;
    }
    this.toGroup(glass);
  }

  /** Parent under the props group (identity), keeping the world pose. */
  private toGroup(glass: Glass): void {
    if (glass.refs.root.parent !== this.group) this.group.attach(glass.refs.root);
  }
}

const _o = new Vector3();
const _d = new Vector3();
const _p = new Vector3();
const _v = new Vector3();
const _prev = new Vector3();
const _head = new Vector3();
const _q = new Quaternion();
const _wq = new Quaternion();
