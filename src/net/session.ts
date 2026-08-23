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
 * Join by code — four DIGITS, typed on the board's keypad — or by URL:
 * ?room=4096&name=YELL.
 */

import { NET, seatHue, serverUrl } from '../config.js';
import { audioContext, ensureAudio } from '../audio/sfx.js';
import { clearVoiceSpeakers, removeVoiceSpeaker, stopVoiceCapture } from '../club/voice.js';
import { startRaid } from '../game/flow.js';
import { dancerAtSeat, match } from '../game/state.js';
import { clearClubPoses, clubPoses, remotePoses } from './poses.js';

export type NetPhase = 'off' | 'connecting' | 'hosting' | 'joined' | 'live' | 'error';

/** Room codes are DIGITS. Four of them — the thing you shout across a
 *  room or type into a phone — and a numeric alphabet gives 10,000 codes
 *  where the old eight letters gave 4,096, on a pad everybody already
 *  knows how to use. */
export const CODE_ALPHABET = '0123456789';

export interface LobbyMember {
  name: string;
  /** Stable relay member index — club poses and voice are keyed by it. */
  idx: number;
  /** The colour they picked (hue 0..1), or null for "whatever my slot says".
   *  It rides the wire so a choice made in the foyer follows its dancer onto
   *  the club floor; an older relay simply never sends it. */
  hue?: number | null;
}

/** THE BALL, while it hangs: who sent it up, on what song, where it floats,
 *  when it fires (local performance.now ms), and who has touched in. */
export interface BallState {
  callerIdx: number;
  callerName: string;
  track: string;
  /** The caller's difficulty — the whole ring dances one chart. */
  diff: number;
  pos: [number, number, number];
  firesAt: number;
  joins: Set<number>;
}

export const net = {
  phase: 'off' as NetPhase,
  code: '',
  members: [] as LobbyMember[],
  isHost: false,
  /** Is this a PUBLIC room (strangers may walk in) or a private one behind
   *  its four digits? The floor reads the same either way; the difference
   *  is only whether the code is a door or just an address. */
  isPublic: false,
  /** My own relay member index (−1 until the room hands it over). */
  myIdx: -1,
  /** The raid-summoning ball currently in the air, or null. */
  ball: null as BallState | null,
  /** Members currently away playing a set (the floor sees them out). */
  gamePlayers: new Set<number>(),
  /** THE CROWN: member idx of the last club raid's winner, worn on their
   *  figure across the floor until their NEXT game (or they leave the
   *  room). null = bare heads. The relay owns it; clients only wear it. */
  crownIdx: null as number | null,
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
let myHue: number | null = null;
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
  net.isPublic = false;
  net.myIdx = -1;
  net.ball = null;
  net.gamePlayers = new Set();
  net.crownIdx = null;
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

/** Everything the relay says about drinks (see server/index.mjs, DRINKS). */
export type PropWire =
  | { t: 'serve'; id: number }
  | {
      t: 'props';
      props: {
        id: number;
        holder: number | null;
        mode: string;
        pos: number[] | null;
        quat: number[] | null;
        full: boolean;
      }[];
    }
  | { t: 'prop-grab'; id: number; idx: number }
  | { t: 'prop-release'; id: number; idx: number }
  | { t: 'prop'; id: number; idx: number; d: number[] }
  | { t: 'prop-rest'; id: number; idle?: boolean; pos?: number[]; quat?: number[] };

/** ClubPropsSystem keeps the shared glasses true to the wire. */
let propHook: ((msg: PropWire) => void) | null = null;
export function onProp(fn: (msg: PropWire) => void): void {
  propHook = fn;
}

function handle(msg: Record<string, unknown>): void {
  switch (msg.t) {
    case 'room': {
      // Join-time, OR a mid-session battlefield promotion: the host left and
      // the relay handed this club to us.
      const wasLive = net.phase === 'live';
      net.phase = wasLive ? 'live' : msg.host ? 'hosting' : 'joined';
      net.isHost = Boolean(msg.host);
      net.isPublic = Boolean(msg.open);
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
    case 'ball-up': {
      // Somebody sent the ball up — it hangs for `ms`, then fires.
      const joins = Array.isArray(msg.joins) ? (msg.joins as number[]).filter((n) => Number.isFinite(n)) : [];
      net.ball = {
        callerIdx: Number(msg.idx),
        callerName: String(msg.name ?? ''),
        track: typeof msg.track === 'string' ? msg.track : '',
        diff: Number.isFinite(Number(msg.diff)) ? Number(msg.diff) : 1,
        pos:
          Array.isArray(msg.pos) && msg.pos.length === 3
            ? [Number(msg.pos[0]), Number(msg.pos[1]), Number(msg.pos[2])]
            : [0, 1.5, -1.5],
        firesAt: performance.now() + Number(msg.ms ?? 60_000),
        joins: new Set(joins),
      };
      net.dirty++;
      break;
    }
    case 'ball-join': {
      if (!net.ball) break;
      const idx = Number(msg.idx);
      if (msg.in === false) net.ball.joins.delete(idx);
      else net.ball.joins.add(idx);
      net.dirty++;
      break;
    }
    case 'ball-off':
      net.ball = null;
      net.dirty++;
      break;
    case 'game': {
      // Who is away on the ring right now (empty = the floor is whole).
      const players = Array.isArray(msg.players) ? (msg.players as number[]) : [];
      net.gamePlayers = new Set(players.filter((n) => Number.isFinite(n)));
      net.dirty++;
      break;
    }
    case 'crown': {
      // The relay crowned (or bared) a head. Guarded by type, not Number():
      // a JSON null must read as "nobody", never as member 0.
      const idx = msg.idx;
      net.crownIdx = typeof idx === 'number' && Number.isFinite(idx) ? idx : null;
      net.dirty++;
      break;
    }
    case 'start': {
      // The ball fired with ME on it: seed + seats + my ring seat + the
      // player seat map + a shared "beat 0 in N ms" (RTT-compensated).
      net.ball = null;
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
        // seed). Either way the whole room lands on one song — and on the
        // caller's difficulty, so every deck runs the identical chart.
        trackId: typeof msg.track === 'string' ? msg.track : undefined,
        difficulty: Number.isFinite(Number(msg.diff)) ? Number(msg.diff) : undefined,
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
        // Appended, and defaulted: a frame from before the neck existed
        // decodes as a dancer who simply isn't nodding.
        hpitch: d[10] ?? 0, hroll: d[11] ?? 0,
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
        // Appended, and defaulted: a frame from before the neck existed
        // decodes as a dancer who simply isn't nodding.
        hpitch: d[10] ?? 0, hroll: d[11] ?? 0,
        t: performance.now(),
      });
      break;
    }
    case 's': {
      const seat = Number(msg.seat);
      const d = msg.d as ScoreWire;
      const dancer = dancerAtSeat(seat);
      if (dancer && dancer.kind === 'remote' && d) {
        dancer.score = d.score;
        dancer.combo = d.combo;
        dancer.bestCombo = Math.max(dancer.bestCombo, d.combo);
        // Dodges and hits ride along so every client can grade every
        // dancer at the podium without asking anyone.
        dancer.dodges = d.dodges;
        dancer.hits = d.hits;
        dancer.perfects = d.perfects;
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
    case 'serve':
    case 'props':
    case 'prop-grab':
    case 'prop-release':
    case 'prop':
    case 'prop-rest':
      // Drinks traffic goes straight to the glasses (ClubPropsSystem).
      propHook?.(msg as unknown as PropWire);
      break;
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

/**
 * Hand the session the colour this headset dances in (null = the slot's).
 *
 * It travels with the greeting that opens or joins a room — and, if a room
 * is already standing, straight down the wire, since the board is reachable
 * from the foyer with a room open and the club floor should never show a
 * dancer a colour they've stopped wearing.
 *
 * Only the COLOUR updates this way, not the name: the club's mute and block
 * lists are keyed by name, so a rename that propagated would shrug off a
 * block. Renaming stays a between-rooms act.
 */
export function setDancerHue(hue: number | null): void {
  const next = hue === null || !Number.isFinite(hue) ? null : ((hue % 1) + 1) % 1;
  if (next === myHue) return;
  myHue = next;
  if (net.phase === 'hosting' || net.phase === 'joined' || net.phase === 'live') {
    send({ t: 'hue', hue: myHue });
  }
}

export function dancerName(): string {
  return myName;
}

/** The hue a room-mate wears on the club floor: the colour they chose, or
 *  their slot's if they never picked one (or the relay is too old to say). */
export function memberHue(m: LobbyMember): number {
  const h = m.hue;
  return h === null || h === undefined || !Number.isFinite(h) ? seatHue(m.idx) : ((h % 1) + 1) % 1;
}

export function hostRoom(): void {
  connect(() => send({ t: 'host', name: myName, hue: myHue }));
}

/** THE PUBLIC FLOOR: no code, no arranging — the relay drops you into
 *  whichever public room has the most people and still has space, or opens
 *  a fresh one if none does. The other door (host/join with a 4-digit
 *  code) is for a room you want to keep to your friends. */
export function enterPublicRoom(): void {
  connect(() => send({ t: 'public', name: myName, hue: myHue }));
}

export function joinRoom(code: string): void {
  connect(() => send({ t: 'join', code: code.toUpperCase(), name: myName, hue: myHue }));
}

export function leaveRoom(): void {
  teardown('');
}

/* ── THE BALL: how games start from the floor ──────────────────────────── */

/** Send the ball up at `pos` — my song pick and ring-size preference ride
 *  along. The relay owns the 60-second clock from here. */
export function callBall(pos: [number, number, number]): void {
  if (net.phase !== 'hosting' && net.phase !== 'joined') return;
  // No seat count rides the ball. A club raid is sized by WHO TURNS UP —
  // the relay deals everyone who touched onto the smallest ring that fits
  // them and fills the rest with groupies. It used to carry `match.seats`,
  // which is this headset's SOLO ring: a leftover from the last solo set,
  // so two friends in a club room got dealt onto whatever size the host
  // last played alone.
  send({ t: 'ball-up', track: match.preferredTrack, diff: match.difficulty, pos });
}

/** Touch in (or step back out) of the hanging ball. */
export function joinBall(wantIn: boolean): void {
  send({ t: 'ball-join', in: wantIn });
}

/** The caller waving their own ball away. */
export function cancelBall(): void {
  send({ t: 'ball-off' });
}

/** The caller dropping the needle NOW rather than riding the clock down —
 *  a room whose dancers have all touched in has nothing left to wait for.
 *  Whoever is on the ball when this lands is who gets dealt; the relay
 *  runs the same deal the timeout would have. Caller-only, and the relay
 *  enforces that rather than trusting the button. */
export function startBall(): void {
  send({ t: 'ball-go' });
}

/**
 * A finished (or bailed) set folds back onto the club floor, NOT out of the
 * room: phase returns to hosting/joined and the relay is told this player
 * is home — when the last one is, the floor can raise the next ball.
 *
 * `winnerIdx` is THE CROWN's claim, sent only when the set actually
 * RESOLVED (walked out through the podium): the member idx of the night's
 * winner, or null when a groupie took it. Every client on the ring
 * computed the identical standings, so the relay believes the first
 * player home. A mid-set bail passes undefined — it names nobody, and a
 * player who finishes the record will.
 */
export function backToClub(winnerIdx?: number | null): void {
  if (net.phase !== 'live') return;
  net.phase = net.isHost ? 'hosting' : 'joined';
  net.dirty++;
  send(winnerIdx === undefined ? { t: 'game-out' } : { t: 'game-out', winner: winnerIdx });
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

/* ── DRINKS: the glasses' side of the wire (see PropWire) ──────────────── */

function onClubFloor(): boolean {
  return net.phase === 'hosting' || net.phase === 'joined';
}

/** Ask the relay for glass `id` — the hand has already taken it on spec. */
export function sendPropGrab(id: number): void {
  if (onClubFloor()) send({ t: 'prop-grab', id });
}

/** The glass left my hand — mark it catchable; I still fly it. */
export function sendPropRelease(id: number): void {
  if (onClubFloor()) send({ t: 'prop-release', id });
}

/** Owner pose stream: [px,py,pz, qx,qy,qz,qw, full01] at ~20 Hz. */
export function sendPropPose(id: number, d: number[]): void {
  if (onClubFloor()) send({ t: 'prop', id, d });
}

/** My throw settled at pos/quat — or fell out of the world (nulls: idle). */
export function sendPropRest(id: number, pos: number[] | null, quat: number[] | null): void {
  if (!onClubFloor()) return;
  send(pos && quat ? { t: 'prop-rest', id, pos, quat } : { t: 'prop-rest', id, idle: true });
}

/** Ship one local voice frame to the room (binary; any connected phase). */
export function sendVoice(frame: ArrayBuffer): void {
  if (ws?.readyState === WebSocket.OPEN && net.phase !== 'off' && net.phase !== 'error') ws.send(frame);
}

/** The 3 Hz score line: enough for the live board AND the final grade. */
export interface ScoreWire {
  score: number;
  combo: number;
  dodges: number;
  hits: number;
  perfects: number;
  alive: boolean;
  elim: number;
}

export function sendScore(d: ScoreWire): void {
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
