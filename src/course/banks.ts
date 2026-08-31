/**
 * The course's instancing kit: everything repeated is an InstancedMesh,
 * every animated glow is per-instance colour, and the reflection is a
 * flipped clone that RE-SHARES the source's live buffers — one extra draw
 * per bank, no second camera, no render target, no resolve (research/02 §3;
 * the club's own mirror trick, borrowed for ground that moves).
 *
 * The venue's GlowBank (arena/voidkit) is the static-placement cousin: it
 * parks its instances once and only ever re-tints them. The circuit's decks
 * MOVE every frame, so this bank keeps a write cursor and rewrites matrices
 * as freely as colours.
 */

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Material,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from 'three';

/** A unit box with lighting baked into vertex colours — top lit, flanks mid,
 *  underside dark. Reads as lit geometry with zero real lights
 *  (research/02 §4). */
export function shadedBoxGeometry(): BoxGeometry {
  const geo = new BoxGeometry(1, 1, 1);
  const normals = geo.getAttribute('normal');
  const colors = new Float32Array(normals.count * 3);
  for (let i = 0; i < normals.count; i++) {
    const ny = normals.getY(i);
    const nx = normals.getX(i);
    let v = 0.62; // ±z flanks
    if (ny > 0.5) v = 1.0;
    else if (ny < -0.5) v = 0.3;
    else if (Math.abs(nx) > 0.5) v = 0.48;
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = v;
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  return geo;
}

const _m = new Matrix4();
const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();
const _e = new Object3D();
const _c = new Color();

export class Bank {
  readonly mesh: InstancedMesh;
  private cursor = 0;

  constructor(geometry: BufferGeometry, material: Material, capacity: number) {
    this.mesh = new InstancedMesh(geometry, material, capacity);
    this.mesh.instanceColor = new InstancedBufferAttribute(
      new Float32Array(capacity * 3).fill(1),
      3,
    );
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.instanceColor.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  /** Reserve the next instance slot; returns its index. */
  add(
    x: number,
    y: number,
    z: number,
    sx = 1,
    sy = 1,
    sz = 1,
    color = 0xffffff,
    rotY = 0,
  ): number {
    const i = this.cursor++;
    this.set(i, x, y, z, sx, sy, sz, rotY);
    this.color(i, color);
    this.mesh.count = this.cursor;
    return i;
  }

  set(i: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rotY = 0): void {
    _p.set(x, y, z);
    _s.set(sx, sy, sz);
    if (rotY !== 0) {
      _e.rotation.set(0, rotY, 0);
      _q.copy(_e.quaternion);
    } else {
      _q.identity();
    }
    _m.compose(_p, _q, _s);
    this.mesh.setMatrixAt(i, _m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  color(i: number, c: number, intensity = 1): void {
    _c.setHex(c);
    _c.multiplyScalar(intensity);
    const a = this.mesh.instanceColor!;
    a.setXYZ(i, _c.r, _c.g, _c.b);
    a.needsUpdate = true;
  }
}

/**
 * The reflection of a live bank: the same instance buffers drawn upside
 * down under the black glass. It animates for free because the buffers are
 * shared; only the material darkens.
 */
export function mirrorBank(bank: Bank, floorY: number, dim = 0.34): Group {
  const src = bank.mesh;
  const clone = new InstancedMesh(src.geometry, src.material, 0);
  const mat = (src.material as MeshBasicMaterial).clone();
  mat.color.multiplyScalar(dim);
  clone.material = mat;
  // Share the live buffers; the count follows the source every frame.
  clone.instanceMatrix = src.instanceMatrix;
  clone.instanceColor = src.instanceColor;
  clone.frustumCulled = false;
  clone.onBeforeRender = (): void => {
    clone.count = src.count;
  };
  const g = new Group();
  g.scale.y = -1;
  g.position.y = 2 * floorY;
  g.add(clone);
  return g;
}
