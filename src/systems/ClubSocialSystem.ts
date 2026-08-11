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
 *    their figure — HRTF panners, distance falloff, a real hubbub;
 *  - applies your safety lists every frame: a MUTED dancer goes silent, a
 *    BLOCKED one vanishes — figure, tag and voice, local only;
 *  - owns the SOCIAL panel (right Ⓐ on the club floor): everyone in the
 *    room, MUTE and BLOCK per dancer, your mic state, and the voice-chat
 *    master switch. The Horizon-store safety console, in house style.
 *
 * When a set drops, the figures pack away (the raid's AvatarSystem takes
 * over on the ring) but the VOICE stays live — pinned to each dancer's
 * platform, so the room keeps talking through the set it's dancing.
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
import { hueToColor, seatHue } from '../config.js';
import * as sfx from '../audio/sfx.js';
import { platformRoot } from '../arena/arena.js';
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
import { net, onVoice, seatByIdx, sendClubPose, sendVoice } from '../net/session.js';
import { Panel, UI, type PanelButton } from '../ui/panel.js';

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
  g.font = "900 58px 'Arial Black', system-ui, sans-serif";
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = colorCss;
  g.shadowBlur = 24;
  g.fillStyle = colorCss;
  g.fillText(text, 256, 64, 470);
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(255,255,255,0.94)';
  g.font = "900 52px 'Arial Black', system-ui, sans-serif";
  g.fillText(text, 256, 64, 460);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

export class ClubSocialSystem extends createSystem({}) {
  private crowd = new Group();
  private puppets = new Map<number, ClubPuppet>();
  private lastRosterKey = '';
  private sendT = 0;
  private voiceStarting = false;
  private voiceRetry = 0;

  private panel!: Panel;
  private ray = new Raycaster();
  private hover: string | null = null;
  private paintKey = '';

  init(): void {
    this.crowd.name = 'club-crowd';
    this.scene.add(this.crowd);

    // Inbound voice frames route straight to their spatial speaker.
    onVoice((id, frame) => pushVoiceFrame(id, frame));

    this.panel = new Panel(0.58, 0.66, 700, 800);
    this.panel.mesh.visible = false;
    this.panel.mesh.rotation.order = 'YXZ';
    this.scene.add(this.panel.group);
  }

  update(delta: number): void {
    const inClub = match.screen === 'lobby' || match.screen === 'map' || match.screen === 'tour';
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
      setVoiceSpeakerMuted(String(p.idx), hidden || socialMuted(p.name));

      if (liveSet) {
        // Mid-set their figure lives on the ring (AvatarSystem's), but the
        // voice needs a home: pin it to their dancer on their platform.
        const seat = seatByIdx.get(p.idx);
        if (seat !== undefined) {
          const root = platformRoot(seat);
          const pose = remotePoses.get(seat);
          if (root && pose) {
            _v.set(pose.hx, pose.hy, pose.hz);
            root.localToWorld(_v);
            setVoiceSpeakerPosition(String(p.idx), _v);
          }
        }
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
      if (!p.live || hidden) continue;

      p.rig.pose(p.pose);
      // Their voice speaks from their figure's head.
      _v.set(p.pose.hx, p.pose.hy, p.pose.hz);
      setVoiceSpeakerPosition(String(p.idx), _v);
      // The name tag rides over the head, faces you, and swells a touch
      // while they hold the floor.
      p.tag.position.set(p.pose.hx, p.pose.hy + 0.38, p.pose.hz);
      this.camera.getWorldPosition(_cam);
      p.tag.rotation.y = Math.atan2(_cam.x - p.pose.hx, _cam.z - p.pose.hz);
      const swell = isSpeaking(String(p.idx)) ? 1.14 : 1;
      p.tag.scale.set(swell, swell, 1);
    }

    // ── the SOCIAL panel ────────────────────────────────────────────────
    this.updatePanel(inClub && (inRoom || net.phase === 'off' || net.phase === 'error'));
  }

  /* ── roster → puppets ─────────────────────────────────────────────────── */

  private syncRoster(connected: boolean): void {
    const key = connected ? net.members.map((m) => `${m.idx}:${m.name}`).join('|') + `#${net.myIdx}` : '';
    if (key === this.lastRosterKey) return;
    this.lastRosterKey = key;

    const want = new Map<number, string>();
    if (connected) {
      for (const m of net.members) {
        if (m.idx !== net.myIdx) want.set(m.idx, m.name);
      }
    }
    // Despawn the departed.
    for (const [idx, p] of [...this.puppets]) {
      if (!want.has(idx)) {
        p.rig.dispose();
        p.tag.removeFromParent();
        p.tagMat.map?.dispose();
        p.tagMat.dispose();
        this.puppets.delete(idx);
      }
    }
    // Spawn the new (parked invisible until their first pose arrives).
    for (const [idx, name] of want) {
      const existing = this.puppets.get(idx);
      if (existing) continue;
      const hue = seatHue(idx);
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
      this.puppets.set(idx, {
        idx,
        name,
        rig,
        tag,
        tagMat,
        pose: {
          hx: 0, hy: 1.55, hz: 3.8, yaw: 0,
          lx: -0.3, ly: 1.0, lz: 3.7, rx: 0.3, ry: 1.0, rz: 3.7,
          slump: 0,
        },
        live: false,
      });
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

  private updatePanel(allowed: boolean): void {
    if (!allowed && this.panel.mesh.visible) this.panel.mesh.visible = false;
    if (allowed && this.input.xr.gamepads.right?.getButtonDown(InputComponent.A_Button)) {
      this.panel.mesh.visible = !this.panel.mesh.visible;
      if (this.panel.mesh.visible) this.place();
      sfx.uiClick();
    }
    if (!this.panel.mesh.visible) return;

    // Pointer: either controller ray; trigger clicks the hovered button.
    let hover: string | null = null;
    let clicked: string | null = null;
    for (const hand of ['left', 'right'] as const) {
      const rayObj = this.world.playerSpaceEntities?.raySpaces?.[hand]?.object3D;
      if (!rayObj) continue;
      rayObj.getWorldPosition(_o);
      rayObj.getWorldQuaternion(_q);
      _d.set(0, 0, -1).applyQuaternion(_q).normalize();
      this.ray.set(_o, _d);
      this.ray.far = 3;
      const hit = this.ray.intersectObject(this.panel.mesh, false)[0];
      if (!hit?.uv) continue;
      const id = this.panel.buttonAt(hit.uv.x, hit.uv.y);
      if (!id) continue;
      hover = id;
      if (this.input.xr.gamepads[hand]?.getButtonDown(InputComponent.Trigger)) clicked = id;
    }
    if (hover !== this.hover) {
      this.hover = hover;
      if (hover) sfx.uiHover();
      this.paintKey = '';
    }
    if (clicked) {
      sfx.uiClick();
      if (clicked === 'voice') {
        setVoiceEnabled(!voiceEnabled());
      } else if (clicked === 'mic') {
        toggleVoiceMuted();
      } else if (clicked.startsWith('mute:')) {
        toggleSocialMute(clicked.slice(5));
      } else if (clicked.startsWith('block:')) {
        toggleSocialBlock(clicked.slice(6));
      }
      this.paintKey = '';
    }

    this.paint();
  }

  /** In front of you at waist height with a lectern lean, facing you. */
  private place(): void {
    this.camera.getWorldPosition(_cam);
    this.camera.getWorldQuaternion(_camQ);
    _fwd.set(0, 0, -1).applyQuaternion(_camQ);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1);
    _fwd.normalize();
    const m = this.panel.mesh;
    m.position.set(_cam.x + _fwd.x * 0.6, _cam.y - 0.42, _cam.z + _fwd.z * 0.6);
    m.rotation.set(-0.3, Math.atan2(_cam.x - m.position.x, _cam.z - m.position.z), 0);
    this.paintKey = '';
  }

  private paint(): void {
    const members = net.members.filter((m) => m.idx !== net.myIdx).slice(0, 12);
    const on = voiceEnabled();
    const mic = !isVoiceMuted() && isVoiceCapturing();
    const key =
      members.map((m) => `${m.name}|${socialMuted(m.name) ? 1 : 0}${socialBlocked(m.name) ? 1 : 0}`).join(';') +
      `#${this.hover ?? ''}#${on ? 1 : 0}#${mic ? 1 : 0}#${net.phase}`;
    if (key === this.paintKey) return;
    this.paintKey = key;

    const buttons: PanelButton[] = [];
    const ROW0 = 178;
    const ROW_H = 64;
    members.forEach((m, i) => {
      const y = ROW0 + i * ROW_H;
      buttons.push({
        id: `mute:${m.name}`,
        label: socialMuted(m.name) ? 'MUTED' : 'MUTE',
        accent: socialMuted(m.name) ? UI.danger : UI.amber,
        x: 396,
        y,
        w: 136,
        h: 52,
        small: true,
      });
      buttons.push({
        id: `block:${m.name}`,
        label: socialBlocked(m.name) ? 'BLOCKED' : 'BLOCK',
        accent: socialBlocked(m.name) ? UI.danger : UI.violet,
        x: 546,
        y,
        w: 136,
        h: 52,
        small: true,
      });
    });
    buttons.push({
      id: 'mic',
      label: mic ? 'MIC LIVE — left Ⓨ mutes' : on ? 'MIC MUTED — left Ⓨ opens it' : 'MIC OFF',
      accent: mic ? UI.goop : UI.danger,
      x: 24,
      y: 656,
      w: 652,
      h: 60,
      small: true,
    });
    buttons.push({
      id: 'voice',
      label: on ? 'VOICE CHAT: ON' : 'VOICE CHAT: OFF',
      sub: on ? 'the room can talk — spatial, by the figure' : 'hear no one, send nothing',
      accent: on ? UI.cyan : UI.danger,
      x: 24,
      y: 724,
      w: 652,
      h: 64,
      small: true,
    });

    this.panel.paint(
      '',
      (g) => {
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        g.font = "900 44px 'Arial Black', system-ui, sans-serif";
        g.fillStyle = UI.amber;
        g.fillText('THE ROOM', 28, 56);
        g.font = "700 22px 'Arial Black', system-ui, sans-serif";
        g.fillStyle = UI.dim;
        g.fillText(
          net.phase === 'hosting' || net.phase === 'joined'
            ? `${net.code} · mute silences · block also hides · yours to undo`
            : 'host or join a room and the floor fills up',
          28,
          98,
        );
        if (net.phase === 'hosting' || net.phase === 'joined') {
          g.fillText('right Ⓐ closes this panel', 28, 130);
        }
        members.forEach((m, i) => {
          const y = ROW0 + i * ROW_H + 26;
          const hidden = socialBlocked(m.name);
          g.font = "900 30px 'Arial Black', system-ui, sans-serif";
          g.fillStyle = hidden
            ? 'rgba(172,182,198,0.45)'
            : `#${hueToColor(seatHue(m.idx), 0.62).toString(16).padStart(6, '0')}`;
          const label = m.name.slice(0, 12);
          g.fillText(label, 28, y);
          if (hidden) {
            const w = g.measureText(label).width;
            g.strokeStyle = 'rgba(172,182,198,0.6)';
            g.lineWidth = 3;
            g.beginPath();
            g.moveTo(28, y);
            g.lineTo(28 + w, y);
            g.stroke();
          }
          if (isSpeaking(String(m.idx))) {
            g.fillStyle = UI.goop;
            g.font = "700 22px 'Arial Black', system-ui, sans-serif";
            g.fillText('◉', 340, y);
          }
        });
        if (!members.length) {
          g.font = "700 26px 'Arial Black', system-ui, sans-serif";
          g.fillStyle = UI.dim;
          g.fillText('nobody else on the floor right now', 28, ROW0 + 30);
        }
      },
      buttons,
      this.hover,
    );
  }
}
