/**
 * MenuSystem — the front desk of THE GILDED ECLIPSE.
 *
 * While you're on any menu screen the ring, stage and light rig are packed
 * away (ArenaSystem/DiscoSystem hide them) and you're standing in the CLUB
 * (ClubSystem owns the venue; the MC poses on its dance floor) — with one
 * wide BOARD floating in front of the spawn, laid out like a modern
 * live-service lobby:
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
  BufferGeometry,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
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

/** The treasure trail: nine stops, (set, night) → canvas centre + radius.
 *  Winds bottom-left → right → back left → up to the golden X. */
const MAP_NODES: { x: number; y: number; r: number }[][] = [
  [
    { x: 470, y: 802, r: 46 },
    { x: 728, y: 848, r: 46 },
    { x: 988, y: 788, r: 58 },
  ],
  [
    { x: 1238, y: 676, r: 46 },
    { x: 1014, y: 566, r: 46 },
    { x: 742, y: 606, r: 58 },
  ],
  [
    { x: 512, y: 462, r: 46 },
    { x: 802, y: 368, r: 46 },
    { x: 1156, y: 300, r: 64 },
  ],
];

type Tab = 'play' | 'tour' | 'map' | 'sys';

interface Pointer {
  line: Line;
  dot: Mesh;
}

export class MenuSystem extends createSystem({}) {
  private board!: Panel;
  private exit!: Panel;
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

    this.pointers = { left: this.makePointer(), right: this.makePointer() };

    autoJoinFromUrl();
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
    // The laser only draws when it's actually ON a panel — searchlights
    // sweeping the club every time a hand moved were pure noise.
    p.line.visible = Boolean(hit);
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
      else if (match.tour) toTour(); // tour podium → back to the map
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
            label:
              match.screen === 'tutorial'
                ? 'END REHEARSAL'
                : match.tour
                  ? 'BACK TO THE MAP'
                  : 'BACK TO THE GREEN ROOM',
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

    // The rail — the TOUR leads: the map is the main attraction.
    const tabs: { id: string; tab: Tab; label: string; sub?: string }[] = [
      { id: 'tab-tour', tab: 'tour', label: '🗺 THE TOUR', sub: this.tourProgressSub() },
      { id: 'tab-play', tab: 'play', label: '▶ QUICK RAID' },
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

    // Rail plate + active accent bar.
    g.fillStyle = 'rgba(12,9,22,0.66)';
    g.beginPath();
    g.roundRect(RAIL_X, 136, RAIL_W, 500, 22);
    g.fill();
    const tabIndex = { tour: 0, play: 1, map: 2, sys: 3 }[tab];
    g.fillStyle = UI.goop;
    g.beginPath();
    g.roundRect(RAIL_X + 2, 158 + tabIndex * 118, 6, 90, 3);
    g.fill();

    // Header divider.
    g.fillStyle = 'rgba(255,42,213,0.35)';
    g.fillRect(28, 130, W - 56, 2);

    // Tab-specific body decoration.
    if (tab === 'tour') this.drawTreasureMap(g);
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
      g.fillText('combo pays: one stick up, one down, swap on the kick', CONTENT_X, 776);
      const done = clearedTourNights().size;
      g.fillStyle = done ? UI.goop : UI.dim;
      g.fillText(
        done ? `tour: ${done}/${TOUR.sets.length * 3} nights cleared` : 'the TOUR awaits — three sets, three records each',
        CONTENT_X,
        812,
      );
    }

    // Footer — the rehearsal reports its row, PLAY gets the controls hint.
    // The map carries none: the chart speaks for itself.
    if (tab !== 'tour') {
      g.textAlign = 'center';
      g.font = "700 21px 'Arial Black', system-ui, sans-serif";
      g.fillStyle = tab === 'map' && allGooplingsCleared() ? UI.goop : 'rgba(232,236,242,0.4)';
      g.fillText(
        tab === 'map'
          ? allGooplingsCleared()
            ? 'RAVE READY — every move in your feet'
            : `${GOOPLINGS.length} gooplings · one move each · clear the row`
          : 'trigger clicks · thumbstick teleports the club · right Ⓐ social panel · mid-set, right Ⓐ bails',
        W / 2,
        992,
      );
    }
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

  /* ── THE TOUR: the treasure map ───────────────────────────────────────
   * Nine nights as stops on a winding neon trail — bottom-left start,
   * golden X at the top. The body paints everything (trail, nodes, compass,
   * the HERE-BE-GOOP doodle); the buttons are GHOSTS: pure hit-areas over
   * the nodes. */

  private mapNodeState(s: number, i: number): { cleared: boolean; unlocked: boolean; next: boolean } {
    const done = clearedTourNights();
    const cleared = done.has(`${s}:${i}`);
    const unlocked = tourNightUnlocked(s, i);
    return { cleared, unlocked, next: unlocked && !cleared };
  }

  private drawTreasureMap(g: CanvasRenderingContext2D): void {
    // Heading.
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = "900 34px 'Arial Black', system-ui, sans-serif";
    g.fillStyle = UI.goop;
    g.fillText('THE TOUR', CONTENT_X, 158);
    g.font = "700 21px 'Arial Black', system-ui, sans-serif";
    g.fillStyle = UI.dim;
    g.fillText('follow the trail · survive a night to book the next · the goop guards every third', CONTENT_X + 224, 160);

    // Map frame: a dashed chart border with bright corner ticks.
    g.setLineDash([10, 14]);
    g.strokeStyle = 'rgba(244,246,251,0.14)';
    g.lineWidth = 3;
    g.beginPath();
    g.roundRect(CONTENT_X, 186, CONTENT_W, 746, 26);
    g.stroke();
    g.setLineDash([]);
    g.strokeStyle = 'rgba(255,42,213,0.5)';
    g.lineWidth = 4;
    for (const [cx, cy, dx, dy] of [
      [CONTENT_X + 4, 190, 1, 1],
      [CONTENT_X + CONTENT_W - 4, 190, -1, 1],
      [CONTENT_X + 4, 928, 1, -1],
      [CONTENT_X + CONTENT_W - 4, 928, -1, -1],
    ] as const) {
      g.beginPath();
      g.moveTo(cx, cy + dy * 34);
      g.lineTo(cx, cy);
      g.lineTo(cx + dx * 34, cy);
      g.stroke();
    }

    // Set regions: a soft tinted pool of light behind each trio.
    TOUR.sets.forEach((_set, s) => {
      const mid = MAP_NODES[s][1];
      const grad = g.createRadialGradient(mid.x, mid.y, 20, mid.x, mid.y, 300);
      const c = SET_COLORS[s % SET_COLORS.length];
      grad.addColorStop(0, `${c}1f`);
      grad.addColorStop(1, `${c}00`);
      g.fillStyle = grad;
      g.fillRect(mid.x - 300, mid.y - 300, 600, 600);
    });

    // The trail — one dashed route through all nine stops, smoothed through
    // midpoints; the cleared stretch re-inked in goop green.
    const pts = MAP_NODES.flat();
    const trail = (upto: number, style: string, width: number): void => {
      if (upto < 1) return;
      g.strokeStyle = style;
      g.lineWidth = width;
      g.setLineDash([13, 17]);
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      for (let k = 1; k <= upto; k++) {
        const prev = pts[k - 1];
        const cur = pts[k];
        const mx = (prev.x + cur.x) / 2;
        const my = (prev.y + cur.y) / 2 + (k % 2 ? 26 : -26); // hand-drawn wobble
        g.quadraticCurveTo(mx, my, cur.x, cur.y);
      }
      g.stroke();
      g.setLineDash([]);
    };
    trail(8, 'rgba(244,246,251,0.34)', 6);
    let frontier = 0;
    for (let k = 0; k < 9; k++) {
      const { cleared } = this.mapNodeState(Math.floor(k / 3), k % 3);
      if (cleared) frontier = k + 1;
      else break;
    }
    trail(Math.min(frontier, 8), 'rgba(140,255,112,0.6)', 6);

    // The stops. (No set banners: the coloured regions and the trail order
    // group them; the count-in card names the night you booked.)
    TOUR.sets.forEach((set, s) => {
      set.songs.forEach((songId, i) => {
        const n = MAP_NODES[s][i];
        const { cleared, unlocked, next } = this.mapNodeState(s, i);
        const finale = i === 2;
        const treasure = s === TOUR.sets.length - 1 && finale;
        const setColor = SET_COLORS[s % SET_COLORS.length];
        const hovered = this.hover === `night${s}-${i}`;
        const track = trackById(songId);

        // Node disc.
        g.beginPath();
        g.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        g.fillStyle = cleared ? 'rgba(24,50,26,0.92)' : 'rgba(10,8,22,0.92)';
        g.fill();
        g.lineWidth = hovered ? 9 : finale ? 7 : 5;
        g.strokeStyle = !unlocked ? 'rgba(150,154,168,0.35)' : cleared ? UI.goop : setColor;
        if (hovered && unlocked) {
          g.shadowColor = setColor;
          g.shadowBlur = 24;
        }
        g.stroke();
        g.shadowBlur = 0;

        // Finale garnish: the goop's eyes peer out of the stop.
        if (finale && !treasure) {
          for (const side of [-1, 1]) {
            g.beginPath();
            g.arc(n.x + side * 14, n.y - 12, 8, 0, Math.PI * 2);
            g.fillStyle = '#f4fff2';
            g.fill();
            g.beginPath();
            g.arc(n.x + side * 14, n.y - 10, 3.5, 0, Math.PI * 2);
            g.fillStyle = '#101b10';
            g.fill();
          }
        }

        // Centre glyph.
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        if (treasure) {
          // X marks the drop.
          g.lineWidth = 11;
          g.lineCap = 'round';
          g.strokeStyle = cleared ? UI.goop : '#ffd24a';
          if (!unlocked) g.strokeStyle = 'rgba(150,154,168,0.4)';
          const a = n.r * 0.42;
          g.beginPath();
          g.moveTo(n.x - a, n.y - a);
          g.lineTo(n.x + a, n.y + a);
          g.moveTo(n.x + a, n.y - a);
          g.lineTo(n.x - a, n.y + a);
          g.stroke();
          g.lineCap = 'butt';
          // Radiating treasure ticks.
          g.lineWidth = 3;
          for (let t = 0; t < 8; t++) {
            const ang = (t / 8) * Math.PI * 2 + 0.39;
            g.beginPath();
            g.moveTo(n.x + Math.cos(ang) * (n.r + 8), n.y + Math.sin(ang) * (n.r + 8));
            g.lineTo(n.x + Math.cos(ang) * (n.r + 20), n.y + Math.sin(ang) * (n.r + 20));
            g.stroke();
          }
        } else if (cleared) {
          g.font = "900 40px 'Arial Black', system-ui, sans-serif";
          g.fillStyle = UI.goop;
          g.fillText('✓', n.x, n.y + (finale ? 8 : 2));
        } else if (!unlocked) {
          g.font = "900 30px 'Arial Black', system-ui, sans-serif";
          g.fillStyle = 'rgba(180,184,198,0.6)';
          g.fillText('🔒', n.x, n.y + (finale ? 10 : 2));
        } else {
          g.font = "900 34px 'Arial Black', system-ui, sans-serif";
          g.fillStyle = UI.text;
          g.fillText(String(i + 1), n.x, n.y + (finale ? 10 : 2));
        }

        // NEXT beacon over the frontier stop.
        if (next) {
          g.font = "900 24px 'Arial Black', system-ui, sans-serif";
          g.fillStyle = UI.cyan;
          g.fillText('▼ NEXT', n.x, n.y - n.r - 30);
        }

        // Stop label: the record's name, nothing else. Finales are marked by
        // the goop's eyes and the treasure by its X — the chart, not a caption.
        g.font = "900 23px 'Arial Black', system-ui, sans-serif";
        g.fillStyle = unlocked ? UI.text : 'rgba(200,204,216,0.45)';
        g.fillText(track?.title ?? songId, n.x, n.y + n.r + 26);
      });
    });

    // Compass rose (a disco one) — top-right corner, off the trail.
    const cx = 1520;
    const cy = 268;
    g.strokeStyle = 'rgba(244,246,251,0.35)';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, cy, 34, 0, Math.PI * 2);
    g.stroke();
    for (let t = 0; t < 8; t++) {
      const ang = (t / 8) * Math.PI * 2;
      const inner = t % 2 ? 12 : 6;
      g.beginPath();
      g.moveTo(cx + Math.cos(ang) * inner, cy + Math.sin(ang) * inner);
      g.lineTo(cx + Math.cos(ang) * (t % 2 ? 26 : 44), cy + Math.sin(ang) * (t % 2 ? 26 : 44));
      g.stroke();
    }
    g.fillStyle = UI.magenta;
    g.beginPath();
    g.arc(cx, cy, 5, 0, Math.PI * 2);
    g.fill();
    g.font = "900 22px 'Arial Black', system-ui, sans-serif";
    g.textAlign = 'center';
    g.fillStyle = UI.dim;
    g.fillText('N', cx, cy - 58);

    // HERE BE GOOP — the sea monster of this chart.
    const gx = 1372;
    const gy = 452;
    g.fillStyle = 'rgba(54,224,90,0.5)';
    g.beginPath();
    g.moveTo(gx - 34, gy + 12);
    g.bezierCurveTo(gx - 40, gy - 26, gx - 6, gy - 38, gx + 8, gy - 22);
    g.bezierCurveTo(gx + 34, gy - 30, gx + 44, gy + 2, gx + 26, gy + 14);
    g.closePath();
    g.fill();
    for (const side of [-1, 1]) {
      g.beginPath();
      g.arc(gx - 6 + side * 10, gy - 18, 5, 0, Math.PI * 2);
      g.fillStyle = '#f4fff2';
      g.fill();
    }
  }

  private tourContent(buttons: PanelButton[]): void {
    // Pure hit-areas over the map stops — the map itself is the visual.
    TOUR.sets.forEach((set, s) => {
      set.songs.forEach((songId, i) => {
        const n = MAP_NODES[s][i];
        const pad = 10;
        buttons.push({
          id: `night${s}-${i}`,
          label: trackById(songId)?.title ?? songId,
          disabled: !tourNightUnlocked(s, i),
          ghost: true,
          x: n.x - n.r - pad,
          y: n.y - n.r - pad,
          w: (n.r + pad) * 2,
          h: (n.r + pad) * 2,
        });
      });
    });
  }

  /* ── REHEARSAL ── */

  private rehearsalContent(buttons: PanelButton[]): void {
    const cleared = clearedGooplings();
    // Seven tutors fit the column at a tighter pitch.
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
        y: 148 + i * 114,
        w: CONTENT_W,
        h: 102,
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
