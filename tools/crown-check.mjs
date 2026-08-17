#!/usr/bin/env node
/**
 * THE CROWN's whole life, against the real relay — a pure protocol check
 * (four bare websockets, no browsers), so it runs in a couple of seconds:
 *
 *   node tools/crown-check.mjs        # spawns its own short-fuse relay
 *
 * The journey: a ball fires a set → the first player home names the winner
 * ('game-out' + winner) and the whole room is told to crown them (a second
 * claim is a no-op) → a late joiner is handed the standing crown in their
 * snapshot → the wearer's NEXT deal-in bares the head at the door → a set
 * a groupie wins ('winner: null') crowns nobody → a new winner takes it →
 * the crown walks out with a leaver → and a floor member who never danced
 * the set cannot claim anything.
 *
 * Exits non-zero if any leg fails.
 */

import { spawn } from 'node:child_process';
import WebSocket from 'ws';

const PORT = Number(process.env.PORT || 8891);
const relay = spawn(process.execPath, ['server/index.mjs'], {
  env: { ...process.env, PORT: String(PORT), BALL_MS: '250' },
  stdio: 'ignore',
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

class Dancer {
  constructor(name) {
    this.name = name;
    this.idx = -1;
    this.crown = null;
    this.started = false;
  }
  connect() {
    return new Promise((resolve) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${PORT}`);
      this.ws.on('open', resolve);
      this.ws.on('message', (raw, isBinary) => {
        if (isBinary) return;
        const m = JSON.parse(raw.toString());
        if (m.t === 'room') {
          this.idx = m.idx;
          this.code = m.code;
        }
        if (m.t === 'crown') this.crown = m.idx;
        if (m.t === 'start') this.started = true;
      });
    });
  }
  send(o) {
    this.ws.send(JSON.stringify(o));
  }
}

await wait(400);
const failures = [];
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};

const A = new Dancer('AAA');
await A.connect();
A.send({ t: 'host', name: 'AAA' });
await wait(120);
const B = new Dancer('BBB');
await B.connect();
B.send({ t: 'join', code: A.code, name: 'BBB' });
const C = new Dancer('CCC');
await C.connect();
await wait(100);
C.send({ t: 'join', code: A.code, name: 'CCC' });
await wait(120);

// Round 1: A calls, B touches in, C holds the floor; B wins the set.
A.send({ t: 'ball-up', track: '', diff: 3, pos: [0, 1.5, 0] });
await wait(120);
B.send({ t: 'ball-join', in: true });
await wait(400); // the short-fuse ball fires
check(A.started && B.started && !C.started, 'the ball dealt A and B, C held the floor');
A.send({ t: 'game-out', winner: B.idx }); // first home names the winner…
await wait(80);
B.send({ t: 'game-out', winner: B.idx }); // …and a second claim is a no-op
await wait(120);
check(
  A.crown === B.idx && B.crown === B.idx && C.crown === B.idx,
  'everyone sees the winner crowned',
);

// A late joiner is handed the standing crown.
const D = new Dancer('DDD');
await D.connect();
D.send({ t: 'join', code: A.code, name: 'DDD' });
await wait(150);
check(D.crown === B.idx, 'a late joiner is told who wears it');

// Round 2: the wearer calls the next ball — the deal-in bares the head.
B.send({ t: 'ball-up', track: '', diff: 1, pos: [0, 1.5, 0] });
await wait(400);
check(
  B.crown === null && C.crown === null && D.crown === null,
  "the wearer's next game takes the crown at the door",
);
B.send({ t: 'game-out', winner: null }); // a groupie's night — nobody's crown
await wait(120);
check(C.crown === null, 'a set a groupie wins crowns nobody');

// Round 3: C calls, D touches in and wins — then walks out of the room.
C.send({ t: 'ball-up', track: '', diff: 2, pos: [0, 1.5, 0] });
await wait(120);
D.send({ t: 'ball-join', in: true });
await wait(400);
C.send({ t: 'game-out', winner: D.idx });
await wait(80);
D.send({ t: 'game-out', winner: D.idx });
await wait(120);
check(A.crown === D.idx && B.crown === D.idx, 'the crown passes to the next winner');
D.ws.close();
await wait(200);
check(
  A.crown === null && B.crown === null && C.crown === null,
  'the crown walks out with its wearer',
);

// Spoof guard: a floor member who never danced the set claims nothing.
C.send({ t: 'ball-up', track: '', diff: 2, pos: [0, 1.5, 0] });
await wait(400);
A.send({ t: 'game-out', winner: A.idx }); // A held the floor — must be ignored
await wait(100);
check(B.crown === null, 'a floor member cannot claim the crown');
C.send({ t: 'game-out', winner: null });
await wait(80);

relay.kill();
if (failures.length) {
  console.log(`\n${failures.length} leg(s) failed`);
  process.exit(1);
}
console.log('\nthe crown behaves.');
process.exit(0);
