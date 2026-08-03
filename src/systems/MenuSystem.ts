/**
 * MenuSystem — the lobby desk of the club: controller lasers, the main
 * panel (start a raid, size the ring, host/join a room, volume), the
 * REHEARSAL map of gooplings, the join-code picker, and the exit buttons
 * for rehearsals and the podium. Mid-set the menus vanish — the right
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
import { GOOPLINGS, RING } from '../config.js';
import * as sfx from '../audio/sfx.js';
import { musicVolume, setMusicVolume } from '../audio/techno.js';
import { finishTutorial, startRaid, startTutorial, toLobby, toMap } from '../game/flow.js';
import { allGooplingsCleared, clearedGooplings, gooplingUnlocked, match } from '../game/state.js';
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

interface Pointer {
  line: Line;
  dot: Mesh;
}

export class MenuSystem extends createSystem({}) {
  private lobby!: Panel;
  private map!: Panel;
  private exit!: Panel;
  private pointers!: Record<'left' | 'right', Pointer>;
  private ray = new Raycaster();
  private hits: Intersection[] = [];
  private hover: string | null = null;
  private lastKey = '';
  private joinMode = false;
  private joinCode = [0, 0, 0, 0];
  private lastNetDirty = -1;

  init(): void {
    try {
      const stored = Number(localStorage.getItem(SEATS_KEY));
      if (Number.isFinite(stored) && stored >= RING.minSeats) {
        match.seats = Math.min(RING.maxSeats, stored);
      }
    } catch {
      /* fine */
    }

    this.lobby = new Panel(1.25, 1.25, 1024, 1024);
    this.lobby.group.position.set(0, 1.45, -1.45);
    this.scene.add(this.lobby.group);

    this.map = new Panel(1.25, 1.25, 1024, 1024);
    this.map.group.position.set(0, 1.45, -1.45);
    this.scene.add(this.map.group);

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

    const lobbyUp = screen === 'lobby';
    const mapUp = screen === 'map';
    const exitUp = screen === 'tutorial' || screen === 'podium';
    this.lobby.group.visible = lobbyUp;
    this.map.group.visible = mapUp;
    this.exit.group.visible = exitUp;

    if (!lobbyUp && !mapUp && !exitUp) {
      this.hidePointers();
      return;
    }

    // Pointers + hover + click.
    const targets: Object3D[] = [];
    if (lobbyUp) targets.push(this.lobby.mesh);
    if (mapUp) targets.push(this.map.mesh);
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
    if (obj === this.lobby.mesh) return this.lobby;
    if (obj === this.map.mesh) return this.map;
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
    if (id === 'raid') {
      if (net.phase === 'hosting') requestStart(match.seats);
      else startRaid({ seats: match.seats });
    } else if (id === 'rehearsal') {
      toMap();
    } else if (id === 'seats-' || id === 'seats+') {
      const step = id === 'seats+' ? 4 : -4;
      match.seats = Math.max(RING.minSeats, Math.min(RING.maxSeats, match.seats + step));
      match.generation++; // rebuild the ring so the lobby shows the size
      try {
        localStorage.setItem(SEATS_KEY, String(match.seats));
      } catch {
        /* fine */
      }
    } else if (id === 'vol-' || id === 'vol+') {
      setMusicVolume(musicVolume() + (id === 'vol+' ? 0.1 : -0.1));
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
      if (match.screen === 'map') toLobby();
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
      this.joinCode.join(''),
      match.seats,
      Math.round(musicVolume() * 10),
      net.phase,
      net.code,
      net.members.length,
      match.tutorialClears,
    ].join('|');
    if (key === this.lastKey) return;
    this.lastKey = key;

    if (match.screen === 'lobby') {
      if (this.joinMode) this.paintJoin();
      else this.paintLobby();
    } else if (match.screen === 'map') {
      this.paintMap();
    }
    if (match.screen === 'tutorial' || match.screen === 'podium') {
      this.exit.paint(
        '',
        () => {},
        [
          {
            id: 'exit',
            label: match.screen === 'tutorial' ? 'END REHEARSAL' : 'BACK TO THE LOBBY',
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

  private paintLobby(): void {
    const online = net.phase;
    const buttons: PanelButton[] = [];

    buttons.push({
      id: 'raid',
      label: online === 'hosting' ? 'DROP THE SET' : online === 'joined' ? 'WAITING FOR HOST…' : 'START RAID',
      sub:
        online === 'hosting'
          ? `${net.members.length} human${net.members.length === 1 ? '' : 's'} + groupies on a ${match.seats}-ring`
          : online === 'joined'
            ? `room ${net.code}`
            : `you + ${match.seats - 1} goo-groupies`,
      accent: UI.goop,
      disabled: online === 'joined' || online === 'connecting',
      x: 40,
      y: 190,
      w: 944,
      h: 150,
    });

    buttons.push({ id: 'seats-', label: '−', x: 40, y: 380, w: 110, h: 92, disabled: match.seats <= RING.minSeats });
    buttons.push({
      id: 'seats',
      label: `${match.seats} DANCERS`,
      x: 170,
      y: 380,
      w: 340,
      h: 92,
      disabled: true,
      small: true,
    });
    buttons.push({ id: 'seats+', label: '+', x: 530, y: 380, w: 110, h: 92, disabled: match.seats >= RING.maxSeats });
    buttons.push({
      id: 'rehearsal',
      label: 'REHEARSAL',
      sub: allGooplingsCleared() ? 'rave ready ✓' : `${clearedGooplings().size}/${GOOPLINGS.length} gooplings`,
      accent: UI.cyan,
      x: 660,
      y: 380,
      w: 324,
      h: 92,
      small: true,
    });

    if (online === 'hosting' || online === 'joined') {
      buttons.push({
        id: 'code',
        label: `ROOM ${net.code}`,
        sub: `${net.members.length} in — share the code or ?room=${net.code}`,
        accent: UI.amber,
        disabled: true,
        x: 40,
        y: 512,
        w: 616,
        h: 92,
        small: true,
      });
      buttons.push({ id: 'leave', label: 'LEAVE', accent: UI.danger, x: 676, y: 512, w: 308, h: 92, small: true });
    } else {
      buttons.push({
        id: 'host',
        label: 'HOST ROOM',
        sub: 'up to 24 humans',
        accent: UI.amber,
        disabled: online === 'connecting',
        x: 40,
        y: 512,
        w: 452,
        h: 92,
        small: true,
      });
      buttons.push({
        id: 'join',
        label: 'JOIN ROOM',
        sub: 'enter a 4-letter code',
        accent: UI.amber,
        disabled: online === 'connecting',
        x: 532,
        y: 512,
        w: 452,
        h: 92,
        small: true,
      });
    }

    buttons.push({ id: 'vol-', label: '−', x: 40, y: 644, w: 110, h: 92 });
    buttons.push({
      id: 'vol',
      label: `MUSIC ${Math.round(musicVolume() * 100)}%`,
      x: 170,
      y: 644,
      w: 340,
      h: 92,
      disabled: true,
      small: true,
    });
    buttons.push({ id: 'vol+', label: '+', x: 530, y: 644, w: 110, h: 92 });

    this.lobby.paint(
      'GOOPLIATH',
      (g) => {
        g.textAlign = 'center';
        g.font = "900 34px 'Arial Black', system-ui, sans-serif";
        g.fillStyle = UI.green;
        g.fillText('D A N C E   R A I D', 512, 142);
        g.font = "700 24px 'Arial Black', system-ui, sans-serif";
        g.fillStyle = net.phase === 'error' ? UI.danger : UI.dim;
        const status =
          net.phase === 'error'
            ? `⚠ ${net.error}`
            : net.phase === 'connecting'
              ? 'reaching the relay…'
              : 'dodge the moves · ride the beat · outlast the floor';
        g.fillText(status, 512, 770);
        g.fillStyle = UI.dim;
        g.font = "700 22px 'Arial Black', system-ui, sans-serif";
        g.fillText('mid-set: right controller Ⓐ bails', 512, 940);
        g.fillText('passthrough on — this room is your club 🪩', 512, 900);
      },
      buttons,
      this.hover,
    );
  }

  private paintJoin(): void {
    const buttons: PanelButton[] = [];
    for (let i = 0; i < 4; i++) {
      buttons.push({
        id: `slot${i}`,
        label: CODE_ALPHABET[this.joinCode[i]],
        x: 132 + i * 205,
        y: 300,
        w: 175,
        h: 190,
      });
    }
    buttons.push({ id: 'go-join', label: 'JOIN', accent: UI.goop, x: 272, y: 580, w: 480, h: 120 });
    buttons.push({ id: 'back', label: 'BACK', accent: UI.danger, x: 272, y: 740, w: 480, h: 92, small: true });

    this.lobby.paint(
      'JOIN ROOM',
      (g) => {
        g.textAlign = 'center';
        g.font = "700 26px 'Arial Black', system-ui, sans-serif";
        g.fillStyle = UI.dim;
        g.fillText('tap a slot to cycle its letter (A–H)', 512, 180);
        g.fillText('or open the share link: ?room=CODE', 512, 890);
      },
      buttons,
      this.hover,
    );
  }

  private paintMap(): void {
    const cleared = clearedGooplings();
    const buttons: PanelButton[] = [];
    GOOPLINGS.forEach((gp, i) => {
      const unlocked = gooplingUnlocked(i);
      const done = cleared.has(gp.id);
      buttons.push({
        id: `node${i}`,
        label: `${done ? '✓ ' : unlocked ? '' : '🔒 '}${gp.name}`,
        sub: `${gp.epithet} · teaches ${gp.move.toUpperCase()}`,
        accent: done ? UI.goop : unlocked ? UI.magenta : undefined,
        disabled: !unlocked,
        x: 90,
        y: 190 + i * 128,
        w: 844,
        h: 108,
        small: true,
      });
    });
    buttons.push({ id: 'back', label: 'BACK', accent: UI.danger, x: 312, y: 856, w: 400, h: 92, small: true });

    this.map.paint(
      'REHEARSAL',
      (g) => {
        g.textAlign = 'center';
        g.font = "700 26px 'Arial Black', system-ui, sans-serif";
        g.fillStyle = allGooplingsCleared() ? UI.goop : UI.dim;
        g.fillText(
          allGooplingsCleared()
            ? 'RAVE READY — the GOOPLIATH awaits your feet'
            : 'five gooplings, five moves — clear the row',
          512,
          150,
        );
      },
      buttons,
      this.hover,
    );
  }
}

const _origin = new Vector3();
const _dir = new Vector3();
const _end = new Vector3();
