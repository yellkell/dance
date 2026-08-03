/**
 * GOOPLIATH: DANCE RAID — entry point.
 *
 * Boots an IWSDK World with a WebXR passthrough (immersive-AR) session: the
 * platform ring, the centre stage, the mirror ball and the giant dancing gel
 * creature all land in your real room. If the device can't do AR, IWSDK
 * falls back to VR.
 *
 * `npm run dev` and open the page: a headset offers ENTER THE RAVE; on
 * desktop the IWSDK dev plugin provides a WebXR emulator (WASD + mouse).
 * For online rooms also run `npm run server`.
 */

import { launchXR, SessionMode, World } from '@iwsdk/core';
import { ensureAudio } from './audio/sfx.js';
import { ArenaSystem } from './systems/ArenaSystem.js';
import { AvatarSystem } from './systems/AvatarSystem.js';
import { ChoreoSystem } from './systems/ChoreoSystem.js';
import { DiscoSystem } from './systems/DiscoSystem.js';
import { GoopliathSystem } from './systems/GoopliathSystem.js';
import { HudSystem } from './systems/HudSystem.js';
import { MenuSystem } from './systems/MenuSystem.js';
import { MusicSystem } from './systems/MusicSystem.js';
import { NetworkSystem } from './systems/NetworkSystem.js';
import { PlayerSystem } from './systems/PlayerSystem.js';
import { RankSystem } from './systems/RankSystem.js';

const container = document.getElementById('scene-container') as HTMLDivElement;
const enterButton = document.getElementById('enter-vr') as HTMLButtonElement | null;

enterButton?.setAttribute('disabled', '');

function hideLanding(): void {
  document.body.classList.add('app-entered');
}

function showLanding(): void {
  document.body.classList.remove('app-entered');
  enterButton?.removeAttribute('disabled');
}

World.create(container, {
  // The landing button calls IWSDK's explicit WebXR launcher from the user's
  // tap. Quest Browser needs that direct requestSession gesture path.
  xr: {
    sessionMode: SessionMode.ImmersiveAR,
    offer: 'none',
  },
  // A stationary dodge game: you never leave your platform, and nothing is
  // grabbed — your body IS the controller.
  features: {
    grabbing: false,
    locomotion: false,
    spatialUI: false,
  },
  render: {
    // Passthrough is the backdrop; we bring only the furniture and the light.
    defaultLighting: false,
    far: 120,
    camera: { position: [0, 1.65, 0] },
  },
}).then(async (world) => {
  // Order matters lightly: player pose first, then the floor, then everything
  // that reads both. Music owns the clock; choreo owns the judgement.
  world.registerSystem(PlayerSystem);
  world.registerSystem(ArenaSystem);
  world.registerSystem(MusicSystem);
  world.registerSystem(ChoreoSystem);
  world.registerSystem(GoopliathSystem);
  world.registerSystem(AvatarSystem);
  world.registerSystem(RankSystem);
  world.registerSystem(DiscoSystem);
  world.registerSystem(HudSystem);
  world.registerSystem(MenuSystem);
  world.registerSystem(NetworkSystem);

  const xrSupported =
    (await navigator.xr?.isSessionSupported(SessionMode.ImmersiveAR).catch(() => false)) === true;

  if (enterButton && xrSupported) {
    enterButton.removeAttribute('disabled');
    enterButton.addEventListener('click', () => {
      enterButton.setAttribute('disabled', '');
      ensureAudio(); // unlock the AudioContext inside the tap gesture
      launchXR(world, { sessionMode: SessionMode.ImmersiveAR });

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
  console.info('[DANCE RAID] World ready — the floor is set, the goop is warm.');
});

// Dev/debug hook: drive the flow from the console (or a headless test)
// without controllers — e.g. __gdr.startRaid({ seats: 8 }).
import { startRaid, startTutorial, toLobby, toMap } from './game/flow.js';
import { match } from './game/state.js';

declare global {
  interface Window {
    __gdr?: {
      startRaid: typeof startRaid;
      startTutorial: typeof startTutorial;
      toLobby: typeof toLobby;
      toMap: typeof toMap;
      match: typeof match;
    };
  }
}
window.__gdr = { startRaid, startTutorial, toLobby, toMap, match };
