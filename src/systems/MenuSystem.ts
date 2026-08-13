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
import { DIFFICULTY, GRADE, RING, TOUR } from '../config.js';
import * as sfx from '../audio/sfx.js';
import { musicVolume, preload, setMusicVolume } from '../audio/music.js';
import { pickRaidTrack, trackById, tracksFor, type Track } from '../audio/tracks.js';
import { startRaid, toLobby, toTour } from '../game/flow.js';
import { NAME_MAX, profileName, setProfileName } from '../game/profile.js';
import {
  bestTourGrade,
  clearedTourNights,
  match,
  soloBoard,
  tourNightUnlocked,
} from '../game/state.js';
import {
  CODE_ALPHABET,
  autoJoinFromUrl,
  hostRoom,
  joinRoom,
  net,
  setDancerName,
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

/** SOLO (select song) geometry: the list column and the song page beside
 *  it. Fifteen rows (SHUFFLE + the raid pool) at a compact pitch. */
const SOLO_LIST_X = CONTENT_X;
const SOLO_LIST_W = 700;
const SOLO_ROW_Y0 = 216;
const SOLO_ROW_H = 42;
const SOLO_ROW_PITCH = 47;
const SOLO_RIGHT_X = 1044;
const SOLO_RIGHT_W = 576;
const SOLO_WELL_Y = 292;
const SOLO_WELL_H = 504;

/** The PROFILE card (header, top right) and its dropdown. */
const PROF = { x: 1280, y: 34, w: 340, h: 58 };
const PROF_CARD = { x: 1140, y: 106, w: 480, h: 232 };

/** The rename keyboard: an arcade board, centre stage, modal. */
const KB = { x: 280, y: 170, w: 1100, h: 690 };
const KB_ROWS: { keys: string[]; x0: number; y: number }[] = [
  { keys: [...'1234567890'], x0: 336, y: 356 },
  { keys: [...'QWERTYUIOP'], x0: 336, y: 456 },
  { keys: [...'ASDFGHJKL'], x0: 386, y: 556 },
  { keys: [...'ZXCVBNM'], x0: 486, y: 656 },
];
const KB_KEY = 88;
const KB_PITCH = 100;

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
  /** Press any board button by id — the headless finger. */
  act?: (id: string) => void;
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
  /** The profile card's dropdown, and the rename keyboard over everything. */
  private profileOpen = false;
  private keyboardOpen = false;
  private nameDraft = '';

  init(): void {
    try {
      const stored = Number(localStorage.getItem(SEATS_KEY));
      if (Number.isFinite(stored) && stored >= RING.minSeats) {
        match.seats = Math.min(RING.maxSeats, stored);
      }
      const track = localStorage.getItem(TRACK_KEY);
      if (track && trackById(track)) match.preferredTrack = track;
      // NB: a missing key must not read as 0 — Number(null) is 0, and that
      // silently forced every fresh headset onto EASY.
      const diffRaw = localStorage.getItem(DIFF_KEY);
      const diff = diffRaw === null ? NaN : Number(diffRaw);
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

    // The stored profile signs the club tag from the first frame; a
    // ?name= share link may still override the session below.
    setDancerName(profileName());

    menuView.setMode = (m) => {
      this.mode = m === 'join' ? 'multi' : m;
      this.joinMode = m === 'join';
      this.profileOpen = false;
      this.keyboardOpen = false;
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
    menuView.act = (id) => this.action(id);
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
    // Any action that isn't the profile's own closes its dropdown.
    if (id !== 'profile' && id !== 'rename') this.profileOpen = false;

    if (id === 'profile') {
      this.profileOpen = !this.profileOpen;
    } else if (id === 'rename') {
      this.keyboardOpen = true;
      this.nameDraft = profileName();
    } else if (id === 'kb:cancel') {
      this.keyboardOpen = false;
    } else if (id === 'kb:done') {
      setProfileName(this.nameDraft);
      setDancerName(profileName());
      this.keyboardOpen = false;
    } else if (id === 'kb:back') {
      this.nameDraft = this.nameDraft.slice(0, -1);
    } else if (id === 'kb:clear') {
      this.nameDraft = '';
    } else if (id.startsWith('kb:')) {
      if (this.nameDraft.length < NAME_MAX) this.nameDraft += id.slice(3);
    } else if (id === 'tab-play') {
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
    } else if (id.startsWith('song:')) {
      // SELECT SONG: pick a record off the list ('' = SHUFFLE, the match
      // seed chooses). Picking one warms it so the drop is instant.
      const picked = id.slice(5);
      match.preferredTrack = picked;
      try {
        localStorage.setItem(TRACK_KEY, picked);
      } catch {
        /* fine */
      }
      preload(trackById(picked) ?? pickRaidTrack(match.seed));
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
      match.preferredTrack,
      Math.round(musicVolume() * 10),
      net.phase,
      net.code,
      net.members.length,
      clearedTourNights().size,
      this.profileOpen,
      this.keyboardOpen,
      this.nameDraft,
      profileName(),
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
    // THE RENAME KEYBOARD is modal: while it's up, its keys are the only
    // buttons alive on the board — the scrim eats every other click.
    if (this.keyboardOpen) {
      const buttons: PanelButton[] = [];
      this.keyboardButtons(buttons);
      this.board.paint('', (g) => this.drawKeyboard(g), buttons, this.hover);
      return;
    }

    const tab = this.activeTab();
    let buttons: PanelButton[] = [];

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
    else this.soloContent(buttons);

    // THE PROFILE CARD (top right, every tab): a ghost the header paints.
    // Its dropdown floats over the content — anything underneath loses its
    // hit area while the card is open.
    if (this.profileOpen) {
      buttons = buttons.filter(
        (b) =>
          b.x + b.w < PROF_CARD.x ||
          b.x > PROF_CARD.x + PROF_CARD.w ||
          b.y + b.h < PROF_CARD.y ||
          b.y > PROF_CARD.y + PROF_CARD.h + 8,
      );
      buttons.push({
        id: 'rename',
        label: 'RENAME',
        x: PROF_CARD.x + 28,
        y: PROF_CARD.y + PROF_CARD.h - 80,
        w: 200,
        h: 56,
        small: true,
      });
    }
    buttons.push({ id: 'profile', label: profileName(), ghost: true, x: PROF.x, y: PROF.y, w: PROF.w, h: PROF.h });

    this.board.paint(
      '',
      (g) => {
        this.drawShell(g, tab);
        if (this.profileOpen) this.drawProfileCard(g);
      },
      buttons,
      this.hover,
    );
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
      { id: 'tab-play', tab: 'play', label: 'SOLO', y: 270 },
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
    const x = PROF.x - 20 - w; // parked beside the profile card
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

  /** THE PROFILE CARD, collapsed: identity mark + name + a disclosure
   *  chevron. A ghost button paints nothing — this is its whole body. */
  private drawProfileChip(g: CanvasRenderingContext2D): void {
    const hov = this.board.hoverOf('profile');
    const open = this.profileOpen;
    g.beginPath();
    g.roundRect(PROF.x, PROF.y, PROF.w, PROF.h, 14);
    g.fillStyle = open ? UI.accentFaint : `rgba(255,255,255,${(0.045 + 0.045 * hov).toFixed(3)})`;
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = open ? 'rgba(255,42,213,0.9)' : `rgba(255,255,255,${(0.1 + 0.2 * hov).toFixed(3)})`;
    g.stroke();
    // The identity mark: the brand diamond, glowing faintly.
    const dx = PROF.x + 32;
    const dy = PROF.y + PROF.h / 2;
    g.save();
    g.translate(dx, dy);
    g.rotate(Math.PI / 4);
    g.fillStyle = UI.accent;
    g.shadowColor = UI.accentDim;
    g.shadowBlur = 8;
    g.fillRect(-8, -8, 16, 16);
    g.restore();
    g.shadowBlur = 0;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = font(600, 25);
    g.letterSpacing = '1.5px';
    g.fillStyle = UI.textHi;
    g.fillText(profileName(), PROF.x + 58, dy + 1, PROF.w - 108);
    g.letterSpacing = '0px';
    g.textAlign = 'center';
    g.font = font(600, 20);
    g.fillStyle = UI.dim;
    g.fillText(open ? '▴' : '▾', PROF.x + PROF.w - 26, dy + 1);
  }

  /** The dropdown under the card: the signed name, and the door to the
   *  rename keyboard (the RENAME button itself is a real PanelButton). */
  private drawProfileCard(g: CanvasRenderingContext2D): void {
    const c = PROF_CARD;
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.55)';
    g.shadowBlur = 30;
    g.fillStyle = 'rgba(15,12,26,0.98)';
    g.beginPath();
    g.roundRect(c.x, c.y, c.w, c.h, 18);
    g.fill();
    g.restore();
    g.lineWidth = 2;
    g.strokeStyle = UI.line;
    g.stroke();

    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = font(600, 19);
    g.letterSpacing = '3px';
    g.fillStyle = UI.faint;
    g.fillText('SIGNED AS', c.x + 28, c.y + 42);
    g.letterSpacing = '1px';
    g.font = font(700, 42);
    g.fillStyle = UI.textHi;
    g.fillText(profileName(), c.x + 28, c.y + 90, c.w - 56);
    g.letterSpacing = '0px';
    g.font = font(500, 19);
    g.fillStyle = UI.dim;
    g.fillText('your tag in the club · signs your scores', c.x + 28, c.y + 130);
  }

  /* ── the rename keyboard (modal) ── */

  private keyboardButtons(buttons: PanelButton[]): void {
    for (const row of KB_ROWS) {
      row.keys.forEach((ch, i) => {
        buttons.push({
          id: `kb:${ch}`,
          label: ch,
          px: 40,
          x: row.x0 + i * KB_PITCH,
          y: row.y,
          w: KB_KEY,
          h: KB_KEY,
        });
      });
    }
    const last = KB_ROWS[3];
    buttons.push({
      id: 'kb:back',
      label: '⌫',
      px: 36,
      x: last.x0 + last.keys.length * KB_PITCH,
      y: last.y,
      w: 138,
      h: KB_KEY,
    });
    buttons.push({ id: 'kb:cancel', label: 'CANCEL', tone: UI.danger, small: true, x: 336, y: 756, w: 200, h: KB_KEY });
    buttons.push({ id: 'kb:clear', label: 'CLEAR', small: true, x: 556, y: 756, w: 180, h: KB_KEY });
    buttons.push({
      id: 'kb:done',
      label: 'DONE',
      primary: true,
      disabled: this.nameDraft.trim().length === 0,
      x: 1104,
      y: 756,
      w: 220,
      h: KB_KEY,
    });
  }

  private drawKeyboard(g: CanvasRenderingContext2D): void {
    // The scrim: the lobby holds its breath while you sign.
    g.fillStyle = 'rgba(4,2,10,0.8)';
    g.beginPath();
    g.roundRect(6, 6, W - 12, H - 12, 30);
    g.fill();

    // The card.
    g.fillStyle = 'rgba(14,11,24,0.98)';
    g.beginPath();
    g.roundRect(KB.x, KB.y, KB.w, KB.h, 24);
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = UI.line;
    g.stroke();

    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = font(600, 22);
    g.letterSpacing = '4px';
    g.fillStyle = UI.dim;
    g.fillText('YOUR NAME', KB.x + 40, KB.y + 44);
    g.letterSpacing = '0px';

    // The preview well: draft, caret, count.
    g.fillStyle = UI.well;
    g.beginPath();
    g.roundRect(KB.x + 40, KB.y + 62, KB.w - 80, 96, 16);
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = UI.lineFaint;
    g.stroke();
    g.textAlign = 'center';
    g.font = font(700, 52);
    g.letterSpacing = '6px';
    const draft = this.nameDraft;
    g.fillStyle = draft ? UI.textHi : UI.faint;
    g.fillText(draft ? `${draft}▏` : 'type a name▏', KB.x + KB.w / 2, KB.y + 112);
    g.letterSpacing = '0px';
    g.textAlign = 'right';
    g.font = font(500, 18);
    g.fillStyle = UI.faint;
    g.fillText(`${draft.length}/${NAME_MAX}`, KB.x + KB.w - 52, KB.y + 138);
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
    if (tab === 'play') this.drawSoloPanel(g);

    // The profile card rides the header on every tab.
    this.drawProfileChip(g);
  }

  /* ── SOLO: select song ─────────────────────────────────────────────────
   * The whole raid pool as a list — BPM and your best letter (at the
   * selected difficulty) beside every record — with the song's local
   * leaderboard on a page to the right. The list and the leaderboard are
   * body-drawn; the rows are ghost hit-areas, like the rail. */

  private soloRows(): { id: string; track: Track | null }[] {
    // Alphabetical — the list is for FINDING a record; the BPM column is
    // right there for anyone shopping by tempo.
    const pool = [...tracksFor('raid')].sort((a, b) => a.title.localeCompare(b.title));
    return [
      { id: 'song:', track: null }, // SHUFFLE — the seed picks
      ...pool.map((t) => ({ id: `song:${t.id}`, track: t })),
    ];
  }

  private soloContent(buttons: PanelButton[]): void {
    // The board lives in the foyer only, so this is always the solo booking
    // (a room's raids are CALLED from the SOCIAL panel with the ball).
    const cued = trackById(match.preferredTrack);

    // The ring-size stepper, compact in the header strip.
    buttons.push({
      id: 'seats-',
      label: '−',
      x: 1352,
      y: 140,
      w: 62,
      h: 60,
      small: true,
      disabled: match.seats <= RING.minSeats,
    });
    buttons.push({ id: 'seats', label: `${match.seats} DANCERS`, display: true, px: 22, x: 1422, y: 140, w: 132, h: 60 });
    buttons.push({
      id: 'seats+',
      label: '+',
      x: 1562,
      y: 140,
      w: 58,
      h: 60,
      small: true,
      disabled: match.seats >= RING.maxSeats,
    });

    // The songs (ghosts — drawSoloPanel paints the rows).
    this.soloRows().forEach((row, i) => {
      buttons.push({
        id: row.id,
        label: row.track?.title ?? 'SHUFFLE',
        ghost: true,
        x: SOLO_LIST_X,
        y: SOLO_ROW_Y0 + i * SOLO_ROW_PITCH,
        w: SOLO_LIST_W,
        h: SOLO_ROW_H,
      });
    });

    // DIFFICULTY: the act floor for the whole song — and the lens the
    // list's BEST column reads through.
    DIFFICULTY.labels.forEach((label, i) => {
      buttons.push({
        id: `diff${i}`,
        label,
        selected: match.difficulty === i,
        x: SOLO_RIGHT_X + i * 148,
        y: 216,
        w: 132,
        h: 60,
        small: true,
      });
    });

    buttons.push({
      id: 'raid',
      label: 'GO RAVE',
      // The record and its tempo — what you're about to dance to, nothing
      // about who's filling the ring.
      sub: cued
        ? `${cued.title} · ${cued.bpm.toFixed(cued.bpm % 1 ? 2 : 0)} BPM`
        : 'the seed picks the record',
      primary: true,
      disabled: net.phase === 'connecting',
      x: SOLO_RIGHT_X,
      y: 812,
      w: SOLO_RIGHT_W,
      h: 120,
    });
  }

  /** The list, the song page and its leaderboard — the SOLO tab's body. */
  private drawSoloPanel(g: CanvasRenderingContext2D): void {
    g.textBaseline = 'middle';

    // Kicker + column captions.
    g.textAlign = 'left';
    g.font = font(600, 24);
    g.letterSpacing = '4px';
    g.fillStyle = UI.dim;
    g.fillText('SELECT SONG', SOLO_LIST_X + 2, 172);
    g.letterSpacing = '1.5px';
    g.font = font(500, 17);
    g.fillStyle = UI.faint;
    g.textAlign = 'right';
    g.fillText('BPM', SOLO_LIST_X + SOLO_LIST_W - 128, 202);
    g.textAlign = 'center';
    g.fillText('BEST', SOLO_LIST_X + SOLO_LIST_W - 52, 202);
    g.letterSpacing = '0px';

    // The rows.
    this.soloRows().forEach((row, i) => {
      const y = SOLO_ROW_Y0 + i * SOLO_ROW_PITCH;
      const selected = (match.preferredTrack || '') === (row.track?.id ?? '');
      const hov = this.board.hoverOf(row.id);
      g.beginPath();
      g.roundRect(SOLO_LIST_X, y, SOLO_LIST_W, SOLO_ROW_H, 10);
      g.fillStyle = selected ? UI.accentFaint : `rgba(255,255,255,${(0.03 + 0.05 * hov).toFixed(3)})`;
      g.fill();
      if (selected) {
        g.lineWidth = 2;
        g.strokeStyle = 'rgba(255,42,213,0.9)';
        g.stroke();
        g.fillStyle = UI.accent;
        g.beginPath();
        g.roundRect(SOLO_LIST_X + 5, y + 8, 4, SOLO_ROW_H - 16, 2);
        g.fill();
      }
      const cy = y + SOLO_ROW_H / 2 + 1;
      g.textAlign = 'left';
      g.font = font(600, 25);
      g.letterSpacing = '1px';
      g.fillStyle = selected ? UI.textHi : UI.text;
      g.fillText(row.track?.title ?? 'SHUFFLE', SOLO_LIST_X + 24, cy, SOLO_LIST_W - 250);
      g.letterSpacing = '0px';
      g.textAlign = 'right';
      g.font = font(500, 21);
      g.fillStyle = UI.dim;
      g.fillText(row.track ? String(Math.round(row.track.bpm)) : '—', SOLO_LIST_X + SOLO_LIST_W - 128, cy);
      g.textAlign = 'center';
      if (row.track) {
        const best = soloBoard(row.track.id, match.difficulty).best;
        g.font = font(700, 26);
        g.fillStyle = best ? (GRADE.colors[best] ?? UI.text) : UI.faint;
        g.fillText(best ?? '—', SOLO_LIST_X + SOLO_LIST_W - 52, cy);
      } else {
        g.font = font(500, 21);
        g.fillStyle = UI.faint;
        g.fillText('—', SOLO_LIST_X + SOLO_LIST_W - 52, cy);
      }
    });

    // The song page: a recessed well with the record's leaderboard.
    const wx = SOLO_RIGHT_X;
    const wy = SOLO_WELL_Y;
    const ww = SOLO_RIGHT_W;
    const wh = SOLO_WELL_H;
    g.fillStyle = UI.well;
    g.beginPath();
    g.roundRect(wx, wy, ww, wh, 22);
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = UI.lineFaint;
    g.stroke();

    const cued = trackById(match.preferredTrack);
    if (!cued) {
      g.textAlign = 'left';
      g.font = font(700, 32);
      g.letterSpacing = '2px';
      g.fillStyle = UI.textHi;
      g.fillText('SHUFFLE', wx + 28, wy + 56);
      g.letterSpacing = '0px';
      g.font = font(500, 21);
      g.fillStyle = UI.dim;
      g.fillText('the match seed picks the record', wx + 28, wy + 102);
      g.font = font(500, 20);
      g.fillStyle = UI.faint;
      g.fillText('leaderboards live with the songs —', wx + 28, wy + 156);
      g.fillText('pick one to see your times', wx + 28, wy + 186);
      return;
    }

    g.textAlign = 'left';
    g.font = font(700, 32);
    g.letterSpacing = '2px';
    g.fillStyle = UI.textHi;
    g.fillText(cued.title, wx + 28, wy + 56, ww - 190);
    g.letterSpacing = '0px';
    g.textAlign = 'right';
    g.font = font(500, 21);
    g.fillStyle = UI.dim;
    g.fillText(
      `${cued.bpm.toFixed(cued.bpm % 1 ? 2 : 0)} BPM · ${Math.round(cued.seconds / 6) / 10} min`,
      wx + ww - 28,
      wy + 56,
    );

    g.textAlign = 'left';
    g.font = font(600, 19);
    g.letterSpacing = '2.5px';
    g.fillStyle = UI.faint;
    g.fillText(`PERSONAL BEST · ${DIFFICULTY.labels[match.difficulty]}`, wx + 28, wy + 102);
    g.letterSpacing = '0px';
    g.fillStyle = UI.lineFaint;
    g.fillRect(wx + 28, wy + 124, ww - 56, 2);

    const { runs } = soloBoard(cued.id, match.difficulty);
    if (!runs.length) {
      g.font = font(500, 24);
      g.fillStyle = UI.dim;
      g.fillText('no runs on this chart yet', wx + 28, wy + 176);
      g.font = font(500, 20);
      g.fillStyle = UI.faint;
      g.fillText('finish a solo set to post the first score', wx + 28, wy + 210);
    } else {
      runs.forEach((run, i) => {
        const ry = wy + 168 + i * 62;
        g.textAlign = 'left';
        g.font = font(600, 22);
        g.fillStyle = UI.faint;
        g.fillText(String(i + 1), wx + 32, ry);
        g.font = font(600, 24);
        g.letterSpacing = '1px';
        g.fillStyle = UI.text;
        g.fillText(run.n || 'RAVER', wx + 76, ry, 250);
        g.letterSpacing = '0px';
        g.textAlign = 'right';
        g.font = font(700, 28);
        g.fillStyle = UI.textHi;
        g.fillText(run.s.toLocaleString('en-US'), wx + ww - 110, ry);
        g.textAlign = 'center';
        g.font = font(700, 28);
        g.fillStyle = GRADE.colors[run.g] ?? UI.text;
        g.fillText(run.g, wx + ww - 56, ry);
      });
    }

    g.textAlign = 'left';
    g.font = font(500, 18);
    g.fillStyle = UI.faint;
    g.fillText('solo runs · this headset', wx + 28, wy + wh - 30);
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

        // The best letter ever taken home from this night, under its stop.
        const bestGrade = bestTourGrade(s, i);
        if (bestGrade) {
          g.font = font(700, 27);
          g.fillStyle = GRADE.colors[bestGrade] ?? UI.text;
          g.fillText(bestGrade, n.x, n.y + n.r + 56);
        }
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
