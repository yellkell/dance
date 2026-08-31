/**
 * CourseSystem — THE STEP's door, and the crossing itself.
 *
 * The club is a teleport room: thumbstick, arc, octagon, you're there. THE
 * COURSE is the opposite proposition — no stick, no arc, no interface at
 * all. One platform under your feet is static relative to your real floor,
 * and the world does the walking; stepping from deck to deck is the entire
 * game. Two sets of physics can't share a room, so they don't: the door in
 * the west corner takes the whole world away and gives you the other one.
 *
 * The crossing, precisely:
 *
 *   off  → you're in the club; the plate in front of the frame lights as
 *          your head nears it, and entering the threshold starts the cross.
 *   in   → the black falls (PHASE.fadeOut). Nothing swaps in front of you.
 *   ride → under the black: the club packs away, the void comes up, the rig
 *          plants at the home pad, the clock starts at bar 0 — then the
 *          black lifts (PHASE.fadeIn) and you're standing on the pad.
 *   out  → the black falls again, on a closed lap or a held Ⓑ.
 *   back → the club returns and puts you down one step outside its own
 *          doorway, facing the hall. Where you started.
 *
 * While `course.active` every club system stands down (see ClubSystem,
 * ClubTeleportSystem, ClubSocialSystem, ClubPropsSystem, ClubBallSystem,
 * ClubMirrorSystem, ArcadeSystem) — including the teleport, which is the
 * whole point: out there the only way to move is to step.
 *
 * This system also owns the body read (head → play-area coordinates) and
 * the transport, because both have to be true before any other course
 * system looks at them.
 */

import { createSystem, InputComponent, VisibilityState } from '@iwsdk/core';
import { BackSide, Mesh, MeshBasicMaterial, SphereGeometry, Vector3 } from 'three';
import * as sfx from '../audio/sfx.js';
import { CLUB } from '../club/config.js';
import { stepRefs } from '../club/step.js';
import { COURSE_ORIGIN, CLIMB, MUSIC, PHASE, PLAY_AREA } from '../course/config.js';
import { conductor } from '../course/conductor.js';
import { PLATFORMS, validateScore } from '../course/score.js';
import { course, G, resetRide } from '../course/state.js';
import { courseRoot } from '../course/world.js';
import { match } from '../game/state.js';
import { net } from '../net/session.js';
import { teleportPlayer } from './ClubTeleportSystem.js';

const _head = new Vector3();

/** The lap lands, the bell rings, and THEN the black comes down. */
const LAP_HOLD = 1.7;

/** Dev window on the door — no thumbstick and no room off-device, so this
 *  is the only way to exercise the crossing headlessly. (`__gdr.course`.) */
export const courseView: {
  enter?: () => void;
  leave?: () => void;
  /** Put the head at a play-area coordinate — the only way to take a step
   *  when there is no body in the room. */
  head?: (x: number, z: number, y?: number) => void;
  /** Where the route says to stand next, in play-area coordinates, or null
   *  while that ground isn't here yet. It is the INVITATION's own answer —
   *  the circle of light on the floor, read back as a number.
   *  (CourseWayfindSystem fills this in.) */
  nextStep?: () => { x: number; z: number } | null;
  state?: () => {
    phase: string;
    active: boolean;
    tracked: string;
    rig: { x: number; y: number; z: number };
    body: { x: number; z: number };
    laps: number;
    slips: number;
    handovers: number;
    bars: number;
    /** The ground you're standing on: is it travelling, and how many bars
     *  of dwell has it left? The rig may only ever change on a frame where
     *  `moving` is true — that is the no-sliding law, in one field. */
    ground: { moving: boolean; departIn: number };
    /** THE DOOR's live read: is the threshold armed, and where is the head
     *  relative to it? */
    door: { refs: boolean; inside: boolean; armed: boolean; dx: number; dz: number };
  };
} = {};

export class CourseSystem extends createSystem({}) {
  private shade!: Mesh<SphereGeometry, MeshBasicMaterial>;
  private t = 0; // seconds inside the current phase
  private lapsAtEntry = 0;
  private lapHold = -1;
  private bailHeld = 0;
  private squeezeHeld = 0;
  /** The threshold only fires on ENTRY: you have to be outside it first, or
   *  coming back out of the door would post you straight back through it. */
  private armed = false;
  private checkedRoom = false;
  /** The door's live read, for the dev window (no controller off-device,
   *  and no room either — this is the only way to see why it didn't fire). */
  private door = { refs: false, inside: false, armed: false, dx: 0, dz: 0 };

  init(): void {
    const root = courseRoot();
    root.position.set(COURSE_ORIGIN.x, COURSE_ORIGIN.y, COURSE_ORIGIN.z);
    this.scene.add(root);
    // A circuit that doesn't tile is a bug in the score, and it should say
    // so on the way up rather than halfway round.
    validateScore();

    // THE CURTAIN — head-locked, a sphere rather than a plane so it covers
    // the field however you turn, and `transparent` at full opacity so it
    // draws after everything it is meant to be hiding (the intro's shade,
    // same reasoning).
    this.shade = new Mesh(
      new SphereGeometry(6, 20, 14),
      new MeshBasicMaterial({
        color: 0x000000,
        side: BackSide,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.shade.renderOrder = 9_000;
    this.shade.name = 'live-course-shade';
    this.shade.visible = false;
    this.scene.add(this.shade);

    courseView.enter = () => this.begin();
    courseView.leave = () => {
      this.end(true);
      course.phase = 'off';
      course.fade = 0;
      this.t = 0;
    };
    courseView.head = (x, z, y = 1.7) => this.camera.position.set(x, y, z);
    courseView.state = () => ({
      phase: course.phase,
      active: course.active,
      tracked: PLATFORMS[G.tracked]?.id ?? '?',
      rig: { ...G.rig },
      body: { x: G.body.x, z: G.body.z },
      laps: course.laps,
      slips: G.slips,
      handovers: G.handovers,
      bars: G.transport.bars,
      ground: {
        moving: G.platforms[G.tracked]?.moving ?? false,
        departIn: G.platforms[G.tracked]?.departIn ?? Infinity,
      },
      door: { ...this.door },
    });
  }

  update(delta: number): void {
    const dt = Math.min(delta, 0.1);
    const menuRoom = match.screen === 'lobby' || match.screen === 'tour';
    const inClub = menuRoom && (net.phase === 'hosting' || net.phase === 'joined') && !match.holdFoyer;

    // The floor got booked (or you left the room) while you were out there.
    // No fade and no doorway: the raid's law is "my platform IS the world
    // origin", so the rig goes back to identity exactly as it does when a
    // set takes the club — putting you down by a door in a hall that is
    // being packed away would move your platform for the night.
    if (!inClub && course.phase !== 'off') {
      this.end(false);
      course.phase = 'off';
      course.fade = 0;
      this.t = 0;
      this.armed = false;
    }

    if (course.active) this.readBody(dt);
    this.stepPhase(dt, inClub);

    // The transport only runs while the ride does — the clock and the floor
    // can never disagree about when a platform leaves, so it must not tick
    // through a black screen or a night at the bar. Nor through a system
    // menu: the runtime blurs the session and the ride would carry on
    // leaving without you, behind somebody else's panel.
    const blurred = this.visibilityState.value === VisibilityState.VisibleBlurred;
    conductor.playing = course.active && !blurred;
    if (course.active && !blurred) {
      conductor.advance(dt);
      G.transport.bars = conductor.bars;
      G.transport.barPhase = conductor.barPhase;
      G.transport.beat = Math.floor(conductor.barPhase * MUSIC.beatsPerBar);
      conductor.setClimb(G.rig.y / CLIMB.top);
      conductor.setArpLevel(Math.min(1, G.flow / 6));
    }

    this.shade.visible = course.fade > 0.002;
    if (this.shade.visible) {
      this.camera.getWorldPosition(_head);
      this.shade.position.copy(_head);
      this.shade.material.opacity = course.fade;
    }
  }

  /* ── the body ─────────────────────────────────────────────────────────
   * The head and nothing else decides standing and stepping. The camera
   * under `world.player` reports play-area coordinates in XR and out of it,
   * so one read serves both — and while the course owns the rig, the rig IS
   * the play-area origin. */
  private readBody(dt: number): void {
    const cam = this.camera;
    G.body.x = cam.position.x;
    G.body.y = cam.position.y;
    G.body.z = cam.position.z;

    // The ghost overlay — the one deliberate button out here, and the set
    // is finishable without ever finding it. Hold a squeeze, or tap G.
    const pad = this.input.xr.gamepads.left ?? this.input.xr.gamepads.right;
    if (pad?.getButtonPressed(InputComponent.Squeeze)) {
      this.squeezeHeld += dt;
      if (this.squeezeHeld > 1) {
        this.squeezeHeld = -0.6; // a release-ish gap before it can re-toggle
        G.ghosts = !G.ghosts;
      }
    } else {
      this.squeezeHeld = Math.max(0, this.squeezeHeld - dt * 4);
    }
    if (this.input.keyboard.getKeyDown('KeyG')) G.ghosts = !G.ghosts;
  }

  /* ── the crossing ─────────────────────────────────────────────────────── */

  private stepPhase(dt: number, inClub: boolean): void {
    this.t += dt;
    switch (course.phase) {
      case 'off':
        this.t = 0;
        this.watchDoor(inClub);
        break;
      case 'in':
        course.fade = Math.min(1, this.t / PHASE.fadeOut);
        if (course.fade >= 1) {
          this.begin();
          course.phase = 'riding';
          this.t = 0;
        }
        break;
      case 'riding':
        course.fade = Math.max(0, 1 - this.t / PHASE.fadeIn);
        this.watchRide(dt);
        break;
      case 'out':
        course.fade = Math.min(1, this.t / PHASE.fadeOut);
        if (course.fade >= 1) {
          this.end(true);
          course.phase = 'back';
          this.t = 0;
        }
        break;
      case 'back':
        course.fade = Math.max(0, 1 - this.t / PHASE.fadeIn);
        if (course.fade <= 0) course.phase = 'off';
        break;
    }
  }

  /** In the club: light the threshold, and take anyone who steps into it. */
  private watchDoor(inClub: boolean): void {
    const refs = stepRefs();
    this.door.refs = Boolean(refs);
    if (!refs) return;
    const S = CLUB.step;
    if (!inClub) {
      this.armed = false;
      refs.plateMat.opacity = 0.22;
      refs.shimmerMat.opacity = 0.16;
      return;
    }
    this.camera.getWorldPosition(_head);
    const dx = Math.abs(_head.x - S.portalX);
    const dz = S.portalZ - _head.z; // positive = in front of the glass
    const inside = dx <= S.portalW / 2 && dz >= -0.1 && dz <= S.reach;
    this.door.dx = dx;
    this.door.dz = dz;
    this.door.inside = inside;
    this.door.armed = this.armed;

    // The plate and the pane wake as you close on them: a door you can see
    // is open before you're standing in it.
    const near = Math.max(0, 1 - Math.max(0, dz - S.reach) / 1.9) * (dx < S.portalW / 2 + 0.9 ? 1 : 0.25);
    refs.plateMat.opacity = 0.18 + near * 0.5;
    refs.shimmerMat.opacity = 0.12 + near * 0.3;

    if (!inside) {
      this.armed = true;
      return;
    }
    if (!this.armed) return;
    this.armed = false;
    course.phase = 'in';
    this.t = 0;
    sfx.ensureAudio(); // the crossing's kit needs a live context on the other side
  }

  /** Out on the circuit: watch for the lap closing, and for a held Ⓑ. */
  private watchRide(dt: number): void {
    if (this.lapHold >= 0) {
      this.lapHold += dt;
      if (this.lapHold >= LAP_HOLD) {
        course.phase = 'out';
        this.t = 0;
      }
      return;
    }
    // The circuit closed — it always ends where it started, so the door
    // is exactly where you left it. Let the bell finish, then go.
    if (course.laps > this.lapsAtEntry) {
      this.lapHold = 0;
      return;
    }
    // …or step back out early. Everything else out here is bodies and
    // floors; this is the one button, and it is deliberately a HOLD.
    if (this.input.xr.gamepads.right?.getButtonPressed(InputComponent.B_Button)) {
      this.bailHeld += dt;
      if (this.bailHeld >= PHASE.bailHold) {
        course.phase = 'out';
        this.t = 0;
      }
    } else {
      this.bailHeld = 0;
    }
  }

  /** Under the black: the club goes, the void comes up, the ride resets. */
  private begin(): void {
    const S = CLUB.step;
    course.exit.x = S.portalX;
    course.exit.z = S.portalZ - S.reach - 0.5;
    course.exit.yaw = 0; // out of the doorway, facing the hall
    course.active = true;
    course.visited = true;
    courseRoot().visible = true;
    this.lapsAtEntry = course.laps;
    this.lapHold = -1;
    this.bailHeld = 0;
    resetRide();
    // Yaw never changes out here, and the play area maps to the world the
    // way it does in a set: your real floor's centre is the pad's centre.
    this.player.rotation.set(0, 0, 0);
    this.player.position.set(COURSE_ORIGIN.x, COURSE_ORIGIN.y, COURSE_ORIGIN.z);
    conductor.start();
    this.checkRoom();
  }

  /**
   * Under the black again: the hall returns, and so do you.
   *
   * `toDoor` is the ordinary way home — you come out of THE STEP's frame
   * standing one pace clear of it, facing the hall. Without it the rig just
   * drops to identity, which is what the club itself does whenever it stops
   * being the room you're in.
   */
  private end(toDoor: boolean): void {
    if (!course.active) return;
    course.active = false;
    courseRoot().visible = false;
    conductor.stop();
    this.player.rotation.set(0, 0, 0);
    this.player.position.set(0, 0, 0);
    if (toDoor) teleportPlayer(this.player, course.exit.x, course.exit.z, course.exit.yaw, 0);
    this.armed = false;
  }

  /**
   * bounded-floor as VALIDATION, never adaptation (research/01 §4, /03 §8.4).
   * The circuit is authored against a fixed 2 × 2 m minimum; what neither
   * exemplar ships is the courtesy of SAYING SO, so we read the real room
   * once and put it on a panel before the first platform moves.
   */
  private checkRoom(): void {
    const session = this.world.session;
    if (!session || this.checkedRoom) return;
    this.checkedRoom = true;
    session
      .requestReferenceSpace('bounded-floor')
      .then((space) => {
        const bounds = (space as XRBoundedReferenceSpace).boundsGeometry;
        if (!bounds || bounds.length < 3) return;
        let minX = Infinity;
        let maxX = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;
        for (const p of bounds) {
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
          minZ = Math.min(minZ, p.z);
          maxZ = Math.max(maxZ, p.z);
        }
        const w = maxX - minX;
        const d = maxZ - minZ;
        if (w < PLAY_AREA.requiredWidth || d < PLAY_AREA.requiredDepth) {
          course.roomWarn = { w, d };
        }
      })
      .catch(() => {
        // No bounded-floor on this runtime: nothing to validate against.
      });
  }
}
