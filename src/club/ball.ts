/**
 * THE BALL — how a raid is called from the club floor.
 *
 * Someone sends it up (from the SOCIAL panel or the board) and a mirror
 * ball hangs in front of them for sixty seconds, turning slowly, wearing a
 * countdown plate: the song, who called it, the seconds left, and who has
 * touched in — one orbiting pip per dancer, in their colour. TOUCH the
 * ball (hand close + trigger) to join the set; touch again to step back
 * out; the caller's touch waves it away. When the relay's clock runs out,
 * the caller and everyone holding a pip leave for the ring together — and
 * the floor keeps dancing without them.
 *
 * This module is the ball's body: the mesh kit and the spawn math.
 * ClubBallSystem drives it from net.ball.
 */

import {
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { PALETTE, hueToColor, seatHue } from '../config.js';
import { glowSprite } from '../materials/glow.js';
import { trackById } from '../audio/tracks.js';
import { CLUB } from './config.js';

export const BALL_TOUCH_RADIUS = 0.42;

/** Where a called ball hangs: ahead of the caller's head, chest-high,
 *  clamped into the hall so it never spawns inside the bar or a wall — and
 *  clear of the menu board's airspace, so the plate is never hidden behind
 *  the menus for the very dancer who called it. */
export function ballSpawnPos(head: Vector3, fwd: Vector3): [number, number, number] {
  const fx = fwd.x;
  const fz = fwd.z;
  const len = Math.hypot(fx, fz) || 1;
  let x = head.x + (fx / len) * 1.35;
  let z = head.z + (fz / len) * 1.35;
  x = Math.max(-CLUB.halfW + 1.2, Math.min(CLUB.bar.x - 1.0, x));
  z = Math.max(CLUB.minZ + 2.4, Math.min(CLUB.terrace.z0 - 0.6, z));
  // The board floats at (0, 1.42, −1.6): a ball called from the spawn would
  // hang right behind it. Slide such a ball out past the board's edge.
  if (Math.abs(x) < 1.3 && z > -2.7 && z < -0.7) {
    x = x >= 0 ? 1.6 : -1.6;
  }
  return [x, 1.5, z];
}

export interface BallVisual {
  group: Group;
  /** Spin this. */
  ball: Mesh;
  /** The countdown/track/joins plate under the ball (yaw-billboard it). */
  plate: Mesh;
  /** Repaint the plate. */
  paint(opts: {
    seconds: number;
    trackId: string;
    callerName: string;
    joinNames: string[];
    mine: boolean;
    joined: boolean;
    inReach: boolean;
  }): void;
  /** One orbiting pip per joined dancer, tinted their hue. */
  setPips(idxs: number[]): void;
  dispose(): void;
}

export function buildBallVisual(): BallVisual {
  const group = new Group();
  group.name = 'raid-ball';

  // The mirror ball itself — painted facets (nothing to reflect in a
  // procedural room), a hot core halo, a stem hanging it from nothing.
  const facets = document.createElement('canvas');
  facets.width = facets.height = 128;
  const fg = facets.getContext('2d')!;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const glint = Math.random();
      const l = glint > 0.86 ? 96 : 50 + Math.floor(glint * 30);
      fg.fillStyle = `hsl(${210 + glint * 40}, 20%, ${l}%)`;
      fg.fillRect(x * 8, y * 8, 7, 7);
    }
  }
  const ballTex = new CanvasTexture(facets);
  ballTex.colorSpace = SRGBColorSpace;
  const ball = new Mesh(new SphereGeometry(0.24, 18, 12), new MeshBasicMaterial({ map: ballTex, color: PALETTE.mirror }));
  group.add(ball);
  const stem = new Mesh(
    new CylinderGeometry(0.008, 0.008, 0.5, 6),
    new MeshStandardMaterial({ color: 0x22262e, metalness: 0.8, roughness: 0.4 }),
  );
  stem.position.y = 0.49;
  group.add(stem);
  group.add(glowSprite(0xffffff, 0.9, 0.4));

  // The plate.
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 300;
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  const plate = new Mesh(
    new PlaneGeometry(0.78, 0.457),
    new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: DoubleSide }),
  );
  plate.position.y = -0.52;
  plate.renderOrder = 26;
  group.add(plate);

  // Join pips: parked hidden; setPips shows one per joined dancer.
  const pipHolder = new Group();
  group.add(pipHolder);
  const pips: Mesh[] = [];
  for (let i = 0; i < 24; i++) {
    const pip = new Mesh(new SphereGeometry(0.028, 10, 8), new MeshBasicMaterial({ color: 0xffffff }));
    pip.visible = false;
    pipHolder.add(pip);
    pips.push(pip);
  }

  const paint: BallVisual['paint'] = ({ seconds, trackId, callerName, joinNames, mine, joined, inReach }) => {
    const g = canvas.getContext('2d')!;
    g.clearRect(0, 0, 512, 300);
    g.fillStyle = 'rgba(7,5,14,0.82)';
    g.beginPath();
    g.roundRect(4, 4, 504, 292, 26);
    g.fill();
    g.lineWidth = inReach ? 6 : 3;
    g.strokeStyle = inReach ? '#ffd24a' : 'rgba(255,42,213,0.8)';
    g.stroke();

    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // The clock — the headline.
    g.font = "900 92px 'Arial Black', system-ui, sans-serif";
    g.fillStyle = seconds <= 10 ? '#ffd24a' : '#f4f6fb';
    if (seconds <= 5) {
      g.shadowColor = '#ffd24a';
      g.shadowBlur = 26;
    }
    g.fillText(String(Math.max(0, seconds)), 256, 74);
    g.shadowBlur = 0;

    const track = trackById(trackId);
    g.font = "900 30px 'Arial Black', system-ui, sans-serif";
    g.fillStyle = '#4fb7ff';
    g.fillText(`♪ ${track ? track.title : 'SHUFFLE'}`, 256, 140);
    g.font = "700 24px 'Arial Black', system-ui, sans-serif";
    g.fillStyle = 'rgba(232,236,242,0.75)';
    g.fillText(`${callerName} calls the raid`, 256, 176);

    // The instruction line — the plate teaches the whole mechanic.
    g.font = "800 26px 'Arial Black', system-ui, sans-serif";
    if (mine) {
      g.fillStyle = '#ff5040';
      g.fillText('your ball — touch it to call it off', 256, 218);
    } else if (joined) {
      g.fillStyle = '#36e05a';
      g.fillText("YOU'RE ON — touch again to step out", 256, 218);
    } else {
      g.fillStyle = '#ffd24a';
      g.fillText('TOUCH THE BALL TO DANCE', 256, 218);
    }

    g.font = "700 22px 'Arial Black', system-ui, sans-serif";
    g.fillStyle = 'rgba(232,236,242,0.6)';
    const names = joinNames.slice(0, 6).join(' · ');
    const extra = joinNames.length > 6 ? ` +${joinNames.length - 6}` : '';
    g.fillText(joinNames.length ? `${names}${extra}` : 'nobody on it yet — the caller rides regardless', 256, 258, 480);
    tex.needsUpdate = true;
  };

  const setPips: BallVisual['setPips'] = (idxs) => {
    pips.forEach((pip, i) => {
      const idx = idxs[i];
      if (idx === undefined) {
        pip.visible = false;
        return;
      }
      const a = (i / Math.max(1, idxs.length)) * Math.PI * 2;
      pip.position.set(Math.sin(a) * 0.34, 0.02, Math.cos(a) * 0.34);
      (pip.material as MeshBasicMaterial).color.setHex(hueToColor(seatHue(idx), 0.62));
      pip.visible = true;
    });
    pipHolder.visible = idxs.length > 0;
  };

  return {
    group,
    ball,
    plate,
    paint,
    setPips,
    dispose() {
      group.removeFromParent();
      ballTex.dispose();
      tex.dispose();
      group.traverse((o) => {
        const m = o as Mesh;
        m.geometry?.dispose?.();
        (m.material as MeshBasicMaterial)?.dispose?.();
      });
    },
  };
}
