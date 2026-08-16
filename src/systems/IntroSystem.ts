/**
 * IntroSystem — the house lights going down.
 *
 * The first thing inside the headset, before the foyer: black, then
 * "yellkell.com presents…", then the marquee — RAVE in goo-green, RAID in
 * hot magenta, the same two-colour split the landing page wears — and then
 * the black lifts and you are standing in the void with the board in front
 * of you. The 2D door and the VR door now open on the same title.
 *
 * It waits to be CUED. Systems start ticking the moment the world is
 * created — while the player is still looking at a web page deciding
 * whether to press the button — so main.ts rings it from the same place it
 * hides the landing. (Waiting on `world.session` looked equivalent and is
 * not: the emulator has a session from boot, so the show played to an
 * empty room and the real player walked in on the last two seconds.)
 *
 * Comfort: the blackout is a sphere pinned to the head, so it covers the
 * whole field however you turn, but the TEXT only follows your yaw, lazily,
 * and never pitches or rolls. Type welded to your face is the fastest way
 * to make somebody take a headset off. Any button skips to the fade.
 *
 * It builds on first use and disposes itself the moment it is finished —
 * this costs nothing for the rest of the session.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import {
  BackSide,
  CanvasTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { font, onFontsReady } from '../ui/fonts.js';

/* The running order, in seconds. */
const PRESENTS_IN = 0.5;
const PRESENTS_OUT = 2.5;
const TITLE_IN = 3.0;
const TITLE_HOLD_TO = 6.2;
const LIFT_TO = 7.4; // black gone, foyer revealed

/** main.ts rings this when the player goes through the door; the second
 *  hook is for headless captures, which need to know where the show is. */
export const introView: { begin?: () => void; at?: () => number } = {};

const _cam = new Vector3();
const _camQ = new Quaternion();
const _fwd = new Vector3();

/** Ease a 0→1 ramp so nothing snaps on or off. */
const ramp = (t: number, from: number, to: number): number =>
  Math.max(0, Math.min(1, (t - from) / (to - from)));
const smooth = (x: number): number => x * x * (3 - 2 * x);

/** A canvas panel sized in world metres, drawn once (and re-inked when the
 *  house fonts land — the intro plays long before the woff2s are certain). */
function cardMesh(
  w: number,
  h: number,
  px: number,
  draw: (g: CanvasRenderingContext2D, W: number, H: number) => void,
): Mesh<PlaneGeometry, MeshBasicMaterial> {
  const c = document.createElement('canvas');
  c.width = px;
  c.height = Math.round((px * h) / w);
  const g = c.getContext('2d')!;
  draw(g, c.width, c.height);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  onFontsReady(() => {
    g.clearRect(0, 0, c.width, c.height);
    draw(g, c.width, c.height);
    tex.needsUpdate = true;
  });
  const mesh = new Mesh(
    new PlaneGeometry(w, h),
    new MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, opacity: 0 }),
  );
  mesh.renderOrder = 9001;
  return mesh;
}

export class IntroSystem extends createSystem({}) {
  private rig: Group | null = null;
  private black!: MeshBasicMaterial;
  private presents!: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private title!: Mesh<PlaneGeometry, MeshBasicMaterial>;
  /** Wall-clock start (ms). The show is timed off the CLOCK, not off
   *  accumulated frame deltas: a title card is a piece of theatre with a
   *  fixed running time, and it should not run fast on a machine dropping
   *  frames or slow on one that isn't. */
  private startedAt = 0;
  private cued = false;
  private done = false;
  /** Lazy-follow yaw for the text (radians). NaN until the first frame. */
  private yaw = NaN;

  init(): void {
    introView.begin = () => {
      if (!this.done) this.cued = true;
    };
    introView.at = () => (this.startedAt ? (performance.now() - this.startedAt) / 1000 : -1);
  }

  private build(): void {
    const rig = new Group();
    rig.name = 'live-intro';

    // The blackout: a sphere around the head, no depth test, drawn last.
    this.black = new MeshBasicMaterial({
      color: 0x000000,
      side: BackSide,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      opacity: 1,
    });
    const dome = new Mesh(new SphereGeometry(6, 20, 14), this.black);
    dome.renderOrder = 9000;
    rig.add(dome);

    this.presents = cardMesh(1.9, 0.5, 900, (g, W, H) => {
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = font(500, 60);
      g.letterSpacing = '10px';
      g.fillStyle = 'rgba(228,224,240,0.9)';
      g.shadowColor = 'rgba(160,150,200,0.5)';
      g.shadowBlur = 18;
      g.fillText('yellkell.com  presents…', W / 2, H / 2);
      g.shadowBlur = 0;
    });
    this.presents.renderOrder = 9002; // over the title card they share space with
    this.presents.position.set(0, 0, -2.4);
    rig.add(this.presents);

    // The marquee, the landing page's own recipe: each word gets chromatic
    // ghosts either side and a bloom of its own colour.
    this.title = cardMesh(2.6, 1.5, 1300, (g, W, H) => {
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const word = (text: string, y: number, face: string, glow: string, l: string, r: string) => {
        g.font = font(700, 290);
        g.letterSpacing = '10px';
        g.fillStyle = l;
        g.fillText(text, W / 2 - 14, y);
        g.fillStyle = r;
        g.fillText(text, W / 2 + 14, y);
        g.shadowColor = glow;
        g.shadowBlur = 46;
        g.fillStyle = face;
        g.fillText(text, W / 2, y);
        g.shadowBlur = 24;
        g.fillText(text, W / 2, y);
        g.shadowBlur = 0;
      };
      word('RAVE', H * 0.29, '#b9ffc4', 'rgba(54,224,90,0.95)', 'rgba(255,42,213,0.55)', 'rgba(79,183,255,0.45)');
      word('RAID', H * 0.74, '#ffd9f6', 'rgba(255,42,213,0.95)', 'rgba(54,224,90,0.5)', 'rgba(176,107,255,0.5)');
    });
    this.title.position.set(0, 0.06, -2.4);
    rig.add(this.title);

    this.scene.add(rig);
    this.rig = rig;
  }

  private finish(): void {
    this.done = true;
    const rig = this.rig;
    if (!rig) return;
    rig.removeFromParent();
    rig.traverse((o) => {
      const m = (o as Mesh).material as MeshBasicMaterial | undefined;
      m?.map?.dispose();
      m?.dispose();
      (o as Mesh).geometry?.dispose();
    });
    this.rig = null;
  }

  update(delta: number): void {
    if (this.done) return;

    // Wait for the cue. Until then this system is a no-op.
    if (!this.startedAt) {
      if (!this.cued) return;
      this.build();
      this.startedAt = performance.now();
    }
    const rig = this.rig;
    if (!rig) return;
    const t = (performance.now() - this.startedAt) / 1000;

    // Any button cuts to the lift — nobody should have to sit through a
    // title card twice.
    const pads = this.input.xr.gamepads;
    const pressed = (['left', 'right'] as const).some((h) =>
      [InputComponent.Trigger, InputComponent.A_Button, InputComponent.X_Button].some((b) =>
        pads[h]?.getButtonDown(b),
      ),
    );
    // Skip: shove the start back so the clock lands on the lift.
    if (pressed && t < TITLE_HOLD_TO) this.startedAt -= (TITLE_HOLD_TO - t) * 1000;

    // Pin to the head; let the text follow the yaw a beat behind, level.
    this.camera.getWorldPosition(_cam);
    this.camera.getWorldQuaternion(_camQ);
    rig.position.copy(_cam);
    _fwd.set(0, 0, -1).applyQuaternion(_camQ);
    const want = Math.atan2(-_fwd.x, -_fwd.z);
    if (Number.isNaN(this.yaw)) this.yaw = want;
    else {
      // Shortest way round, then a soft chase.
      let d = want - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * Math.min(1, delta * 2.2);
    }
    rig.rotation.y = this.yaw;

    // The running order.
    this.presents.material.opacity =
      smooth(ramp(t, PRESENTS_IN, PRESENTS_IN + 0.7)) * (1 - smooth(ramp(t, PRESENTS_OUT, PRESENTS_OUT + 0.5)));
    const titleUp = smooth(ramp(t, TITLE_IN, TITLE_IN + 0.8));
    const lift = smooth(ramp(t, TITLE_HOLD_TO, LIFT_TO));
    this.title.material.opacity = titleUp * (1 - lift);
    // The marquee swells a touch as it lands, then settles.
    const swell = 1 + 0.06 * (1 - smooth(ramp(t, TITLE_IN, TITLE_IN + 1.4)));
    this.title.scale.setScalar(swell);
    this.black.opacity = 1 - lift;

    if (t >= LIFT_TO) this.finish();
  }
}
