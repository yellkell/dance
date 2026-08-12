/**
 * MenuSystem — the board at the front desk.
 *
 * While you're on any menu screen the ring, stage and light rig are packed
 * away (ArenaSystem/DiscoSystem hide them) and you're standing in the
 * FOYER — or, with a room open, on the club floor (ClubSystem owns both
 * places) — with one wide BOARD floating in front of the spawn, laid out
 * like a modern live-service lobby:
 *
 *   ┌────────┬───────────────────────────────┐
 *   │ RAVE   │  HEADER: wordmark · status    │
 *   │  RAID  ├───────────────────────────────┤
 *   │ TOUR   │                               │
 *   │ PLAY   │   content cards per tab       │
 *   │ MULTI  │                               │
 *   │ SYSTEM │                               │
 *   ├────────┴───────────────────────────────┤
 *   │ footer hints                           │
 *   └────────────────────────────────────────┘
 *
 * One rail, one content region, no floating sub-panels. TOUR is its own
 * flow screen; PLAY, MULTIPLAYER and SYSTEM are in-panel modes of the
 * lobby. MULTIPLAYER stays locked (greyed) until the first boss falls —
 * tour set 1's finale — then the club opens for good.
 *
 * Mid-set the board vanishes and the right controller's A button raises
 * THE PAUSE CARD — a small pop-up dead ahead (the Beat Saber posture):
 * KEEP DANCING or LEAVE THE SET. Nothing stops while it's up — a shared
 * clock can't pause for one dancer — it exists so leaving is a decision,
 * never a slipped button.
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
import { DIFFICULTY, RING, TOUR } from '../config.js';
import * as sfx from '../audio/sfx.js';
import { musicVolume, preload, setMusicVolume } from '../audio/music.js';
import { pickRaidTrack, trackById, tracksFor } from '../audio/tracks.js';
import { startRaid, toLobby, toTour } from '../game/flow.js';
import { clearedTourNights, match, tourNightUnlocked } from '../game/state.js';
import { ballSpawnPos } from '../club/ball.js';
import {
  CODE_ALPHABET,
  autoJoinFromUrl,
  callBall,
  hostRoom,
  joinRoom,
  leaveRoom,
  net,
} from '../net/session.js';
import { Panel, UI, type PanelButton } from '../ui/panel.js';
import { Quaternion } from 'three';

const SEATS_KEY = 'gdr-seats';
const TRACK_KEY = 'gdr-track';
const DIFF_KEY = 'gdr-diff';

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

type Tab = 'play' | 'tour' | 'multi' | 'sys';

interface Pointer {
  line: Line;
  dot: Mesh;
}

export class MenuSystem extends createSystem({}) {
  private board!: Panel;
  private exit!: Panel;
  private pause!: Panel;
  private pauseUp = false;
  private pointers!: Record<'left' | 'right', Pointer>;
  private ray = new Raycaster();
  private hits: Intersection[] = [];
  private hover: string | null = null;
  private lastKey = '';
  private joinMode = false;
  /** Which in-panel mode the lobby board shows (TOUR is its own screen). */
  private mode: 'play' | 'multi' | 'sys' = 'play';
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
      const diff = Number(localStorage.getItem(DIFF_KEY));
      if (Number.isFinite(diff) && diff >= 0 && diff <= 3) match.difficulty = diff;
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

    // THE PAUSE CARD: dead ahead, a touch below the count-in's eye line so
    // it never fights the HUD wedge (down-left) or the flair pops (up-right).
    this.pause = new Panel(0.56, 0.36, 560, 360);
    this.pause.group.position.set(0, 1.28, -1.05);
    this.pause.group.visible = false;
    this.scene.add(this.pause.group);

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

  /** The club (multiplayer) opens when the first boss falls — set 1's finale. */
  private multiplayerUnlocked(): boolean {
    return clearedTourNights().has('0:2');
  }

  private activeTab(): Tab {
    if (match.screen === 'tour') return 'tour';
    return this.mode;
  }

  update(): void {
    const screen = match.screen;

    // Mid-set, right A raises (or lowers) THE PAUSE CARD — leaving is a
    // decision on a button, never the button itself.
    const inSet = screen === 'raid' || screen === 'countdown';
    if (inSet) {
      if (this.input.xr.gamepads.right?.getButtonDown(InputComponent.A_Button)) {
        sfx.uiClick();
        this.pauseUp = !this.pauseUp;
        this.lastKey = '';
      }
    } else if (this.pauseUp) {
      this.pauseUp = false; // the set ended while the card was up
    }
    const pauseUp = inSet && this.pauseUp;

    const menuRoom = screen === 'lobby' || screen === 'tour';
    const exitUp = screen === 'podium';
    this.board.group.visible = menuRoom;
    this.exit.group.visible = exitUp;
    this.pause.group.visible = pauseUp;

    if (!menuRoom && !exitUp && !pauseUp) {
      this.hidePointers();
      return;
    }

    // Pointers + hover + click.
    const targets: Object3D[] = [];
    if (menuRoom) targets.push(this.board.mesh);
    if (exitUp) targets.push(this.exit.mesh);
    if (pauseUp) targets.push(this.pause.mesh);

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
    if (obj === this.pause.mesh) return this.pause;
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
      this.mode = 'play';
      this.joinMode = false;
      if (match.screen !== 'lobby') toLobby();
    } else if (id === 'tab-tour') {
      this.joinMode = false;
      if (match.screen !== 'tour') toTour();
    } else if (id === 'tab-multi') {
      this.mode = 'multi';
      this.joinMode = false;
      if (match.screen !== 'lobby') toLobby();
    } else if (id === 'tab-sys') {
      this.mode = 'sys';
      this.joinMode = false;
      if (match.screen !== 'lobby') toLobby();
    } else if (id === 'raid') {
      if (net.phase === 'hosting' || net.phase === 'joined') {
        // On the club floor a raid is CALLED, not declared: the ball goes
        // up ahead of you and whoever touches it rides along at zero.
        if (!net.ball && net.gamePlayers.size === 0) {
          const headObj = this.playerHeadEntity?.object3D;
          if (headObj) {
            headObj.getWorldPosition(_origin);
            headObj.getWorldQuaternion(_headQ);
            _dir.set(0, 0, -1).applyQuaternion(_headQ);
            callBall(ballSpawnPos(_origin, _dir));
          }
        }
      } else {
        startRaid({ seats: match.seats });
      }
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
    } else if (id.startsWith('diff')) {
      match.difficulty = Math.max(0, Math.min(3, Number(id.slice(4))));
      try {
        localStorage.setItem(DIFF_KEY, String(match.difficulty));
      } catch {
        /* fine */
      }
    } else if (id === 'vol-' || id === 'vol+') {
      setMusicVolume(musicVolume() + (id === 'vol+' ? 0.1 : -0.1));
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
    } else if (id === 'resume') {
      this.pauseUp = false;
    } else if (id === 'bail') {
      this.pauseUp = false;
      toLobby();
    } else if (id === 'exit') {
      if (match.tour) toTour(); // tour podium → back to the map
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
      this.mode,
      this.pauseUp,
      this.joinCode.join(''),
      match.seats,
      match.difficulty,
      Math.round(musicVolume() * 10),
      net.phase,
      net.code,
      net.members.length,
      clearedTourNights().size,
    ].join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;

    if (match.screen === 'lobby' || match.screen === 'tour') {
      this.paintBoard();
    }
    if (this.pauseUp && (match.screen === 'raid' || match.screen === 'countdown')) {
      this.pause.paint(
        '',
        () => {},
        [
          { id: 'resume', label: 'KEEP DANCING', accent: UI.goop, x: 24, y: 24, w: 512, h: 148 },
          { id: 'bail', label: 'LEAVE THE SET', accent: UI.danger, x: 24, y: 196, w: 512, h: 140, small: true },
        ],
        this.hover,
      );
    }
    if (match.screen === 'podium') {
      this.exit.paint(
        '',
        () => {},
        [
          {
            id: 'exit',
            label: match.tour ? 'BACK TO THE MAP' : 'BACK TO THE GREEN ROOM',
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

    // The rail — the TOUR leads: the map is the main attraction. The club
    // seat stays greyed until the first boss is down.
    const clubOpen = this.multiplayerUnlocked();
    const tabs: { id: string; tab: Tab; label: string; sub?: string; disabled?: boolean }[] = [
      { id: 'tab-tour', tab: 'tour', label: '🗺 THE TOUR', sub: this.tourProgressSub() },
      { id: 'tab-play', tab: 'play', label: '▶ QUICK RAID' },
      {
        id: 'tab-multi',
        tab: 'multi',
        label: '👥 MULTIPLAYER',
        sub: clubOpen ? undefined : 'beat the first boss',
        disabled: !clubOpen,
      },
      { id: 'tab-sys', tab: 'sys', label: '⚙ SYSTEM' },
    ];
    tabs.forEach((t, i) => {
      buttons.push({
        id: t.id,
        label: t.label,
        sub: t.sub,
        accent: tab === t.tab ? UI.goop : undefined,
        disabled: t.disabled,
        x: RAIL_X + 12,
        y: 152 + i * 118,
        w: RAIL_W - 24,
        h: 102,
        small: true,
      });
    });

    // Tab content.
    if (tab === 'tour') this.tourContent(buttons);
    else if (tab === 'multi') {
      if (this.joinMode) this.joinContent(buttons);
      else this.multiContent(buttons);
    } else if (tab === 'sys') this.systemContent(buttons);
    else this.playContent(buttons);

    this.board.paint('', (g) => this.drawShell(g, tab), buttons, this.hover);
  }

  private tourProgressSub(): string {
    const done = clearedTourNights().size;
    const all = TOUR.sets.length * 3;
    return done >= all ? 'complete ✓' : `${done}/${all}`;
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
      g.fillText('OFFLINE', W - 40, 56);
    }

    // Rail plate + active accent bar.
    g.fillStyle = 'rgba(12,9,22,0.66)';
    g.beginPath();
    g.roundRect(RAIL_X, 136, RAIL_W, 500, 22);
    g.fill();
    const tabIndex = { tour: 0, play: 1, multi: 2, sys: 3 }[tab];
    g.fillStyle = UI.goop;
    g.beginPath();
    g.roundRect(RAIL_X + 2, 158 + tabIndex * 118, 6, 90, 3);
    g.fill();

    // Header divider.
    g.fillStyle = 'rgba(255,42,213,0.35)';
    g.fillRect(28, 130, W - 56, 2);

    // Tab-specific body decoration. No slogans, no manuals — the boards
    // carry buttons and progress, and the game teaches itself.
    if (tab === 'tour') this.drawTreasureMap(g);
    if (tab === 'play') {
      const done = clearedTourNights().size;
      if (done > 0) {
        g.textAlign = 'left';
        g.font = "700 23px 'Arial Black', system-ui, sans-serif";
        g.fillStyle = UI.goop;
        g.fillText(`tour ${done}/${TOUR.sets.length * 3}`, CONTENT_X, 836);
      }
    }
  }

  /* ── PLAY ── */

  private playContent(buttons: PanelButton[]): void {
    const online = net.phase;
    const cued = trackById(match.preferredTrack);
    const inRoom = online === 'hosting' || online === 'joined';
    const ballUp = net.ball !== null;
    const setOut = net.gamePlayers.size > 0;

    buttons.push({
      id: 'raid',
      label: !inRoom
        ? 'START RAID'
        : ballUp
          ? 'THE BALL IS UP'
          : setOut
            ? 'A SET IS OUT'
            : 'CALL A RAID',
      sub: !inRoom
        ? `you + ${match.seats - 1} goo-groupies · the MC runs the stage`
        : ballUp
          ? 'touch the ball to dance — it fires at zero'
          : setOut
            ? `${net.gamePlayers.size} on the ring — back on the floor soon`
            : 'the ball goes up before you · 60 s · touchers ride along',
      accent: UI.goop,
      disabled: online === 'connecting' || (inRoom && (ballUp || setOut)),
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

    // DIFFICULTY: the act floor for the whole song — no more trivially
    // easy opening third. Rides the ball online, like the song pick.
    DIFFICULTY.labels.forEach((label, i) => {
      buttons.push({
        id: `diff${i}`,
        label,
        accent: match.difficulty === i ? UI.goop : undefined,
        x: CONTENT_X + i * 331,
        y: 668,
        w: 305,
        h: 104,
        small: true,
      });
    });

    if (online === 'hosting' || online === 'joined') {
      // A live room is worth knowing about from any tab that starts a set.
      buttons.push({
        id: 'code',
        label: `ROOM ${net.code}`,
        sub: `${net.members.length} on the floor`,
        accent: UI.amber,
        disabled: true,
        x: CONTENT_X,
        y: 528,
        w: 640,
        h: 108,
        small: true,
      });
    }
  }

  /* ── MULTIPLAYER: the club's front door ── */

  private multiContent(buttons: PanelButton[]): void {
    const online = net.phase;
    if (online === 'hosting' || online === 'joined') {
      buttons.push({
        id: 'code',
        label: `ROOM ${net.code}`,
        sub: `${net.members.length} in · share the code or ?room=${net.code}`,
        accent: UI.amber,
        disabled: true,
        x: CONTENT_X,
        y: 172,
        w: CONTENT_W,
        h: 210,
      });
      buttons.push({ id: 'leave', label: 'LEAVE', accent: UI.danger, x: CONTENT_X, y: 428, w: 452, h: 116, small: true });
    } else {
      // First door first: stepping onto the social floor IS opening a room
      // — the club appears around you and friends join with your code.
      buttons.push({
        id: 'host',
        label: 'ENTER THE CLUB',
        sub: 'the social floor · friends join with your code',
        accent: UI.goop,
        disabled: online === 'connecting',
        x: CONTENT_X,
        y: 172,
        w: CONTENT_W,
        h: 210,
      });
      buttons.push({
        id: 'join',
        label: 'JOIN A ROOM',
        sub: 'enter a 4-letter code',
        accent: UI.amber,
        disabled: online === 'connecting',
        x: CONTENT_X,
        y: 428,
        w: CONTENT_W,
        h: 210,
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
  }
}

const _origin = new Vector3();
const _dir = new Vector3();
const _end = new Vector3();
const _headQ = new Quaternion();
