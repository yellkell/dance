/**
 * The liquid — SPLASH WARS' centrepiece trick (Half-Life: Alyx style),
 * vendored here to live inside YOUR glowsticks.
 *
 * The glow inside a stick is one mesh (a slightly-shrunk copy of the tube
 * interior) whose fragment shader CLIPS everything above a liquid surface
 * plane defined in WORLD space. Because the plane lives in world space, the
 * surface stays level however you tilt, swing or roll the stick — exactly
 * the Alyx bottle illusion. Where the clip cuts the mesh open you see its
 * back faces, which we paint as a flat bright "surface of the liquid"
 * colour — the classic cheap fake for the liquid's top.
 *
 * On top of that:
 *  - a spring–damper SloshSim tilts the plane's normal in response to how
 *    the hand accelerates, so dancing sends the glow surging end to end;
 *  - a travelling ripple wobbles the plane, scaled by slosh energy;
 *  - a foam/meniscus band brightens the cut line where glow meets air.
 *
 * Three deliberate departures from the SPLASH WARS original:
 *  - the fill level never drains — a glowstick is not a magazine; the fun
 *    is the pour, not the gauge — so `fill` is just a knob the stick sets;
 *  - the colours are LIVE (setColor), because the sticks wear your seat
 *    colour, run hotter as the groove deepens, and flash white on a
 *    rewarded swap — none of which is known at build time;
 *  - the liquid is GEL, not water: overdamped slosh that heaps and oozes
 *    instead of ringing, slow heavy ripples, a fat meniscus climbing the
 *    tube, and depths dark enough to read as optical density. It is that
 *    kind of night — the headliner is made of the same stuff.
 *
 * ONLY YOUR OWN STICKS get this. The 23 other dancers' figures keep their
 * bare neon blades: nobody can read a meniscus across the ring, and 46
 * extra slosh sims + draw calls would buy nothing but frame time. The
 * liquid is a held-in-your-hand pleasure, so it lives only in your hands.
 */

import {
  Color,
  DoubleSide,
  Mesh,
  ShaderMaterial,
  Vector3,
  type BufferGeometry,
} from 'three';

/**
 * Slosh tuning, sized for a 30 cm × 1.3 cm stick rather than a pistol tank
 * — and tuned THICK. SPLASH WARS' juice is water: a lively spring that
 * rings level in a beat. This glow is GEL (it's that kind of night): the
 * surface heaps up hard when you throw the stick, then OOZES back level —
 * overdamped, no ring-back — and what ripples across it travels slow and
 * heavy. Watery numbers here read as a thin drink; the drag is the
 * viscosity.
 */
const SLOSH = {
  accelGain: 0.06, // hand acceleration (m/s²) → surface tilt drive (gel lags hard)
  spring: 15, // pull of the surface back toward level — lazy on purpose
  damping: 9, // heavy: kills the ring-back, leaves the creep
  maxTilt: 0.6, // tilt clamp (rise/run) so the surface never flips
  rippleGain: 1.0, // slosh energy → shader ripple amplitude
  energyDecay: 1.25, // per-second decay of ripple energy — the wobble lingers
};

// ---------------------------------------------------------------------------
// The slosh simulation — a damped 2D pendulum for the surface tilt.
// ---------------------------------------------------------------------------

/**
 * Tracks the liquid surface's tilt (rise/run in world X and Z) and a scalar
 * "energy" that drives the shader ripple. Feed it the stick's world-space
 * acceleration every frame. `energy` is also a public knob: a rewarded swap
 * kicks it directly, so the reward visibly churns the glow.
 */
export class SloshSim {
  tiltX = 0;
  tiltZ = 0;
  energy = 0;
  private velX = 0;
  private velZ = 0;

  update(dt: number, accel: Vector3): void {
    const s = SLOSH;
    // Integrate on a CAPPED step — never more than a frame's worth, the
    // same rule the stick pulse lives by. Fed a whole second (a hitch, a
    // headset waking, a backgrounded tab throttling to 1 Hz), this spring
    // doesn't lag — it goes UNSTABLE, ringing between the tilt clamps
    // forever. A long frame may cost the pendulum time; it may not poison
    // it. (Energy below keeps the true dt: pure decay is stable, and a
    // long frame SHOULD calm the ripple more.)
    const step = Math.min(dt, 0.05);
    // Surface tips away from the direction of acceleration (gel lags the
    // tube), pulled level by the spring, dragged by damping. The damping is
    // applied IMPLICITLY (divide, not subtract): at gel-grade drag the
    // explicit form overshoots past zero on a capped step and the "thick"
    // tuning would ring harder than the watery one it replaced. The
    // implicit form is a pure decay at any damping and any step.
    const h = step * 60;
    const driveX = -accel.x * s.accelGain;
    const driveZ = -accel.z * s.accelGain;
    this.velX = (this.velX + (driveX - s.spring * 0.01 * this.tiltX) * h) / (1 + s.damping * 0.1 * h);
    this.velZ = (this.velZ + (driveZ - s.spring * 0.01 * this.tiltZ) * h) / (1 + s.damping * 0.1 * h);
    this.tiltX += this.velX * step;
    this.tiltZ += this.velZ * step;
    const clamp = s.maxTilt;
    this.tiltX = Math.max(-clamp, Math.min(clamp, this.tiltX));
    this.tiltZ = Math.max(-clamp, Math.min(clamp, this.tiltZ));

    // Ripple energy: spikes with jolts (vertical ones count too), then dies.
    const jolt = Math.min(1.2, accel.length() * 0.02);
    this.energy = Math.max(this.energy * Math.exp(-s.energyDecay * dt), jolt);
  }

  reset(): void {
    this.tiltX = this.tiltZ = this.velX = this.velZ = this.energy = 0;
  }
}

/**
 * Per-hand world-space motion tracking for the slosh — velocity and
 * acceleration by finite difference, smoothed so controller pose jitter
 * doesn't read as constant slosh energy. (SPLASH WARS keeps this beside its
 * weapon system; here it's stick kit, so it lives with the liquid.)
 */
export class HandMotion {
  readonly accel = new Vector3();
  private readonly vel = new Vector3();
  private readonly prevPos = new Vector3();
  private readonly prevVel = new Vector3();
  private primed = false;

  update(pos: Vector3, dt: number): void {
    if (!this.primed || dt <= 0) {
      this.prevPos.copy(pos);
      this.primed = true;
      return;
    }
    _vel.copy(pos).sub(this.prevPos).divideScalar(dt);
    this.vel.lerp(_vel, 0.5);
    this.accel.lerp(_vel.sub(this.prevVel).divideScalar(dt), 0.25);
    this.prevVel.copy(this.vel);
    this.prevPos.copy(pos);
  }

  /** Forget the past — call when the stick teleports (reparent, un-bag),
   *  or a frame of fake acceleration churns the glow for no reason. */
  reset(): void {
    this.accel.set(0, 0, 0);
    this.vel.set(0, 0, 0);
    this.prevVel.set(0, 0, 0);
    this.primed = false;
  }
}

// ---------------------------------------------------------------------------
// The clipped-liquid shader.
// ---------------------------------------------------------------------------

const LIQUID_VERT = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  void main(){
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const LIQUID_FRAG = /* glsl */ `
  uniform vec3 uPlanePoint;   // a world-space point on the liquid surface
  uniform vec3 uPlaneNormal;  // world up, tilted by the slosh sim
  uniform float uTime;
  uniform float uSlosh;       // ripple energy 0..~1
  uniform vec3 uColor;        // lit glow body
  uniform vec3 uDeepColor;    // shadowed depths
  uniform vec3 uFoamColor;    // meniscus / surface sheen
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  void main(){
    // Signed distance above the (tilted) surface plane, wobbled by two
    // crossing travelling ripples so churned glow visibly rolls. SPLASH
    // WARS' water chops fast and fine; this is GEL, so the waves run half
    // the frequency and a third the speed — a slow, heavy roll, the way a
    // thick pour wobbles instead of splashing.
    float ripple =
      sin(dot(vWorldPos.xz, vec2(46.0, 32.0)) - uTime * 4.2) * 0.5 +
      sin(dot(vWorldPos.xz, vec2(-28.0, 40.0)) + uTime * 3.0) * 0.5;
    float d = dot(vWorldPos - uPlanePoint, normalize(uPlaneNormal))
            + ripple * 0.006 * uSlosh * ${SLOSH.rippleGain.toFixed(2)};
    if (d > 0.0) discard;

    if (!gl_FrontFacing) {
      // The open cut — the liquid's top surface. Flat and bright, with the
      // ripple shimmering across it.
      float shimmer = 0.92 + 0.08 * ripple * uSlosh * 4.0;
      gl_FragColor = vec4(uFoamColor * shimmer, 1.0);
      return;
    }

    // The body of the glow: simple fixed-key shading, weighted hard toward
    // the depths — optical density is most of what "thick" looks like, and
    // a column that stays bright to the bottom reads as water with dye in
    // it rather than gel.
    float up = clamp(vWorldNormal.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = mix(uDeepColor, uColor, up * 0.85 + 0.15);
    // Meniscus: a foam band hugging the underside of the surface plane —
    // FAT, nearly twice the water version's reach, because a thick pour
    // climbs its glass: the wide bright collar where gel wets the tube is
    // the second half of what "viscous" looks like.
    col = mix(col, uFoamColor, smoothstep(-0.011, -0.0015, d) * 0.9);
    // Wet gloss: a real Blinn-Phong glint off a fixed key light, tracking
    // the camera, so the glow gleams as the stick turns in your hand.
    vec3 n = normalize(vWorldNormal);
    vec3 lightDir = normalize(vec3(0.35, 0.85, 0.4));
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    vec3 h = normalize(lightDir + viewDir);
    // Two lobes: a broad wet sheen plus a hot pin inside it. Glass gloss
    // is that contrast — but the pin runs wider than water's (120 vs 190):
    // a highlight on gel smears where one on water snaps to a point.
    float ndh = max(dot(n, h), 0.0);
    col += pow(ndh, 26.0) * 0.4;
    col += pow(ndh, 120.0) * 1.0;
    // A second, cooler glint from the opposite side keeps the far edge of
    // the liquid alive as the stick rolls.
    float ndh2 = max(dot(n, normalize(normalize(vec3(-0.5, 0.55, -0.35)) + viewDir)), 0.0);
    col += pow(ndh2, 90.0) * 0.32 * vec3(0.75, 0.9, 1.0);
    // Fresnel skin: the surface turns to a bright film at grazing angles.
    col += pow(1.0 - max(dot(n, viewDir), 0.0), 4.0) * 0.28;
    // FULLY OPAQUE: thick glow is not see-through. Anything less and you
    // catch the casing's far wall (and the void) straight through it.
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** A live liquid volume: parent `mesh` inside the tube, then call update(). */
export interface LiquidVisual {
  mesh: Mesh;
  material: ShaderMaterial;
  slosh: SloshSim;
  /**
   * Drive the illusion. `fill` is 0..1 of the tube's volume, `center` the
   * tube's world-space centre, `worldHeight` the interior's extent along
   * WORLD up (project the tube onto world Y before calling — a level
   * surface through a tilted tube spans less height than the tube is long).
   */
  update(time: number, dt: number, fill: number, center: Vector3, worldHeight: number, accel: Vector3): void;
  /**
   * The night's live colours, every frame: `base` is the seat colour,
   * `flash` the rewarded-swap kick (0..1, snaps the glow toward white the
   * way the tube flashes), `glow` the groove depth (0..1, runs the body
   * hotter the longer the streak holds).
   */
  setColor(base: Color, flash: number, glow: number): void;
  dispose(): void;
}

const _up = new Vector3();
const _point = new Vector3();
const _vel = new Vector3();
const _white = new Color(0xffffff);

export function createLiquid(interiorGeo: BufferGeometry): LiquidVisual {
  const material = new ShaderMaterial({
    uniforms: {
      uPlanePoint: { value: new Vector3() },
      uPlaneNormal: { value: new Vector3(0, 1, 0) },
      uTime: { value: 0 },
      uSlosh: { value: 0 },
      uColor: { value: new Color(0xffffff) },
      uDeepColor: { value: new Color(0x404040) },
      uFoamColor: { value: new Color(0xffffff) },
    },
    vertexShader: LIQUID_VERT,
    fragmentShader: LIQUID_FRAG,
    // Opaque: it renders in the opaque pass, writes depth, and the frosted
    // tube then blends over the top of it in the transparent pass — which
    // is exactly the sort order the illusion needs.
    transparent: false,
    side: DoubleSide,
  });

  const mesh = new Mesh(interiorGeo, material);
  mesh.renderOrder = 1; // before the frosted tube blends over it
  const slosh = new SloshSim();

  return {
    mesh,
    material,
    slosh,
    update(time, dt, fill, center, worldHeight, accel) {
      slosh.update(dt, accel);
      // Surface plane: a world-up normal tipped by the slosh pendulum…
      _up.set(slosh.tiltX, 1, slosh.tiltZ).normalize();
      // …passing through the tube centre offset by the fill level. Measuring
      // the offset along world up (not the tube's axis) keeps the volume
      // believable however the stick is tilted — hang it upside down and
      // the glow pours to the other end.
      _point.copy(center).addScaledVector(
        _up,
        (Math.min(1, Math.max(0, fill)) - 0.5) * worldHeight,
      );
      material.uniforms.uPlanePoint.value.copy(_point);
      material.uniforms.uPlaneNormal.value.copy(_up);
      material.uniforms.uTime.value = time;
      material.uniforms.uSlosh.value = slosh.energy;
      // Fully drained: hide the mesh so no backface slivers linger.
      mesh.visible = fill > 0.005;
    },
    setColor(base, flash, glow) {
      const u = material.uniforms;
      // The body wears the seat colour and runs hotter as the groove
      // deepens; the flash snaps everything toward white, the way a tube
      // does when it's struck.
      (u.uColor.value as Color).copy(base).lerp(_white, 0.1 + glow * 0.18 + flash * 0.55);
      // The depths stay the same hue, darkened HARD — that contrast is
      // what makes the column read as a dense gel pour instead of flat
      // neon, and most of the body wears the deep end of the ramp now.
      (u.uDeepColor.value as Color)
        .copy(base)
        .multiplyScalar(0.3 + glow * 0.12)
        .lerp(_white, flash * 0.35);
      // The meniscus and surface sheen sit near-white: this is the "hot
      // filament" job the old solid core used to do — brightness says it's
      // a light, and now the brightness is the liquid's surface.
      (u.uFoamColor.value as Color).copy(base).lerp(_white, 0.72 + flash * 0.28);
    },
    dispose() {
      material.dispose();
      mesh.removeFromParent();
    },
  };
}
