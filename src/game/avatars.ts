/**
 * The other dancers — neon ravers, one per occupied platform. A glowing
 * head + hover torso + two glowstick hands: cheap enough to run 23 of them,
 * expressive enough to read a duck, a lunge and a slump from across the ring.
 *
 * Everything is authored in PLATFORM-LOCAL space and parented to the seat's
 * platform root, so rank lifts and eliminations carry the dancer with the
 * deck for free. Remote humans stream their real head/hands into the same
 * rig; groupies get theirs synthesised by AvatarSystem.
 */

import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
} from 'three';
import { hueToColor } from '../config.js';
import { glowSprite } from '../materials/glow.js';

export interface DancerRig {
  root: Group;
  head: Group;
  torso: Mesh;
  handL: Group;
  handR: Group;
  /** Every accent material (dim on elimination, flash on hit). */
  accents: (MeshStandardMaterial | MeshBasicMaterial)[];
  baseColor: number;
  dispose(): void;
}

export function buildDancer(hue: number): DancerRig {
  const root = new Group();
  const color = hueToColor(hue, 0.6);
  const accents: DancerRig['accents'] = [];

  const neon = (): MeshStandardMaterial => {
    const m = new MeshStandardMaterial({
      color: 0x14161c,
      emissive: color,
      emissiveIntensity: 0.9,
      metalness: 0.4,
      roughness: 0.45,
    });
    accents.push(m);
    return m;
  };

  // Head: a glossy orb with a visor slit — every raver needs shades.
  const head = new Group();
  const skull = new Mesh(new SphereGeometry(0.11, 14, 10), neon());
  head.add(skull);
  const visor = new Mesh(
    new BoxGeometry(0.15, 0.045, 0.02),
    new MeshBasicMaterial({ color: 0x05070a }),
  );
  visor.position.set(0, 0.01, -0.095);
  head.add(visor);
  head.add(glowSprite(color, 0.5, 0.5));
  head.position.y = 1.45;
  root.add(head);

  // Hover torso: a tapered drum, no legs (the FIRE FIGHT doctrine — on brand
  // and honest: nobody tracks legs anyway).
  const torso = new Mesh(new CylinderGeometry(0.16, 0.1, 0.52, 10), neon());
  torso.position.y = 1.02;
  root.add(torso);

  // Hands with glowsticks.
  const mkHand = (side: -1 | 1): Group => {
    const hand = new Group();
    const palm = new Mesh(new SphereGeometry(0.05, 8, 6), neon());
    hand.add(palm);
    const stick = new Mesh(
      new CylinderGeometry(0.012, 0.012, 0.26, 6),
      new MeshBasicMaterial({ color }),
    );
    stick.position.y = 0.1;
    hand.add(stick);
    hand.add(glowSprite(color, 0.32, 0.6));
    hand.position.set(side * 0.32, 1.05, -0.08);
    root.add(hand);
    return hand;
  };
  const handL = mkHand(-1);
  const handR = mkHand(1);

  return {
    root,
    head,
    torso,
    handL,
    handR,
    accents,
    baseColor: color,
    dispose() {
      root.removeFromParent();
      root.traverse((o) => {
        const m = o as Mesh;
        m.geometry?.dispose?.();
        (m.material as MeshBasicMaterial)?.dispose?.();
      });
    },
  };
}
