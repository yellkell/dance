/**
 * Online session — thin client for the room relay (server/index.mjs).
 *
 * The deterministic-choreography model keeps this tiny: the server's only
 * real jobs are seats, the seed, and a shared "beat 0 lands in N ms". After
 * that the wire carries nothing but poses (10 Hz) and score reports (3 Hz);
 * every client runs the identical show from the seed. Empty seats become
 * groupies, identical on every client.
 *
 * Join by code (the 4-letter room code uses the alphabet A–H so the XR code
 * picker only needs 8 letters per slot) or by URL: ?room=CADA&name=YELL.
 */

import { NET, serverUrl } from '../config.js';
import { audioContext, ensureAudio } from '../audio/sfx.js';
import { startRaid } from '../game/flow.js';
import { dancerAtSeat, match } from '../game/state.js';
import { remotePoses } from './poses.js';

export type NetPhase = 'off' | 'connecting' | 'hosting' | 'joined' | 'live' | 'error';

export const CODE_ALPHABET = 'ABCDEFGH';

export interface LobbyMember {
  name: string;
  /** Provisional join order (final ring seats arrive with the start). */
  idx: number;
}

export const net = {
  phase: 'off' as NetPhase,
  code: '',
  members: [] as LobbyMember[],
  isHost: false,
  error: '',
  rttMs: 0,
  /** Bumped on any lobby change so menus know to repaint. */
  dirty: 0,
};

let ws: WebSocket | null = null;
let pingTimer: number | null = null;
let myName = 'DANCER';

function send(obj: unknown): void {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function connect(onOpen: () => void): void {
  teardown('');
  net.phase = 'connecting';
  net.dirty++;
  try {
    ws = new WebSocket(serverUrl());
  } catch {
    net.phase = 'error';
    net.error = 'relay unreachable';
    net.dirty++;
    return;
  }
  ws.onopen = () => {
    onOpen();
    // A light ping keeps RTT fresh for the start-time compensation.
    pingTimer = window.setInterval(() => send({ t: 'ping', t0: performance.now() }), 2000);
  };
  ws.onerror = () => {
    if (net.phase === 'connecting') {
      net.phase = 'error';
      net.error = 'relay unreachable';
      net.dirty++;
    }
  };
  ws.onclose = () => {
    if (net.phase !== 'off' && net.phase !== 'error') {
      net.phase = 'error';
      net.error = 'connection lost';
      net.dirty++;
    }
    stopPing();
  };
  ws.onmessage = (ev) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
    } catch {
      return;
    }
    handle(msg);
  };
}

function stopPing(): void {
  if (pingTimer !== null) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

function teardown(reason: string): void {
  stopPing();
  if (ws) {
    ws.onclose = null;
    ws.onmessage = null;
    ws.close();
    ws = null;
  }
  net.phase = reason ? 'error' : 'off';
  net.error = reason;
  net.code = '';
  net.members = [];
  net.isHost = false;
  net.dirty++;
}

function handle(msg: Record<string, unknown>): void {
  switch (msg.t) {
    case 'room':
      net.phase = msg.host ? 'hosting' : 'joined';
      net.code = String(msg.code ?? '');
      net.isHost = Boolean(msg.host);
      net.dirty++;
      break;
    case 'roster':
      net.members = (msg.players as LobbyMember[]) ?? [];
      net.dirty++;
      break;
    case 'start': {
      // Everyone leaves the lobby together: seed + seats + my ring seat +
      // the human seat map + a shared "beat 0 in N ms" (RTT-compensated).
      const players = (msg.players as { seat: number; name: string; you?: boolean }[]) ?? [];
      const humans = new Map<number, { name: string }>();
      let mySeat = 0;
      for (const p of players) {
        if (p.you) mySeat = p.seat;
        else humans.set(p.seat, { name: p.name });
      }
      const startInMs = Number(msg.startInMs ?? 5000) - net.rttMs / 2;
      ensureAudio();
      const ctx = audioContext();
      const beatZeroAt = ctx ? ctx.currentTime + Math.max(0.5, startInMs / 1000) : undefined;
      net.phase = 'live';
      net.dirty++;
      startRaid({
        seats: Number(msg.seats ?? players.length),
        seed: Number(msg.seed ?? 1),
        mySeat,
        humans,
        beatZeroAt,
        online: true,
        // The host's record (empty = everyone derives the same one from the
        // seed). Either way the whole room lands on one song.
        trackId: typeof msg.track === 'string' ? msg.track : undefined,
      });
      match.roomCode = net.code;
      break;
    }
    case 'p': {
      const seat = Number(msg.seat);
      const d = msg.d as number[];
      if (!Array.isArray(d) || d.length < 10) break;
      remotePoses.set(seat, {
        hx: d[0], hy: d[1], hz: d[2], hyaw: d[3],
        lx: d[4], ly: d[5], lz: d[6],
        rx: d[7], ry: d[8], rz: d[9],
        t: performance.now(),
      });
      break;
    }
    case 's': {
      const seat = Number(msg.seat);
      const d = msg.d as { score: number; combo: number; lives: number; alive: boolean; elim: number };
      const dancer = dancerAtSeat(seat);
      if (dancer && dancer.kind === 'remote' && d) {
        dancer.score = d.score;
        dancer.combo = d.combo;
        dancer.bestCombo = Math.max(dancer.bestCombo, d.combo);
        dancer.lives = d.lives;
        if (dancer.alive && !d.alive) {
          dancer.alive = false;
          dancer.elimAtBeat = Number.isFinite(d.elim) ? d.elim : match.beat;
        }
      }
      break;
    }
    case 'left': {
      const seat = Number(msg.seat);
      const dancer = dancerAtSeat(seat);
      if (dancer && dancer.kind === 'remote' && dancer.alive) {
        // A vanished dancer leaves the floor mid-song.
        dancer.alive = false;
        dancer.elimAtBeat = Number.isFinite(match.beat) ? match.beat : 0;
      }
      remotePoses.delete(seat);
      net.dirty++;
      break;
    }
    case 'pong': {
      const t0 = Number(msg.t0);
      if (Number.isFinite(t0)) net.rttMs = performance.now() - t0;
      break;
    }
    case 'err':
      teardown(String(msg.m ?? 'room error'));
      break;
  }
}

/* ── public api ─────────────────────────────────────────────────────────── */

export function setDancerName(name: string): void {
  myName = name.trim().slice(0, 12).toUpperCase() || 'DANCER';
}

export function dancerName(): string {
  return myName;
}

export function hostRoom(): void {
  connect(() => send({ t: 'host', name: myName }));
}

export function joinRoom(code: string): void {
  connect(() => send({ t: 'join', code: code.toUpperCase(), name: myName }));
}

/** Host only: lock the roster and drop the needle for the whole room. */
export function requestStart(seats: number, trackId = ''): void {
  send({ t: 'start', seats, track: trackId });
}

export function leaveRoom(): void {
  teardown('');
}

export function sendPose(d: number[]): void {
  if (net.phase === 'live') send({ t: 'p', d });
}

export function sendScore(d: { score: number; combo: number; lives: number; alive: boolean; elim: number }): void {
  if (net.phase === 'live') send({ t: 's', d });
}

/** Auto-join from a share link (?room=CADA&name=YELL). */
export function autoJoinFromUrl(): void {
  const params = new URLSearchParams(location.search);
  const name = params.get('name');
  if (name) setDancerName(name);
  const room = params.get('room');
  if (room && room.length === 4) joinRoom(room);
}

export const netConfigNote = NET;
