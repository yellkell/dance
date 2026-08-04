/**
 * MenuSystem — the GREEN ROOM: menus as their own place, apart from the club.
 *
 * While you're on any menu screen the ring, stage and light rig are packed
 * away (ArenaSystem/DiscoSystem hide them); what's left is a quiet dark
 * room — soft key light, a neon floor ring, the GOOPLIATH lounging on one
 * side and the MC posing on the other — with one wide BOARD in front of
 * you, laid out like a modern live-service lobby:
 *
 *   ┌────────┬───────────────────────────────┐
 *   │ RAVE   │  HEADER: wordmark · status    │
 *   │  RAID  ├───────────────────────────────┤
 *   │ PLAY   │                               │
 *   │ TOUR   │   content cards per tab       │
 *   │ REHRSL │                               │
 *   │ SYSTEM │                               │
 *   ├────────┴───────────────────────────────┤
 *   │ footer hints                           │
 *   └────────────────────────────────────────┘
 *
 * One rail, one content region, no floating sub-panels. The rail tabs map
 * onto the flow screens (PLAY = lobby, TOUR = tour, REHEARSAL = map) plus
 * an in-panel SYSTEM mode; mid-set the board vanishes and the right
 * controller's A button is the only way out.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Group,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  Raycaster,
  RingGeometry,
  SphereGeometry,
  Vector3,
  type Intersection,
  type Object3D,
} from 'three';
import { GOOPLINGS, RING, TOUR } from '../config.js';
import * as sfx from '../audio/sfx.js';
import { musicVolume, preload, setMusicVolume } from '../audio/music.js';
import { pickRaidTrack, trackById, tracksFor } from '../audio/tracks.js';
import { finishTutorial, startRaid, startTutorial, toLobby, toMap, toTour } from '../game/flow.js';
import {
  allGooplingsCleared,
  clearedGooplings,
  clearedTourNights,
  gooplingUnlocked,
  match,
  tourNightUnlocked,
} from '../game/state.js';
import { cycleRoomDim, roomDimName } from './DiscoSystem.js';
import {
  CODE_ALPHABET,
  autoJoinFromUrl,
  hostRoom,
  joinRoom,
  leaveRoom,
  net,
  requestStart,
} from '../net/session.js';
import { Panel, UI, type PanelButton } from '../ui/panel.js';

const SEATS_KEY = 'gdr-seats';
const TRACK_KEY = 'gdr-track';

/** Canvas geometry of the board. */
const W = 1660;
const H = 1024;
const RAIL_X = 24;
const RAIL_W = 264;
const CONTENT_X = 320;
const CONTENT_W = 1300;

const SET_COLORS = ['#8cff70', '#ff6ee0', '#ffd24a'];

type Tab = 'play' | 'tour' | 'map' | 'sys';

interface Pointer {
  line: Line;
  dot: Mesh;
}

export class MenuSystem extends createSystem({}) {
  private board!: Panel;
  private exit!: Panel;
  private greenRoom!: Group;
  private pointers!: Record<'left' | 'right', Pointer>;
  private ray = new Raycaster();
  private hits: Intersection[] = [];
  private hover: string | null = null;
  private lastKey = '';
  private joinMode = false;
  private sysMode = false;
  private joinCode = [0, 0, 0, 0];
  private lastNetDirty = -1;

  init(): void {
    try {
      const stored = Number(localStorage.getItem(SEATS_KEY));
      if (Number.isFinite(stored) && stored >= RING.minSeats) {
        match.seats = Math.min(RING.maxSeats, stored);
      }
      const track = localStorage.getItem(TRACK_KEY);
      if (track && trackById(track)) match.preferredTrack = track;
    } catch {
      /* fine */
    }

    this.board = new Panel(1.72, 1.06, W, H);
    this.board.group.position.set(0, 1.42, -1.6);
    this.scene.add(this.board.group);

    this.exit = new Panel(0.62, 0.2, 640, 208);
    this.exit.group.position.set(0.85, 1.15, -0.95);
    this.exit.group.rotation.y = -0.5;
    this.scene.add(this.exit.group);

    this.buildGreenRoom();
    this.pointers = { left: this.makePointer(), right: this.makePointer() };

    autoJoinFromUrl();
  }

  /** The menu space itself: a key light, a neon floor ring and three slim
   *  pillars — enough room to read the characters, nothing of the club. */
  private buildGreenRoom(): void {
    this.greenRoom = new Group();
    this.greenRoom.name = 'green-room';

    this.greenRoom.add(new HemisphereLight(0xcfe0ff, 0x0a0812, 0.85));
    const key = new PointLight(0xffffff, 1.3, 14, 1.7);
    key.position.set(0, 2.8, -1.8);
    this.greenRoom.add(key);

    const ringMat = (color: number, opacity: number) =>
      new MeshBasicMaterial({ color, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false });
    const innerRing = new Mesh(new RingGeometry(1.35, 1.48, 48), ringMat(0xff2ad5, 0.5));
    innerRing.rotation.x = -Math.PI / 2;
    innerRing.position.y = 0.012;
    this.greenRoom.add(innerRing);
    const outerRing = new Mesh(new RingGeometry(2.5, 2.56, 56), ringMat(0x4fb7ff, 0.22));
    outerRing.rotation.x = -Math.PI / 2;
    outerRing.position.y = 0.01;
    this.greenRoom.add(outerRing);

    const pillarColors = [0xb06bff, 0xff2ad5, 0x4fb7ff];
    for (let i = 0; i < 3; i++) {
      const pillar = new Mesh(new BoxGeometry(0.05, 2.7, 0.05), ringMat(pillarColors[i], 0.5));
      pillar.position.set((i - 1) * 2.3, 1.35, -3.6);
      this.greenRoom.add(pillar);
    }
    this.scene.add(this.greenRoom);
  }

  private makePointer(): Pointer {
    const geo = new BufferGeometry().setFromPoints([new Vector3(), new Vector3(0, 0, -1)]);
    const line = new Line(geo, new LineBasicMaterial({ color: 0xff2ad5, transparent: true, opacity: 0.8 }));
    line.frustumCulled = false;
    line.visible = false;
    const dot = new Mesh(new SphereGeometry(0.012, 10, 8), new MeshBasicMaterial({ color: 0xffd9f6 }));
    dot.visible = false;
    this.scene.add(line);
    this.scene.add(dot);
    return { line, dot };
  }

  private activeTab(): Tab {
    if (match.screen === 'tour') return 'tour';
    if (match.screen === 'map') return 'map';
    return this.sysMode ? 'sys' : 'play';
  }

  update(): void {
    const screen = match.screen;

    // Mid-set escape hatch: right A bails.
    if (screen === 'raid' || screen === 'tutorial' || screen === 'countdown') {
      if (this.input.xr.gamepads.right?.getButtonDown(InputComponent.A_Button)) {
        sfx.uiClick();
        if (match.after === 'tutorial') finishTutorial(false);
        else toLobby();
      }
    }

    const menuRoom = screen === 'lobby' || screen === 'map' || screen === 'tour';
    const exitUp = screen === 'tutorial' || screen === 'podium';
    this.board.group.visible = menuRoom;
    this.greenRoom.visible = menuRoom;
    this.exit.group.visible = exitUp;

    if (!menuRoom && !exitUp) {
      this.hidePointers();
      return;
    }

    // Pointers + hover + click.
    const targets: Object3D[] = [];
    if (menuRoom) targets.push(this.board.mesh);
    if (exitUp) targets.push(this.exit.mesh);

    let hover: string | null = null;
    let clicked: string | null = null;
    for (const hand of ['left', 'right'] as const) {
      const hit = this.updatePointer(hand, targets);
      if (hit?.uv) {
        const panel = this.panelFor(hit.object);
        const id = panel?.buttonAt(hit.uv.x, hit.uv.y) ?? null;
        if (id) {
          hover = id;
          if (this.input.xr.gamepads[hand]?.getButtonDown(InputComponent.Trigger)) clicked = id;
        }
      }
    }
    if (hover !== this.hover) {
      this.hover = hover;
      if (hover) sfx.uiHover();
    }
    if (clicked) {
      sfx.uiClick();
      this.action(clicked);
    }

    this.repaintIfNeeded();
  }

  private panelFor(obj: Object3D): Panel | null {
    if (obj === this.board.mesh) return this.board;
    if (obj === this.exit.mesh) return this.exit;
    return null;
  }

  private updatePointer(hand: 'left' | 'right', targets: Object3D[]): Intersection | undefined {
    const p = this.pointers[hand];
    const rayObj = this.world.playerSpaceEntities?.raySpaces?.[hand]?.object3D;
    if (!rayObj) {
      p.line.visible = false;
      p.dot.visible = false;
      return undefined;
    }
    rayObj.getWorldPosition(_origin);
    rayObj.getWorldDirection(_dir).negate();
    this.ray.set(_origin, _dir);
    this.hits.length = 0;
    const hit = this.ray.intersectObjects(targets, false, this.hits)[0];
    _end.copy(hit ? hit.point : _origin.clone().addScaledVector(_dir, 1.8));
    const pos = p.line.geometry.getAttribute('position');
    pos.setXYZ(0, _origin.x, _origin.y, _origin.z);
    pos.setXYZ(1, _end.x, _end.y, _end.z);
    pos.needsUpdate = true;
    p.line.visible = true;
    p.dot.visible = Boolean(hit);
    if (hit) p.dot.position.copy(hit.point);
    return hit;
  }

  private hidePointers(): void {
    for (const hand of ['left', 'right'] as const) {
      this.pointers[hand].line.visible = false;
      this.pointers[hand].dot.visible = false;
    }
  }

  /* ── actions ──────────────────────────────────────────────────────────── */

  private action(id: string): void {
    if (id === 'tab-play') {
      this.sysMode = false;
      this.joinMode = false;
      if (match.screen !== 'lobby') toLobby();
    } else if (id === 'tab-tour') {
      this.sysMode = false;
      this.joinMode = false;
      if (match.screen !== 'tour') toTour();
    } else if (id === 'tab-map') {
      this.sysMode = false;
      this.joinMode = false;
      if (match.screen !== 'map') toMap();
    } else if (id === 'tab-sys') {
      this.joinMode = false;
      this.sysMode = true;
      if (match.screen !== 'lobby') toLobby();
    } else if (id === 'raid') {
      if (net.phase === 'hosting') requestStart(match.seats, match.preferredTrack);
      else startRaid({ seats: match.seats });
    } else if (id.startsWith('night')) {
      const [s, i] = id.slice(5).split('-').map(Number);
      if (tourNightUnlocked(s, i)) startRaid({ seats: match.seats, tour: { set: s, song: i } });
    } else if (id === 'seats-' || id === 'seats+') {
      const step = id === 'seats+' ? 4 : -4;
      match.seats = Math.max(RING.minSeats, Math.min(RING.maxSeats, match.seats + step));
      match.generation++; // the next set is booked at this size
      try {
        localStorage.setItem(SEATS_KEY, String(match.seats));
      } catch {
        /* fine */
      }
    } else if (id === 'vol-' || id === 'vol+') {
      setMusicVolume(musicVolume() + (id === 'vol+' ? 0.1 : -0.1));
    } else if (id === 'dim') {
      cycleRoomDim();
    } else if (id === 'track') {
      // Cycle: SHUFFLE → each raid record → back. Picking one warms it so
      // the drop is instant; SHUFFLE lets the match seed choose (and every
      // client in a room derives the same record from that seed).
      const pool = tracksFor('raid');
      const at = pool.findIndex((t) => t.id === match.preferredTrack);
      const next = at + 1 >= pool.length ? '' : pool[at + 1].id;
      match.preferredTrack = next;
      try {
        localStorage.setItem(TRACK_KEY, next);
      } catch {
        /* fine */
      }
      preload(trackById(next) ?? pickRaidTrack(match.seed));
    } else if (id === 'host') {
      hostRoom();
    } else if (id === 'join') {
      this.joinMode = true;
    } else if (id === 'leave') {
      leaveRoom();
    } else if (id.startsWith('slot')) {
      const i = Number(id.slice(4));
      this.joinCode[i] = (this.joinCode[i] + 1) % CODE_ALPHABET.length;
    } else if (id === 'go-join') {
      joinRoom(this.joinCode.map((i) => CODE_ALPHABET[i]).join(''));
      this.joinMode = false;
    } else if (id === 'back') {
      this.joinMode = false;
    } else if (id.startsWith('node')) {
      startTutorial(Number(id.slice(4)));
    } else if (id === 'exit') {
      if (match.screen === 'tutorial') finishTutorial(false);
      else toLobby();
    }
    this.lastKey = ''; // force repaint
  }

  /* ── painting ─────────────────────────────────────────────────────────── */

  private repaintIfNeeded(): void {
    if (net.dirty !== this.lastNetDirty) {
      this.lastNetDirty = net.dirty;
      this.lastKey = '';
    }
    const key = [
      match.screen,
      this.hover,
      this.joinMode,
      this.sysMode,
      this.joinCode.join(''),
      match.seats,
      Math.round(musicVolume() * 10),
      roomDimName(),
      net.phase,
      net.code,
      net.members.length,
      match.tutorialClears,
      clearedTourNights().size,
    ].join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;

    if (match.screen === 'lobby' || match.screen === 'map' || match.screen === 'tour') {
      this.paintBoard();
    }
    if (match.screen === 'tutorial' || match.screen === 'podium') {
      this.exit.paint(
        '',
        () => {},
        [
          {
            id: 'exit',
            label: match.screen === 'tutorial' ? 'END REHEARSAL' : 'BACK TO THE GREEN ROOM',
            accent: UI.danger,
            x: 24,
            y: 24,
            w: 592,
            h: 160,
            small: true,
          },
        ],
        this.hover,
      );
    }
  }

  /** The shell every tab shares: header, rail, footer — then the content. */
  private paintBoard(): void {
    const tab = this.activeTab();
    const buttons: PanelButton[] = [];

    // The rail.
    const tabs: { id: string; tab: Tab; label: string; sub?: string }[] = [
      { id: 'tab-play', tab: 'play', label: '▶ PLAY' },
      { id: 'tab-tour', tab: 'tour', label: '🗺 THE TOUR', sub: this.tourProgressSub() },
      { id: 'tab-map', tab: 'map', label: '🎓 REHEARSAL', sub: this.rehearsalSub() },
      { id: 'tab-sys', tab: 'sys', label: '⚙ SYSTEM' },
    ];
    tabs.forEach((t, i) => {
      buttons.push({
        id: t.id,
        label: t.label,
        sub: t.sub,
        accent: tab === t.tab ? UI.goop : undefined,
        x: RAIL_X + 12,
        y: 152 + i * 118,
        w: RAIL_W - 24,
        h: 102,
        small: true,
      });
    });

    // Tab content.
    if (tab === 'tour') this.tourContent(buttons);
    else if (tab === 'map') this.rehearsalContent(buttons);
    else if (tab === 'sys') this.systemContent(buttons);
    else if (this.joinMode) this.joinContent(buttons);
    else this.playContent(buttons);

    this.board.paint('', (g) => this.drawShell(g, tab), buttons, this.hover);
  }

  private tourProgressSub(): string {
    const done = clearedTourNights().size;
    const all = TOUR.sets.length * 3;
    return done >= all ? 'complete ✓' : `${done}/${all} nights`;
  }

  private rehearsalSub(): string {
    return allGooplingsCleared() ? 'rave ready ✓' : `${clearedGooplings().size}/${GOOPLINGS.length} moves`;
  }

  private drawShell(g: CanvasRenderingContext2D, tab: Tab): void {
    // Header.
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = "900 58px 'Arial Black', system-ui, sans-serif";
    g.fillStyle = UI.magenta;
    g.shadowColor = UI.magenta;
    g.shadowBlur = 22;
    g.fillText('RAVE RAID', 40, 66);
    g.shadowBlur = 0;
    g.font = "700 20px 'Arial Black', system-ui, sans-serif";
    g.fillStyle = UI.dim;
    g.fillText('feat. THE GOOPLIATH', 44, 108);

    // Header status, right-aligned.
    g.textAlign = 'right';
    g.font = "700 24px 'Arial Black', system-ui, sans-serif";
    if (net.phase === 'error') {
      g.fillStyle = UI.danger;
      g.fillText(`⚠ ${net.error}`, W - 40, 56);
    } else if (net.phase === 'hosting' || net.phase === 'joined') {
      g.fillStyle = UI.amber;
      g.fillText(`ROOM ${net.code} · ${net.members.length} IN`, W - 40, 56);
    } else if (net.phase === 'connecting') {
      g.fillStyle = UI.dim;
      g.fillText('REACHING THE RELAY…', W - 40, 56);
    } else {
      g.fillStyle = UI.dim;
      g.fillText('OFFLINE · SOLO + GROUPIES', W - 40, 56);
    }
    g.font = "700 18px 'Arial Black', system-ui, sans-serif";
    g.fillStyle = 'rgba(232,236,242,0.35)';
    g.fillText(`${match.seats}-DANCER RING`, W - 40, 92);

    // Rail plate + active accent bar.
    g.fillStyle = 'rgba(12,9,22,0.66)';
    g.beginPath();
    g.roundRect(RAIL_X, 136, RAIL_W, 500, 22);
    g.fill();
    const tabIndex = { play: 0, tour: 1, map: 2, sys: 3 }[tab];
    g.fillStyle = UI.goop;
    g.beginPath();
    g.roundRect(RAIL_X + 2, 158 + tabIndex * 118, 6, 90, 3);
    g.fill();

    // Header divider.
    g.fillStyle = 'rgba(255,42,213,0.35)';
    g.fillRect(28, 130, W - 56, 2);

    // Tab-specific body decoration.
    if (tab === 'tour') this.drawTourCards(g);
    if (tab === 'map') {
      g.textAlign = 'left';
      g.font = "700 24px 'Arial Black', system-ui, sans-serif";
      g.fillStyle = allGooplingsCleared() ? UI.goop : UI.dim;
      g.fillText(
        allGooplingsCleared()
          ? 'RAVE READY — every move in your feet'
          : 'five gooplings · five moves · clear the row',
        CONTENT_X,
        920,
      );
    }
    if (tab === 'sys') {
      g.textAlign = 'left';
      g.font = "700 24px 'Arial Black', system-ui, sans-serif";
      g.fillStyle = UI.dim;
      g.fillText('RAVE RAID · a passthrough rhythm raid', CONTENT_X, 560);
      g.fillText('records measured to the beat · every client dances the same set', CONTENT_X, 600);
    }
    if (tab === 'play' && !this.joinMode) {
      // Tonight strip.
      g.textAlign = 'left';
      g.font = "900 26px 'Arial Black', system-ui, sans-serif";
      g.fillStyle = UI.cyan;
      g.fillText('TONIGHT', CONTENT_X, 700);
      g.font = "700 23px 'Arial Black', system-ui, sans-serif";
      g.fillStyle = UI.dim;
      g.fillText('dodge the moves · ride the beat · outlast the floor', CONTENT_X, 740);
      g.fillText('groove pays: one stick up, one down, swap on the kick', CONTENT_X, 776);
      const done = clearedTourNights().size;
      g.fillStyle = done ? UI.goop : UI.dim;
      g.fillText(
        done ? `tour: ${done}/${TOUR.sets.length * 3} nights cleared` : 'the TOUR awaits — three sets, three records each',
        CONTENT_X,
        812,
      );
    }

    // Footer.
    g.textAlign = 'center';
    g.font = "700 21px 'Arial Black', system-ui, sans-serif";
    g.fillStyle = 'rgba(232,236,242,0.4)';
    g.fillText('point · pull the trigger — mid-set the board packs away, right Ⓐ bails', W / 2, 992);
  }

  /* ── PLAY ── */

  private playContent(buttons: PanelButton[]): void {
    const online = net.phase;
    const cued = trackById(match.preferredTrack);

    buttons.push({
      id: 'raid',
      label: online === 'hosting' ? 'DROP THE SET' : online === 'joined' ? 'WAITING FOR HOST…' : 'START RAID',
      sub:
        online === 'hosting'
          ? `${net.members.length} human${net.members.length === 1 ? '' : 's'} + groupies · the MC runs the stage`
          : online === 'joined'
            ? `room ${net.code}`
            : `you + ${match.seats - 1} goo-groupies · the MC runs the stage`,
      accent: UI.goop,
      disabled: online === 'joined' || online === 'connecting',
      x: CONTENT_X,
      y: 152,
      w: CONTENT_W,
      h: 210,
    });

    buttons.push({
      id: 'track',
      label: cued ? `♪ ${cued.title}` : '♪ SHUFFLE',
      sub: cued
        ? `${cued.bpm.toFixed(cued.bpm % 1 ? 2 : 0)} BPM · ${Math.round(cued.seconds / 6) / 10} min`
        : 'the match seed picks the record',
      accent: UI.cyan,
      x: CONTENT_X,
      y: 392,
      w: 640,
      h: 112,
      small: true,
    });
    buttons.push({ id: 'seats-', label: '−', x: 976, y: 392, w: 104, h: 112, disabled: match.seats <= RING.minSeats });
    buttons.push({
      id: 'seats',
      label: `${match.seats} DANCERS`,
      x: 1092,
      y: 392,
      w: 220,
      h: 112,
      disabled: true,
      small: true,
    });
    buttons.push({ id: 'seats+', label: '+', x: 1324, y: 392, w: 104, h: 112, disabled: match.seats >= RING.maxSeats });

    if (online === 'hosting' || online === 'joined') {
      buttons.push({
        id: 'code',
        label: `ROOM ${net.code}`,
        sub: `share the code or ?room=${net.code}`,
        accent: UI.amber,
        disabled: true,
        x: CONTENT_X,
        y: 528,
        w: 856,
        h: 108,
        small: true,
      });
      buttons.push({ id: 'leave', label: 'LEAVE', accent: UI.danger, x: 1192, y: 528, w: 236, h: 108, small: true });
    } else {
      buttons.push({
        id: 'host',
        label: 'HOST ROOM',
        sub: 'up to 24 humans',
        accent: UI.amber,
        disabled: online === 'connecting',
        x: CONTENT_X,
        y: 528,
        w: 640,
        h: 108,
        small: true,
      });
      buttons.push({
        id: 'join',
        label: 'JOIN ROOM',
        sub: 'enter a 4-letter code',
        accent: UI.amber,
        disabled: online === 'connecting',
        x: 976,
        y: 528,
        w: 452,
        h: 108,
        small: true,
      });
    }
  }

  private joinContent(buttons: PanelButton[]): void {
    for (let i = 0; i < 4; i++) {
      buttons.push({
        id: `slot${i}`,
        label: CODE_ALPHABET[this.joinCode[i]],
        x: 460 + i * 200,
        y: 280,
        w: 180,
        h: 190,
      });
    }
    buttons.push({ id: 'go-join', label: 'JOIN', accent: UI.goop, x: 560, y: 540, w: 360, h: 116 });
    buttons.push({ id: 'back', label: 'BACK', accent: UI.danger, x: 560, y: 690, w: 360, h: 88, small: true });
  }

  /* ── THE TOUR ── */

  private drawTourCards(g: CanvasRenderingContext2D): void {
    TOUR.sets.forEach((set, s) => {
      const y = 152 + s * 250;
      g.fillStyle = 'rgba(14,10,24,0.7)';
      g.beginPath();
      g.roundRect(CONTENT_X, y, CONTENT_W, 232, 20);
      g.fill();
      g.strokeStyle = SET_COLORS[s % SET_COLORS.length];
      g.globalAlpha = 0.55;
      g.lineWidth = 2;
      g.stroke();
      g.globalAlpha = 1;
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.font = "900 30px 'Arial Black', system-ui, sans-serif";
      g.fillStyle = SET_COLORS[s % SET_COLORS.length];
      g.fillText(`SET ${s + 1} — ${set.name}`, CONTENT_X + 28, y + 38);
    });
  }

  private tourContent(buttons: PanelButton[]): void {
    const done = clearedTourNights();
    TOUR.sets.forEach((set, s) => {
      const cardY = 152 + s * 250;
      set.songs.forEach((songId, i) => {
        const track = trackById(songId);
        const unlocked = tourNightUnlocked(s, i);
        const cleared = done.has(`${s}:${i}`);
        const finale = i === 2;
        buttons.push({
          id: `night${s}-${i}`,
          label: `${cleared ? '✓ ' : unlocked ? '' : '🔒 '}${track?.title ?? songId}`,
          sub: finale ? 'GOOP FINALE 👁' : `night ${i + 1} · ${Math.round(track?.bpm ?? 0)} BPM`,
          accent: cleared ? UI.goop : finale ? UI.magenta : UI.cyan,
          disabled: !unlocked,
          x: CONTENT_X + 28 + i * 424,
          y: cardY + 66,
          w: 400,
          h: 142,
          small: true,
        });
      });
    });
    buttons.push({
      id: 'more',
      label: '🔒 MORE SETS ON THE WAY — the tour keeps growing',
      disabled: true,
      x: CONTENT_X,
      y: 912,
      w: CONTENT_W,
      h: 56,
      small: true,
    });
  }

  /* ── REHEARSAL ── */

  private rehearsalContent(buttons: PanelButton[]): void {
    const cleared = clearedGooplings();
    GOOPLINGS.forEach((gp, i) => {
      const unlocked = gooplingUnlocked(i);
      const done = cleared.has(gp.id);
      buttons.push({
        id: `node${i}`,
        label: `${done ? '✓ ' : unlocked ? '' : '🔒 '}${gp.name}`,
        sub: `${gp.epithet} · teaches ${gp.move.toUpperCase()}`,
        accent: done ? UI.goop : unlocked ? UI.magenta : undefined,
        disabled: !unlocked,
        x: CONTENT_X,
        y: 152 + i * 142,
        w: CONTENT_W,
        h: 124,
        small: true,
      });
    });
  }

  /* ── SYSTEM ── */

  private systemContent(buttons: PanelButton[]): void {
    buttons.push({ id: 'vol-', label: '−', x: CONTENT_X, y: 172, w: 110, h: 110 });
    buttons.push({
      id: 'vol',
      label: `MUSIC ${Math.round(musicVolume() * 100)}%`,
      x: CONTENT_X + 126,
      y: 172,
      w: 330,
      h: 110,
      disabled: true,
      small: true,
    });
    buttons.push({ id: 'vol+', label: '+', x: CONTENT_X + 472, y: 172, w: 110, h: 110 });
    buttons.push({
      id: 'dim',
      label: `ROOM ${roomDimName()}`,
      sub: 'darken your passthrough — OFF / CLUB / CAVE',
      accent: UI.violet,
      x: CONTENT_X,
      y: 322,
      w: 582,
      h: 110,
      small: true,
    });
  }
}

const _origin = new Vector3();
const _dir = new Vector3();
const _end = new Vector3();
