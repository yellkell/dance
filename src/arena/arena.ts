/**
 * The rave floor — a ring of octagonal dancer platforms around the
 * GOOPLIATH's centre stage, floating in your real room (passthrough is the
 * backdrop; we only bring the furniture and the light).
 *
 * Rendered ME-RELATIVE: my platform is always at the world origin on my real
 * floor, the stage is dead ahead at (0,0,−R), and everyone else's platforms
 * are placed by the ring transform. Rank lifts (RankSystem) raise the top
 * ten above the floor — RELATIVE to my own tier, so my real floor never has
 * to move: when I'm champion the whole ring sits below me, and when I'm out
 * the leaders tower overhead.
 */

import {
  AdditiveBlending,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointLight,
  RingGeometry,
  Scene,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import {
  OCTAGON_VERTICES,
  PALETTE,
  PLATFORM,
  RING,
  hueToColor,
  ringRadius,
  seatHue,
} from '../config.js';
import { seatLocal } from '../game/ring.js';
import { octagonSlab } from './octagon.js';

export interface PlatformHandle {
  seat: number;
  /** Move THIS for rank lifts — everything on the platform rides along. */
  root: Group;
  /** The neon rim material (beat pulse + elimination dim live here). */
  rimMat: MeshBasicMaterial;
  slabMat: MeshStandardMaterial;
  nameSprite: Sprite;
  /** Current eased lift (RankSystem's scratch). */
  lift: number;
}

export interface Arena {
  root: Group;
  platforms: PlatformHandle[];
  /** The stage podium root (boss stands on top). */
  stage: Group;
  stageRingMat: MeshBasicMaterial;
  /** Stage top surface height (boss feet). */
  stageTopY: number;
  dispose(): void;
}

let current: Arena | null = null;

export function arena(): Arena | null {
  return current;
}

function nameTexture(text: string, colorCss: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 512, 128);
  g.font = "900 64px 'Arial Black', system-ui, sans-serif";
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = colorCss;
  g.shadowBlur = 26;
  g.fillStyle = colorCss;
  g.fillText(text, 256, 64, 480);
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.font = "900 58px 'Arial Black', system-ui, sans-serif";
  g.fillText(text, 256, 64, 470);
  return new CanvasTexture(c);
}

function cssColor(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

function buildPlatform(seat: number, name: string, isMine: boolean): PlatformHandle {
  const root = new Group();
  root.name = `platform-${seat}`;

  const hue = seatHue(seat);
  const accent = hueToColor(hue, 0.6);

  // The slab: near-black glass so the neon owns it.
  const slabMat = new MeshStandardMaterial({
    color: 0x101318,
    metalness: 0.85,
    roughness: 0.35,
  });
  const slab = new Mesh(octagonSlab(OCTAGON_VERTICES, PLATFORM.thickness), slabMat);
  slab.position.y = -PLATFORM.thickness;
  root.add(slab);

  // Neon rim: the same octagon, a hair larger, as a glowing skirt.
  const rimMat = new MeshBasicMaterial({
    color: accent,
    transparent: true,
    opacity: 0.9,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
  const rim = new Mesh(octagonSlab(OCTAGON_VERTICES, 0.02), rimMat);
  rim.scale.set(1.035, 1, 1.045);
  rim.position.y = PLATFORM.rimLift;
  root.add(rim);

  // Floating name tag over the far rim (not for my own platform — I know).
  const nameSprite = new Sprite(
    new SpriteMaterial({
      map: nameTexture(name, cssColor(accent)),
      transparent: true,
      depthWrite: false,
    }),
  );
  nameSprite.scale.set(1.1, 0.28, 1);
  nameSprite.position.set(0, 2.05, 0);
  nameSprite.visible = !isMine;
  root.add(nameSprite);

  return { seat, root, rimMat, slabMat, nameSprite, lift: 0 };
}

function buildStage(): { stage: Group; ringMat: MeshBasicMaterial; topY: number } {
  const stage = new Group();
  stage.name = 'goop-stage';

  const podium = new Mesh(
    new CylinderGeometry(RING.stageRadius, RING.stageRadius * 1.06, RING.stageHeight, 28),
    new MeshStandardMaterial({ color: 0x0e1116, metalness: 0.9, roughness: 0.3 }),
  );
  podium.position.y = RING.stageHeight / 2;
  stage.add(podium);

  // The stage's neon ring — the whole rig's colour clock (DiscoSystem cycles it).
  const ringMat = new MeshBasicMaterial({
    color: PALETTE.magenta,
    transparent: true,
    opacity: 0.95,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
  const ring = new Mesh(new RingGeometry(RING.stageRadius * 0.94, RING.stageRadius * 1.05, 48), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = RING.stageHeight + 0.012;
  stage.add(ring);

  // Dancefloor tiles on the podium top: a faint checker that DiscoSystem pulses.
  const tiles = new Mesh(
    new CylinderGeometry(RING.stageRadius * 0.92, RING.stageRadius * 0.92, 0.01, 28),
    new MeshStandardMaterial({ color: 0x161a22, metalness: 0.6, roughness: 0.25, emissive: 0x0a0d14 }),
  );
  tiles.position.y = RING.stageHeight;
  stage.add(tiles);

  return { stage, ringMat, topY: RING.stageHeight };
}

/**
 * (Re)build the whole floor for a seat count. Call on entering the lobby and
 * whenever the roster's seat count changes.
 */
export function buildArena(scene: Scene, seats: number, mySeat: number, names: (seat: number) => string): Arena {
  current?.dispose();

  const root = new Group();
  root.name = 'rave-floor';

  // Passthrough brings no light — we bring the club's.
  const hemi = new HemisphereLight(0xbfd4ff, 0x0c0a14, 0.75);
  root.add(hemi);
  const stageLight = new PointLight(0xffffff, 1.4, 26, 1.6);
  stageLight.position.set(0, 3.2, -ringRadius(seats));
  root.add(stageLight);

  const platforms: PlatformHandle[] = [];
  const at = new Vector3();
  for (let seat = 0; seat < seats; seat++) {
    const handle = buildPlatform(seat, names(seat), seat === mySeat);
    const { yaw } = seatLocal(mySeat, seat, seats, at);
    handle.root.position.copy(at);
    handle.root.rotation.y = yaw;
    root.add(handle.root);
    platforms.push(handle);
  }

  const { stage, ringMat, topY } = buildStage();
  stage.position.set(0, 0, -ringRadius(seats));
  root.add(stage);

  scene.add(root);

  const built: Arena = {
    root,
    platforms,
    stage,
    stageRingMat: ringMat,
    stageTopY: topY,
    dispose() {
      root.removeFromParent();
      root.traverse((o) => {
        const m = o as Mesh;
        m.geometry?.dispose?.();
        const mat = m.material as MeshBasicMaterial | MeshBasicMaterial[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose?.();
      });
      if (current === built) current = null;
    },
  };
  current = built;
  return built;
}

/** The platform root for a seat (strike FX + telegraphs parent here). */
export function platformRoot(seat: number): Group | null {
  return current?.platforms.find((p) => p.seat === seat)?.root ?? null;
}
