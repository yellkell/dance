/**
 * MenuSystem — the board at the front desk.
 *
 * While you're on a menu screen the ring, stage and light rig are packed
 * away (ArenaSystem/DiscoSystem hide them) and you're standing in the
 * FOYER (ClubSystem owns the places) with one wide BOARD floating in front
 * of the spawn, laid out like a modern live-service lobby:
 *
 *   ┌────────┬───────────────────────────────┐
 *   │ RAVE   │  HEADER: wordmark · status    │
 *   │  RAID  ├───────────────────────────────┤
 *   │ TOUR   │                               │
 *   │ PLAY   │   content cards per tab       │
 *   │ MULTI  │                               │
 *   │ SYSTEM │                               │
 *   └────────┴───────────────────────────────┘
 *
 * One rail, one content region, no floating sub-panels. TOUR is its own
 * flow screen; PLAY, MULTIPLAYER and SYSTEM are in-panel modes of the
 * lobby. MULTIPLAYER stays locked (greyed) until the first boss falls —
 * tour set 1's finale — then the club opens for good. With a room OPEN the
 * board doesn't exist at all: the club floor's console is the SOCIAL panel
 * (ClubSocialSystem), and the board waits in the foyer.
 *
 * Mid-set the board vanishes and the right controller's A button raises
 * THE PAUSE CARD — a small pop-up dead ahead (the Beat Saber posture):
 * KEEP DANCING or LEAVE THE SET. Nothing stops while it's up — a shared
 * clock can't pause for one dancer — it exists so leaving is a decision,
 * never a slipped button.
 *
 * The look and motion contract lives in ui/panel.ts: quiet glass, one
 * accent, eased hovers, a beat-leaning under-halo. This file decides WHAT
 * each button is (primary CTA / selected / value chip / semantic text);
 * the kit decides how those roles look.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import { Raycaster, Vector3, type Intersection, type Object3D } from 'three';
import { DIFFICULTY, RING, TOUR } from '../config.js';
import * as sfx from '../audio/sfx.js';
import { musicVolume, preload, setMusicVolume } from '../audio/music.js';
import { pickRaidTrack, trackById, tracksFor } from '../audio/tracks.js';
import { startRaid, toLobby, toTour } from '../game/flow.js';
import { clearedTourNights, match, tourNightUnlocked } from '../game/state.js';
import {
  CODE_ALPHABET,
  autoJoinFromUrl,
  hostRoom,
  joinRoom,
  net,
} from '../net/session.js';
import { font } from '../ui/fonts.js';
import { Panel, UI, type PanelButton } from '../ui/panel.js';
import { PointerRay } from '../ui/pointer.js';

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

/** Headless/dev hooks (wired into __gdr in main.ts) — drive the board
 *  without controllers: switch modes, force hovers, raise the pause card. */
export const menuView: {
  setMode?: (m: 'play' | 'multi' | 'sys' | 'join') => void;
  setHover?: (id: string | null) => void;
  setPause?: (on: boolean) => void;
  /** The board's raw canvas as a data URL — pixel-perfect style checks. */
  snapBoard?: () => string;
  snapPause?: () => string;
} = {};

export class MenuSystem extends createSystem({}) {
  private board!: Panel;
  private exit!: Panel;
  private pause!: Panel;
  private pauseUp = false;
  private pointers!: Record<'left' | 'right', PointerRay>;
  private ray = new Raycaster();
  private hits: Intersection[] = [];
  private hover: string | null = null;
  private lastKey = '';
  private joinMode = false;
  /** Which in-panel mode the lobby board shows (TOUR is its own screen). */
  private mode: 'play' | 'multi' | 'sys' = 'play';
  private joinCode = [0, 0, 0, 0];
  private lastNetDirty = -1;
  private clock = 0;
  /** The rail marker slides between tabs instead of teleporting: current
   *  eased y (canvas space) and its target. NaN until first paint. */
  private railY = NaN;
  private railTargetY = NaN;

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
    this.exit.setShown(false, true);
    this.scene.add(this.exit.group);

    // THE PAUSE CARD: dead ahead, a touch below the count-in's eye line so
    // it never fights the HUD wedge (down-left) or the flair pops (up-right).
    this.pause = new Panel(0.56, 0.36, 560, 360);
    this.pause.group.position.set(0, 1.28, -1.05);
    this.pause.setShown(false, true);
    this.scene.add(this.pause.group);

    this.pointers = { left: new PointerRay(this.scene), right: new PointerRay(this.scene) };

    menuView.setMode = (m) => {
      this.mode = m === 'join' ? 'multi' : m;
      this.joinMode = m === 'join';
      if (match.screen !== 'lobby') toLobby();
      this.lastKey = '';
    };
    menuView.setHover = (id) => {
      this.hover = id;
      this.lastKey = '';
    };
    menuView.setPause = (on) => {
      this.pauseUp = on;
      this.lastKey = '';
    };
    menuView.snapBoard = () => (this.board.ctx().canvas as HTMLCanvasElement).toDataURL('image/png');
    menuView.snapPause = () => (this.pause.ctx().canvas as HTMLCanvasElement).toDataURL('image/png');

    autoJoinFromUrl();
  }

  /** The club (multiplayer) opens when the first boss falls — set 1's finale. */
  private multiplayerUnlocked(): boolean {
    return clearedTourNights().has('0:2');
  }

  private activeTab(): Tab {
    if (match.screen === 'tour') return 'tour';
    return this.mode;
  }

  /** The under-halo's beat envelope: fast attack, cubic decay, downbeat
   *  weighted — the lobby loop publishes match.beat; a slow house clock
   *  covers the silence before the first record decodes. */
  private beatPulse(): number {
    const beat = Number.isFinite(match.beat) ? match.beat : this.clock / 0.86;
    const f = beat - Math.floor(beat);
    const att = Math.min(1, f / 0.06);
    const env = att * (1 - f) ** 3;
    return env * (Math.floor(beat) % 4 === 0 ? 1 : 0.5);
  }

  update(delta: number): void {
    this.clock += delta;
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
    // THE CLUB keeps no front desk: with a room open you're standing on the
    // social floor, and the floor's controls live on the SOCIAL panel
    // (right Ⓐ). The board belongs to the foyer.
    const social = net.phase === 'hosting' || net.phase === 'joined';
    const boardUp = menuRoom && !social;
    const exitUp = screen === 'podium';
    this.board.setShown(boardUp);
    this.exit.setShown(exitUp);
    this.pause.setShown(pauseUp);

    const pulse = this.beatPulse();

    if (!boardUp && !exitUp && !pauseUp) {
      this.hidePointers();
      this.tickPanels(delta, pulse);
      return;
    }

    // Pointers + hover + click.
    const targets: Object3D[] = [];
    if (boardUp) targets.push(this.board.mesh);
    if (exitUp) targets.push(this.exit.mesh);
    if (pauseUp) targets.push(this.pause.mesh);

    let hover: string | null = null;
    let clicked: string | null = null;
    let clickedPanel: Panel | null = null;
    for (const hand of ['left', 'right'] as const) {
      const hit = this.updatePointer(hand, delta, targets);
      if (hit?.uv) {
        const panel = this.panelFor(hit.object);
        const id = panel?.buttonAt(hit.uv.x, hit.uv.y) ?? null;
        if (id) {
          hover = id;
          if (this.input.xr.gamepads[hand]?.getButtonDown(InputComponent.Trigger)) {
            clicked = id;
            clickedPanel = panel;
            this.pointers[hand].click();
          }
        }
      }
    }
    if (hover !== this.hover) {
      this.hover = hover;
      if (hover) sfx.uiHover();
    }
    if (clicked) {
      sfx.uiClick();
      clickedPanel?.press(clicked);
      this.action(clicked);
    }

    // The rail marker's slide: ease toward the active tab and keep the
    // board repainting for the ~200 ms it's in flight.
    if (boardUp && Number.isFinite(this.railY) && Number.isFinite(this.railTargetY)) {
      const gap = this.railTargetY - this.railY;
      if (Math.abs(gap) > 0.5) {
        this.railY += gap * Math.min(1, delta / 0.09);
        this.lastKey = '';
      } else if (this.railY !== this.railTargetY) {
        this.railY = this.railTargetY;
        this.lastKey = '';
      }
    }

    this.repaintIfNeeded();
    this.tickPanels(delta, pulse);
  }

  private tickPanels(delta: number, pulse: number): void {
    this.board.tick(delta, pulse);
    this.exit.tick(delta, pulse);
    this.pause.tick(delta, pulse);
  }

  private panelFor(obj: Object3D): Panel | null {
    if (obj === this.board.mesh) return this.board;
    if (obj === this.exit.mesh) return this.exit;
    if (obj === this.pause.mesh) return this.pause;
    return null;
  }

  private updatePointer(hand: 'left' | 'right', delta: number, targets: Object3D[]): Intersection | undefined {
    const p = this.pointers[hand];
    const rayObj = this.world.playerSpaceEntities?.raySpaces?.[hand]?.object3D;
    if (!rayObj) {
      p.hide();
      return undefined;
    }
    rayObj.getWorldPosition(_origin);
    rayObj.getWorldDirection(_dir).negate();
    this.ray.set(_origin, _dir);
    this.hits.length = 0;
    const hit = this.ray.intersectObjects(targets, false, this.hits)[0];
    // The laser only draws when it's actually ON a panel — searchlights
    // sweeping the room every time a hand moved were pure noise.
    const overButton = Boolean(
      hit?.uv && this.panelFor(hit.object)?.buttonAt(hit.uv.x, hit.uv.y),
    );
    p.update(delta, _origin, hit ? hit.point : null, overButton);
    return hit;
  }

  private hidePointers(): void {
    this.pointers.left.hide();
    this.pointers.right.hide();
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
      // The board is foyer-only now, so a raid from here is always the solo
      // booking — on the club floor the SOCIAL panel sends the ball up.
      startRaid({ seats: match.seats });
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

    const social = net.phase === 'hosting' || net.phase === 'joined';
    if ((match.screen === 'lobby' || match.screen === 'tour') && !social) {
      this.paintBoard();
    }
    if (this.pauseUp && (match.screen === 'raid' || match.screen === 'countdown')) {
      this.pause.paint(
        '',
        () => {},
        [
          { id: 'resume', label: 'KEEP DANCING', primary: true, x: 24, y: 24, w: 512, h: 148 },
          { id: 'bail', label: 'LEAVE THE SET', tone: UI.danger, x: 24, y: 196, w: 512, h: 140, small: true },
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
            primary: true,
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

  /** The shell every tab shares: header, rail — then the content. */
  private paintBoard(): void {
    const tab = this.activeTab();
    const buttons: PanelButton[] = [];

    // The rail: pure hit-areas — drawShell paints the tabs (text + marker,
    // no boxes: the Valorant move), so the highlight can ease.
    const clubOpen = this.multiplayerUnlocked();
    this.railTabs(clubOpen).forEach((t) => {
      buttons.push({
        id: t.id,
        label: t.label,
        disabled: t.disabled,
        ghost: true,
        x: RAIL_X + 8,
        y: t.y,
        w: RAIL_W - 16,
        h: 102,
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

  private railTabs(clubOpen: boolean): {
    id: string;
    tab: Tab;
    label: string;
    sub?: string;
    disabled?: boolean;
    y: number;
  }[] {
    return [
      { id: 'tab-tour', tab: 'tour', label: 'THE TOUR', sub: this.tourProgressSub(), y: 152 },
      { id: 'tab-play', tab: 'play', label: 'QUICK RAID', y: 270 },
      {
        id: 'tab-multi',
        tab: 'multi',
        label: 'MULTIPLAYER',
        sub: clubOpen ? undefined : 'beat the first boss',
        disabled: !clubOpen,
        y: 388,
      },
      { id: 'tab-sys', tab: 'sys', label: 'SYSTEM', y: 506 },
    ];
  }

  private tourProgressSub(): string {
    const done = clearedTourNights().size;
    const all = TOUR.sets.length * 3;
    return done >= all ? 'complete ✓' : `${done} of ${all} nights`;
  }

  /** Header status, as a chip: presence dot + quiet uppercase text. */
  private drawStatusChip(g: CanvasRenderingContext2D): void {
    let dot = UI.faint;
    let text = 'OFFLINE';
    if (net.phase === 'error') {
      dot = UI.danger;
      text = String(net.error ?? 'RELAY ERROR').toUpperCase().slice(0, 40);
    } else if (net.phase === 'connecting') {
      dot = UI.warn;
      text = 'REACHING THE RELAY…';
    }
    g.font = font(600, 21);
    g.letterSpacing = '2px';
    const tw = g.measureText(text).width;
    const h = 44;
    const w = tw + 66;
    const x = W - 40 - w;
    const y = 42;
    g.fillStyle = 'rgba(255,255,255,0.04)';
    g.beginPath();
    g.roundRect(x, y, w, h, h / 2);
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = UI.lineFaint;
    g.stroke();
    g.fillStyle = dot;
    if (dot !== UI.faint) {
      g.shadowColor = dot;
      g.shadowBlur = 8;
    }
    g.beginPath();
    g.arc(x + 26, y + h / 2, 5, 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = UI.dim;
    g.fillText(text, x + 44, y + h / 2 + 1);
    g.letterSpacing = '0px';
  }

  private drawShell(g: CanvasRenderingContext2D, tab: Tab): void {
    // The wordmark — the one glowing text on the board.
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = font(700, 60);
    g.letterSpacing = '6px';
    g.fillStyle = UI.textHi;
    g.shadowColor = UI.accentDim;
    g.shadowBlur = 12;
    g.fillText('RAVE RAID', 40, 66);
    g.shadowBlur = 0;
    g.letterSpacing = '0px';

    this.drawStatusChip(g);

    // Header divider.
    g.fillStyle = UI.lineFaint;
    g.fillRect(28, 128, W - 56, 2);

    // The rail: a recessed well, tabs as text + eased marker.
    g.fillStyle = 'rgba(0,0,0,0.26)';
    g.beginPath();
    g.roundRect(RAIL_X, 136, RAIL_W, 500, 22);
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = UI.lineFaint;
    g.stroke();

    const clubOpen = this.multiplayerUnlocked();
    const tabs = this.railTabs(clubOpen);
    const activeY = tabs.find((t) => tab === t.tab)?.y ?? tabs[0].y;
    this.railTargetY = activeY + 18;
    if (!Number.isFinite(this.railY)) this.railY = this.railTargetY;
    for (const t of tabs) {
      const active = tab === t.tab;
      const hov = this.board.hoverOf(t.id);
      const rx = RAIL_X + 8;
      const rw = RAIL_W - 16;
      if (active || hov > 0.01) {
        g.fillStyle = `rgba(255,255,255,${(active ? 0.06 : 0.04 * hov).toFixed(3)})`;
        g.beginPath();
        g.roundRect(rx, t.y, rw, 102, 14);
        g.fill();
      }
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.font = font(active ? 700 : 600, 29);
      g.letterSpacing = '2.5px';
      g.fillStyle = t.disabled
        ? UI.disabled
        : active
          ? UI.textHi
          : hov > 0
            ? `rgba(242,243,247,${(0.62 + 0.38 * hov).toFixed(3)})`
            : UI.dim;
      const ty = t.y + (t.sub ? 40 : 51);
      g.fillText(t.label, rx + 26, ty, rw - 40);
      if (t.sub) {
        g.font = font(500, 20);
        g.letterSpacing = '0.5px';
        g.fillStyle = t.disabled ? 'rgba(233,236,244,0.22)' : UI.faint;
        g.fillText(t.sub, rx + 26, ty + 34, rw - 40);
      }
      g.letterSpacing = '0px';
    }
    // The marker, mid-slide or parked.
    g.fillStyle = UI.accent;
    g.beginPath();
    g.roundRect(RAIL_X + 12, this.railY, 5, 66, 2.5);
    g.fill();

    // Tab-specific body decoration. No slogans, no manuals — the boards
    // carry buttons and progress, and the game teaches itself.
    if (tab === 'tour') this.drawTreasureMap(g);
    if (tab === 'play') {
      const done = clearedTourNights().size;
      if (done > 0) {
        g.textAlign = 'left';
        g.font = font(600, 22);
        g.letterSpacing = '1.5px';
        g.fillStyle = UI.positive;
        g.fillText(`TOUR ${done}/${TOUR.sets.length * 3}`, CONTENT_X, 836);
        g.letterSpacing = '0px';
      }
    }
  }

  /* ── PLAY ── */

  private playContent(buttons: PanelButton[]): void {
    // The board lives in the foyer only, so this is always the solo booking
    // (a room's raids are CALLED from the SOCIAL panel with the ball).
    const cued = trackById(match.preferredTrack);

    buttons.push({
      id: 'raid',
      label: 'START RAID',
      sub: `you + ${match.seats - 1} goo-groupies · the MC runs the stage`,
      primary: true,
      disabled: net.phase === 'connecting',
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
      display: true,
      small: true,
    });
    buttons.push({ id: 'seats+', label: '+', x: 1324, y: 392, w: 104, h: 112, disabled: match.seats >= RING.maxSeats });

    // DIFFICULTY: the act floor for the whole song — no more trivially
    // easy opening third.
    DIFFICULTY.labels.forEach((label, i) => {
      buttons.push({
        id: `diff${i}`,
        label,
        selected: match.difficulty === i,
        x: CONTENT_X + i * 331,
        y: 668,
        w: 305,
        h: 104,
        small: true,
      });
    });
  }

  /* ── MULTIPLAYER: the club's front door ── */

  private multiContent(buttons: PanelButton[]): void {
    // A room can't be open while this board exists (open room = club floor,
    // and the club keeps no board) — so this tab only ever sells the doors.
    const connecting = net.phase === 'connecting';
    buttons.push({
      id: 'host',
      label: 'ENTER THE CLUB',
      sub: 'the social floor · friends join with your code',
      primary: true,
      disabled: connecting,
      x: CONTENT_X,
      y: 172,
      w: CONTENT_W,
      h: 210,
    });
    buttons.push({
      id: 'join',
      label: 'JOIN A ROOM',
      sub: 'enter a 4-letter code',
      disabled: connecting,
      x: CONTENT_X,
      y: 428,
      w: CONTENT_W,
      h: 210,
    });
  }

  private joinContent(buttons: PanelButton[]): void {
    for (let i = 0; i < 4; i++) {
      buttons.push({
        id: `slot${i}`,
        label: CODE_ALPHABET[this.joinCode[i]],
        tone: UI.info,
        px: 72,
        x: 460 + i * 200,
        y: 280,
        w: 180,
        h: 190,
      });
    }
    buttons.push({ id: 'go-join', label: 'JOIN', primary: true, x: 560, y: 540, w: 360, h: 116 });
    buttons.push({ id: 'back', label: 'BACK', x: 560, y: 690, w: 360, h: 88, small: true });
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

  /** A drawn padlock — the chart marks a sealed stop itself; no emoji. */
  private drawLock(g: CanvasRenderingContext2D, cx: number, cy: number): void {
    g.strokeStyle = 'rgba(190,196,210,0.55)';
    g.fillStyle = 'rgba(190,196,210,0.55)';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(cx, cy - 4, 8, Math.PI, 0);
    g.stroke();
    g.beginPath();
    g.roundRect(cx - 11, cy - 4, 22, 17, 3);
    g.fill();
  }

  private drawTreasureMap(g: CanvasRenderingContext2D): void {
    // Section label, kicker-style.
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = font(600, 24);
    g.letterSpacing = '4px';
    g.fillStyle = UI.dim;
    g.fillText('THE TOUR', CONTENT_X + 2, 158);
    g.letterSpacing = '0px';

    // Map frame: a dashed chart border with bracket ticks in the corners.
    g.setLineDash([8, 12]);
    g.strokeStyle = 'rgba(244,246,251,0.12)';
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(CONTENT_X, 186, CONTENT_W, 746, 26);
    g.stroke();
    g.setLineDash([]);
    g.strokeStyle = UI.accentDim;
    g.lineWidth = 2.5;
    for (const [cx, cy, dx, dy] of [
      [CONTENT_X + 4, 190, 1, 1],
      [CONTENT_X + CONTENT_W - 4, 190, -1, 1],
      [CONTENT_X + 4, 928, 1, -1],
      [CONTENT_X + CONTENT_W - 4, 928, -1, -1],
    ] as const) {
      g.beginPath();
      g.moveTo(cx, cy + dy * 30);
      g.lineTo(cx, cy);
      g.lineTo(cx + dx * 30, cy);
      g.stroke();
    }

    // Set regions: a soft tinted pool of light behind each trio — clipped
    // to the chart, so the light never spills past the frame.
    g.save();
    g.beginPath();
    g.roundRect(CONTENT_X, 186, CONTENT_W, 746, 26);
    g.clip();
    TOUR.sets.forEach((_set, s) => {
      const mid = MAP_NODES[s][1];
      const grad = g.createRadialGradient(mid.x, mid.y, 20, mid.x, mid.y, 300);
      const c = SET_COLORS[s % SET_COLORS.length];
      grad.addColorStop(0, `${c}20`);
      grad.addColorStop(1, `${c}00`);
      g.fillStyle = grad;
      g.fillRect(mid.x - 300, mid.y - 300, 600, 600);
    });
    g.restore();

    // The trail — one dashed route through all nine stops, smoothed through
    // midpoints; the cleared stretch re-inked in the positive green.
    const pts = MAP_NODES.flat();
    const trail = (upto: number, style: string, width: number): void => {
      if (upto < 1) return;
      g.strokeStyle = style;
      g.lineWidth = width;
      g.setLineDash([12, 16]);
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
    trail(8, 'rgba(244,246,251,0.34)', 5);
    let frontier = 0;
    for (let k = 0; k < 9; k++) {
      const { cleared } = this.mapNodeState(Math.floor(k / 3), k % 3);
      if (cleared) frontier = k + 1;
      else break;
    }
    trail(Math.min(frontier, 8), 'rgba(43,226,138,0.55)', 5);

    // The stops. (No set banners: the coloured regions and the trail order
    // group them; the count-in card names the night you booked.)
    TOUR.sets.forEach((set, s) => {
      set.songs.forEach((songId, i) => {
        const n = MAP_NODES[s][i];
        const { cleared, unlocked, next } = this.mapNodeState(s, i);
        const finale = i === 2;
        const treasure = s === TOUR.sets.length - 1 && finale;
        const setColor = SET_COLORS[s % SET_COLORS.length];
        const hov = unlocked ? this.board.hoverOf(`night${s}-${i}`) : 0;
        const track = trackById(songId);

        // Node disc.
        g.beginPath();
        g.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        g.fillStyle = cleared ? 'rgba(16,38,26,0.94)' : 'rgba(10,8,18,0.94)';
        g.fill();
        g.lineWidth = (finale ? 5 : 3.5) + 3 * hov;
        g.strokeStyle = !unlocked ? 'rgba(190,196,210,0.32)' : cleared ? UI.positive : setColor;
        if (hov > 0.02) {
          g.shadowColor = setColor;
          g.shadowBlur = 22 * hov;
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
          g.lineWidth = 10;
          g.lineCap = 'round';
          g.strokeStyle = cleared ? UI.positive : '#ffd24a';
          if (!unlocked) g.strokeStyle = 'rgba(190,196,210,0.3)';
          const a = n.r * 0.42;
          g.beginPath();
          g.moveTo(n.x - a, n.y - a);
          g.lineTo(n.x + a, n.y + a);
          g.moveTo(n.x + a, n.y - a);
          g.lineTo(n.x - a, n.y + a);
          g.stroke();
          g.lineCap = 'butt';
          // Radiating treasure ticks.
          g.lineWidth = 2.5;
          for (let t = 0; t < 8; t++) {
            const ang = (t / 8) * Math.PI * 2 + 0.39;
            g.beginPath();
            g.moveTo(n.x + Math.cos(ang) * (n.r + 8), n.y + Math.sin(ang) * (n.r + 8));
            g.lineTo(n.x + Math.cos(ang) * (n.r + 20), n.y + Math.sin(ang) * (n.r + 20));
            g.stroke();
          }
        } else if (cleared) {
          g.font = font(700, 40);
          g.fillStyle = UI.positive;
          g.fillText('✓', n.x, n.y + (finale ? 8 : 2));
        } else if (!unlocked) {
          this.drawLock(g, n.x, n.y + (finale ? 8 : 0));
        } else {
          g.font = font(700, 36);
          g.fillStyle = UI.text;
          g.fillText(String(i + 1), n.x, n.y + (finale ? 10 : 2));
        }

        // NEXT beacon over the frontier stop.
        if (next) {
          g.font = font(700, 22);
          g.letterSpacing = '2px';
          g.fillStyle = UI.info;
          g.fillText('▼ NEXT', n.x, n.y - n.r - 30);
          g.letterSpacing = '0px';
        }

        // Stop label: the record's name, nothing else. Finales are marked by
        // the goop's eyes and the treasure by its X — the chart, not a caption.
        g.font = font(600, 23);
        g.letterSpacing = '1px';
        g.fillStyle = unlocked ? UI.text : 'rgba(233,236,244,0.42)';
        g.fillText(track?.title ?? songId, n.x, n.y + n.r + 26);
        g.letterSpacing = '0px';
      });
    });

    // Compass rose (a disco one) — top-right corner, off the trail.
    const cx = 1520;
    const cy = 268;
    g.strokeStyle = 'rgba(244,246,251,0.28)';
    g.lineWidth = 2.5;
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
    g.fillStyle = UI.accent;
    g.beginPath();
    g.arc(cx, cy, 5, 0, Math.PI * 2);
    g.fill();
    g.font = font(600, 22);
    g.textAlign = 'center';
    g.fillStyle = UI.dim;
    g.fillText('N', cx, cy - 58);

    // HERE BE GOOP — the sea monster of this chart.
    const gx = 1372;
    const gy = 452;
    g.fillStyle = 'rgba(54,224,90,0.45)';
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
      display: true,
      small: true,
    });
    buttons.push({ id: 'vol+', label: '+', x: CONTENT_X + 472, y: 172, w: 110, h: 110 });
  }
}

const _origin = new Vector3();
const _dir = new Vector3();
