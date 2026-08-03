/**
 * Remote pose store — the last head/hands sample per seat, in that seat's
 * own platform-local frame (which is exactly the space their avatar rig is
 * parented in, so AvatarSystem consumes these without any transform).
 */

export interface RemotePose {
  hx: number;
  hy: number;
  hz: number;
  /** Head yaw only — full quats are overkill for a rave silhouette. */
  hyaw: number;
  lx: number;
  ly: number;
  lz: number;
  rx: number;
  ry: number;
  rz: number;
  /** Wall-clock ms of arrival (stale poses freeze rather than glide). */
  t: number;
}

export const remotePoses = new Map<number, RemotePose>();

export function clearRemotePoses(): void {
  remotePoses.clear();
}
