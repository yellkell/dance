/**
 * Online session — thin client for the room relay (server/index.mjs).
 *
 * The deterministic-choreography model keeps this tiny: the server's only
 * real jobs are seats, the seed, and a shared "beat 0 lands in N ms". After
 * that the wire carries poses (10 Hz) and score reports (3 Hz); every client
 * runs the identical show from the seed. Empty seats become groupies,
 * identical on every client.
 *
 * THE CLUB made the room a PLACE, so the session now carries a social layer
 * too — and a room OUTLIVES its sets:
 *
 *  - While the room is on the club floor (hosting/joined), everyone streams
 *    a club pose ('cp', world space, keyed by member idx) and binary VOICE
 *    frames ride the same socket (see src/club/voice.ts for the format).
 *  - 'start' flips the room to a live set; when the set resolves the host
 *    sends 'end' and everyone lands back in the club together, same code,
 *    same members, ready to go again. Leaving is a button, not a side
 *    effect of the music stopping.
 *  - The host can leave without folding the party: the relay promotes the
 *    longest-standing member and tells them with a fresh 'room' message.
 *
 * Join by code (the 4-letter room code uses the alphabet A–H so the XR code
 * picker only needs 8 letters per slot) or by URL: ?room=CADA&name=YELL.
 */

import { NET, serverUrl } from '../config.js';
import { audioContext, ensureAudio } from '../audio/sfx.js';
import { clearVoiceSpeakers, removeVoiceSpeaker, stopVoiceCapture } from '../club/voice.js';
import { startRaid } from '../game/flow.js';
import { dancerAtSeat, match } from '../game/state.js';
import { clearClubPoses, clubPoses, remotePoses } from './poses.js';

export type NetPhase = 'off' | 'connecting' | 'hosting' | 'joined' | 'live' | 'error';

export const CODE_ALPHABET = 'ABCDEFGH';

export interface LobbyMember {
  name: string;
  /** Stable relay member index — club poses and voice are keyed by it. */
  idx: number;
}

export const net = {
  phase: 'off' as NetPhase,
  code: '',
  members: [] as LobbyMember[],
  isHost: false,
  /** My own relay member index (−1 until the room hands it over). */
  myIdx: -1,
  error: '',
  rttMs: 0,
  /** Bumped on any lobby change so menus know to repaint. */
  dirty: 0,
};

/** Member idx → ring seat for the CURRENT set (filled by 'start') — how
 *  voice finds a dancer's platform while the raid is live. */
export const seatByIdx = new Map<number, number>();

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
  ws.binaryType = 'arraybuffer'; // voice frames ride as binary beside the JSON
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
    stopVoiceCapture();
    clearVoiceSpeakers();
    clearClubPoses();
  };
  ws.onmessage = (ev) => {
    // Binary payloads are voice frames; everything else is JSON room traffic.
    if (typeof ev.data !== 'string') {
      handleVoiceFrame(ev.data as ArrayBuffer);
      return;
    }
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(ev.data) as Record<string, unknown>;
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
  net.myIdx = -1;
  net.dirty++;
  seatByIdx.clear();
  stopVoiceCapture();
  clearVoiceSpeakers();
  clearClubPoses();
}

/** A voice frame off the wire: [1-byte id length][ascii sender id][pcm]. */
function handleVoiceFrame(buf: ArrayBuffer): void {
  if (!voiceHook || buf.byteLength < 2) return;
  const bytes = new Uint8Array(buf);
  const idLen = bytes[0];
  if (buf.byteLength < 1 + idLen + 8) return;
  let id = '';
  for (let i = 0; i < idLen; i++) id += String.fromCharCode(bytes[1 + i]);
  voiceHook(id, buf.slice(1 + idLen));
}

/** ClubSocialSystem routes inbound frames to the spatial speakers. */
let voiceHook: ((id: string, frame: ArrayBuffer) => void) | null = null;
export function onVoice(fn: (id: string, frame: ArrayBuffer) => void): void {
  voiceHook = fn;
}

function handle(msg: Record<string, unknown>): void {
  switch (msg.t) {
    case 'room': {
      // Join-time, OR a mid-session battlefield promotion: the host left and
      // the relay handed this club to us.
      const wasLive = net.phase === 'live';
      net.phase = wasLive ? 'live' : msg.host ? 'hosting' : 'joined';
      net.isHost = Boolean(msg.host);
      net.code = String(msg.code ?? net.code);
      if (Number.isFinite(Number(msg.idx))) net.myIdx = Number(msg.idx);
      net.dirty++;
      break;
    }
    case 'roster': {
      const members = (msg.players as LobbyMember[]) ?? [];
      // Anyone who vanished takes their voice and club figure with them.
      const still = new Set(members.map((m) => m.idx));
      for (const old of net.members) {
        if (!still.has(old.idx)) {
          removeVoiceSpeaker(String(old.idx));
          clubPoses.delete(old.idx);
        }
      }
      net.members = members;
      net.dirty++;
      break;
    }
    case 'start': {
      // Everyone leaves the club floor together: seed + seats + my ring seat
      // + the human seat map + a shared "beat 0 in N ms" (RTT-compensated).
      const players = (msg.players as { seat: number; name: string; idx?: number; you?: boolean }[]) ?? [];
      const humans = new Map<number, { name: string; netId?: number }>();
      seatByIdx.clear();
      let mySeat = 0;
      for (const p of players) {
        if (Number.isFinite(Number(p.idx))) seatByIdx.set(Number(p.idx), p.seat);
        if (p.you) mySeat = p.seat;
        else humans.set(p.seat, { name: p.name, netId: p.idx });
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
    case 'cp': {
      // A room-mate moving through the club (world space, keyed by idx).
      const idx = Number(msg.idx);
      const d = msg.d as number[];
      if (!Number.isFinite(idx) || !Array.isArray(d) || d.length < 10) break;
      clubPoses.set(idx, {
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
      const idx = Number(msg.idx);
      if (Number.isFinite(idx)) {
        removeVoiceSpeaker(String(idx));
        clubPoses.delete(idx);
        seatByIdx.delete(idx);
      }
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

/**
 * A finished (or bailed) set folds back into the club, NOT out of the room:
 * phase returns to hosting/joined, the host tells the relay the floor is
 * open again, and the same members carry on where the music left them.
 */
export function backToClub(): void {
  if (net.phase !== 'live') return;
  net.phase = net.isHost ? 'hosting' : 'joined';
  net.dirty++;
  if (net.isHost) send({ t: 'end' });
  remotePoses.clear();
  seatByIdx.clear();
}

export function sendPose(d: number[]): void {
  if (net.phase === 'live') send({ t: 'p', d });
}

/** My spot on the club floor (world space) — for the room-mates' view. */
export function sendClubPose(d: number[]): void {
  if (net.phase === 'hosting' || net.phase === 'joined') send({ t: 'cp', d });
}

/** Ship one local voice frame to the room (binary; any connected phase). */
export function sendVoice(frame: ArrayBuffer): void {
  if (ws?.readyState === WebSocket.OPEN && net.phase !== 'off' && net.phase !== 'error') ws.send(frame);
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
