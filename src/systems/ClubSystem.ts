/**
 * ClubSystem — keeper of the venue's THREE places. The law of the land:
 * where you are is what you're doing.
 *
 *  1. THE FOYER — the menu place. Every menu screen (lobby, tour, map)
 *     stands at the front desk: the board, the coat check, the MC posing,
 *     and the closed doors to THE FLOOR with warm light in the crack.
 *  2. THE CLUB — the social place. Host or join a room and the doors do
 *     the rest: the full GILDED ECLIPSE hall swaps in around you — dance
 *     floor, eclipse chandelier, bar, booths, terrace, still room — with
 *     your room-mates live in it (ClubSocialSystem) and teleport movement
 *     (ClubTeleportSystem). Leave the room and you're back in the foyer.
 *  3. THE SET — the game place. The needle drops, both rooms pack away,
 *     and the passthrough raid takes your real room, exactly as ever.
 *
 * This system builds both interiors once, swaps them per frame, and keeps
 * whichever is open breathing:
 *
 *  - the eclipse chandelier counter-rotates and PHASES with the music,
 *    leaning into the kick; the moon brightens on the bar, the corona
 *    breathes; the floor's brass inlay (the raid ring's ghost) shimmers;
 *  - the bar's ribbed-glass wall pulses slow, candles flicker on one
 *    shared flame, the DJ console blinks, the still room's lamp breathes
 *    at a resting heart rate;
 *  - the foyer's door-crack glow warms while the relay is being reached
 *    and settles once you're through;
 *  - a whisper of FogExp2 gives the hall its depth (lifted for raids —
 *    passthrough must stay clean).
 *
 * THE STILL ROOM's law is enforced here: step through its door and the
 * club's music falls away to a murmur (setAmbientDuck), voices untouched.
 */

import { createSystem } from '@iwsdk/core';
import { FogExp2, type Scene } from 'three';
import { setAmbientDuck } from '../audio/music.js';
import { buildClub, buildFoyer, type ClubRefs, type FoyerRefs } from '../club/build.js';
import { CLUB } from '../club/config.js';
import { match } from '../game/state.js';
import { net } from '../net/session.js';

const FOG_DENSITY = 0.028;

export class ClubSystem extends createSystem({}) {
  private club: ClubRefs | null = null;
  private foyer: FoyerRefs | null = null;
  private fog = new FogExp2(0x0b0810, FOG_DENSITY);
  private clock = 0;
  private duckTarget = 1;

  init(): void {
    this.club = buildClub(this.scene);
    this.club.root.visible = false;
    this.foyer = buildFoyer(this.scene, this.club.candleMat);
    this.foyer.root.visible = false;
  }

  update(delta: number): void {
    const club = this.club;
    const foyer = this.foyer;
    if (!club || !foyer) return;

    const menuRoom = match.screen === 'lobby' || match.screen === 'map' || match.screen === 'tour';
    const social = net.phase === 'hosting' || net.phase === 'joined';
    const wantClub = menuRoom && social;
    const wantFoyer = menuRoom && !social;

    if (club.root.visible !== wantClub) club.root.visible = wantClub;
    if (foyer.root.visible !== wantFoyer) foyer.root.visible = wantFoyer;
    const fogged = wantClub || wantFoyer;
    if (((this.scene as Scene).fog !== null) !== fogged) {
      (this.scene as Scene).fog = fogged ? this.fog : null;
    }
    if (!wantClub && this.duckTarget !== 1) {
      // Leaving the floor (set booked, room left): the hush lifts.
      this.duckTarget = 1;
      setAmbientDuck(1);
    }

    this.clock += delta;
    const t = this.clock;

    // Beat: the lobby loop publishes one whenever it's running.
    const beat = Number.isFinite(match.beat) ? match.beat : t / 0.86;
    const beatFrac = beat - Math.floor(beat);
    const pulse = Math.max(0, 1 - beatFrac * 2.4); // crests on the kick, dies fast
    const bar = beat / 4;

    // The shared candle flame flickers for whichever room is lit.
    if (fogged) {
      club.candleMat.opacity = 0.74 + Math.sin(t * 12.7) * 0.07 + Math.sin(t * 29.3) * 0.05;
    }

    if (wantFoyer) {
      // The door crack: settled warmth, a slow breathe — and a reaching
      // flare while the relay is being rung.
      const reaching = net.phase === 'connecting';
      foyer.doorGlowMat.emissiveIntensity = reaching
        ? 0.9 + Math.sin(t * 6) * 0.5
        : 0.5 + Math.sin(t * 0.8) * 0.12 + pulse * 0.08;
    }

    if (wantClub) {
      // ── the eclipse ───────────────────────────────────────────────────
      club.chandelier.rings.forEach((ring, i) => {
        ring.pivot.rotation.y += ring.speed * delta;
        // The phase wave: one crest slowly orbiting the ring stack, plus a
        // gentle lean into the kick. Music-reactive, never strobing.
        const phase = Math.sin(bar * Math.PI * 0.5 - i * 1.1);
        ring.glowMat.emissiveIntensity = 1.05 + phase * 0.5 + pulse * 0.28;
      });
      club.chandelier.group.rotation.y += delta * 0.02; // stately drift
      club.chandelier.moonMat.emissiveIntensity = 1.0 + pulse * 0.3;
      club.chandelier.coronaMat.opacity = 0.42 + pulse * 0.2 + Math.sin(t * 0.7) * 0.06;

      // ── the floor's brass ghost-ring ──────────────────────────────────
      club.inlayMat.opacity = 0.34 + pulse * 0.3;

      // ── the bar wall, slow and low ────────────────────────────────────
      club.barBackMat.emissiveIntensity = 0.4 + Math.sin(t * 0.5) * 0.07 + pulse * 0.05;

      // ── the DJ console blinks along ───────────────────────────────────
      club.consoleMat.color.setScalar(0.82 + pulse * 0.18);

      // ── the still room's resting pulse ────────────────────────────────
      club.stillLampMat.emissiveIntensity = 1.0 + Math.sin(t * 0.9) * 0.22;

      // ── THE STILL ROOM's hush ─────────────────────────────────────────
      const Q = CLUB.quiet;
      const inside =
        match.headX >= Q.minX && match.headX <= Q.maxX && match.headZ >= Q.minZ && match.headZ <= Q.maxZ;
      const target = inside ? 0.1 : 1;
      if (target !== this.duckTarget) {
        this.duckTarget = target;
        setAmbientDuck(target);
      }
    }
  }
}
