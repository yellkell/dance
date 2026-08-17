/**
 * RAVE RAID room relay — rooms of up to 24 dancers behind 4-digit codes.
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
 *  - DRINKS: the FIRE FIGHT prop broker, poured into this house. The room
 *    keeps a registry of PROP_COUNT glasses; the server owns the DUMBWAITER
 *    clock (like the ball's), so one shared coupe rises on one shared plate:
 *    'serve' names the glass on the pedestal. Ownership is brokered —
 *    'prop-grab' is granted when a glass is free, mid-flight (a catch), or
 *    already the asker's; a losing asker is told who really holds it. The
 *    owner streams pose+fill ('prop', ~20 Hz, stored and fanned out),
 *    'prop-release' marks a throw catchable, and 'prop-rest' parks the
 *    final pose — which is what late joiners get in their 'props' snapshot.
 *    Leavers and dancers dealt onto the ring drop whatever they held.
 *  - COLOUR: a dancer's chosen hue rides the 'host'/'join' greeting and is
 *    carried in the roster, so the figure and name tag on the club floor
 *    wear the colour they picked rather than the one their slot handed out.
 *    'hue' updates it on a room already standing (the board is reachable
 *    from the foyer mid-room). Names deliberately do NOT work this way —
 *    the club's mute/block lists key on them.
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
// Four DIGITS: 10,000 codes, and a keypad to type them on. (Was eight
// letters — 4,096 codes and a cycling letter-picker to enter them.)
const CODE_ALPHABET = '0123456789';
const MAX_ROOM = 24;
/** RING SIZES a ball may be dealt onto. The raid takes the SMALLEST one
 *  that seats everybody who touched in, and the seats nobody claimed
 *  become groupies — so a caller who dances alone gets a full four-ring
 *  rather than a bare solo deck, five dancers get a proper eight, and
 *  nobody pays to render a twenty-four-ring for a room of three.
 *
 *  Steps of four rather than an exact fit because a ring wants filling:
 *  five humans on a five-ring is five decks and no crowd, while five on an
 *  eight leaves three groupies dancing between them. */
const RING_SIZES = [4, 8, 12, 16, 20, 24];
const ringFor = (n) => RING_SIZES.find((size) => size >= n) ?? MAX_ROOM;
const START_IN_MS = 5500; // count-in cushion: 8 beats at 128 BPM is 3750 ms
const PROP_COUNT = 6; // mirrors the client's glass pool (ClubPropsSystem)
const SERVE_MS = 1600; // the plate's sink + pause before the next coupe rises
const SERVE_RETRY_MS = 900; // every glass out on the floor — bide, try again

/**
 * code → {
 *   members: Map<ws, {name, idx, seat}>,
 *   host: ws,
 *   ball: { caller: idx, track, diff, pos, joins: Set<idx>, timer, deadline } | null,
 *   playing: Set<idx>,   // members currently away on the ring
 *   props: [{ holder: idx|null, mode, pos, quat, full, restedAt }],  // the glasses
 *   serveTimer,          // the dumbwaiter's clock (server-owned, like the ball's)
 *   crown: idx|null,     // THE CROWN: the last set's winner, worn on the floor
 *   lastSet: Set<idx>,   // who was dealt onto the most recent ring
 *   crownSettled,        // has this set's winner been claimed yet?
 * }
 *
 * THE CROWN: when a set resolves, the first player home ('game-out' with a
 * `winner` field — every client computed the identical podium, so first is
 * as good as all) names the night's winner, and the whole room is told to
 * crown that figure. It stays on across the floor until the wearer's NEXT
 * game — the deal-in takes it off — or until they leave the room. A set a
 * groupie won names nobody, and a mid-set bail carries no field at all.
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
    .map((m) => ({ name: m.name, idx: m.idx, hue: m.hue ?? null }));
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

/** Open a fresh room around `ws`. `isPublic` marks it as somewhere the
 *  PUBLIC FLOOR door may drop a stranger; private rooms are reachable only
 *  by their four digits. Returns false if the code space is exhausted. */
function openRoom(ws, msg, isPublic) {
  leaveRoom(ws);
  const code = mintCode();
  if (!code) return false;
  const room = {
    members: new Map(),
    host: ws,
    isPublic,
    ball: null,
    playing: new Set(),
    props: freshProps(),
    serveTimer: null,
    crown: null,
    lastSet: new Set(),
    crownSettled: true, // no set yet — nothing to claim
  };
  room.members.set(ws, { name: sanitizeName(msg.name), hue: sanitizeHue(msg.hue), idx: 0, seat: 0 });
  rooms.set(code, room);
  ws.room = code;
  send(ws, { t: 'room', code, host: true, idx: 0, open: isPublic });
  send(ws, { t: 'roster', players: roster(room) });
  // The snapshot doubles as "this relay speaks drinks"; the first coupe
  // rises on the dumbwaiter's own clock.
  send(ws, { t: 'props', props: snapshotProps(room) });
  armServe(code, room);
  console.log(`[dance-raid] room ${code} opened (${isPublic ? 'public floor' : 'private'})`);
  return true;
}

/** Put `ws` into an existing room and catch them up on everything already
 *  in the air. The caller has checked the room exists and has space. */
function joinRoomByCode(ws, msg, code) {
  leaveRoom(ws);
  const room = rooms.get(code);
  if (!room) return;
  // The floor is ALWAYS open — a set being away on the ring doesn't bar
  // the door. Latecomers land in the club.
  const idx = Math.max(-1, ...[...room.members.values()].map((m) => m.idx)) + 1;
  room.members.set(ws, { name: sanitizeName(msg.name), hue: sanitizeHue(msg.hue), idx, seat: idx });
  ws.room = code;
  send(ws, { t: 'room', code, host: false, idx, open: Boolean(room.isPublic) });
  broadcast(room, { t: 'roster', players: roster(room) });
  // Walk them into whatever is mid-air: a hanging ball, a live game.
  if (room.ball) {
    send(ws, {
      t: 'ball-up',
      idx: room.ball.caller,
      name: memberByIdx(room, room.ball.caller)?.[1].name ?? '',
      track: room.ball.track,
      diff: room.ball.diff,
      pos: room.ball.pos,
      ms: Math.max(500, room.ball.deadline - Date.now()),
      joins: [...room.ball.joins],
    });
  }
  if (room.playing.size) send(ws, { t: 'game', players: [...room.playing].sort((a, b) => a - b) });
  // ... the reigning winner, still wearing their crown ...
  if (room.crown !== null) send(ws, { t: 'crown', idx: room.crown });
  // ... and the drinks as they stand: the pedestal, the floor, the air.
  send(ws, { t: 'props', props: snapshotProps(room) });
}

function clearBall(room) {
  if (!room.ball) return;
  clearTimeout(room.ball.timer);
  room.ball = null;
}

/* ── DRINKS: the dumbwaiter's clock and the glass registry ──────────────── */

function freshProps() {
  return Array.from({ length: PROP_COUNT }, () => ({
    holder: null, // member idx simulating it (held or mid-throw), or free
    mode: 'idle', // idle | pedestal | held | flight | rest
    pos: null, // last owner-streamed / settled [x,y,z]
    quat: null, // ... and [x,y,z,w]
    full: true,
    restedAt: 0, // when it settled — the house recycles the longest-resting
  }));
}

/** The room's glasses as a late joiner needs them. */
function snapshotProps(room) {
  return room.props.map((p, id) => ({
    id, holder: p.holder, mode: p.mode, pos: p.pos, quat: p.quat, full: p.full,
  }));
}

function clearServe(room) {
  if (room.serveTimer) {
    clearTimeout(room.serveTimer);
    room.serveTimer = null;
  }
}

function armServe(code, room, ms = SERVE_MS) {
  clearServe(room);
  room.serveTimer = setTimeout(() => fireServe(code), ms);
}

/** The plate rises: put the next coupe on the pedestal — a fresh glass
 *  first, else the longest-resting one (the house quietly tidies). */
function fireServe(code) {
  const room = rooms.get(code);
  if (!room) return;
  room.serveTimer = null;
  let id = room.props.findIndex((p) => p.mode === 'idle' && p.holder === null);
  if (id < 0) {
    let oldest = Infinity;
    room.props.forEach((p, i) => {
      if (p.mode === 'rest' && p.holder === null && p.restedAt < oldest) {
        oldest = p.restedAt;
        id = i;
      }
    });
  }
  if (id < 0) {
    armServe(code, room, SERVE_RETRY_MS);
    return;
  }
  const prop = room.props[id];
  prop.holder = null;
  prop.mode = 'pedestal';
  prop.full = true;
  prop.pos = null;
  prop.quat = null;
  broadcast(room, { t: 'serve', id });
}

/** A member leaves the floor (room exit, or dealt onto the ring): whatever
 *  they were holding or had mid-air drops where it last was. */
function dropProps(room, idx) {
  room.props?.forEach((prop, id) => {
    if (prop.holder !== idx) return;
    prop.holder = null;
    if (prop.pos) {
      prop.mode = 'rest';
      prop.restedAt = Date.now();
      broadcast(room, { t: 'prop-rest', id, pos: prop.pos, quat: prop.quat });
    } else {
      prop.mode = 'idle';
      broadcast(room, { t: 'prop-rest', id, idle: true });
    }
  });
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
  const seats = ringFor(players.length);
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
      diff: ball.diff,
      startInMs: START_IN_MS,
      players: players.map(([m, h]) => ({ seat: h.seat, name: h.name, idx: h.idx, you: m === ws })),
    });
  }
  room.playing = new Set(players.map(([, info]) => info.idx));
  broadcastGame(room);
  // THE CROWN comes off at the door: the wearer's next game is starting.
  // The set that just dealt is now the one whose winner may claim it.
  room.lastSet = new Set(room.playing);
  room.crownSettled = false;
  if (room.crown !== null && room.playing.has(room.crown)) {
    room.crown = null;
    broadcast(room, { t: 'crown', idx: null });
  }
  // Nobody carries a coupe onto the ring — held drinks drop to the floor.
  for (const [, info] of players) dropProps(room, info.idx);
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
    clearServe(room);
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
    // A crown walks out with its wearer — the room's heads go bare.
    if (room.crown === info.idx) {
      room.crown = null;
      broadcast(room, { t: 'crown', idx: null });
    }
    // Their drink drops where it last was; their touch on the ball goes
    // with them; a caller's exit cancels it.
    dropProps(room, info.idx);
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
        if (!openRoom(ws, msg, false)) send(ws, { t: 'err', m: 'no room codes free' });
        break;
      }

      // THE PUBLIC FLOOR. No code, no arranging: put me wherever the
      // strangers are. The relay walks you into the FULLEST public room
      // with space — clustering, not scattering, because one club with
      // nine people in it is a night out and three clubs with three each
      // is three lonely rooms. If none has room, it opens a fresh one.
      case 'public': {
        let best = null;
        let bestSize = -1;
        for (const [code, room] of rooms) {
          if (!room.isPublic || room.members.size >= MAX_ROOM) continue;
          if (room.members.size > bestSize) {
            bestSize = room.members.size;
            best = code;
          }
        }
        if (best) joinRoomByCode(ws, msg, best);
        else if (!openRoom(ws, msg, true)) send(ws, { t: 'err', m: 'no room codes free' });
        break;
      }

      case 'join': {
        const code = String(msg.code ?? '').toUpperCase();
        if (!rooms.has(code)) {
          send(ws, { t: 'err', m: 'no such room' });
          break;
        }
        if (rooms.get(code).members.size >= MAX_ROOM) {
          send(ws, { t: 'err', m: 'room is full' });
          break;
        }
        joinRoomByCode(ws, msg, code);
        break;
      }

      // A dancer repainted themselves at the board with the room still
      // open. Names are fixed at the door (the safety lists key on them);
      // the colour is free to change and the floor repaints to match.
      case 'hue': {
        const room = rooms.get(ws.room);
        const info = room?.members.get(ws);
        if (!room || !info) break;
        const hue = sanitizeHue(msg.hue);
        if (hue === info.hue) break;
        info.hue = hue;
        broadcast(room, { t: 'roster', players: roster(room) });
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
        // The caller's difficulty rides the ball like their song pick does.
        const diff = Number.isFinite(Number(msg.diff)) ? Math.max(0, Math.min(3, Number(msg.diff))) : 1;
        // Capture the code now — ws.room clears if the caller walks, and
        // the timeout must still find the room (fireBall re-checks state).
        const code = ws.room;
        room.ball = {
          caller: info.idx,
          track,
          diff,
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
          diff,
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
        const wasPlaying = room.playing.delete(info.idx);
        if (wasPlaying) broadcastGame(room);
        // THE CROWN's claim: only a player of THIS set may make it, only
        // once per set, and only for someone that set actually dealt who
        // is still in the room. `winner: null` (a groupie's night) settles
        // the set with no crown; a bail sends no field and settles nothing.
        if (wasPlaying && !room.crownSettled && 'winner' in msg) {
          room.crownSettled = true;
          const idx = typeof msg.winner === 'number' && Number.isFinite(msg.winner) ? msg.winner : null;
          if (idx !== null && room.lastSet.has(idx) && memberByIdx(room, idx)) {
            room.crown = idx;
            broadcast(room, { t: 'crown', idx });
            console.log(`[dance-raid] room ${ws.room}: ${memberByIdx(room, idx)[1].name} takes the crown`);
          }
        }
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

      /* ── DRINKS: the FIRE FIGHT prop broker ───────────────────────── */

      case 'prop-grab': {
        // Granted when the glass is free, mid-flight (a catch), or already
        // theirs. Everyone hears the grant; a losing asker hears the truth.
        const room = rooms.get(ws.room);
        const info = room?.members.get(ws);
        const id = Number(msg.id);
        const prop = room?.props?.[id];
        if (!room || !info || !prop) break;
        if (prop.holder === null || prop.mode === 'flight' || prop.holder === info.idx) {
          const wasServed = prop.mode === 'pedestal';
          prop.holder = info.idx;
          prop.mode = 'held';
          broadcast(room, { t: 'prop-grab', id, idx: info.idx });
          // The plate's drink was taken — sink, pause, rise with the next.
          if (wasServed) armServe(ws.room, room);
        } else {
          send(ws, { t: 'prop-grab', id, idx: prop.holder });
        }
        break;
      }

      case 'prop-release': {
        // A throw: the glass goes catchable, the thrower keeps simulating
        // (and streaming) the arc until it settles or someone snags it.
        const room = rooms.get(ws.room);
        const info = room?.members.get(ws);
        const prop = room?.props?.[Number(msg.id)];
        if (!room || !info || !prop || prop.holder !== info.idx) break;
        prop.mode = 'flight';
        broadcast(room, { t: 'prop-release', id: Number(msg.id), idx: info.idx }, ws);
        break;
      }

      case 'prop': {
        // The owner's pose+fill stream (~20 Hz): stored — it's the drop
        // spot if they vanish, and the snapshot pose — then fanned out.
        const room = rooms.get(ws.room);
        const info = room?.members.get(ws);
        const prop = room?.props?.[Number(msg.id)];
        if (!room || !info || !prop || prop.holder !== info.idx) break;
        if (!Array.isArray(msg.d) || msg.d.length < 8) break;
        const d = msg.d.slice(0, 8).map(Number);
        if (d.some((n) => !Number.isFinite(n))) break; // one NaN would poison every client
        prop.pos = [d[0], d[1], d[2]];
        prop.quat = [d[3], d[4], d[5], d[6]];
        prop.full = d[7] > 0.5;
        broadcast(room, { t: 'prop', id: Number(msg.id), idx: info.idx, d }, ws);
        break;
      }

      case 'prop-rest': {
        // The owner's flight settled (or fell out of the world: idle) —
        // the final pose sticks and the glass goes free.
        const room = rooms.get(ws.room);
        const info = room?.members.get(ws);
        const id = Number(msg.id);
        const prop = room?.props?.[id];
        if (!room || !info || !prop || prop.holder !== info.idx) break;
        prop.holder = null;
        if (msg.idle) {
          prop.mode = 'idle';
          prop.pos = null;
          prop.quat = null;
          broadcast(room, { t: 'prop-rest', id, idle: true }, ws);
        } else {
          const fin = (a, n) => Array.isArray(a) && a.length === n && a.map(Number).every(Number.isFinite);
          const pos = fin(msg.pos, 3) ? msg.pos.map(Number) : prop.pos;
          const quat = fin(msg.quat, 4) ? msg.quat.map(Number) : prop.quat;
          prop.mode = 'rest';
          prop.pos = pos;
          prop.quat = quat;
          prop.restedAt = Date.now();
          broadcast(room, { t: 'prop-rest', id, pos, quat }, ws);
        }
        break;
      }
    }
  });

  ws.on('close', () => leaveRoom(ws));
});

function sanitizeName(name) {
  return String(name ?? 'DANCER').replace(/[^\w !?'-]/g, '').slice(0, 12).toUpperCase() || 'DANCER';
}

// A dancer's chosen colour, as a hue in [0,1). null means "no choice" — the
// room falls back to the colour of the slot they landed in.
function sanitizeHue(hue) {
  // Explicit, because Number(null) is 0 — a dancer handing their colour
  // back to their slot must not come out painted red.
  if (hue === null || hue === undefined || hue === '') return null;
  const h = Number(hue);
  if (!Number.isFinite(h)) return null;
  return ((h % 1) + 1) % 1;
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
