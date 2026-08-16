/**
 * ClubSocialSystem — the people in the room, made present.
 *
 * While your room hangs on the club floor (hosting/joined), this system:
 *
 *  - streams YOUR spot — head + hands, club world space — at 12 Hz ('cp');
 *  - embodies every room-mate as a raver figure (the same slender rigs the
 *    raid uses, in their join colour) with a floating name tag that SWELLS
 *    while they talk, eased toward their streamed pose;
 *  - runs the voice room: auto-joins your mic on arrival (left Y mutes it),
 *    glues the audio listener to your head, and pins each dancer's voice to
 *    their figure — HRTF panners, distance falloff, a real hubbub. Voice
 *    carries within ONE PLACE only: the floor hears the floor, a set hears
 *    the set, and neither hears the other through the wall;
 *  - applies your safety lists every frame: a MUTED dancer goes silent, a
 *    BLOCKED one vanishes — figure, tag and voice, local only;
 *  - owns the SOCIAL panel (right Ⓐ on the club floor): everyone in the
 *    room, MUTE and BLOCK per dancer, your mic state, and the voice-chat
 *    master switch. The Horizon-store safety console, in house style.
 *
 * When a set drops, the figures pack away (the raid's AvatarSystem takes
 * over on the ring) but the VOICE stays live among the dancers ON it,
 * pinned to each one's platform — so a raid keeps talking through the set
 * it's dancing while the party it left carries on without it.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import {
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { DIFFICULTY, RING, hueToColor } from '../config.js';
import * as sfx from '../audio/sfx.js';
import { preload } from '../audio/music.js';
import { pickRaidTrack, trackById, tracksFor } from '../audio/tracks.js';
import { platformRoot } from '../arena/arena.js';
import { ballSpawnPos } from '../club/ball.js';
import { CLUB_NET } from '../club/config.js';
import { socialBlocked, socialMuted, toggleSocialBlock, toggleSocialMute } from '../club/social.js';
import {
  clearVoiceSpeakers,
  isSpeaking,
  isVoiceCapturing,
  isVoiceMuted,
  pushVoiceFrame,
  setVoiceEnabled,
  setVoiceSpeakerMuted,
  setVoiceSpeakerPosition,
  startVoiceCapture,
  stopVoiceCapture,
  toggleVoiceMuted,
  updateVoiceListener,
  voiceEnabled,
} from '../club/voice.js';
import { buildDancer, type DancerPose, type DancerRig } from '../game/avatars.js';
import { match } from '../game/state.js';
import { clubPoses, remotePoses } from '../net/poses.js';
import {
  callBall,
  cancelBall,
  leaveRoom,
  memberHue,
  net,
  onVoice,
  seatByIdx,
  sendClubPose,
  sendVoice,
} from '../net/session.js';
import { font } from '../ui/fonts.js';
import { Panel, UI, type PanelButton } from '../ui/panel.js';
import { PointerRay } from '../ui/pointer.js';

const TRACK_KEY = 'gdr-track';
const DIFF_KEY = 'gdr-diff';

const _v = new Vector3();
const _q = new Quaternion();
const _cam = new Vector3();
const _camQ = new Quaternion();
const _fwd = new Vector3();
const _o = new Vector3();
const _d = new Vector3();

interface ClubPuppet {
  idx: number;
  name: string;
  /** The hue this figure was built in — respawned if their pick changes. */
  hue: number;
  rig: DancerRig;
  tag: Mesh;
  tagMat: MeshBasicMaterial;
  pose: DancerPose;
  /** False until their first club pose arrives — no gliding in from spawn. */
  live: boolean;
}

function nameTagTexture(text: string, colorCss: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.font = font(700, 58);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = colorCss;
  g.shadowBlur = 24;
  g.fillStyle = colorCss;
  g.fillText(text, 256, 64, 470);
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(255,255,255,0.94)';
  g.font = font(700, 52);
  g.fillText(text, 256, 64, 460);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** One room-mate's live presence on the floor, published for the mirror.
 *  `pose` is the SAME object the puppet dances with (live reference, club
 *  world space); `shown` mirrors the figure's actual visibility — blocked
 *  dancers and dancers away on the ring are not shown, so they cast no
 *  reflection either. */
export interface FloorFigure {
  pose: DancerPose;
  hue: number;
  shown: boolean;
}

/** The club floor's figures by member idx (me excluded — I have no figure;
 *  ClubMirrorSystem builds my reflection from the headset directly). */
export const clubFloorFigures = new Map<number, FloorFigure>();

/** Headless/dev hook (wired into __gdr in main.ts): raise the SOCIAL panel
 *  without a controller. */
export const socialView: {
  show?: (on: boolean) => void;
  /** Is it actually up? `show(true)` off the club floor is refused, so the
   *  ask and the answer are not the same question. */
  shown?: () => boolean;
  snapSocial?: () => string;
  snapSongs?: () => string;
  openSongs?: (on: boolean) => void;
} = {};

export class ClubSocialSystem extends createSystem({}) {
  private crowd = new Group();
  private puppets = new Map<number, ClubPuppet>();
  private lastRosterKey = '';
  private sendT = 0;
  private voiceStarting = false;
  private voiceRetry = 0;

  private panel!: Panel;
  /** The song list, flown out beside the desk (see SONGS). */
  private songs!: Panel;
  private songsOpen = false;
  private songsKey = '';
  private pointers!: Record<'left' | 'right', PointerRay>;
  private ray = new Raycaster();
  private hover: string | null = null;
  private paintKey = '';
  private clock = 0;

  init(): void {
    this.crowd.name = 'club-crowd';
    this.scene.add(this.crowd);

    // Inbound voice frames route straight to their spatial speaker.
    onVoice((id, frame) => pushVoiceFrame(id, frame));

    // With the board gone from the club floor, this panel is the floor's
    // whole console — the extra rows (difficulty, leave) earn it the height.
    this.panel = new Panel(0.6, 0.99, 700, 1155);
    this.panel.setShown(false, true);
    this.panel.group.rotation.order = 'YXZ';
    this.scene.add(this.panel.group);

    // THE SONG LIST, as a leaf off the desk: the ♪ row used to CYCLE, so
    // finding a record meant tapping through fourteen of them and reading
    // the label each time. It flies out to the left instead, whole, and
    // rides the desk (a child of its group) wherever the desk is placed.
    this.songs = new Panel(0.38, 0.777, 440, 900);
    this.songs.setShown(false, true);
    this.songs.group.position.set(-0.51, 0.107, 0.008);
    this.panel.group.add(this.songs.group);

    this.pointers = { left: new PointerRay(this.scene), right: new PointerRay(this.scene) };

    socialView.show = (on) => {
      this.panel.setShown(on);
      if (!on) this.closeSongs();
      if (on) this.place();
      this.paintKey = '';
    };
    socialView.shown = () => this.panel.isShown;
    socialView.snapSongs = () => (this.songs.ctx().canvas as HTMLCanvasElement).toDataURL('image/png');
    socialView.openSongs = (on) => this.openSongs(on);
    socialView.snapSocial = () => (this.panel.ctx().canvas as HTMLCanvasElement).toDataURL('image/png');
  }

  update(delta: number): void {
    const inClub = match.screen === 'lobby' || match.screen === 'tour';
    const inRoom = net.phase === 'hosting' || net.phase === 'joined';
    const liveSet = net.phase === 'live';

    this.syncRoster(inRoom || liveSet);
    this.crowd.visible = inClub && inRoom;

    // ── voice: capture + listener, whether on the floor or mid-set ──────
    this.voiceRetry = Math.max(0, this.voiceRetry - delta);
    if ((inRoom || liveSet) && voiceEnabled() && !isVoiceCapturing() && !this.voiceStarting && this.voiceRetry <= 0) {
      // Entering a room came from a button press, so the gesture gate is
      // usually warm; if the mic is refused we retry on a cadence (any
      // fresh trigger press clears the wait faster).
      this.voiceStarting = true;
      void startVoiceCapture(sendVoice).then((ok) => {
        this.voiceStarting = false;
        if (!ok) this.voiceRetry = 2.0;
      });
    }
    if (!inRoom && !liveSet && isVoiceCapturing()) {
      stopVoiceCapture();
      clearVoiceSpeakers();
    }
    if (inRoom || liveSet) {
      // Left Y flips your mic, club floor or mid-set alike.
      if (this.input.xr.gamepads.left?.getButtonDown(InputComponent.Y_Button)) {
        toggleVoiceMuted();
        sfx.uiClick();
        this.paintKey = '';
      }
      this.camera.getWorldPosition(_cam);
      this.camera.getWorldQuaternion(_camQ);
      updateVoiceListener(_cam, _camQ);
    }

    // ── my own spot on the floor, streamed to the room ──────────────────
    if (inClub && inRoom) {
      this.sendT -= delta;
      if (this.sendT <= 0) {
        this.sendT = 1 / CLUB_NET.poseRateHz;
        this.pumpClubPose();
      }
    }

    // ── the crowd ───────────────────────────────────────────────────────
    const ease = 1 - Math.exp(-CLUB_NET.smoothing * delta);
    for (const p of this.puppets.values()) {
      const hidden = socialBlocked(p.name);
      // THE TWO ROOMS. A set and the club floor are different places, and
      // voice only carries within one: mid-set you hear the people dancing
      // it with you and not the party you left, and on the floor you hear
      // the floor and not a raid happening in another world. Spatial audio
      // needs somewhere to put a voice, and there is no honest answer for
      // "the club, from the ring" — it used to sing out of the stage, which
      // made a friend twenty metres away sound like they were in the set.
      //
      // The frames still arrive (the relay fans to the whole room); this is
      // a local gate, exactly like mute and block.
      const ring = seatByIdx.get(p.idx);
      const theyDance = liveSet ? ring !== undefined : net.gamePlayers.has(p.idx);
      const elsewhere = theyDance !== liveSet;
      setVoiceSpeakerMuted(String(p.idx), hidden || elsewhere || socialMuted(p.name));

      if (liveSet) {
        // I'M on the ring. Fellow players' voices pin to their dancer on
        // their own platform. Anyone still on the floor is muted above and
        // needs no position at all.
        if (ring === undefined) continue;
        const root = platformRoot(ring);
        const pose = remotePoses.get(ring);
        if (root && pose) {
          _v.set(pose.hx, pose.hy, pose.hz);
          root.localToWorld(_v);
          setVoiceSpeakerPosition(String(p.idx), _v);
        }
        continue;
      }

      if (net.gamePlayers.has(p.idx)) {
        // They're away playing: their figure steps off the floor and their
        // voice goes with them (muted above) until the set folds back.
        p.rig.root.visible = false;
        const away = clubFloorFigures.get(p.idx);
        if (away) away.shown = false;
        p.tag.visible = false;
        continue;
      }
      if (!this.crowd.visible) continue;

      const netPose = clubPoses.get(p.idx);
      if (netPose && !p.live) {
        // First sighting: appear where they actually stand, no glide-in.
        p.live = true;
        this.applyPose(p, netPose, 1);
      } else if (netPose) {
        this.applyPose(p, netPose, ease);
      }
      p.rig.root.visible = p.live && !hidden;
      p.tag.visible = p.live && !hidden;
      const fig = clubFloorFigures.get(p.idx);
      if (fig) fig.shown = p.rig.root.visible;
      if (!p.live || hidden) continue;

      this.camera.getWorldPosition(_cam);
      // DETAIL by distance, like the ring — but re-tested each frame,
      // because a club floor is people WALKING rather than fixed decks.
      // The hall is 18 m end to end, so somebody at the far booths is as
      // far off as the other side of a full ring. (setDetail early-outs
      // unless the answer actually changed.)
      p.rig.setDetail(
        (p.pose.hx - _cam.x) ** 2 + (p.pose.hz - _cam.z) ** 2 <= RING.detailRadius ** 2,
      );
      p.rig.pose(p.pose);
      // Their voice speaks from their figure's head.
      _v.set(p.pose.hx, p.pose.hy, p.pose.hz);
      setVoiceSpeakerPosition(String(p.idx), _v);
      // The name tag rides over the head, faces you, and swells a touch
      // while they hold the floor.
      p.tag.position.set(p.pose.hx, p.pose.hy + 0.38, p.pose.hz);
      p.tag.rotation.y = Math.atan2(_cam.x - p.pose.hx, _cam.z - p.pose.hz);
      const swell = isSpeaking(String(p.idx)) ? 1.14 : 1;
      p.tag.scale.set(swell, swell, 1);
    }

    // ── the SOCIAL panel ────────────────────────────────────────────────
    this.clock += delta;
    // The panel belongs to the SOCIAL FLOOR and nowhere else. It used to
    // open with no room too, on the theory that its empty state ("host or
    // join a room") was a signpost — but the foyer already has the board
    // for that, so all it did was put a second menu on a button in the
    // middle of the first one. Off the floor, right Ⓐ does nothing.
    this.updatePanel(delta, inClub && inRoom);
    const pulse = this.beatPulse();
    this.panel.tick(delta, pulse);
    this.songs.tick(delta, pulse);
  }

  /** The under-halo's beat envelope (the same curve the board uses) —
   *  ECLIPSE publishes match.beat on the floor; a house clock covers gaps. */
  private beatPulse(): number {
    const beat = Number.isFinite(match.beat) ? match.beat : this.clock / 0.86;
    const f = beat - Math.floor(beat);
    const att = Math.min(1, f / 0.06);
    const env = att * (1 - f) ** 3;
    return env * (Math.floor(beat) % 4 === 0 ? 1 : 0.5);
  }

  /* ── roster → puppets ─────────────────────────────────────────────────── */

  private syncRoster(connected: boolean): void {
    const key = connected
      ? net.members.map((m) => `${m.idx}:${m.name}:${memberHue(m).toFixed(4)}`).join('|') + `#${net.myIdx}`
      : '';
    if (key === this.lastRosterKey) return;
    this.lastRosterKey = key;

    // Everyone but me, in the colour they dance in — their own pick if they
    // made one back in the foyer, otherwise the neon their slot handed out.
    const want = new Map<number, { name: string; hue: number }>();
    if (connected) {
      for (const m of net.members) {
        if (m.idx !== net.myIdx) want.set(m.idx, { name: m.name, hue: memberHue(m) });
      }
    }
    // Despawn the departed — and anyone whose name or colour changed under
    // them, since both are baked into the rig and the tag's texture.
    for (const [idx, p] of [...this.puppets]) {
      const w = want.get(idx);
      if (!w || w.name !== p.name || Math.abs(w.hue - p.hue) > 1e-4) {
        p.rig.dispose();
        p.tag.removeFromParent();
        p.tagMat.map?.dispose();
        p.tagMat.dispose();
        this.puppets.delete(idx);
        clubFloorFigures.delete(idx);
      }
    }
    // Spawn the new (parked invisible until their first pose arrives).
    for (const [idx, { name, hue }] of want) {
      const existing = this.puppets.get(idx);
      if (existing) continue;
      const rig = buildDancer(hue);
      rig.root.visible = false;
      this.crowd.add(rig.root);
      const tagMat = new MeshBasicMaterial({
        map: nameTagTexture(name, `#${hueToColor(hue, 0.62).toString(16).padStart(6, '0')}`),
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      });
      const tag = new Mesh(new PlaneGeometry(0.72, 0.18), tagMat);
      tag.renderOrder = 24;
      tag.visible = false;
      this.crowd.add(tag);
      const pose: DancerPose = {
        hx: 0, hy: 1.55, hz: 3.8, yaw: 0,
        lx: -0.3, ly: 1.0, lz: 3.7, rx: 0.3, ry: 1.0, rz: 3.7,
        slump: 0,
      };
      this.puppets.set(idx, { idx, name, hue, rig, tag, tagMat, pose, live: false });
      // The mirror watches the same pose object the puppet dances with.
      clubFloorFigures.set(idx, { pose, hue, shown: false });
    }
    this.paintKey = ''; // roster changed → repaint the panel
  }

  private applyPose(p: ClubPuppet, s: { hx: number; hy: number; hz: number; hyaw: number; lx: number; ly: number; lz: number; rx: number; ry: number; rz: number }, k: number): void {
    const t = p.pose;
    t.hx += (s.hx - t.hx) * k;
    t.hy += (s.hy - t.hy) * k;
    t.hz += (s.hz - t.hz) * k;
    t.yaw += (s.hyaw - t.yaw) * k;
    t.lx += (s.lx - t.lx) * k;
    t.ly += (s.ly - t.ly) * k;
    t.lz += (s.lz - t.lz) * k;
    t.rx += (s.rx - t.rx) * k;
    t.ry += (s.ry - t.ry) * k;
    t.rz += (s.rz - t.rz) * k;
  }

  private pumpClubPose(): void {
    const headObj = this.playerHeadEntity?.object3D;
    if (!headObj) return;
    headObj.getWorldPosition(_v);
    headObj.getWorldQuaternion(_q);
    _fwd.set(0, 0, -1).applyQuaternion(_q);
    const yaw = Math.atan2(-_fwd.x, -_fwd.z);
    const d: number[] = [_v.x, _v.y, _v.z, yaw];
    for (const hand of ['left', 'right'] as const) {
      const obj = this.world.playerSpaceEntities?.raySpaces?.[hand]?.object3D;
      if (obj) {
        obj.getWorldPosition(_o);
        d.push(_o.x, _o.y, _o.z);
      } else {
        d.push(_v.x + (hand === 'left' ? -0.25 : 0.25), Math.max(0.6, _v.y - 0.6), _v.z - 0.1);
      }
    }
    sendClubPose(d);
  }

  /* ── the SOCIAL panel ─────────────────────────────────────────────────── */

  private updatePanel(delta: number, allowed: boolean): void {
    if (!allowed && this.panel.isShown) this.panel.setShown(false);
    if (allowed && this.input.xr.gamepads.right?.getButtonDown(InputComponent.A_Button)) {
      this.panel.setShown(!this.panel.isShown);
      if (this.panel.isShown) this.place();
      sfx.uiClick();
    }
    if (!this.panel.isShown) {
      this.pointers.left.hide();
      this.pointers.right.hide();
      return;
    }

    // Pointer: either controller ray; trigger clicks the hovered button.
    let hover: string | null = null;
    let clicked: string | null = null;
    for (const hand of ['left', 'right'] as const) {
      const p = this.pointers[hand];
      const rayObj = this.world.playerSpaceEntities?.raySpaces?.[hand]?.object3D;
      if (!rayObj) {
        p.hide();
        continue;
      }
      rayObj.getWorldPosition(_o);
      rayObj.getWorldQuaternion(_q);
      _d.set(0, 0, -1).applyQuaternion(_q).normalize();
      this.ray.set(_o, _d);
      this.ray.far = 3;
      // Both surfaces when the list is out — nearest hit wins, and the id
      // says which panel owns it ('song:' is the list's).
      const hit = this.ray.intersectObjects(
        this.songsOpen ? [this.panel.mesh, this.songs.mesh] : [this.panel.mesh],
        false,
      )[0];
      const owner = hit?.object === this.songs.mesh ? this.songs : this.panel;
      const id = hit?.uv ? owner.buttonAt(hit.uv.x, hit.uv.y) : null;
      p.update(delta, _o, hit ? hit.point : null, Boolean(id));
      if (!id) continue;
      hover = id;
      if (this.input.xr.gamepads[hand]?.getButtonDown(InputComponent.Trigger)) {
        clicked = id;
        p.click();
      }
    }
    if (hover !== this.hover) {
      this.hover = hover;
      if (hover) sfx.uiHover();
      this.paintKey = '';
      this.songsKey = '';
    }
    if (clicked) {
      sfx.uiClick();
      const onList = clicked.startsWith('song:');
      (onList ? this.songs : this.panel).press(clicked);
      if (onList) {
        const pick = clicked.slice(5);
        if (pick !== 'close') this.setTrack(pick === 'shuffle' ? '' : pick);
        this.closeSongs();
      } else if (clicked === 'voice') {
        setVoiceEnabled(!voiceEnabled());
      } else if (clicked === 'mic') {
        toggleVoiceMuted();
      } else if (clicked === 'track') {
        this.openSongs(!this.songsOpen);
      } else if (clicked === 'call') {
        this.callFromHere();
      } else if (clicked === 'cancel') {
        cancelBall();
      } else if (clicked.startsWith('diff')) {
        // The act floor for the chart my ball calls — same store the board
        // uses, so the foyer and the floor always agree.
        match.difficulty = Math.max(0, Math.min(3, Number(clicked.slice(4))));
        try {
          localStorage.setItem(DIFF_KEY, String(match.difficulty));
        } catch {
          /* fine */
        }
      } else if (clicked === 'leave') {
        this.panel.setShown(false);
        this.closeSongs();
        leaveRoom();
      } else if (clicked.startsWith('mute:')) {
        toggleSocialMute(clicked.slice(5));
      } else if (clicked.startsWith('block:')) {
        toggleSocialBlock(clicked.slice(6));
      }
      this.paintKey = '';
    }

    this.paint();
    if (this.songsOpen) this.paintSongs();
  }

  /* ── SONGS: the list that flies out of the ♪ row ──────────────────────── */

  private openSongs(on: boolean): void {
    this.songsOpen = on;
    this.songs.setShown(on);
    this.songsKey = '';
    this.paintKey = '';
    if (on) this.paintSongs();
  }

  private closeSongs(): void {
    if (this.songsOpen) this.openSongs(false);
  }

  /** Take a record (or '' for SHUFFLE). The pick rides the ball when I call
   *  one — same store the foyer's board uses, so the two always agree. */
  private setTrack(id: string): void {
    match.preferredTrack = id;
    try {
      localStorage.setItem(TRACK_KEY, id);
    } catch {
      /* fine */
    }
    preload(trackById(id) ?? pickRaidTrack(match.seed));
  }

  private paintSongs(): void {
    const pool = tracksFor('raid');
    const cur = match.preferredTrack || '';
    const key = `${cur}#${this.hover ?? ''}#${pool.length}`;
    if (key === this.songsKey) return;
    this.songsKey = key;

    const Y0 = 104;
    const CLOSE_Y = 848;
    const rows: { id: string; title: string; bpm: string }[] = [
      { id: 'shuffle', title: 'SHUFFLE', bpm: '—' },
      ...pool.map((t) => ({ id: t.id, title: t.title, bpm: String(Math.round(t.bpm)) })),
    ];
    // The whole shelf fits on one surface, however long the shelf gets: the
    // pitch tightens rather than running a record off the bottom edge.
    const PITCH = Math.min(46, (CLOSE_Y - Y0) / rows.length);
    const ROW_H = PITCH - 4;
    // Ghost hit-areas: the body paints the rows itself so the title and the
    // BPM can share one line (the kit's label/sub would stack them).
    const buttons: PanelButton[] = rows.map((r, i) => ({
      id: `song:${r.id}`,
      label: r.title,
      ghost: true,
      x: 16,
      y: Y0 + i * PITCH,
      w: 408,
      h: ROW_H,
    }));
    buttons.push({
      id: 'song:close',
      label: 'CLOSE',
      x: 16,
      y: CLOSE_Y,
      w: 408,
      h: 44,
      small: true,
    });

    this.songs.paint(
      '',
      (g) => {
        g.textBaseline = 'middle';
        g.textAlign = 'left';
        g.font = font(600, 22);
        g.letterSpacing = '4px';
        g.fillStyle = UI.dim;
        g.fillText('SELECT SONG', 22, 50);
        g.letterSpacing = '1.5px';
        g.font = font(500, 15);
        g.fillStyle = UI.faint;
        g.textAlign = 'right';
        g.fillText('BPM', 424, 50);
        g.letterSpacing = '0px';
        g.fillStyle = UI.lineFaint;
        g.fillRect(22, 76, 402, 2);

        rows.forEach((r, i) => {
          const y = Y0 + i * PITCH;
          const selected = cur === (r.id === 'shuffle' ? '' : r.id);
          const hov = this.songs.hoverOf(`song:${r.id}`);
          g.beginPath();
          g.roundRect(16, y, 408, ROW_H, 9);
          g.fillStyle = selected ? UI.accentFaint : `rgba(255,255,255,${(0.03 + 0.05 * hov).toFixed(3)})`;
          g.fill();
          if (selected) {
            g.lineWidth = 2;
            g.strokeStyle = UI.accentDim;
            g.stroke();
            g.fillStyle = UI.accent;
            g.beginPath();
            g.roundRect(21, y + 8, 4, ROW_H - 16, 2);
            g.fill();
          }
          const cy = y + ROW_H / 2 + 1;
          g.textAlign = 'left';
          g.font = font(600, Math.min(23, ROW_H - 19));
          g.letterSpacing = '1px';
          g.fillStyle = selected ? UI.textHi : UI.text;
          g.fillText(r.title, 38, cy, 286);
          g.letterSpacing = '0px';
          g.textAlign = 'right';
          g.font = font(500, 20);
          g.fillStyle = UI.dim;
          g.fillText(r.bpm, 408, cy);
        });
      },
      buttons,
      this.hover,
    );
  }

  /** Send the ball up just ahead of me, and warm my record for the drop. */
  private callFromHere(): void {
    const headObj = this.playerHeadEntity?.object3D;
    if (!headObj) return;
    headObj.getWorldPosition(_v);
    headObj.getWorldQuaternion(_q);
    _fwd.set(0, 0, -1).applyQuaternion(_q);
    callBall(ballSpawnPos(_v, _fwd));
    preload(trackById(match.preferredTrack) ?? pickRaidTrack(match.seed));
  }

  /** In front of you at waist height with a lectern lean, facing you. */
  private place(): void {
    this.camera.getWorldPosition(_cam);
    this.camera.getWorldQuaternion(_camQ);
    _fwd.set(0, 0, -1).applyQuaternion(_camQ);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1);
    _fwd.normalize();
    const m = this.panel.group;
    m.position.set(_cam.x + _fwd.x * 0.6, _cam.y - 0.42, _cam.z + _fwd.z * 0.6);
    m.rotation.set(-0.3, Math.atan2(_cam.x - m.position.x, _cam.z - m.position.z), 0);
    this.paintKey = '';
  }

  private paint(): void {
    const members = net.members.filter((m) => m.idx !== net.myIdx).slice(0, 8);
    const more = Math.max(0, net.members.length - 1 - members.length);
    const on = voiceEnabled();
    const mic = !isVoiceMuted() && isVoiceCapturing();
    const cued = trackById(match.preferredTrack);
    const ballUp = net.ball !== null;
    const mine = ballUp && net.ball!.callerIdx === net.myIdx;
    const setOut = net.gamePlayers.size > 0;
    const inRoom = net.phase === 'hosting' || net.phase === 'joined';
    const key =
      members.map((m) => `${m.name}|${socialMuted(m.name) ? 1 : 0}${socialBlocked(m.name) ? 1 : 0}`).join(';') +
      `#${this.hover ?? ''}#${on ? 1 : 0}#${mic ? 1 : 0}#${net.phase}#${cued?.id ?? ''}#${ballUp ? (mine ? 'B' : 'b') : ''}#${setOut ? net.gamePlayers.size : 0}#${more}#${match.difficulty}#${this.songsOpen ? 1 : 0}`;
    if (key === this.paintKey) return;
    this.paintKey = key;

    const buttons: PanelButton[] = [];
    const ROW0 = 172;
    const ROW_H = 58;
    members.forEach((m, i) => {
      const y = ROW0 + i * ROW_H;
      buttons.push({
        id: `mute:${m.name}`,
        label: socialMuted(m.name) ? 'MUTED' : 'MUTE',
        tone: socialMuted(m.name) ? UI.danger : undefined,
        x: 396,
        y,
        w: 136,
        h: 50,
        small: true,
      });
      buttons.push({
        id: `block:${m.name}`,
        label: socialBlocked(m.name) ? 'BLOCKED' : 'BLOCK',
        tone: socialBlocked(m.name) ? UI.danger : undefined,
        x: 546,
        y,
        w: 136,
        h: 50,
        small: true,
      });
    });

    // ── calling a raid: the song pick, the chart, the ball ──────────────
    buttons.push({
      id: 'track',
      // The chevron says the row opens onto something, rather than
      // advancing one notch per press.
      label: `${this.songsOpen ? '◂' : '▸'}  ♪ ${cued ? cued.title : 'SHUFFLE'}`,
      sub: cued ? `${cued.bpm.toFixed(cued.bpm % 1 ? 2 : 0)} BPM` : undefined,
      selected: this.songsOpen,
      x: 24,
      y: 652,
      w: 652,
      h: 74,
      small: true,
    });
    // DIFFICULTY: the chart's act floor — the caller's pick rides the ball
    // with the song (the board's row, moved in with the rest of the desk).
    DIFFICULTY.labels.forEach((label, i) => {
      buttons.push({
        id: `diff${i}`,
        label,
        selected: match.difficulty === i,
        x: 24 + i * 165,
        y: 740,
        w: 157,
        h: 54,
        small: true,
      });
    });
    if (mine) {
      buttons.push({
        id: 'cancel',
        label: 'CALL IT OFF',
        tone: UI.danger,
        x: 24,
        y: 808,
        w: 652,
        h: 74,
        small: true,
      });
    } else {
      // The floor's one CTA. It says what it does and nothing else: the
      // subtitle used to explain the ball's whole ritual to a room that
      // can see the ball hanging in front of them.
      buttons.push({
        id: 'call',
        label: ballUp ? 'BALL IS UP' : setOut ? 'SET IS OUT' : 'HOST',
        sub: setOut ? `${net.gamePlayers.size} on the ring` : undefined,
        primary: true,
        disabled: ballUp || setOut,
        x: 24,
        y: 808,
        w: 652,
        h: 74,
        small: true,
      });
    }

    buttons.push({
      id: 'mic',
      label: mic ? 'MIC LIVE — left Ⓨ mutes' : on ? 'MIC MUTED — left Ⓨ opens it' : 'MIC OFF',
      tone: mic ? UI.positive : UI.danger,
      x: 24,
      y: 896,
      w: 652,
      h: 54,
      small: true,
    });
    buttons.push({
      id: 'voice',
      label: on ? 'VOICE CHAT: ON' : 'VOICE CHAT: OFF',
      tone: on ? undefined : UI.danger,
      x: 24,
      y: 958,
      w: 652,
      h: 60,
      small: true,
    });
    if (inRoom) {
      // The board's LEAVE moved in with the desk — the one door out of the
      // room that isn't a set.
      buttons.push({
        id: 'leave',
        label: 'LEAVE THE CLUB',
        tone: UI.danger,
        x: 24,
        y: 1036,
        w: 652,
        h: 64,
        small: true,
      });
    }

    this.panel.paint(
      '',
      (g) => {
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        g.font = font(700, 42);
        g.letterSpacing = '3px';
        g.fillStyle = UI.textHi;
        g.fillText('THE ROOM', 28, 56);
        g.letterSpacing = '0px';
        if (inRoom) {
          // The code IS the invitation — it gets the data colour and the
          // wide tracking; everything around it stays quiet.
          g.font = font(600, 20);
          g.letterSpacing = '2px';
          g.fillStyle = UI.faint;
          g.fillText('ROOM', 28, 102);
          const rw = g.measureText('ROOM').width;
          g.font = font(700, 30);
          g.letterSpacing = '8px';
          g.fillStyle = UI.info;
          g.fillText(net.code, 28 + rw + 18, 102);
          const cw = g.measureText(net.code).width;
          g.font = font(500, 21);
          g.letterSpacing = '0.5px';
          g.fillStyle = UI.dim;
          g.fillText(`· ${net.members.length} on the floor`, 28 + rw + 18 + cw + 16, 102);
          g.font = font(500, 20);
          g.fillStyle = UI.faint;
          g.fillText('right Ⓐ closes', 28, 138);
        } else {
          g.font = font(500, 21);
          g.letterSpacing = '0.5px';
          g.fillStyle = UI.dim;
          g.fillText('host or join a room', 28, 102);
        }
        g.letterSpacing = '0px';

        members.forEach((m, i) => {
          const y = ROW0 + i * ROW_H + 25;
          const hidden = socialBlocked(m.name);
          const away = net.gamePlayers.has(m.idx);
          if (i > 0) {
            g.fillStyle = UI.lineFaint;
            g.fillRect(28, y - 29, 652 - 8, 1.5);
          }
          g.font = font(600, 29);
          g.letterSpacing = '1px';
          g.fillStyle = hidden
            ? UI.faint
            : `#${hueToColor(memberHue(m), 0.62).toString(16).padStart(6, '0')}`;
          const label = m.name.slice(0, 12);
          g.fillText(label, 28, y);
          g.letterSpacing = '0px';
          if (hidden) {
            const w = g.measureText(label).width;
            g.strokeStyle = 'rgba(172,182,198,0.6)';
            g.lineWidth = 2.5;
            g.beginPath();
            g.moveTo(28, y);
            g.lineTo(28 + w, y);
            g.stroke();
          }
          if (away) {
            g.fillStyle = UI.warn;
            g.font = font(600, 19);
            g.letterSpacing = '1.5px';
            g.fillText('ON THE RING', 246, y);
            g.letterSpacing = '0px';
          } else if (isSpeaking(String(m.idx))) {
            // The presence dot: they're holding the floor right now.
            g.fillStyle = UI.positive;
            g.shadowColor = UI.positive;
            g.shadowBlur = 8;
            g.beginPath();
            g.arc(352, y, 6, 0, Math.PI * 2);
            g.fill();
            g.shadowBlur = 0;
          }
        });
        if (more > 0) {
          g.font = font(500, 21);
          g.fillStyle = UI.dim;
          g.fillText(`…and ${more} more on the floor`, 28, ROW0 + members.length * ROW_H + 22);
        }
        if (!members.length) {
          g.font = font(500, 24);
          g.fillStyle = UI.dim;
          g.fillText('nobody else on the floor right now', 28, ROW0 + 30);
        }

        // Section seams: the ball's console, the voice desk, the door.
        g.fillStyle = UI.lineFaint;
        g.fillRect(24, 634, 652, 2);
        g.fillRect(24, 884, 652, 2);
        if (inRoom) g.fillRect(24, 1024, 652, 2);
      },
      buttons,
      this.hover,
    );
  }
}
