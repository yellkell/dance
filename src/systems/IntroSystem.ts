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
import { match } from '../game/state.js';
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

/** THE THROB — the landing page's own keyframes (0% → 6% swell, 6% → 12%
 *  dip, then a slow settle), one cycle every two bars at 128 BPM. RAVE and
 *  RAID run it half a beat apart, so the two words trade the kick exactly
 *  as they do on the web page. */
const THROB_PERIOD = 1.875;
const THROB_OFFSET = 0.234;
function throb(t: number): number {
  const f = (((t / THROB_PERIOD) % 1) + 1) % 1;
  if (f < 0.06) return 1 + 0.045 * (f / 0.06);
  if (f < 0.12) return 1.045 - 0.055 * ((f - 0.06) / 0.06);
  return 0.99 + 0.01 * Math.min(1, (f - 0.12) / 0.16);
}

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
  /** RAVE and RAID are separate cards so each can throb on its own beat —
   *  one mesh could only ever pulse as a block. */
  private words!: Mesh<PlaneGeometry, MeshBasicMaterial>[];
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

    // THE MARQUEE, the landing page's own recipe: chromatic ghosts either
    // side of each word and a stack of blooms in its own colour, so the
    // type reads as LIT rather than as coloured letters. A card per word,
    // half the height each, and generous margins for the glow to spill
    // into — bloom clipped by its own texture edge looks like a box.
    const mkWord = (text: string, face: string, glow: string, l: string, r: string) =>
      cardMesh(3.5, 1.25, 1400, (g, W, H) => {
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.font = font(700, 300);
        g.letterSpacing = '12px';
        g.fillStyle = l;
        g.fillText(text, W / 2 - 15, H / 2);
        g.fillStyle = r;
        g.fillText(text, W / 2 + 15, H / 2);
        // Three passes, wide to tight: the outer haze, the halo, the core.
        g.shadowColor = glow;
        g.fillStyle = face;
        for (const blur of [90, 46, 20]) {
          g.shadowBlur = blur;
          g.fillText(text, W / 2, H / 2);
        }
        g.shadowBlur = 0;
      });
    this.words = [
      mkWord('RAVE', '#b9ffc4', 'rgba(54,224,90,0.95)', 'rgba(255,42,213,0.6)', 'rgba(79,183,255,0.5)'),
      mkWord('RAID', '#ffd9f6', 'rgba(255,42,213,0.95)', 'rgba(54,224,90,0.55)', 'rgba(176,107,255,0.55)'),
    ];
    this.words[0].position.set(0, 0.52, -2.9);
    this.words[1].position.set(0, -0.46, -2.9);
    for (const w of this.words) rig.add(w);

    this.scene.add(rig);
    this.rig = rig;
    match.introUp = true; // the board underneath is off limits until the lift
  }

  private finish(): void {
    this.done = true;
    match.introUp = false;
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
    // Hand the menu back the instant the black begins to go.
    if (lift > 0) match.introUp = false;
    // It arrives big and settles — a marquee dropping into place.
    const land = 1 + 0.1 * (1 - smooth(ramp(t, TITLE_IN, TITLE_IN + 1.4)));
    this.words.forEach((w, i) => {
      const phase = t - i * THROB_OFFSET;
      // The KICK is a punch every bar and then stillness — faithful to the
      // landing page, but on its own it leaves the marquee sitting dead for
      // a second and a third at a time. A slow breath underneath keeps the
      // sign alive between the hits, the way real neon never quite settles.
      const breath = Math.sin(phase * 1.9 + i * 1.1);
      w.material.opacity = titleUp * (1 - lift);
      w.scale.setScalar(land * throb(phase) * (1 + 0.012 * breath));
      // The tint multiplies the canvas, so the whole word brightens rather
      // than just growing. Over 1 blows the bloom out hot — that's the kick.
      const beat = Math.max(0, (throb(phase) - 0.99) / 0.055);
      w.material.color.setScalar(1 + 0.3 * beat + 0.1 * breath);
    });
    this.black.opacity = 1 - lift;

    if (t >= LIFT_TO) this.finish();
  }
}
