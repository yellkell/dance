/**
 * THE VOID KIT — the abstract space language the game's bookends share.
 *
 * Deep Beat-Saber-background inspiration, adapted to a radial arena: vast
 * darkness given shape by LIGHT ONLY — towering pylons with emissive seams,
 * huge slow polygonal ring stacks, a glowing horizon band with no land
 * under it, drifting angular shards, and a floor that is mostly the
 * absence of one (a grid dissolving into fog). No walls, no materials that
 * pretend to be matter: everything is near-black gloss or pure emission.
 *
 * Used by the SET's environment (arena/environment.ts) and the FOYER
 * (club/build.ts) — the menu void and the game void are the same place at
 * different sizes; the club is the warm human room between them.
 */

import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  TorusGeometry,
} from 'three';

/** The void's own darkness (fog + backdrop). */
export const VOID_BG = 0x040309;

/* ── the grid floor: light where ground would be ────────────────────────── */

let _gridTex: CanvasTexture | null = null;
function gridTexture(): CanvasTexture {
  if (_gridTex) return _gridTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(255,255,255,1)';
  g.lineWidth = 2;
  g.strokeRect(0.5, 0.5, 256, 256);
  const tex = new CanvasTexture(c);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  _gridTex = tex;
  return tex;
}

export interface GridFloor {
  group: Group;
  mat: MeshBasicMaterial;
}

/**
 * A dark gloss disc with an additive grid dissolving outward — the ground
 * the void almost has. `cell` metres per grid square.
 */
export function buildGridFloor(radius: number, color: number, cell = 1.2, opacity = 0.16): GridFloor {
  const group = new Group();
  const disc = new Mesh(
    new CircleGeometry(radius, 48),
    new MeshStandardMaterial({ color: 0x08070d, metalness: 0.85, roughness: 0.35 }),
  );
  disc.rotation.x = -Math.PI / 2;
  group.add(disc);

  const tex = gridTexture().clone();
  tex.needsUpdate = true;
  tex.repeat.set((radius * 2) / cell, (radius * 2) / cell);
  const mat = new MeshBasicMaterial({
    map: tex,
    color,
    transparent: true,
    opacity,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const grid = new Mesh(new CircleGeometry(radius, 48), mat);
  grid.rotation.x = -Math.PI / 2;
  grid.position.y = 0.012;
  group.add(grid);
  return { group, mat };
}

/* ── pylons: the towers that pulse ──────────────────────────────────────── */

export interface Pylon {
  group: Group;
  /** The emissive seams + cap — drive emissiveIntensity to the beat. */
  glowMats: MeshStandardMaterial[];
}

/**
 * A monolith tower: near-black shaft, two full-height emissive seams, a
 * bright cap. Sized by `h`; base sits at y = 0.
 */
export function buildPylon(h: number, color: number, w = 0.9): Pylon {
  const group = new Group();
  const glowMats: MeshStandardMaterial[] = [];
  const shaft = new Mesh(
    new BoxGeometry(w, h, w * 0.62),
    new MeshStandardMaterial({ color: 0x0a0910, metalness: 0.7, roughness: 0.5 }),
  );
  shaft.position.y = h / 2;
  group.add(shaft);

  const seamMat = new MeshStandardMaterial({
    color: 0x0c0b12,
    emissive: color,
    emissiveIntensity: 1.1,
    metalness: 0.2,
    roughness: 0.5,
  });
  glowMats.push(seamMat);
  for (const side of [-1, 1]) {
    const seam = new Mesh(new BoxGeometry(w * 0.1, h * 0.94, 0.03), seamMat);
    seam.position.set(side * w * 0.28, h / 2, (w * 0.62) / 2 + 0.005);
    group.add(seam);
    const back = new Mesh(new BoxGeometry(w * 0.1, h * 0.94, 0.03), seamMat);
    back.position.set(side * w * 0.28, h / 2, -((w * 0.62) / 2 + 0.005));
    group.add(back);
  }
  const capMat = new MeshStandardMaterial({
    color: 0x0c0b12,
    emissive: color,
    emissiveIntensity: 1.6,
    metalness: 0.2,
    roughness: 0.4,
  });
  glowMats.push(capMat);
  const cap = new Mesh(new BoxGeometry(w * 1.04, 0.12, w * 0.66), capMat);
  cap.position.y = h + 0.06;
  group.add(cap);
  return { group, glowMats };
}

/* ── ring stacks: the huge slow geometry overhead ───────────────────────── */

export interface VoidRing {
  mesh: Mesh;
  mat: MeshStandardMaterial;
  speed: number;
}

/**
 * Big hexagonal rings (a low-side-count torus reads as machined geometry,
 * not jewellery) lying flat, stacked upward, counter-rotating. Centre at
 * the group origin; ring `i` sits at y0 + i·gap.
 */
export function buildRingStack(
  count: number,
  r0: number,
  rStep: number,
  y0: number,
  gap: number,
  color: number,
): { group: Group; rings: VoidRing[] } {
  const group = new Group();
  const rings: VoidRing[] = [];
  for (let i = 0; i < count; i++) {
    const mat = new MeshStandardMaterial({
      color: 0x0b0a11,
      emissive: color,
      emissiveIntensity: 0.9,
      metalness: 0.4,
      roughness: 0.45,
    });
    const mesh = new Mesh(new TorusGeometry(r0 + i * rStep, 0.07 + i * 0.012, 4, 6), mat);
    mesh.rotation.x = Math.PI / 2;
    mesh.rotation.z = (i * Math.PI) / 6;
    mesh.position.y = y0 + i * gap;
    group.add(mesh);
    rings.push({ mesh, mat, speed: (i % 2 ? -1 : 1) * (0.05 + i * 0.02) });
  }
  return { group, rings };
}

/* ── the horizon: a dawn with no land under it ──────────────────────────── */

let _horizonTex: CanvasTexture | null = null;
function horizonTexture(): CanvasTexture {
  if (_horizonTex) return _horizonTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 256, 0, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.28)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.07)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 256);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  _horizonTex = tex;
  return tex;
}

/**
 * A giant open cylinder faced inward, carrying a vertical glow gradient —
 * the void's horizon line, 360°. Tint via `color`.
 */
export function buildHorizon(radius: number, height: number, color: number, opacity = 0.5): { mesh: Mesh; mat: MeshBasicMaterial } {
  const mat = new MeshBasicMaterial({
    map: horizonTexture(),
    color,
    transparent: true,
    opacity,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
  const mesh = new Mesh(new CylinderGeometry(radius, radius, height, 48, 1, true), mat);
  mesh.position.y = height / 2 - 0.5;
  return { mesh, mat };
}

/* ── shards: the drifting debris of the void ────────────────────────────── */

export interface Shard {
  mesh: Mesh;
  baseY: number;
  spin: number;
  bob: number;
  phase: number;
}

/** Angular octahedron shards, stretched long, scattered on a ring band
 *  between rMin..rMax, drifting and slowly turning. */
export function buildShards(
  count: number,
  rMin: number,
  rMax: number,
  yMin: number,
  yMax: number,
  color: number,
  seed = 7,
): { group: Group; shards: Shard[]; mat: MeshStandardMaterial } {
  const group = new Group();
  const shards: Shard[] = [];
  const mat = new MeshStandardMaterial({
    color: 0x0d0c14,
    emissive: color,
    emissiveIntensity: 0.5,
    metalness: 0.6,
    roughness: 0.4,
    flatShading: true,
  });
  let s = seed >>> 0;
  const rnd = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2;
    const r = rMin + rnd() * (rMax - rMin);
    const y = yMin + rnd() * (yMax - yMin);
    const mesh = new Mesh(new OctahedronGeometry(0.4 + rnd() * 0.8, 0), mat);
    mesh.scale.set(0.35 + rnd() * 0.3, 1.6 + rnd() * 1.8, 0.35 + rnd() * 0.3);
    mesh.position.set(Math.sin(a) * r, y, Math.cos(a) * r);
    mesh.rotation.set(rnd() * Math.PI, rnd() * Math.PI, rnd() * Math.PI);
    group.add(mesh);
    shards.push({ mesh, baseY: y, spin: (rnd() - 0.5) * 0.3, bob: 0.2 + rnd() * 0.5, phase: rnd() * Math.PI * 2 });
  }
  return { group, shards, mat };
}
