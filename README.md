# RAVE RAID 🪩🕺💃

A **WebXR passthrough rhythm battle royale**. Up to **24 dancers** stand on
octagonal platforms ringed around one giant gel creature — the **GOOPLIATH** —
who dances on a stage in the middle of your real room and throws beat-quantized
moves that mark **every platform at the same time**.

You don't fight back. You read the floor, move with the rhythm, and outlast
everyone else.

- **Dodge** a landing → your **DODGE STREAK** climbs → your points multiply
  (up to ×4).
- Nail a **last-instant dodge** (still in the fire one beat out, clear on the
  drop) → **PERFECT!**, ×1.5.
- **COMBO**: dance like the groupies — one hand up, one hand down, swapping
  on the beat. Every rhythmic swap pays a little, and the payout creeps up
  the longer you keep the motion going. Stop, or swap off-rhythm, and the
  combo lets go.
- Get clipped → the dodge streak dies and you lose one of **three lives**.
  Three hits and you're off the floor, spectating from a sunken deck.
- A **live holo leaderboard** over the stage shows everyone's rank, score and
  dodge streak. The **top ten** dance on raised platforms, and the current **champion
  above them all** — heights rendered relative to *your* platform, because your
  real floor never moves: when you lead, the ring drops away beneath you.
- Every other dancer is a **slender humanoid figure** — gloss-black mannequin,
  neon collar/waist/wrist trim and visor in their seat colour, glowsticks in
  hand — solved live from just a head and two hands (which is all VR knows).
  **You have no body of your own**: the local player sees only their
  controllers; the figure is for everyone else's view of you.
- Last dancer standing (or the highest score when the set ends) **owns the
  night**: podium, crown, confetti cannons.

Built on Meta's [Immersive Web SDK](https://developers.meta.com/horizon/documentation/web/immersive-web-sdk/)
(`@iwsdk/core`) + Three.js. The gel creature, the telegraph language and the
platform arena are lifted from
[Iron Balls Boxing](https://github.com/yellkell/Iron-Balls-Boxing)'s FIRE FIGHT
campaign (the `goopliath-raid-campaign-boss` branch) — same goo, new religion.

---

## Quick start

```bash
npm install
npm run dev          # → http://localhost:5173
```

- **Quest browser**: open the page, tap **ENTER THE RAVE** → passthrough AR.
  Your platform appears under your feet, the club around your room.
- **Desktop**: the IWSDK dev plugin injects a WebXR emulator (IWER) — click
  ENTER THE RAVE and fly with WASD + mouse; the emulated controllers click the
  menus.
- **Mid-set escape hatch**: right controller **Ⓐ** bails back to the lobby.

There's also a debug hook in the console:
`__gdr.startRaid({ seats: 24 })`, `__gdr.startTutorial(0)`, `__gdr.match`.

## The moves (and their answers)

| Move | The tell | Your answer |
| --- | --- | --- |
| **SLAM** | amber discs charge on your deck (a drumline in later acts) | **step** off the glow |
| **BEAM** | a strip rakes down the deck from the stage — one laser on a slot, or a deliberate **double**: a TWIN pair taking one side and the middle, or a SPLIT evenly either side of centre | **sidestep** the lane; **get across** a twin; **stand between** a split |
| **SWEEP** | a blade hangs at chest height, chevrons cascading **downward** off it | **duck** — and hold it |
| **SEESAW** | one half of the deck floods, then the other, on the beat | **cross** the centreline |
| **SURGE** | the seesaw's front/back cousin | **cross**, the other way |
| **GATE** | the whole deck floods except one clear column — doorposts + chevrons pointing in | **stand in the gap** |
| **CHASE** | a disc glued to your feet, following you — then it **freezes** | **juke** after the freeze |
| **NOVA** | everything burns except one wedge — same compass bearing for the whole ring | **stand** in the safe ground, together |
| **CROSSFIRE** | a laser is loaded on one side rail and a strip fills **across** the deck (late on, a stage lane crosses it) | **step forward or back** off the strip — diagonally, once it's a lattice |
| **TRIP WEB** | shin-high laser wire strung over the whole deck; nothing safe is drawn, because nothing is | **hold still** until it discharges |
| **DONUT** | usually a laser straight down the middle, and a bar later the rim closes with chevrons marching **inward** | **step off** the middle, then **run back into it** |

The telegraph is the whole instruction: whatever fills amber→red, don't be
in it; wherever the doorpost rails and chevrons point, be there. Windups are
sacred — escalation compresses the gaps between moves, never the read — and
landings always hit bar downbeats.

Two of those answers are deliberate exceptions, and both are drawn in the
AIR rather than on the deck — floor paint means "move your feet" everywhere
else, so a move whose answer is *don't* must never use it. The **sweep**
says drop; the **trip web** says freeze.

Nothing is placed at random. Lasers land on slots and doubles come in two
shapes only, so a glance is enough to know whether you're crossing or
threading. The donut is built as a **one-two** — the middle laser drives
everyone off centre, the ring hauls them back a bar later — and its ring
stays dark until that laser has fired, so there is only ever one shape on
the deck to read (the same staging the pie chain uses).

## Rehearsal (the campaign)

The lobby's **REHEARSAL** map is a row of goop creatures, each drilling one
move at a gentle BPM: **GOOPLET** (step), **DRIZZLE** (sidestep), **SLOSHA**
(duck), **BIG SPILL** (cross the line), **BOUNCER** (the gate), **SMITTEN**
(the chase juke), **GLOBULON** (the nova wedge). Clear the row and you're
**RAVE READY**. Progress saves locally. Surge, crossfire and the trip web
have no tutor yet — they arrive in a set and teach themselves off the
telegraph.

## Multiplayer

The whole choreography — every zone, every bot's every roll, even the
placeholder track's bassline — is **deterministic from one seed**. So the
relay server is tiny: it deals seats, rolls the seed, and calls "beat 0 in
N ms"; after that the wire carries only poses (10 Hz) and score reports.
Empty seats are filled with identical seeded **goo-groupies** on every client.

```bash
npm run server       # room relay on :8788
```

In the lobby: **HOST ROOM** → share the 4-letter code (or the
`?room=CODE&name=YOU` link) → friends **JOIN ROOM** → host presses
**DROP THE SET**. Humans are spread evenly around the ring; groupies fill the
gaps. Point clients at a hosted relay with `?server=wss://your-host:8788`.

## The music

Seven real tracks drive the game (`src/assets/music/`, registry in
`src/audio/tracks.ts`). Every number in that registry was **measured from the
files**, not guessed — the whole game is quantized to them, so they had to be:

| Track | BPM | Set length | Loudness | Role |
| --- | --- | --- | --- | --- |
| SAKUPENED | 133.964 | 10 phrases | −8.1 LUFS | raid |
| COMBAT | 135 | 12 phrases | −13.2 LUFS | raid · rehearsal |
| LOOP | 150 | 17 phrases | −11.2 LUFS | raid |
| CAPTURE | 117 | 13 phrases | −15.0 LUFS | raid · rehearsal |
| MONEY | 78.395 | 6 phrases | −14.5 LUFS | raid |
| TARGET | 91 | 11 phrases | −9.5 LUFS | raid · rehearsal |
| SWAG | 91.974 | — | −15.7 LUFS | lobby loop |

- **Tempo** came from an onset-flux autocorrelation phase-locked across each
  whole track. Four land on exact integers (a DAW grid). Three genuinely sit a
  hair under — and it matters: locking SAKUPENED at a round 134 instead of
  133.964 drifts off the kick by the last third of the song (grid retention
  falls from 68% to 35%), so the fractions stay.
- **Loudness** is EBU R128 integrated. The masters span **7.6 dB** — SWAG at
  −15.7 against SAKUPENED at −8.1 — so every track is gain-matched to −14 LUFS
  at playback and the mix runs through a limiter. Nothing is re-encoded; it's
  a gain node, and the files ship untouched.
- **Downbeat** (seconds to bar 1 beat 1) is the one number a human ear might
  want to nudge. If a set ever feels like it lands on the 2 instead of the 1,
  move that one field by ±one beat — nothing else changes.

**Set length follows the record.** A track's playable length becomes the number
of 8-bar phrases in the match, and the act boundaries are *fractions* of the
set — so MONEY (2.8 min) and LOOP (5.6 min) both get a full opening, build,
peak and finale.

**The lobby is never silent.** SWAG — the soft one — loops under the lobby and
the rehearsal map at reduced level, and publishes its own beat, so the mirror
ball, the lasers and the GOOPLIATH's idle bounce are already grooving before
anyone starts a set.

**Picking a record**: the lobby's `♪` row cycles SHUFFLE → each raid track.
SHUFFLE derives the record from the match seed, so an online room agrees on the
song without anyone sending it; a host's explicit pick rides along in the start
message.

**Adding a track**: drop the file in `src/assets/music/`, add a row to
`TRACKS`, done. Roles decide where it plays. `npm run analyze -- <file…>` prints
the BPM, downbeat and loudness row for you.

If a browser can't decode a file (AAC support varies — Quest Browser and
desktop Chrome are fine), the original synthesised set in `src/audio/techno.ts`
takes over at the same tempo and the raid carries on. Nobody gets silence.

## Project map

```
src/
  config.ts            every tunable: ring, moves, score, rank, palette
  main.ts              IWSDK world + system registration
  audio/techno.ts      the beat clock + the synthesised set
  audio/sfx.ts         WebAudio sfx kit (vendored)
  goopliath/           the raymarched gel creature (vendored, untouched)
  choreo/setlist.ts    seeded, beat-quantized move generation
  choreo/telegraphs.ts the hazard-shape shader kit (vendored)
  choreo/strikes.ts    landing FX per platform
  arena/               platform ring, stage, disco rig
  game/                state, flow, ring math, rng, avatars
  systems/             Music, Choreo, Player, Avatar, Rank, Goopliath,
                       Disco, Hud, Menu, Network, Arena
  net/                 room session + pose store
server/index.mjs       the room relay
```

`DESIGN.md` has the full design notes and the roadmap.
