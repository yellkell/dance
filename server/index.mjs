/**
 * RAVE RAID room relay — rooms of up to 24 dancers behind 4-letter codes.
 *
 * The game's choreography is deterministic from the seed, so this server is
 * almost embarrassingly small: it mints room codes, tracks who's in the
 * room, and relays. Empty seats are filled with identical seeded groupies
 * by every client — the server never simulates anything.
 *
 * THE CLUB (the social floor) leans on a handful of verbs, all still just
 * relaying — and games are called FROM the floor with THE BALL:
 *
 *  - 'cp' club poses: members stream their spot on the floor; fanned out
 *    with the sender's idx.
 *  - VOICE: binary frames ride the same socket ([8-byte f64 sample rate +
 *    Int16 PCM], see src/club/voice.ts). The relay prepends the sender's
 *    idx as an ascii id and fans them to everyone else — floor or ring.
 *  - THE BALL: any member sends 'ball-up' (their song pick rides along) and
 *    a disco ball hangs in the room for BALL_MS. Members touch it to opt in
 *    ('ball-join'); the caller's touch cancels it ('ball-off'). When the
 *    timer runs out HERE (the server owns the clock), the caller plus
 *    everyone who touched get dealt seats, THE seed, and "beat 0 in N ms" —
 *    and only they leave for the ring. The floor stays open: stay-behinds
 *    keep dancing, newcomers keep joining, and a 'game' broadcast tells
 *    everyone who is away playing. Players fold back with 'game-out' when
 *    their set resolves; when the last one returns the ball may rise again.
 *  - A departing host is replaced by the longest-standing member instead of
 *    folding the party.
 *
 *   npm run server            # listens on :8788 (or PORT=…)
 *
 * Point clients at it with ?server=wss://your-host:8788 (ws:// in dev).
 * BALL_MS=4000 shrinks the ball timer (the two-headset test uses it).
 */

import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT || 8788);
const BALL_MS = Number(process.env.BALL_MS || 60_000);
const CODE_ALPHABET = 'ABCDEFGH';
const MAX_ROOM = 24;
const START_IN_MS = 5500; // count-in cushion: 8 beats at 128 BPM is 3750 ms

/**
 * code → {
 *   members: Map<ws, {name, idx, seat}>,
 *   host: ws,
 *   ball: { caller: idx, track, seats, pos, joins: Set<idx>, timer, deadline } | null,
 *   playing: Set<idx>,   // members currently away on the ring
 * }
 */
const rooms = new Map();

const http = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ game: 'goopliath-dance-raid', rooms: rooms.size }));
});

const wss = new WebSocketServer({ server: http });

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function mintCode() {
  for (let tries = 0; tries < 64; tries++) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
  return null;
}

function roster(room) {
  return [...room.members.values()]
    .sort((a, b) => a.idx - b.idx)
    .map((m) => ({ name: m.name, idx: m.idx }));
}

function broadcast(room, obj, except = null) {
  for (const member of room.members.keys()) {
    if (member !== except) send(member, obj);
  }
}

function memberByIdx(room, idx) {
  for (const [ws, info] of room.members.entries()) {
    if (info.idx === idx) return [ws, info];
  }
  return null;
}

function clearBall(room) {
  if (!room.ball) return;
  clearTimeout(room.ball.timer);
  room.ball = null;
}

function broadcastGame(room) {
  broadcast(room, { t: 'game', players: [...room.playing].sort((a, b) => a - b) });
}

/** The ball's timer ran out — deal the willing onto the ring. */
function fireBall(code) {
  const room = rooms.get(code);
  if (!room?.ball) return;
  const ball = room.ball;
  room.ball = null;

  // The caller plus everyone who touched, in join order, still present.
  const idxs = [ball.caller, ...ball.joins].filter((idx) => memberByIdx(room, idx));
  broadcast(room, { t: 'ball-off' });
  if (idxs.length === 0) return; // the caller walked — the ball just fades

  const players = idxs.map((idx) => memberByIdx(room, idx));
  const seats = Math.min(MAX_ROOM, Math.max(4, Number(ball.seats) || players.length, players.length));
  players.forEach(([, info], i) => {
    info.seat = Math.floor((i * seats) / players.length);
  });
  const seed = (Math.random() * 0xffffffff) >>> 0;
  for (const [ws] of players) {
    send(ws, {
      t: 'start',
      seed,
      seats,
      track: ball.track,
      startInMs: START_IN_MS,
      players: players.map(([m, h]) => ({ seat: h.seat, name: h.name, idx: h.idx, you: m === ws })),
    });
  }
  room.playing = new Set(players.map(([, info]) => info.idx));
  broadcastGame(room);
  console.log(`[dance-raid] room ${code}: the ball fired — ${players.length} on a ${seats}-ring, ${room.members.size - players.length} hold the floor`);
}

function leaveRoom(ws) {
  const code = ws.room;
  if (!code) return;
  ws.room = null;
  const room = rooms.get(code);
  if (!room) return;
  const info = room.members.get(ws);
  room.members.delete(ws);

  if (room.members.size === 0) {
    clearBall(room);
    rooms.delete(code);
    return;
  }
  // A departing host doesn't fold the club — the longest-standing member
  // inherits the room (told via a fresh 'room' message, host: true).
  if (ws === room.host) {
    const heir = [...room.members.entries()].sort((a, b) => a[1].idx - b[1].idx)[0];
    room.host = heir[0];
    send(heir[0], { t: 'room', code, host: true, idx: heir[1].idx });
    console.log(`[dance-raid] room ${code}: host left, ${heir[1].name} inherits`);
  }
  if (info) {
    // Their touch on the ball goes with them; a caller's exit cancels it.
    if (room.ball) {
      if (room.ball.caller === info.idx) {
        clearBall(room);
        broadcast(room, { t: 'ball-off' });
      } else if (room.ball.joins.delete(info.idx)) {
        broadcast(room, { t: 'ball-join', idx: info.idx, in: false });
      }
    }
    if (room.playing.delete(info.idx)) {
      broadcast(room, { t: 'left', seat: info.seat, idx: info.idx });
      broadcastGame(room);
    }
  }
  broadcast(room, { t: 'roster', players: roster(room) });
}

/** Fan a member's binary voice frame to the rest of their room, tagged
 *  with the sender's idx: [1-byte id length][ascii id][frame]. */
function relayVoice(ws, frame) {
  const room = rooms.get(ws.room);
  if (!room) return;
  const info = room.members.get(ws);
  if (!info) return;
  const id = String(info.idx);
  const head = Buffer.from([id.length, ...Buffer.from(id, 'ascii')]);
  const packet = Buffer.concat([head, Buffer.isBuffer(frame) ? frame : Buffer.from(frame)]);
  for (const member of room.members.keys()) {
    if (member !== ws && member.readyState === member.OPEN) member.send(packet, { binary: true });
  }
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.room = null;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw, isBinary) => {
    // Binary = a voice frame; everything textual is room traffic.
    if (isBinary) {
      relayVoice(ws, raw);
      return;
    }
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.t) {
      case 'ping':
        send(ws, { t: 'pong', t0: msg.t0 });
        break;

      case 'host': {
        leaveRoom(ws);
        const code = mintCode();
        if (!code) {
          send(ws, { t: 'err', m: 'no room codes free' });
          break;
        }
        const room = { members: new Map(), host: ws, ball: null, playing: new Set() };
        room.members.set(ws, { name: sanitizeName(msg.name), idx: 0, seat: 0 });
        rooms.set(code, room);
        ws.room = code;
        send(ws, { t: 'room', code, host: true, idx: 0 });
        send(ws, { t: 'roster', players: roster(room) });
        console.log(`[dance-raid] room ${code} opened`);
        break;
      }

      case 'join': {
        leaveRoom(ws);
        const code = String(msg.code ?? '').toUpperCase();
        const room = rooms.get(code);
        if (!room) {
          send(ws, { t: 'err', m: 'no such room' });
          break;
        }
        if (room.members.size >= MAX_ROOM) {
          send(ws, { t: 'err', m: 'room is full' });
          break;
        }
        // The floor is ALWAYS open — a set being away on the ring doesn't
        // bar the door anymore. Latecomers land in the club.
        const idx = Math.max(-1, ...[...room.members.values()].map((m) => m.idx)) + 1;
        room.members.set(ws, { name: sanitizeName(msg.name), idx, seat: idx });
        ws.room = code;
        send(ws, { t: 'room', code, host: false, idx });
        broadcast(room, { t: 'roster', players: roster(room) });
        // Walk them into whatever is mid-air: a hanging ball, a live game.
        if (room.ball) {
          send(ws, {
            t: 'ball-up',
            idx: room.ball.caller,
            name: memberByIdx(room, room.ball.caller)?.[1].name ?? '',
            track: room.ball.track,
            pos: room.ball.pos,
            ms: Math.max(500, room.ball.deadline - Date.now()),
            joins: [...room.ball.joins],
          });
        }
        if (room.playing.size) send(ws, { t: 'game', players: [...room.playing].sort((a, b) => a - b) });
        break;
      }

      /* ── THE BALL ─────────────────────────────────────────────────── */

      case 'ball-up': {
        const room = rooms.get(ws.room);
        const info = room?.members.get(ws);
        if (!room || !info) break;
        if (room.ball || room.playing.size) {
          // A ball is already up or a game is out — clear the asker's UI.
          send(ws, { t: 'ball-off' });
          break;
        }
        const pos = Array.isArray(msg.pos) && msg.pos.length === 3 ? msg.pos.map(Number) : [0, 1.5, -1.5];
        const track = typeof msg.track === 'string' ? msg.track.slice(0, 32) : '';
        // Capture the code now — ws.room clears if the caller walks, and
        // the timeout must still find the room (fireBall re-checks state).
        const code = ws.room;
        room.ball = {
          caller: info.idx,
          track,
          seats: Number(msg.seats) || 0,
          pos,
          joins: new Set(),
          deadline: Date.now() + BALL_MS,
          timer: setTimeout(() => fireBall(code), BALL_MS),
        };
        broadcast(room, {
          t: 'ball-up',
          idx: info.idx,
          name: info.name,
          track,
          pos,
          ms: BALL_MS,
          joins: [],
        });
        console.log(`[dance-raid] room ${code}: ${info.name} sent the ball up (${track || 'shuffle'})`);
        break;
      }

      case 'ball-join': {
        const room = rooms.get(ws.room);
        const info = room?.members.get(ws);
        if (!room?.ball || !info || info.idx === room.ball.caller) break;
        const wantIn = msg.in !== false;
        const changed = wantIn ? !room.ball.joins.has(info.idx) : room.ball.joins.delete(info.idx);
        if (wantIn) room.ball.joins.add(info.idx);
        if (changed || wantIn) broadcast(room, { t: 'ball-join', idx: info.idx, in: wantIn });
        break;
      }

      case 'ball-off': {
        // Only the caller can wave their ball away.
        const room = rooms.get(ws.room);
        const info = room?.members.get(ws);
        if (!room?.ball || !info || room.ball.caller !== info.idx) break;
        clearBall(room);
        broadcast(room, { t: 'ball-off' });
        break;
      }

      /* ── the set, and coming home from it ─────────────────────────── */

      case 'game-out': {
        // A player's set resolved (or they bailed) — they're back on the
        // floor. When the last one returns, the ball may rise again.
        const room = rooms.get(ws.room);
        const info = room?.members.get(ws);
        if (!room || !info) break;
        if (room.playing.delete(info.idx)) broadcastGame(room);
        break;
      }

      case 'p':
      case 's': {
        const room = rooms.get(ws.room);
        if (!room || !room.playing.size) break;
        const info = room.members.get(ws);
        if (!info || !room.playing.has(info.idx)) break;
        // Ring traffic concerns the ring: only fellow players receive it.
        for (const [member, mInfo] of room.members.entries()) {
          if (member !== ws && room.playing.has(mInfo.idx)) {
            send(member, { t: msg.t, seat: info.seat, d: msg.d });
          }
        }
        break;
      }

      case 'cp': {
        // A club-floor pose — relayed with the sender's idx, any time the
        // room exists (the floor is live before, during and after sets).
        const room = rooms.get(ws.room);
        if (!room) break;
        const info = room.members.get(ws);
        if (!info) break;
        broadcast(room, { t: 'cp', idx: info.idx, d: msg.d }, ws);
        break;
      }
    }
  });

  ws.on('close', () => leaveRoom(ws));
});

function sanitizeName(name) {
  return String(name ?? 'DANCER').replace(/[^\w !?'-]/g, '').slice(0, 12).toUpperCase() || 'DANCER';
}

// Heartbeat: cull dead sockets so lobbies never wedge on a ghost.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 10_000);

http.listen(PORT, () => {
  console.log(`[dance-raid] relay listening on :${PORT} (ball: ${BALL_MS} ms)`);
});
