/**
 * ClubTeleportSystem — FIRE FIGHT's club movement, carried over whole:
 * teleport-only, no sliding, no smooth turn.
 *
 *  - Deflect either thumbstick and that controller starts aiming: a
 *    ballistic arc curves from it to the floor, ending in an OCTAGON marker
 *    (the dancer's platform footprint, naturally) with an arrow inside it.
 *  - Move the controller to move the landing spot; roll the thumbstick to
 *    spin the arrow — that's the way you'll be FACING when you arrive.
 *  - Let the stick spring back and you're there.
 *  - An isolated sideways flick (when not aiming) is a snap turn.
 *
 * Landing spots are restricted to the club's floor rectangles
 * (TELEPORT_AREAS — hall, bar aisle, terrace wings, still room); anywhere
 * else the marker burns hazard-red and release does nothing. The terrace
 * rides at +0.45 m: areas carry their own floor height and the rig lands at
 * it. Arcs can't cut through walls, the bar counter, or the stage face.
 *
 * Active only while the club is the room (menu screens). The moment a set
 * books the floor, the rig is re-planted at the spawn facing the stage —
 * the raid's law is "my platform IS the world origin", and it still is.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import {
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Shape,
  ShapeGeometry,
  Vector3,
} from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { XROrigin } from '@iwsdk/xr-input';
import { OCTAGON_VERTICES, PALETTE } from '../config.js';
import { octagonSlab } from '../arena/octagon.js';
import * as sfx from '../audio/sfx.js';
import { CLUB, DECOR, TELEPORT, TELEPORT_AREAS, WALL_SEGMENTS, type FloorArea } from '../club/config.js';
import { match } from '../game/state.js';
import { net } from '../net/session.js';

const _origin = new Vector3();
const _dir = new Vector3();
const _quat = new Quaternion();
const _p = new Vector3();
const _v = new Vector3();
const _head = new Vector3();

/**
 * Move the rig so the player's head lands over (x, z) at floor height `y`,
 * facing `yaw` (three.js convention: yaw 0 looks down −z).
 */
export function teleportPlayer(player: XROrigin, x: number, z: number, yaw: number, y = 0): void {
  player.head.getWorldPosition(_head);
  player.head.getWorldQuaternion(_quat);
  _dir.set(0, 0, -1).applyQuaternion(_quat);
  const headYaw = Math.atan2(-_dir.x, -_dir.z);

  const dYaw = yaw - headYaw;
  player.rotation.y += dYaw;
  player.position.y = y;

  // Rotate the head's offset from the rig origin by the turn we just made,
  // then position the rig so the head ends up exactly on target.
  const offX = _head.x - player.position.x;
  const offZ = _head.z - player.position.z;
  const cos = Math.cos(dYaw);
  const sin = Math.sin(dYaw);
  player.position.x = x - (offX * cos + offZ * sin);
  player.position.z = z - (-offX * sin + offZ * cos);
}

/**
 * Snap-turn the rig by `deltaYaw` radians about the player's HEAD, so your
 * physical spot stays put and the world spins around you (rotating about
 * the rig origin would swing your head through an arc).
 */
export function snapTurn(player: XROrigin, deltaYaw: number): void {
  player.head.getWorldPosition(_head);
  const hx = _head.x;
  const hz = _head.z;
  player.rotation.y += deltaYaw;
  const offX = hx - player.position.x;
  const offZ = hz - player.position.z;
  const cos = Math.cos(deltaYaw);
  const sin = Math.sin(deltaYaw);
  player.position.x = hx - (offX * cos + offZ * sin);
  player.position.z = hz - (-offX * sin + offZ * cos);
}

function areaAt(x: number, z: number): FloorArea | null {
  for (const a of TELEPORT_AREAS) {
    if (x >= a.minX && x <= a.maxX && z >= a.minZ && z <= a.maxZ) return a;
  }
  return null;
}

/** Do segments AB and CD properly cross? (Collinear/endpoint touches don't
 *  count — grazing a doorway edge shouldn't block the hop.) */
function segmentsCross(
  ax: number, az: number, bx: number, bz: number,
  cx: number, cz: number, dx: number, dz: number,
): boolean {
  const o = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number): number =>
    (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
  const d1 = o(cx, cz, dx, dz, ax, az);
  const d2 = o(cx, cz, dx, dz, bx, bz);
  const d3 = o(ax, az, bx, bz, cx, cz);
  const d4 = o(ax, az, bx, bz, dx, dz);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Does the straight path (x0,z0)→(x1,z1) cross any solid wall? */
function crossesWall(x0: number, z0: number, x1: number, z1: number): boolean {
  return WALL_SEGMENTS.some(([ax, az, bx, bz]) => segmentsCross(x0, z0, x1, z1, ax, az, bx, bz));
}

export class ClubTeleportSystem extends createSystem({}) {
  private aimingHand: 'left' | 'right' | null = null;
  private arc!: Line2;
  private arcGeo!: LineGeometry;
  private arcMat!: LineMaterial;
  private arcBuf = new Array<number>(TELEPORT.arcPoints * 3).fill(0);
  private marker!: Group;
  private markerMat!: MeshBasicMaterial;
  private arrowMat!: MeshBasicMaterial;
  private landing = new Vector3();
  private landingArea: FloorArea | null = null;
  private landingYaw = 0;
  private valid = false;
  /** Snap turn fires once per flick: armed again after the stick recentres. */
  private snapArmed = true;
  private wasClub = false;

  init(): void {
    // Arc line — a fat world-unit ribbon in club brass (hazard-red when the
    // landing is refused), LineBasicMaterial ignores width so Line2 it is.
    this.arcGeo = new LineGeometry();
    this.arcGeo.setPositions(this.arcBuf);
    this.arcMat = new LineMaterial({
      color: DECOR.brass,
      linewidth: 0.014,
      worldUnits: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    this.arc = new Line2(this.arcGeo, this.arcMat);
    this.arc.frustumCulled = false;
    this.arc.visible = false;
    this.scene.add(this.arc);

    // Octagon landing marker — the dancer's platform silhouette, ghosted.
    this.markerMat = new MeshBasicMaterial({
      color: DECOR.brass,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    const slab = new Mesh(octagonSlab(OCTAGON_VERTICES, 0.012), this.markerMat);
    this.marker = new Group();
    this.marker.scale.setScalar(0.42); // a compact puck, not a full platform
    this.marker.add(slab);

    // The facing arrow inside it (points −z at yaw 0, like the camera).
    const shape = new Shape();
    shape.moveTo(0, 0.34);
    shape.lineTo(0.16, 0.06);
    shape.lineTo(0.06, 0.06);
    shape.lineTo(0.06, -0.26);
    shape.lineTo(-0.06, -0.26);
    shape.lineTo(-0.06, 0.06);
    shape.lineTo(-0.16, 0.06);
    shape.closePath();
    this.arrowMat = new MeshBasicMaterial({
      color: DECOR.brass,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    const arrow = new Mesh(new ShapeGeometry(shape), this.arrowMat);
    arrow.rotation.x = -Math.PI / 2;
    arrow.position.y = 0.03;
    this.marker.add(arrow);
    this.marker.visible = false;
    this.scene.add(this.marker);
  }

  update(): void {
    // Movement belongs to the SOCIAL place only: the club floor, which is
    // open while a room is (hosting/joined) on a menu screen. The foyer is
    // a front desk, and the raid is your real feet.
    const menuRoom = match.screen === 'lobby' || match.screen === 'map' || match.screen === 'tour';
    const inClub = menuRoom && (net.phase === 'hosting' || net.phase === 'joined');

    // Leaving the floor — a set booked it, or you left the room: re-plant
    // the rig at the spawn, facing the stage. The raid's law is "my
    // platform IS the world origin", and the foyer stands at the origin.
    if (!inClub) {
      if (this.wasClub) {
        this.wasClub = false;
        this.hide();
        teleportPlayer(this.player, CLUB.spawn.x, CLUB.spawn.z, 0, 0);
      }
      return;
    }
    this.wasClub = true;

    // Not mid-aim? An isolated sideways flick is a snap turn (forward/back
    // starts a teleport; sideways WHILE aiming steers facing, below).
    if (!this.aimingHand && this.trySnapTurn()) return;

    let axes: { x: number; y: number } | null = null;
    if (this.aimingHand) {
      const a = this.input.xr.gamepads[this.aimingHand]?.getAxesValues(InputComponent.Thumbstick);
      axes = a ?? null;
    } else {
      for (const hand of ['left', 'right'] as const) {
        const a = this.input.xr.gamepads[hand]?.getAxesValues(InputComponent.Thumbstick);
        if (a && Math.hypot(a.x, a.y) >= TELEPORT.engage && Math.abs(a.y) >= Math.abs(a.x)) {
          this.aimingHand = hand;
          axes = a;
          break;
        }
      }
    }

    if (!this.aimingHand || !axes) {
      this.hide();
      return;
    }

    const mag = Math.hypot(axes.x, axes.y);
    if (mag < TELEPORT.release) {
      // Stick sprung back — go (if the marker was on valid floor).
      if (this.valid) {
        teleportPlayer(this.player, this.landing.x, this.landing.z, this.landingYaw, this.landingArea?.y ?? 0);
        sfx.uiClick();
      }
      this.hide();
      return;
    }

    this.traceArc(axes);
  }

  private traceArc(axes: { x: number; y: number }): void {
    const ray = this.player.raySpaces[this.aimingHand!];
    ray.getWorldPosition(_origin);
    ray.getWorldQuaternion(_quat);
    _dir.set(0, 0, -1).applyQuaternion(_quat);

    // Ballistic arc from the controller. The club has two floor heights, so
    // the arc lands where it meets the AREA under it — probing the terrace
    // height first, then ground level.
    _p.copy(_origin);
    _v.copy(_dir).multiplyScalar(TELEPORT.launchSpeed);
    const buf = this.arcBuf;
    const put = (i: number): void => {
      buf[i * 3] = _p.x;
      buf[i * 3 + 1] = _p.y;
      buf[i * 3 + 2] = _p.z;
    };
    let landed = false;
    this.landingArea = null;
    for (let i = 0; i < TELEPORT.arcPoints; i++) {
      put(i);
      if (landed) continue;
      _v.y -= TELEPORT.gravity * TELEPORT.arcStep;
      _p.addScaledVector(_v, TELEPORT.arcStep);
      // Falling through a floor level that has an area under this (x,z)?
      const area = _v.y < 0 || _p.y <= 0 ? areaAt(_p.x, _p.z) : null;
      const floorY = area ? area.y : 0;
      if (_p.y <= floorY) {
        _p.y = floorY;
        landed = true;
        this.landing.copy(_p);
        this.landingArea = area;
        for (let j = i + 1; j < TELEPORT.arcPoints; j++) {
          buf[j * 3] = _p.x;
          buf[j * 3 + 1] = _p.y;
          buf[j * 3 + 2] = _p.z;
        }
        break;
      }
    }
    if (!landed) this.landing.copy(_p);
    this.arcGeo.setPositions(buf);

    // Valid only on real floor, with no wall between you and it.
    this.player.head.getWorldPosition(_head);
    this.valid =
      landed &&
      this.landingArea !== null &&
      !crossesWall(_head.x, _head.z, this.landing.x, this.landing.z);

    // Facing: thumbstick angle relative to where the controller points.
    const ctrlYaw = Math.atan2(-_dir.x, -_dir.z);
    const stickAngle = Math.atan2(axes.x, -axes.y); // 0 = pushed forward
    this.landingYaw = ctrlYaw - stickAngle;

    const colour = this.valid ? DECOR.brass : PALETTE.danger;
    this.markerMat.color.set(colour);
    this.arrowMat.color.set(colour);
    this.arcMat.color.set(colour);
    this.marker.position.set(this.landing.x, this.landing.y + 0.012, this.landing.z);
    this.marker.rotation.y = this.landingYaw;
    this.marker.visible = true;
    this.arc.visible = true;
  }

  /**
   * An isolated left/right flick of either stick yaws the rig by snapAngle.
   * One turn per flick: the stick must spring back below snapReset to
   * re-arm, so holding it sideways doesn't spin you.
   */
  private trySnapTurn(): boolean {
    let sx = 0;
    let sy = 0;
    let mag = 0;
    for (const hand of ['left', 'right'] as const) {
      const a = this.input.xr.gamepads[hand]?.getAxesValues(InputComponent.Thumbstick);
      if (!a) continue;
      const m = Math.hypot(a.x, a.y);
      if (m > mag) {
        mag = m;
        sx = a.x;
        sy = a.y;
      }
    }
    if (mag < TELEPORT.snapReset) {
      this.snapArmed = true;
      return false;
    }
    // A clear sideways flick past the threshold — turn the way it's pushed
    // (stick right yaws you right: a NEGATIVE rotation about +y).
    if (this.snapArmed && Math.abs(sx) >= TELEPORT.snapEngage && Math.abs(sx) > Math.abs(sy)) {
      this.snapArmed = false;
      snapTurn(this.player, sx > 0 ? -TELEPORT.snapAngle : TELEPORT.snapAngle);
      sfx.uiClick();
      return true;
    }
    return false;
  }

  private hide(): void {
    this.aimingHand = null;
    this.valid = false;
    this.arc.visible = false;
    this.marker.visible = false;
  }
}
