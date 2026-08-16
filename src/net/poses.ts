/**
 * Remote pose store — the last head/hands sample per seat, in that seat's
 * own platform-local frame (which is exactly the space their avatar rig is
 * parented in, so AvatarSystem consumes these without any transform).
 */

export interface RemotePose {
  hx: number;
  hy: number;
  hz: number;
  /** Head yaw, pitch and roll. Yaw alone was enough while everyone was a
   *  silhouette across a ring; on the club floor, standing close enough to
   *  talk, a head that can only swivel left and right is unmistakably a
   *  puppet. Nodding, looking up at the decks, glancing down at a drink —
   *  that is most of what a face does in a conversation. */
  hyaw: number;
  hpitch: number;
  hroll: number;
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

/**
 * CLUB poses — the same wire shape, different space and key: while a room
 * hangs out in the club (before/after a set) every member streams
 * head + hands in club WORLD space, keyed by their relay member idx (seats
 * don't exist yet). ClubSocialSystem embodies these.
 */
export const clubPoses = new Map<number, RemotePose>();

export function clearClubPoses(): void {
  clubPoses.clear();
}
