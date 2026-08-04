/**
 * DANCE RAID room relay — rooms of up to 24 dancers behind 4-letter codes.
 *
 * The game's choreography is deterministic from the seed, so this server is
 * almost embarrassingly small: it mints room codes, tracks who's in the
 * lobby, and when the host starts it deals every human a ring seat, rolls
 * THE seed, and tells everyone "beat 0 lands in N ms". After that it relays
 * pose ('p') and score ('s') packets to the rest of the room, verbatim.
 * Empty seats are filled with identical seeded groupies by every client —
 * the server never simulates anything.
 *
 *   npm run server            # listens on :8788 (or PORT=…)
 *
 * Point clients at it with ?server=wss://your-host:8788 (ws:// in dev).
 */

import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT || 8788);
const CODE_ALPHABET = 'ABCDEFGH';
const MAX_ROOM = 24;
const START_IN_MS = 5500; // count-in cushion: 8 beats at 128 BPM is 3750 ms

/** code → { members: Map<ws, {name, idx, seat}>, host: ws, started, seed } */
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

function leaveRoom(ws) {
  const code = ws.room;
  if (!code) return;
  ws.room = null;
  const room = rooms.get(code);
  if (!room) return;
  const info = room.members.get(ws);
  room.members.delete(ws);

  if (room.members.size === 0) {
    rooms.delete(code);
    return;
  }
  if (room.started && info) {
    broadcast(room, { t: 'left', seat: info.seat });
    return;
  }
  if (ws === room.host) {
    // Host walked before the drop — the room folds.
    broadcast(room, { t: 'err', m: 'host left — room closed' });
    for (const member of room.members.keys()) member.room = null;
    rooms.delete(code);
    return;
  }
  broadcast(room, { t: 'roster', players: roster(room) });
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.room = null;
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
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
        const room = { members: new Map(), host: ws, started: false };
        room.members.set(ws, { name: sanitizeName(msg.name), idx: 0, seat: 0 });
        rooms.set(code, room);
        ws.room = code;
        send(ws, { t: 'room', code, host: true });
        send(ws, { t: 'roster', players: roster(room) });
        console.log(`[dance-raid] room ${code} opened`);
        break;
      }

      case 'join': {
        leaveRoom(ws);
        const code = String(msg.code ?? '').toUpperCase();
        const room = rooms.get(code);
        if (!room || room.started) {
          send(ws, { t: 'err', m: room ? 'set already started' : 'no such room' });
          break;
        }
        if (room.members.size >= MAX_ROOM) {
          send(ws, { t: 'err', m: 'room is full' });
          break;
        }
        const idx = Math.max(-1, ...[...room.members.values()].map((m) => m.idx)) + 1;
        room.members.set(ws, { name: sanitizeName(msg.name), idx, seat: idx });
        ws.room = code;
        send(ws, { t: 'room', code, host: false });
        broadcast(room, { t: 'roster', players: roster(room) });
        break;
      }

      case 'start': {
        const room = rooms.get(ws.room);
        if (!room || room.host !== ws || room.started) break;
        room.started = true;
        const humans = [...room.members.entries()].sort((a, b) => a[1].idx - b[1].idx);
        // Ring size: what the host asked for, never smaller than the humans.
        const seats = Math.min(MAX_ROOM, Math.max(4, Number(msg.seats) || humans.length, humans.length));
        // Spread the humans evenly around the ring; groupies fill the gaps.
        humans.forEach(([, info], i) => {
          info.seat = Math.floor((i * seats) / humans.length);
        });
        const seed = (Math.random() * 0xffffffff) >>> 0;
        // The host's record choice rides along verbatim ('' = let every
        // client derive the same one from the seed). The server never looks
        // inside it — the client registry owns what track ids mean.
        const track = typeof msg.track === 'string' ? msg.track.slice(0, 32) : '';
        for (const [member, info] of room.members.entries()) {
          send(member, {
            t: 'start',
            seed,
            seats,
            track,
            startInMs: START_IN_MS,
            players: humans.map(([m, h]) => ({ seat: h.seat, name: h.name, you: m === member })),
          });
        }
        console.log(`[dance-raid] room ${ws.room} dropped: ${humans.length} humans on a ${seats}-ring`);
        break;
      }

      case 'p':
      case 's': {
        const room = rooms.get(ws.room);
        if (!room || !room.started) break;
        const info = room.members.get(ws);
        if (!info) break;
        broadcast(room, { t: msg.t, seat: info.seat, d: msg.d }, ws);
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
  console.log(`[dance-raid] relay listening on :${PORT}`);
});
