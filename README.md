# GOOPLIATH: DANCE RAID 🪩🕺💃

A **WebXR passthrough rhythm battle royale**. Up to **24 dancers** stand on
octagonal platforms ringed around one giant gel creature — the **GOOPLIATH** —
who dances on a stage in the middle of your real room and throws beat-quantized
moves that mark **every platform at the same time**.

You don't fight back. You read the floor, move with the rhythm, and outlast
everyone else.

- **Dodge** a landing → your **combo** climbs → your points multiply (up to ×4).
- Nail a **last-instant dodge** (still in the fire one beat out, clear on the
  drop) → **PERFECT!**, ×1.5.
- Get clipped → the combo dies and you lose one of **three lives**. Three hits
  and you're off the floor, spectating from a sunken deck.
- A **live holo leaderboard** over the stage shows everyone's rank, score and
  combo. The **top ten** dance on raised platforms, and the current **champion
  above them all** — heights rendered relative to *your* platform, because your
  real floor never moves: when you lead, the ring drops away beneath you.
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
| **BEAM** | a strip rakes down the deck from the stage | **sidestep** the lane |
| **SWEEP** | a blade of goo hangs at chest height, floor band beneath | **duck** — and hold it |
| **SEESAW** | one half of the deck floods, then the other, on the beat | **cross** the centreline |
| **SURGE** | the seesaw's front/back cousin | **cross**, the other way |
| **NOVA** | everything burns except one wedge — same compass bearing for the whole ring | **stand** in the safe ground, together |

Telegraph windups are sacred: escalation compresses the gaps between moves,
never the read. Landings always hit bar downbeats.

## Rehearsal (the campaign)

The lobby's **REHEARSAL** map is a row of five goop creatures, each teaching
one move at a gentle BPM: **GOOPLET** (step), **DRIZZLE** (sidestep),
**SLOSHA** (duck), **BIG SPILL** (cross), **GLOBULON** (the nova wedge).
Clear the row and you're **RAVE READY**. Progress saves locally.

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

## Bringing your own music

The current set is a **synthesised placeholder** (`src/audio/techno.ts`): a
seeded 128 BPM techno engine so the game is fully playable today. When the real
tracks land, start the same clock from a file instead — the contract is just
`startSet({ bpm, countInBeats, endBeat, … })` plus "beat 0 is at AudioContext
time T". Everything else (choreography, boss, lights, scoring) hangs off that
clock and never knows the difference.

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
