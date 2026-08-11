/**
 * Attack telegraphs for the ARCADE titans — the whole "souls-like" readability
 * contract lives here. Every titan strike marks its kill zone ON THE PLAYER'S
 * PLATFORM while it charges: hazard-amber shapes that fill up and shift to
 * danger-red as the strike arrives (the fill IS the countdown). Three shapes:
 *
 *  - CIRCLE  : a fist slam / mortar shell footprint — step out of the disc.
 *  - BEAM    : a strip the eye-beam will rake — sidestep off the line.
 *  - SWEEP   : a horizontal blade slice across the platform at a marked
 *              height — duck under it (a floor band shows it's coming).
 *
 * All shader-driven planes; cheap, additive, no textures.
 */

import {
  AdditiveBlending,
  DoubleSide,
  Group,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';

export interface Telegraph {
  /** Position/rotate this; the shapes live inside. */
  group: Group;
  /** fill: 0..1 charge progress; time: seconds for the pulse. */
  update(fill: number, time: number): void;
  dispose(): void;
}

/** Shared vertex shader — pass UVs through. */
const VERT = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

/** Hazard amber → danger red as the charge completes, pulsing faster. */
const COMMON = /* glsl */ `
  uniform float uFill, uTime;
  varying vec2 vUv;
  vec3 warnColor(){
    return mix(vec3(1.0, 0.69, 0.0), vec3(0.91, 0.21, 0.16), smoothstep(0.55, 0.95, uFill));
  }
  float pulse(){
    float rate = mix(3.0, 14.0, uFill);
    return 0.82 + 0.18 * sin(uTime * rate);
  }
`;

/** Strip: edge rails + a fill front that advances down the line (v: 1 → 0). */
const STRIP_FRAG = /* glsl */ `
  ${COMMON}
  void main(){
    vec3 col = warnColor();
    float a = 0.0;
    // Side rails.
    float edge = min(vUv.x, 1.0 - vUv.x);
    a += (1.0 - smoothstep(0.04, 0.1, edge)) * 0.9;
    // Chevron dashes marching toward the player while it charges.
    float dash = step(0.5, fract(vUv.y * 9.0 + uTime * 2.2));
    a += dash * 0.18;
    // The advance front: fills from the far (titan) end toward you.
    a += step(1.0 - uFill, vUv.y) * 0.34;
    a *= pulse();
    gl_FragColor = vec4(col, a);
  }
`;

/**
 * Nova: the whole disc floods with warning EXCEPT one safe wedge, whose
 * edges are drawn as two bright rays — the one telegraph that means
 * "stand HERE". uAngle = wedge centre (radians), uHalf = wedge half-width.
 */
const NOVA_FRAG = /* glsl */ `
  ${COMMON}
  uniform float uAngle, uHalf;
  void main(){
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;
    // World-space angle: the plane is rotated flat, so uv v runs down −z.
    float ang = atan(p.x, -p.y);
    float d = abs(mod(ang - uAngle + 3.14159, 6.28318) - 3.14159);
    float inWedge = step(d, uHalf);
    vec3 col = warnColor();
    float a = 0.0;
    // The flood: everything OUTSIDE the wedge fills and pulses.
    a += (1.0 - inWedge) * (0.16 + 0.5 * uFill);
    // Rim ring all the way round, dimmer through the wedge.
    a += smoothstep(0.9, 0.95, r) * (1.0 - smoothstep(0.98, 1.0, r)) * (1.0 - inWedge * 0.7);
    // The wedge's edge rays — the doorposts of the safe ground.
    float edge = smoothstep(0.06, 0.0, abs(d - uHalf));
    a += edge * 0.9;
    a *= pulse();
    gl_FragColor = vec4(col, a);
  }
`;

/**
 * THE ROUTINE's step mark: one quarter of the deck, ringed and washed, with
 * its STEP NUMBER spelled out as a row of dots in the middle — one dot for
 * step one, two for step two. Drawn in goo green, not hazard amber: during
 * the preview nothing is dangerous yet, and the marks are a lesson rather
 * than a warning. They fade out near the end of the charge, and from then
 * on the routine lives only in your head. uOrd = the step number.
 */
const MARK_FRAG = /* glsl */ `
  ${COMMON}
  uniform float uOrd, uAspect;
  void main(){
    // Goo green — the boss's own colour, and never confusable with the
    // amber that means "don't be here".
    vec3 col = vec3(0.62, 1.0, 0.70);
    // The lesson is over before the first step lands.
    float fade = 1.0 - smoothstep(0.70, 0.92, uFill);
    float a = 0.10;
    // Border around the quarter — this whole square is the ground.
    float e = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    a += (1.0 - smoothstep(0.022, 0.055, e)) * 0.55;
    // The step number, as dots in a row across the middle.
    for (int i = 0; i < 4; i++) {
      if (float(i) >= uOrd) break;
      float cx = 0.5 + (float(i) - (uOrd - 1.0) * 0.5) * 0.15;
      vec2 p = (vUv - vec2(cx, 0.5)) * vec2(1.0, 1.0 / uAspect);
      a += (1.0 - smoothstep(0.04, 0.055, length(p))) * 0.95;
    }
    a *= fade * pulse();
    gl_FragColor = vec4(col, a);
  }
`;

/**
 * THE ROUTINE's quarter lines: the cross that splits the deck into four,
 * lit dim and neutral for the whole move. It is furniture, not danger —
 * it says where the boxes will land, never which quarter is yours — so it
 * stays a cool chalk white and never fills.
 */
const QUARTER_FRAG = /* glsl */ `
  ${COMMON}
  void main(){
    float a = 0.0;
    // Two chalk lines through the middle, softly feathered.
    a += (1.0 - smoothstep(0.004, 0.016, abs(vUv.x - 0.5))) * 0.5;
    a += (1.0 - smoothstep(0.004, 0.016, abs(vUv.y - 0.5))) * 0.5;
    // Ticks at the rim so the split reads even from across the ring.
    float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    a *= 0.55 + 0.45 * (1.0 - smoothstep(0.0, 0.18, edge));
    a *= 0.75 + 0.25 * sin(uTime * 2.0);
    gl_FragColor = vec4(vec3(0.86, 0.92, 1.0), a);
  }
`;

/**
 * Donut: the RIM floods and the middle lives — the nova's opposite number.
 * A bright doorpost CIRCLE burns at the edge of the safe disc with chevrons
 * marching inward across the doomed ring, so the shape says "in here", not
 * "somewhere over there". uInner = safe radius as a fraction of the pane.
 */
const DONUT_FRAG = /* glsl */ `
  ${COMMON}
  uniform float uInner;
  void main(){
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;
    float safe = step(r, uInner);
    vec3 col = warnColor();
    float a = 0.0;
    // The flood: everything outside the safe disc fills with the charge.
    a += (1.0 - safe) * (0.12 + 0.5 * uFill);
    // The doorpost ring — the honest edge of the ground that lives.
    a += smoothstep(0.055, 0.0, abs(r - uInner)) * (0.35 + 0.65 * uFill);
    // Chevron rings marching INWARD toward the safe disc (+uTime pulls the
    // pattern to smaller radii as the clock runs).
    float band = step(0.68, fract((r - uInner) * 5.5 + uTime * 1.9));
    a += band * (1.0 - safe) * (0.12 + 0.2 * uFill);
    // Outer rim ring, so the doomed annulus has a far edge too.
    a += smoothstep(0.92, 0.97, r) * (1.0 - smoothstep(0.99, 1.0, r)) * 0.6;
    a *= pulse();
    gl_FragColor = vec4(col, a);
  }
`;

/**
 * Half-platform flood (GOOPLIATH's seesaw): one side of the deck fills with
 * warning while a hard rail burns along the centreline — the honest border —
 * and chevrons march toward the SAFE half: jump. uDir is the local-x
 * direction of escape (−side), so the arrows always point off the doomed half.
 */
const HALF_FRAG = /* glsl */ `
  ${COMMON}
  void main(){
    vec3 col = warnColor();
    float a = 0.0;
    // The flood: the whole half fills as the wave charges. Only TWO panes
    // ever show at once (the imminent beat and the one after — see
    // advanceAttack), so the ramp is bold: the side about to blow is
    // unmistakably the bright one, its follow-up a faint promise.
    a += 0.05 + 0.55 * uFill;
    // The centreline rail — the honest border you must be across. The mesh is
    // authored with u = 0 on the centreline, u = 1 at the outer rim.
    a += (1.0 - smoothstep(0.0, 0.06, vUv.x)) * (0.25 + 0.75 * uFill);
    // Bands marching toward the centreline — CROSS HERE, the other half lives.
    float lane = fract(vUv.x * 5.0 + uTime * 2.4);
    float band = step(0.72, lane) * step(abs(fract(vUv.y * 3.0) - 0.5), 0.32);
    a += band * (0.1 + 0.25 * uFill);
    a *= pulse();
    gl_FragColor = vec4(col, a);
  }
`;

/**
 * Gate: the WHOLE deck floods EXCEPT one clear column — the doorpost rails
 * burn at its edges and chevron streams march INTO it from both sides. The
 * linear cousin of the nova: the one telegraph that says "stand HERE", on a
 * line instead of a compass. uGap = column centre (u), uHalf = half-width (u).
 */
const GATE_FRAG = /* glsl */ `
  ${COMMON}
  uniform float uGap, uHalf;
  void main(){
    vec3 col = warnColor();
    float d = vUv.x - uGap;
    float inGap = step(abs(d), uHalf);
    float a = 0.0;
    // The flood: everything OUTSIDE the column fills with the charge.
    a += (1.0 - inGap) * (0.1 + 0.5 * uFill);
    // Doorpost rails — the honest edges of the safe ground.
    a += smoothstep(0.045, 0.0, abs(abs(d) - uHalf)) * (0.35 + 0.65 * uFill);
    // Chevron streams marching INTO the gap from both sides.
    float band = step(0.68, fract(abs(d) * 9.0 + uTime * 2.3));
    a += band * (1.0 - inGap) * step(abs(fract(vUv.y * 4.0) - 0.5), 0.34) * 0.22;
    a *= pulse();
    gl_FragColor = vec4(col, a);
  }
`;

/**
 * Danger roof: a horizontal pane hung at the sweep line — the threat reads
 * as a CEILING over the whole deck, never as a wall about to bisect it.
 * Faint bands drift along +u (mirror the mesh so they run entry → exit).
 */
const ROOF_FRAG = /* glsl */ `
  ${COMMON}
  void main(){
    vec3 col = warnColor();
    float a = 0.10 + 0.40 * uFill;
    // Drift bands carry the swing's travel direction across the roof.
    float band = step(0.72, fract(vUv.x * 5.0 - uTime * 1.4));
    a += band * 0.13;
    a *= smoothstep(0.0, 0.07, vUv.x) * smoothstep(1.0, 0.93, vUv.x);
    a *= smoothstep(0.0, 0.10, vUv.y) * smoothstep(1.0, 0.90, vUv.y);
    a *= pulse();
    gl_FragColor = vec4(col, a);
  }
`;

/**
 * Duck cascade: rows of downward-pointing chevrons pouring toward the floor
 * beneath a sweep blade — the shape ITSELF says "get under". Drawn on a
 * vertical plane; v = 0 is the floor end.
 */
const DUCK_FRAG = /* glsl */ `
  ${COMMON}
  void main(){
    vec3 col = warnColor();
    // A V-shape per row: the row line dips at the centre (chevron pointing
    // down), and the whole pattern marches DOWNWARD with time.
    float vee = vUv.y * 5.0 + abs(vUv.x - 0.5) * 2.2 + uTime * 1.8;
    float row = smoothstep(0.42, 0.5, fract(vee)) * (1.0 - smoothstep(0.5, 0.58, fract(vee)));
    float a = row * (0.16 + 0.38 * uFill);
    // Fade at the plane's side edges so it reads as a stream, not a wall.
    a *= smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
    a *= pulse();
    gl_FragColor = vec4(col, a);
  }
`;

/** Blade: a horizontal slice hanging in the air — bright core line, soft body. */
const BLADE_FRAG = /* glsl */ `
  ${COMMON}
  void main(){
    vec3 col = warnColor();
    float mid = 1.0 - abs(vUv.y * 2.0 - 1.0); // 1 at the slice centre line
    float a = pow(mid, 3.0) * 0.75 + mid * 0.12;
    // Fill sweeps across the width as the swing charges.
    a *= 0.35 + 0.65 * step(vUv.x, uFill);
    a *= pulse();
    gl_FragColor = vec4(col, a);
  }
`;

/**
 * THE TRIP WEB's filled cell, floor: an ordinary danger flood with a hard
 * border — paint means "move your feet", and this square means exactly that
 * even while every wire around it means the opposite.
 */
const CELL_FRAG = /* glsl */ `
  ${COMMON}
  void main(){
    vec3 col = warnColor();
    float a = 0.07 + 0.5 * uFill;
    float e = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    a += (1.0 - smoothstep(0.02, 0.06, e)) * (0.3 + 0.6 * uFill);
    a *= pulse();
    gl_FragColor = vec4(col, a);
  }
`;

/**
 * THE TRIP WEB's filled cell, walls: a column of the same danger rising to
 * the web's true ceiling — dense at the floor, thinning as it climbs, with
 * slow bands drifting UP so the volume reads as rising rather than hanging.
 * vUv.y runs 0 at the floor to 1 at WIRE_TOP.
 */
const CELLWALL_FRAG = /* glsl */ `
  ${COMMON}
  void main(){
    vec3 col = warnColor();
    float a = mix(0.34, 0.05, vUv.y) * (0.25 + 0.75 * uFill);
    float band = step(0.78, fract(vUv.y * 4.0 - uTime * 0.9));
    a += band * 0.08 * uFill;
    // A bright lip at the very top — the hitbox's honest ceiling.
    a += (1.0 - smoothstep(0.0, 0.05, 1.0 - vUv.y)) * 0.3 * uFill;
    a *= pulse();
    gl_FragColor = vec4(col, a);
  }
`;

function warnMat(frag: string, extra: Record<string, { value: number }> = {}): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uFill: { value: 0 }, uTime: { value: 0 }, ...extra },
    vertexShader: VERT,
    fragmentShader: frag,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
}

function makeTelegraph(meshes: Mesh[], mats: ShaderMaterial[]): Telegraph {
  const group = new Group();
  for (const m of meshes) {
    // Draw after the deck furniture — a warning that loses the depth fight
    // to a rim bolt is a warning nobody saw.
    m.renderOrder = 20;
    group.add(m);
  }
  return {
    group,
    update(fill, time) {
      for (const mat of mats) {
        mat.uniforms.uFill.value = fill;
        mat.uniforms.uTime.value = time;
      }
    },
    dispose() {
      for (const m of meshes) m.geometry.dispose();
      for (const mat of mats) mat.dispose();
      group.removeFromParent();
    },
  };
}

/**
 * GOLIATH's nova: a platform-covering disc where everything floods with
 * warning EXCEPT the safe wedge centred on `angle` (world radians, atan2(x,z)
 * around the platform centre), `halfAngle` wide each side. Place the group
 * at the platform centre on the floor.
 */
export function novaTelegraph(radius: number, angle: number, halfAngle: number): Telegraph {
  const mat = warnMat(NOVA_FRAG, { uAngle: { value: angle }, uHalf: { value: halfAngle } });
  const disc = new Mesh(new PlaneGeometry(radius * 2, radius * 2), mat);
  disc.rotation.x = -Math.PI / 2;
  return makeTelegraph([disc], [mat]);
}

/**
 * THE ROUTINE, taught: one marked quarter per step, each carrying its step
 * number in dots. `corners` are (sx, sz) signs in platform-local space.
 * Place the group at the deck centre on the floor; the marks fade
 * themselves out as the charge runs down.
 */
export function routineMarksTelegraph(
  routine: readonly number[],
  halfWidth: number,
  halfDepth: number,
): Telegraph {
  const meshes: Mesh[] = [];
  const mats: ShaderMaterial[] = [];
  const w = halfWidth * 0.92;
  const d = halfDepth * 0.92;
  routine.forEach((corner, step) => {
    const mat = warnMat(MARK_FRAG, { uOrd: { value: step + 1 }, uAspect: { value: w / d } });
    const pane = new Mesh(new PlaneGeometry(w, d), mat);
    pane.rotation.x = -Math.PI / 2;
    pane.position.set(((corner & 1 ? 1 : -1) * halfWidth) / 2, 0, ((corner & 2 ? 1 : -1) * halfDepth) / 2);
    meshes.push(pane);
    mats.push(mat);
  });
  return makeTelegraph(meshes, mats);
}

/** THE ROUTINE's quarter lines — the split deck, lit for the whole move. */
export function quarterTelegraph(halfWidth: number, halfDepth: number): Telegraph {
  const mat = warnMat(QUARTER_FRAG);
  const pane = new Mesh(new PlaneGeometry(halfWidth * 2, halfDepth * 2), mat);
  pane.rotation.x = -Math.PI / 2;
  return makeTelegraph([pane], [mat]);
}

/**
 * THE DONUT: the deck's rim floods and one disc in the middle survives.
 * `radius` covers the whole deck (corners included), `innerR` is the safe
 * disc. Place the group at the platform centre on the floor.
 */
export function donutTelegraph(radius: number, innerR: number): Telegraph {
  const mat = warnMat(DONUT_FRAG, { uInner: { value: innerR / radius } });
  const disc = new Mesh(new PlaneGeometry(radius * 2, radius * 2), mat);
  disc.rotation.x = -Math.PI / 2;
  return makeTelegraph([disc], [mat]);
}

/**
 * GOOPLIATH's seesaw: ONE HALF of the platform floods with warning — the
 * centreline burns as a hard rail and bands march toward it: get across.
 * `side` is the doomed half's local-x sign; `halfWidth`/`depth` span the
 * platform. Place the group at the platform centre on the floor (the side
 * flip is baked in here — no extra rotation needed beyond the seat yaw).
 */
export function halfTelegraph(side: -1 | 1, halfWidth: number, depth: number): Telegraph {
  const mat = warnMat(HALF_FRAG);
  const pane = new Mesh(new PlaneGeometry(halfWidth, depth), mat);
  pane.rotation.x = -Math.PI / 2;
  // Authored for the +x half (u = 0 at the centreline); the −x half is the
  // same pane mirrored in place. The flip lives on the MESH — the group's
  // rotation stays free for the caller's seat yaw.
  pane.position.x = (side * halfWidth) / 2;
  pane.scale.x = side;
  return makeTelegraph([pane], [mat]);
}

/**
 * A beam strip `length` long and `2*halfWidth` wide, flat on the floor,
 * running along the group's local −Z (v=1 is the far end, where the fill
 * front starts). Place the group at the NEAR end centre and yaw it.
 */
export function beamTelegraph(halfWidth: number, length: number): Telegraph {
  const mat = warnMat(STRIP_FRAG);
  const strip = new Mesh(new PlaneGeometry(halfWidth * 2, length), mat);
  strip.rotation.x = -Math.PI / 2; // plane +v now points down local −Z
  strip.position.z = -length / 2;
  return makeTelegraph([strip], [mat]);
}

/**
 * The sweep: danger lives IN THE AIR, never on the floor. Three parts, all
 * hung off the limbo line at `bladeY`:
 *  - a DANGER ROOF — a horizontal pane at bladeY covering the deck, so the
 *    doomed volume reads as a ceiling (a wall-like pane here is exactly what
 *    made it look like the deck was about to be cut in half);
 *  - the LINE itself — a thin blazing pane whose charge-fill runs from the
 *    side the blade will enter (`fromSide`), so veterans read the direction;
 *  - a SHORT chevron fringe dripping under the line — "get under HERE".
 * The floor is deliberately unpainted: ground-paint means "move your feet"
 * in every other move, and the sweep's answer is stay put and DROP. Place
 * the group at the platform centre on the floor.
 */
export function sweepTelegraph(
  width: number,
  depth: number,
  bladeY: number,
  thickness: number,
  fromSide: 1 | -1,
): Telegraph {
  const meshes: Mesh[] = [];
  const mats: ShaderMaterial[] = [];
  // The danger volume drawn as a SANDWICH: one roof at the line and one
  // above head height. Standing, the upper layer hangs over your eyes and
  // the lower shimmers at your chest — you are visibly INSIDE the amber;
  // duck and the whole stack is overhead. A single pane at the line is
  // edge-on from standing eye height and carries nothing.
  for (const dy of [0, 0.55]) {
    const roofMat = warnMat(ROOF_FRAG);
    const roof = new Mesh(new PlaneGeometry(width, depth), roofMat);
    roof.rotation.x = -Math.PI / 2;
    roof.position.y = bladeY + dy;
    // u runs +x unmirrored; flip so fill/bands originate at the entry side.
    roof.scale.x = -fromSide;
    meshes.push(roof);
    mats.push(roofMat);
  }
  // TWO limbo rails, pushed to the deck's front and back thirds — never
  // through the dancer's own head: a pane at deck centre sits edge-on in
  // the owner's eyes and renders as nothing. From your spot you always have
  // one rail ACROSS your view (plus its chevron fringe dripping under it);
  // from across the ring the pair reads as a horizontal danger layer.
  const zOff = depth * 0.28;
  const duckH = 0.42;
  for (const dz of [-zOff, zOff]) {
    const bladeMat = warnMat(BLADE_FRAG);
    const blade = new Mesh(new PlaneGeometry(width, thickness * 2), bladeMat);
    blade.position.set(0, bladeY, dz);
    blade.scale.x = -fromSide;
    const duckMat = warnMat(DUCK_FRAG);
    const duck = new Mesh(new PlaneGeometry(width * 0.85, duckH), duckMat);
    duck.position.set(0, bladeY - duckH / 2, dz);
    meshes.push(blade, duck);
    mats.push(bladeMat, duckMat);
  }
  return makeTelegraph(meshes, mats);
}

/**
 * THE CROSSFIRE's rail: the beam strip a quarter-turn round, running left to
 * right across the deck so the dodge is a step toward or away from the
 * stage. `from` is the local-x side the emitter sits on: the strip's fill
 * front advances from there, so the charge already shows which rail is
 * feeding it. Place the group at the deck centre, at the strip's z.
 */
export function railTelegraph(halfDepth: number, length: number, from: 1 | -1): Telegraph {
  const mat = warnMat(STRIP_FRAG);
  const strip = new Mesh(new PlaneGeometry(halfDepth * 2, length), mat);
  // Flat on the deck (x tip), then spun within the floor plane (z spin —
  // innermost in three's default XYZ order, so it turns the strip in place).
  // The sign puts v = 1, where the fill front starts, on the emitter side.
  strip.rotation.set(-Math.PI / 2, 0, (from * Math.PI) / 2);
  return makeTelegraph([strip], [mat]);
}

/* ── THE TRIP WEB's grid ────────────────────────────────────────────────
 * The six wires cut the deck into a 4×4 of CELLS. Both the telegraph (a
 * filled cell is a column of danger) and the judge (standing in one at the
 * discharge is a hit) need the same rectangles, so the cell math lives
 * here, next to the wires that define it. Index = cx + cz * 4.
 */
const WIRE_FRACS = [-0.5, -0.32, 0, 0.32, 0.5] as const;
/** The web's hitbox is honest to here — eye level, where the discharge
 *  visibly sweeps. */
export const WIRE_TOP = 1.6;

export interface CellRect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export function wireCellRect(idx: number, width: number, depth: number): CellRect {
  const cx = idx % 4;
  const cz = Math.floor(idx / 4);
  return {
    x0: WIRE_FRACS[cx] * width,
    x1: WIRE_FRACS[cx + 1] * width,
    z0: WIRE_FRACS[cz] * depth,
    z1: WIRE_FRACS[cz + 1] * depth,
  };
}

/**
 * THE TRIP WEB: a shin-high lattice of laser wire strung across the whole
 * deck. The base move draws NO safe ground, because there isn't any: the
 * answer is to stop moving. Deliberately air-only (floor paint says "move
 * your feet" in every other move) and deliberately dense: from anywhere on
 * the deck a wire crosses your view, so "stepping breaks one of these"
 * needs no explaining. Each wire is a short vertical ribbon — a flat one
 * at shin height is edge-on from standing and renders as nothing.
 *
 * From act 2 the web starts arriving with CELLS FILLED IN: columns of
 * danger rising off chosen squares of the grid, floor to eye level, amber
 * filling to red like every other zone. A filled cell is ground you must
 * NOT be standing on when the web goes off — so the late-act web asks for
 * both verbs in order: get out of the filled squares while the charge is
 * young, then freeze where you stand. The floor paint under each column
 * keeps the law: paint means move.
 */
export function wireTelegraph(width: number, depth: number, y: number, filled: readonly number[] = []): Telegraph {
  const meshes: Mesh[] = [];
  const mats: ShaderMaterial[] = [];
  const h = 0.075;
  // Wires across (facing the stage) and wires down the deck, woven into a
  // grid — the crossings are what make it read as a web and not as rails.
  for (const dz of [-depth * 0.34, 0, depth * 0.34]) {
    const mat = warnMat(BLADE_FRAG);
    const wire = new Mesh(new PlaneGeometry(width, h), mat);
    wire.position.set(0, y, dz);
    meshes.push(wire);
    mats.push(mat);
  }
  for (const dx of [-width * 0.32, 0, width * 0.32]) {
    const mat = warnMat(BLADE_FRAG);
    const wire = new Mesh(new PlaneGeometry(depth, h), mat);
    wire.position.set(dx, y, 0);
    wire.rotation.y = Math.PI / 2;
    meshes.push(wire);
    mats.push(mat);
  }
  // The emitter posts the web is strung between — off at the deck corners,
  // so the danger still owns the air and nothing paints the ground.
  for (const sx of [-1, 1] as const) {
    for (const sz of [-1, 1] as const) {
      const mat = warnMat(BLADE_FRAG);
      const post = new Mesh(new PlaneGeometry(0.06, y * 2), mat);
      post.position.set((sx * width) / 2, y, (sz * depth) / 2);
      post.rotation.y = Math.PI / 4;
      meshes.push(post);
      mats.push(mat);
    }
  }
  // The filled cells: a floor pane (paint = move) and a four-walled open
  // column running the full height of the web's hitbox.
  for (const idx of filled) {
    const r = wireCellRect(idx, width, depth);
    const cw = r.x1 - r.x0;
    const cd = r.z1 - r.z0;
    const cx = (r.x0 + r.x1) / 2;
    const cz = (r.z0 + r.z1) / 2;
    const floorMat = warnMat(CELL_FRAG);
    const pane = new Mesh(new PlaneGeometry(cw, cd), floorMat);
    pane.rotation.x = -Math.PI / 2;
    pane.position.set(cx, 0.045, cz);
    meshes.push(pane);
    mats.push(floorMat);
    const wallH = WIRE_TOP;
    for (const [wx, wz, ww, yaw] of [
      [cx, r.z0, cw, 0],
      [cx, r.z1, cw, 0],
      [r.x0, cz, cd, Math.PI / 2],
      [r.x1, cz, cd, Math.PI / 2],
    ] as const) {
      const wallMat = warnMat(CELLWALL_FRAG);
      const wall = new Mesh(new PlaneGeometry(ww, wallH), wallMat);
      wall.position.set(wx, wallH / 2, wz);
      wall.rotation.y = yaw;
      meshes.push(wall);
      mats.push(wallMat);
    }
  }
  return makeTelegraph(meshes, mats);
}

/**
 * The gate: a full-deck pane where everything fills EXCEPT one clear column
 * centred at `gapX` (platform-local), `gapHalfW` wide each side. Place the
 * group at the platform centre on the floor.
 */
export function gateTelegraph(halfWidth: number, halfDepth: number, gapX: number, gapHalfW: number): Telegraph {
  const w = halfWidth * 2 + 0.4;
  const d = halfDepth * 2 + 0.3;
  const mat = warnMat(GATE_FRAG, {
    uGap: { value: (gapX + w / 2) / w },
    uHalf: { value: gapHalfW / w },
  });
  const pane = new Mesh(new PlaneGeometry(w, d), mat);
  pane.rotation.x = -Math.PI / 2;
  return makeTelegraph([pane], [mat]);
}
