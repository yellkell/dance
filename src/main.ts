/**
 * RAVE RAID — entry point.
 *
 * Boots an IWSDK World as a FULL VR (immersive-VR) session. Nothing here is
 * halfway anymore: the foyer is a platform in the void, the club is a sealed
 * hall, and the set plays inside the void environment — your real floor is
 * still the platform you dodge on (roomscale reference space keeps y = 0 at
 * your actual floor), but your room itself is never shown.
 *
 * `npm run dev` and open the page: a headset offers ENTER THE RAVE; on
 * desktop the IWSDK dev plugin provides a WebXR emulator (WASD + mouse).
 * For online rooms also run `npm run server`.
 */

import { launchXR, SessionMode, World } from '@iwsdk/core';
import { Color } from 'three';
import { ensureAudio } from './audio/sfx.js';
import { VOID_BG } from './arena/voidkit.js';
import { ArcadeSystem } from './systems/ArcadeSystem.js';
import { ArenaSystem } from './systems/ArenaSystem.js';
import { AvatarSystem } from './systems/AvatarSystem.js';
import { ChoreoSystem } from './systems/ChoreoSystem.js';
import { ClubBallSystem } from './systems/ClubBallSystem.js';
import { ClubMirrorSystem } from './systems/ClubMirrorSystem.js';
import { ClubPropsSystem } from './systems/ClubPropsSystem.js';
import { ClubSocialSystem } from './systems/ClubSocialSystem.js';
import { ClubSystem } from './systems/ClubSystem.js';
import { ClubTeleportSystem } from './systems/ClubTeleportSystem.js';
import { CourseFrameSystem } from './systems/CourseFrameSystem.js';
import { CoursePlatformSystem } from './systems/CoursePlatformSystem.js';
import { CourseSystem } from './systems/CourseSystem.js';
import { CourseVoidSystem } from './systems/CourseVoidSystem.js';
import { CourseWayfindSystem } from './systems/CourseWayfindSystem.js';
import { DiscoSystem } from './systems/DiscoSystem.js';
import { GoopliathSystem } from './systems/GoopliathSystem.js';
import { HudSystem } from './systems/HudSystem.js';
import { IntroSystem, introView } from './systems/IntroSystem.js';
import { McSystem } from './systems/McSystem.js';
import { MenuSystem } from './systems/MenuSystem.js';
import { MusicSystem } from './systems/MusicSystem.js';
import { NetworkSystem } from './systems/NetworkSystem.js';
import { PlayerSystem } from './systems/PlayerSystem.js';
import { RankSystem } from './systems/RankSystem.js';

const container = document.getElementById('scene-container') as HTMLDivElement;
const enterButton = document.getElementById('enter-vr') as HTMLButtonElement | null;

/** The created world, for the debug hook below (set once boot resolves). */
let worldRef: World | null = null;

enterButton?.setAttribute('disabled', '');

function hideLanding(): void {
  document.body.classList.add('app-entered');
  // House lights down: the title card plays on the inside of the headset,
  // cued by the same moment the web page gets out of the way.
  introView.begin?.();
}

function showLanding(): void {
  document.body.classList.remove('app-entered');
  enterButton?.removeAttribute('disabled');
}

World.create(container, {
  // The landing button calls IWSDK's explicit WebXR launcher from the user's
  // tap. Quest Browser needs that direct requestSession gesture path.
  xr: {
    sessionMode: SessionMode.ImmersiveVR,
    offer: 'none',
  },
  // A stationary dodge game: you never leave your platform, and nothing is
  // grabbed — your body IS the controller. (The club's teleport is our own.)
  features: {
    grabbing: false,
    locomotion: false,
    spatialUI: false,
  },
  render: {
    // The void is the backdrop, everywhere and always.
    defaultLighting: false,
    far: 160,
    camera: { position: [0, 1.65, 0] },
  },
}).then(async (world) => {
  worldRef = world;
  // FULL VR: an opaque backdrop behind every place. The club's walls stand
  // in front of it; the foyer and the set live inside it.
  world.scene.background = new Color(VOID_BG);
  // Order matters lightly: player pose first, then the floor, then everything
  // that reads both. Music owns the clock; choreo owns the judgement.
  world.registerSystem(PlayerSystem);
  world.registerSystem(ArenaSystem);
  // The venue's places (foyer void + the club), teleport-only movement,
  // the social floor (room-mates, voice, mute/block), and the raid-calling
  // ball. The teleport system runs before the network pumps so the rig is
  // already re-planted at the spawn on the frame a set books the floor.
  world.registerSystem(ClubSystem);
  world.registerSystem(ClubTeleportSystem);
  // THE WEST DOOR and what's behind it. Registered AFTER the teleport so
  // that on the frame the crossing happens the course's frame of reference
  // has the last word on the rig — the teleport drops every club offset on
  // its way out, and the circuit plants the rig where the pad is.
  world.registerSystem(CourseSystem);
  world.registerSystem(CoursePlatformSystem);
  world.registerSystem(CourseFrameSystem);
  world.registerSystem(CourseWayfindSystem);
  world.registerSystem(CourseVoidSystem);
  world.registerSystem(ClubSocialSystem);
  world.registerSystem(ClubMirrorSystem);
  world.registerSystem(ClubBallSystem);
  world.registerSystem(ArcadeSystem);
  world.registerSystem(ClubPropsSystem);
  world.registerSystem(MusicSystem);
  world.registerSystem(ChoreoSystem);
  world.registerSystem(GoopliathSystem);
  world.registerSystem(McSystem);
  world.registerSystem(AvatarSystem);
  world.registerSystem(RankSystem);
  world.registerSystem(DiscoSystem);
  world.registerSystem(HudSystem);
  world.registerSystem(MenuSystem);
  world.registerSystem(NetworkSystem);
  // Last, so its blackout is built after everything it covers.
  world.registerSystem(IntroSystem);

  const xrSupported =
    (await navigator.xr?.isSessionSupported(SessionMode.ImmersiveVR).catch(() => false)) === true;

  if (enterButton && xrSupported) {
    enterButton.removeAttribute('disabled');
    enterButton.addEventListener('click', () => {
      enterButton.setAttribute('disabled', '');
      ensureAudio(); // unlock the AudioContext inside the tap gesture
      launchXR(world, { sessionMode: SessionMode.ImmersiveVR });

      const watchForSession = (): void => {
        if (world.session) {
          hideLanding();
          world.session.addEventListener('end', showLanding, { once: true });
          return;
        }
        if (!document.body.classList.contains('app-entered')) {
          requestAnimationFrame(watchForSession);
        }
      };
      requestAnimationFrame(watchForSession);
      window.setTimeout(() => {
        if (!world.session) enterButton.removeAttribute('disabled');
      }, 4000);
    });
  } else if (enterButton) {
    enterButton.textContent = 'XR unavailable';
  }

  // eslint-disable-next-line no-console
  console.info('[RAVE RAID] World ready — the floor is set, the goop is warm.');
});

// Dev/debug hook: drive the flow from the console (or a headless test)
// without controllers — e.g. __gdr.startRaid({ seats: 8 }), or walk the
// club with __gdr.net.host() + __gdr.rig(x, z, yaw).
import { finishRaid, startRaid, toLobby, toTour } from './game/flow.js';
import { ambientMuted, ambientTrackId } from './audio/music.js';
import { mutedSpeakerIds } from './club/voice.js';
import { match } from './game/state.js';
import { arena } from './arena/arena.js';
import { choreoView } from './systems/ChoreoSystem.js';
import { menuView } from './systems/MenuSystem.js';
import { socialView } from './systems/ClubSocialSystem.js';
import { propsView } from './systems/ClubPropsSystem.js';
import { teleportView } from './systems/ClubTeleportSystem.js';
import { courseView } from './systems/CourseSystem.js';
import { grooveView } from './systems/PlayerSystem.js';
import {
  callBall,
  cancelBall,
  hostRoom,
  joinBall,
  joinRoom,
  leaveRoom,
  net,
  setDancerHue,
  setDancerName,
  startBall,
} from './net/session.js';
import { clubPoses } from './net/poses.js';

declare global {
  interface Window {
    __gdr?: {
      startRaid: typeof startRaid;
      toLobby: typeof toLobby;
      toTour: typeof toTour;
      /** Drop the needle early: jump a live set straight to its grade. */
      endSet: typeof finishRaid;
      /** Draw calls / triangles this frame — the scenery's budget check. */
      info: () => { calls: number; triangles: number } | null;
      match: typeof match;
      arena: typeof arena;
      choreo: typeof choreoView;
      /** Fire a glowstick sparkle burst (heat 0..1) for tuning. */
      sparkle: (heat?: number) => void;
      /** What the controller models are doing (see grooveView.controllers). */
      pads: () => ReturnType<NonNullable<typeof grooveView.controllers>>;
      /** The live controller visual adapters — the only handle on the
       *  hide-for-a-song path off-device. */
      padAdapters: () => ReturnType<NonNullable<typeof grooveView.padAdapters>>;
      net: {
        host: typeof hostRoom;
        join: typeof joinRoom;
        leave: typeof leaveRoom;
        setName: typeof setDancerName;
        /** Repaint this headset — pushes to a room already standing. */
        setHue: typeof setDancerHue;
        state: typeof net;
        poses: typeof clubPoses;
      };
      /** THE BALL, drivable headlessly: call one, touch in, call it off. */
      club: { call: typeof callBall; touch: typeof joinBall; cancel: typeof cancelBall; go: typeof startBall };
      /** THE DRINKS: read the pool, or launch a glass on a known arc. */
      props: typeof propsView;
      /** The menus, drivable headlessly: board mode/hover, the pause card,
       *  the SOCIAL panel — the style-iteration hooks. */
      menu: typeof menuView & typeof socialView;
      /** Park the player rig at (x, z) facing `yaw` — headless club walks.
       *  `pitch`/`roll` tip the rig (and so the head that rides it) the way
       *  a neck would, for probing what the room sees of your head. */
      rig: (x: number, z: number, yaw?: number, y?: number, pitch?: number, roll?: number) => void;
      /** The live scene graph — headless probes walk it by name. */
      scene: () => import('three').Scene | null;
      /** The title card, for captures that need to know where the show is. */
      intro: typeof introView;
      /** Voice speakers currently gated off (mute, block, or wrong room). */
      mutedVoices: typeof mutedSpeakerIds;
      /** Which record the room is spinning right now, by track id. */
      ambient: typeof ambientTrackId;
      /** Is this headset listening to it? (The floor's MUSIC switch — the
       *  record keeps spinning either way.) */
      ambientMuted: typeof ambientMuted;
      /** The club moves that resolve without an arc (step back, snap turn). */
      move: typeof teleportView;
      /** THE STEP: cross into the course and back without a doorway, and
       *  read the ride's ledger (tracked platform, laps, slips, handovers). */
      course: typeof courseView;
    };
  }
}
window.__gdr = {
  startRaid,
  toLobby,
  toTour,
  endSet: finishRaid,
  info: () => {
    const r = (worldRef as unknown as { renderer?: { info: { render: { calls: number; triangles: number } } } } | null)
      ?.renderer;
    return r ? { calls: r.info.render.calls, triangles: r.info.render.triangles } : null;
  },
  match,
  arena,
  choreo: choreoView,
  sparkle: (heat = 1) => grooveView.burst?.(heat),
  pads: () => grooveView.controllers?.() ?? [],
  padAdapters: () => grooveView.padAdapters?.() ?? null,
  net: {
    host: hostRoom,
    join: joinRoom,
    leave: leaveRoom,
    setName: setDancerName,
    setHue: setDancerHue,
    state: net,
    poses: clubPoses,
  },
  club: { call: callBall, touch: joinBall, cancel: cancelBall, go: startBall },
  intro: introView,
  mutedVoices: mutedSpeakerIds,
  ambient: ambientTrackId,
  ambientMuted,
  move: teleportView,
  course: courseView,
  props: propsView,
  menu: new Proxy({} as typeof menuView & typeof socialView, {
    // The views are populated in each system's init — resolve lazily.
    get: (_t, key) =>
      (menuView as Record<string | symbol, unknown>)[key] ??
      (socialView as Record<string | symbol, unknown>)[key],
  }),
  rig: (x, z, yaw = 0, y = 0, pitch = 0, roll = 0) => {
    const w = worldRef;
    if (!w) return;
    w.player.position.set(x, y, z);
    // Same order the pose pumps decode in, so what you set is what the
    // room reads back.
    w.player.rotation.order = 'YXZ';
    w.player.rotation.set(pitch, yaw, roll);
  },
  scene: () =>
    (worldRef as unknown as { scene?: import('three').Scene } | null)?.scene ?? null,
};
