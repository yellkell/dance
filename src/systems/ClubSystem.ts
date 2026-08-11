/**
 * ClubSystem — keeper of the venue's places. The law of the land: where
 * you are is what you're doing.
 *
 *  1. THE FOYER — the menu place, and a piece of THE VOID: a floating
 *     neon-edged platform in the set's own abstract space (pylons, slow
 *     hexes, drifting shards, a horizon with no land), with the board, the
 *     MC, and a moon-gate PORTAL shimmering shut until a room of yours is
 *     open beyond it.
 *  2. THE CLUB — the social place, the warm human room between the voids.
 *     Host or join and the portal does the rest: the Art Deco hall swaps
 *     in around you — dance floor, eclipse chandelier, bar, booths,
 *     terrace, still room — with your room-mates live in it
 *     (ClubSocialSystem) and teleport movement (ClubTeleportSystem).
 *  3. THE SET — the game place. The ball fires (or a solo set starts),
 *     both rooms pack away, and the raid takes over — wrapped in the void
 *     environment (DiscoSystem's business).
 *
 * This system builds both interiors once, swaps them per frame, and keeps
 * whichever is open breathing:
 *
 *  - club: the eclipse chandelier counter-rotates and PHASES with the
 *    music, leaning into the kick; the moon brightens on the bar; the
 *    floor's brass inlay (the raid ring's ghost) shimmers; the bar's
 *    ribbed glass pulses slow; candles flicker on one shared flame; the
 *    DJ console blinks; the still room's lamp breathes at rest.
 *  - foyer: the portal shimmer breathes (and flares while the relay is
 *    rung), the pylons roll a slow wave, the hexes turn, shards drift.
 *
 * Fog belongs to whoever's place is up — this system owns it for the foyer
 * and club and never clobbers the set's (DiscoSystem's) fog.
 *
 * THE STILL ROOM's law is enforced here: step through its door and the
 * club's music falls away to a murmur (setAmbientDuck), voices untouched.
 */

import { createSystem } from '@iwsdk/core';
import { FogExp2, type Scene } from 'three';
import { setAmbientDuck } from '../audio/music.js';
import { VOID_BG } from '../arena/voidkit.js';
import { buildClub, buildFoyer, type ClubRefs, type FoyerRefs } from '../club/build.js';
import { CLUB } from '../club/config.js';
import { match } from '../game/state.js';
import { net } from '../net/session.js';

export class ClubSystem extends createSystem({}) {
  private club: ClubRefs | null = null;
  private foyer: FoyerRefs | null = null;
  private clubFog = new FogExp2(0x0b0810, 0.028);
  private foyerFog = new FogExp2(VOID_BG, 0.026);
  private fogOwned: 'club' | 'foyer' | null = null;
  private clock = 0;
  private duckTarget = 1;

  init(): void {
    this.club = buildClub(this.scene);
    this.club.root.visible = false;
    this.foyer = buildFoyer(this.scene);
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

    // Fog handoff: claim it for our place, release it ONLY if it's ours —
    // the set's void fog is DiscoSystem's and must never be stomped here.
    const want: 'club' | 'foyer' | null = wantClub ? 'club' : wantFoyer ? 'foyer' : null;
    if (want !== this.fogOwned) {
      const scene = this.scene as Scene;
      if (want === null) {
        if (scene.fog === this.clubFog || scene.fog === this.foyerFog) scene.fog = null;
      } else {
        scene.fog = want === 'club' ? this.clubFog : this.foyerFog;
      }
      this.fogOwned = want;
    }
    if (!wantClub && this.duckTarget !== 1) {
      // Leaving the floor (set booked, room left): the hush lifts.
      this.duckTarget = 1;
      setAmbientDuck(1);
    }
    if (!wantClub && !wantFoyer) return;

    this.clock += delta;
    const t = this.clock;

    // Beat: the lobby loop publishes one whenever it's running.
    const beat = Number.isFinite(match.beat) ? match.beat : t / 0.86;
    const beatFrac = beat - Math.floor(beat);
    const pulse = Math.max(0, 1 - beatFrac * 2.4); // crests on the kick, dies fast
    const bar = beat / 4;

    if (wantFoyer) {
      // The portal: a settled breathing shimmer, flaring while the relay
      // is being rung — the way in, warming up.
      const reaching = net.phase === 'connecting';
      foyer.portalMat.opacity = reaching ? 0.3 + Math.sin(t * 7) * 0.16 : 0.12 + Math.sin(t * 0.9) * 0.05 + pulse * 0.04;
      foyer.portalRingMat.emissiveIntensity = reaching ? 1.6 + Math.sin(t * 7) * 0.5 : 1.05 + pulse * 0.2;
      // The void idles: a slow wave rolls the pylons, the hexes turn,
      // shards drift, the far grid breathes.
      foyer.pylons.forEach((p, i) => {
        const wave = Math.sin(t * 0.6 + i * 1.3);
        for (const m of p.glowMats) m.emissiveIntensity = 0.75 + Math.max(0, wave) * 0.4 + pulse * 0.18;
      });
      for (const r of foyer.rings) {
        r.mesh.rotation.z += r.speed * delta;
        r.mat.emissiveIntensity = 0.7 + pulse * 0.25;
      }
      for (const s of foyer.shards) {
        s.mesh.rotation.y += s.spin * delta;
        s.mesh.position.y = s.baseY + Math.sin(t * 0.4 + s.phase) * s.bob;
      }
      foyer.gridMat.opacity = 0.07 + pulse * 0.03;
    }

    if (wantClub) {
      // The shared candle flame flickers wherever it burns.
      club.candleMat.opacity = 0.74 + Math.sin(t * 12.7) * 0.07 + Math.sin(t * 29.3) * 0.05;

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
