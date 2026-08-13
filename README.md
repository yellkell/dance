# RAVE RAID 🪩🕺💃

A **full-VR WebXR rhythm battle royale**. Up to **24 dancers** stand on
octagonal platforms ringed around one giant gel creature — the **GOOPLIATH** —
who dances on a centre stage inside THE VOID and throws beat-quantized
moves that mark **every platform at the same time**. Your real floor is
still the floor you dodge on; everything you see is the show's.

You don't fight back. You read the floor, move with the rhythm, and outlast
everyone else.

- **Dodge** a landing → your **chain** climbs → your points multiply (up to
  ×4). The HUD never says a word about it: a small **×N** in your seat's
  colour rides low off your deck's front rim, out of your sightline.
- Nail a **last-instant dodge** (still in the fire one beat out, clear on the
  drop) → **PERFECT!**, ×1.5.
- **COMBO**: dance like the groupies — one hand up, one hand down, swapping
  on the beat. Every rhythmic swap throws **neon sparkles off the
  glowstick** that went up — four-point lens glints that twinkle, run
  hotter and denser the deeper the groove, mirror themselves in the
  floor's polish, and die in the air (nothing ever lies on the floor as
  litter). The HUD's **groove row** keeps the ledger:
  four pips light one per swap as it catches, then give way to a fill bar
  and the points that streak has paid. Stop, swap off-rhythm, or **get
  clipped** — a hit knocks the rhythm out of your hands — and it lets go,
  row and all.
- Get clipped → the chain dies. **There are no lives** — you dance the
  whole record and the night **grades** you at the end: **S / A / B / C /
  F**, off the share of landings you survived, with S reserved for a clean
  set danced late (a quarter of your dodges on the last beat). Every
  dancer's letter lands on the final board.
- **GAME OVER** is the one early exit: three clipped landings **back to
  back**. It isn't a budget of three hits — a single dodge wipes the count
  clean. The HUD says nothing about it until you're hit, then a row of red
  marks counts toward the end of your night. Falling to it is an **F**,
  however clean the set was up to then.
- A **live holo leaderboard** over the stage shows everyone's rank, score and
  chain. The **top ten** dance on raised platforms, and the current **champion
  above them all** — and nobody ever renders below your real floor: leaders
  float overhead on lit pedestals and the fallen dim instead of sinking.
  Your own lift is real too, but inverted — your deck IS your real floor
  and can't move, so when you lead, **the rest of the show gently sinks**
  (THE RISE), and the longer you hold #1 the further it goes (THE CLIMB),
  until you're looking **down** on the boss.
- Every other dancer is a **slender humanoid figure** — gloss-black mannequin,
  neon collar/waist/wrist trim and visor in their seat colour, glowsticks in
  hand — solved live from just a head and two hands (which is all VR knows).
  **You have no body of your own**: the local player sees only their
  controllers; the figure is for everyone else's view of you.
- Last dancer standing (or the highest score when the set ends) **owns the
  night**: podium, crown, confetti cannons.
- Between sets, online rooms live in **THE CLUB** (it has no name — the
  sign over the stage is a moon, not a word). An Art Deco hall with a dance
  floor, a backlit bar, velvet booths, a raised terrace and a hushed STILL
  ROOM, under an eclipse of counter-rotating brass rings. Teleport around
  it, **talk** to your room (spatial voice), and mute/block anyone from the
  SOCIAL panel.
- Raids are **called from the floor with THE BALL**: anyone sends a mirror
  ball up (their song pick rides along), it hangs for sixty seconds, and
  whoever **touches it** rides to the ring with them at zero — while the
  rest of the room keeps the floor. When the set resolves, the players are
  deposited straight back among their friends.
- The set itself happens inside **THE VOID** — an actual environment in the
  Beat-Saber-background bloodline, built in four depth layers so a black
  room reads as a vast one: **18 monolith towers** at 17 m carrying
  pinstripes, panel bands, porthole rows and lit caps; **26 bigger ones**
  at 31 m; a **58-slab skyline** out to 88 m; and a low horizon band beyond
  that. Overhead, a four-ring **truss** with radial spars and lit joints,
  and six great **arcs** springing over the floor. Underfoot, black glass
  with a two-scale grid, 28 radial rays chasing the beat, concentric rings
  swelling outward — and **a mirror**: every tower and slab has a twin
  under the floor, sharing the same instance buffers, so the reflection
  pulses with the original for one extra draw call. The whole world is 48
  draws and ~24k triangles. The game is **full VR** — the void is always
  on, and there is no passthrough mode.

Built on Meta's [Immersive Web SDK](https://developers.meta.com/horizon/documentation/web/immersive-web-sdk/)
(`@iwsdk/core`) + Three.js. The gel creature, the telegraph language and the
platform arena are lifted from
[Iron Balls Boxing](https://github.com/yellkell/Iron-Balls-Boxing)'s FIRE FIGHT
campaign (the `goopliath-raid-campaign-boss` branch) — same goo, new religion.
The club carries FIRE FIGHT's pub systems forward whole — the teleport
arc-and-octagon, the PCM voice relay, the mute/block store — re-dressed from
diamond-plate boozer to champagne-brass supper club.

---

## Quick start

```bash
npm install
npm run dev          # → http://localhost:5173
```

- **Quest browser**: open the page, tap **ENTER THE RAVE** → full VR. Your
  platform appears under your feet with the void all around — your real
  floor is still the floor you play on.
- **Desktop**: the IWSDK dev plugin injects a WebXR emulator (IWER) — click
  ENTER THE RAVE and fly with WASD + mouse; the emulated controllers click the
  menus.
- **Mid-set escape hatch**: right controller **Ⓐ** raises **THE PAUSE
  CARD** — a small pop-up dead ahead with KEEP DANCING / LEAVE THE SET.
  The set keeps playing behind it (a shared clock can't pause for one
  dancer); it exists so leaving is a decision, never a slipped button.
  Ⓐ again puts it away.

There's also a debug hook in the console:
`__gdr.startRaid({ seats: 24 })`, `__gdr.match`.

## The moves (and their answers)

| Move | The tell | Your answer |
| --- | --- | --- |
| **BEAM** | a strip rakes down the deck from the stage on a short fuse — one laser on a slot, or a deliberate **double**: a TWIN pair taking one side and the middle, a SPLIT evenly either side of centre, or (late) **THE X**: two THIN beams thrown diagonally at once, crossing dead centre | **sidestep** the lane; **get across** a twin; **stand between** a split; against the X, **get into a pocket** between the arms — they're real rooms |
| **SWEEP** | a blade hangs at chest height, chevrons cascading **downward** off it | **duck** — and hold it |
| **SEESAW** | one half of the deck floods, then the other, on the beat | **cross** the centreline |
| **SURGE** | the seesaw's front/back cousin | **cross**, the other way |
| **GATE** | the whole deck floods except one clear band — doorposts + chevrons pointing in. Half the time it's the **horizontal cousin**: the clear band runs across the deck at a depth line | **stand in the gap** — sidestep into the column, or step forward/back into the row |
| **NOVA** | everything burns except one wedge — same compass bearing for the whole ring | **stand** in the safe ground, together |
| **CROSSFIRE** | a laser is loaded on one side rail and a strip fills **across** the deck (late on, a stage lane crosses it) — and from mid-set it can come as **THE TRAP**: both side rails at once, one ahead of you and one behind, landing on the same beat | **step forward or back** off the strip — diagonally, once it's a lattice; against the trap, **squeeze into the band between the rails** |
| **DONUT** | usually a laser straight down the middle, and a bar later the rim closes fast with chevrons marching **inward** on a tight safe disc | **step off** the middle, then **run back into it** |
| **DUCK DONUT** | the finale combination, rare even in act 3: the rim closes **and** the blade hangs at chest height, both on one beat | **get to the middle AND duck** — small and close |
| **THE WAVE** | beams marching **1-2-3** across the deck (their staggered fills ARE the count) — sideways, or front-to-back — with the far quarter left dark: the **EXIT**. Every wave **TURNS**: the march wheels at the exit — its first return strike is that very square, a double step plus a whole extra beat late — and sweeps back, new exit on the far side | **travel with the march into the exit**; breathe at the turn, then **ride one square behind the return** all the way home |
| **ROUTINE** | the deck splits into quarters and the boss **teaches** a corner sequence — each marked with its step number, each pointed out in turn — then the marks go out and, on every step, three spinning neon blocks **fall from above** onto the quarters you weren't taught. On some EXPERT charts it comes **SWEPT**: the blade hangs over every blast | **remember it**, and stand in the taught corner on each tick — on a swept routine, **duck there too** |

The telegraph is the whole instruction: whatever fills amber→red, don't be
in it; wherever the doorpost rails and chevrons point, be there. Windups are
sacred — escalation compresses the gaps between moves, never the read — and
landings always hit bar downbeats.

One answer is a deliberate exception, and it hangs its threat in the AIR —
floor paint means "move your feet" everywhere else, so a move whose answer
is *don't step* must never paint the ground you should stay on. The
**sweep** says drop, and nothing on the floor contradicts it.

The set-list itself keeps you travelling, two ways. Every move's dodge
asks the body for a verb — sidestep, step through, get to the middle,
duck — and the choreographer never calls the same move twice running and
steers away from repeating a verb. And underneath that runs **THE FLOOR
MANAGER**: the generator knows where each move's correct dodge *parks* a
dancer who plays it right (the split's corridor parks you dead centre,
the seesaw leaves you hugging the centreline, the donut ends in the
middle by definition) — and it re-rolls any move whose danger never
touches that spot. A split into a bare donut used to ask for nothing;
now the follow-up is something that wants your square: an X, a beam down
the middle, a gate somewhere else.
Two more laws serve the same end: a lone crossfire rail never lands
**behind** you (a strip at your back was a read nobody should be asked to
make — only the trap and the wave, which telegraph as whole-deck events,
touch the rear ground), and a gate's gap never sits over the **middle**,
because a doorway you're already standing in asks for nothing.

The **routine** is the one move that isn't read at all — it's learned. Two
to four corners, never the same one twice, taught during a two-bar wind-up
and then hidden. From there the danger is visible the whole way down: on
each step, three spinning neon polyhedra (the
[DOWN](https://yellkell.github.io/down) bloodline, upside down — dark core,
glowing shell, blazing wireframe, a deck ring brightening underneath)
descend on a beat-locked path onto the three quarters you must not be in,
crushing flat exactly on the tick. A bell rings a beat ahead of each step,
pitched up an arpeggio so the sound says *which* step as well as *when*.
The quarter lines stay lit the whole way through, because the floor should
always tell you where the boxes land — never which one is yours.

Nothing else is placed at random either. Lasers land on slots and doubles
come in two shapes only, so a glance is enough to know whether you're
crossing or threading. The donut is built as a **one-two** — the middle laser drives
everyone off centre, the ring hauls them back a bar later — and its ring
stays dark until that laser has fired, so there is only ever one shape on
the deck to read (the same staging the pie chain uses). THE WAVE is that
law's one deliberate exception: its four strips telegraph together on
staggered fuses, because the SEQUENCE is the shape — a march you read the
way you read a drum fill.

## Multiplayer — and the club

The board's **MULTIPLAYER** seat starts greyed out and unlocks when the
first boss falls — clear the opening set's finale night on THE TOUR and
the club is open for good. (A friend's `?room=` link still works either
way — being pulled through the door is its own invitation.)

The whole choreography — every zone, every bot's every roll, even the
placeholder track's bassline — is **deterministic from one seed**. So the
relay server is tiny: it deals seats, rolls the seed, and calls "beat 0 in
N ms"; after that the wire carries only poses (10 Hz) and score reports.
Empty seats are filled with identical seeded **goo-groupies** on every client.

```bash
npm run server       # room relay on :8788
```

There are **three places**, and where you are is what you're doing:

1. **THE FOYER** — the menu place, and a piece of THE VOID: a floating
   neon-edged platform in the set's own abstract space (monolith pylons,
   slow hexes, drifting shards, a horizon with no land under it), with the
   board and the MC posing. The club's door is the board's MULTIPLAYER
   seat, nothing in the room.
2. **THE CLUB** — the social place, the warm room between the voids.
   **ENTER THE CLUB** (the multiplayer tab's first door — it opens a room
   around you) → share the 4-letter code (or the `?room=CODE&name=YOU`
   link) → friends **JOIN A ROOM** — and your whole room stands in the
   club together. Every member is a raver figure in
   their join colour with a name tag that swells while they talk. Voice is
   **spatial** (each voice comes from its figure, HRTF + distance falloff)
   and rides the same room socket as Int16 PCM — no SFU, no peer soup, the
   exact system proven in FIRE FIGHT's pub. Movement is **teleport-only**:
   deflect a thumbstick, aim the arc, roll the stick to set your landing
   facing, release to go; an isolated sideways flick snap-turns. Left
   **Ⓨ** mutes your mic. Right **Ⓐ** raises the **SOCIAL panel** — the
   club floor's whole console (the big board stays in the foyer; the club
   keeps no front desk): MUTE (silence) or BLOCK (silence + vanish)
   anyone, persisted by name, strictly local — the voice-chat master
   switch, your ♪ song pick, the DIFFICULTY row (your pick rides the ball
   you call), **SEND THE BALL UP**, and **LEAVE THE CLUB**. Step into
   **THE STILL ROOM** (north-west corner) and the music falls to a
   murmur; voices stay.
3. **THE SET** — the game place, called with **THE BALL**. Anyone sends it
   up (from the SOCIAL panel); a mirror ball hangs in front
   of them for **60 seconds** wearing a countdown plate — the song, the
   caller, who's touched in. **Touch the ball** (hand close + trigger) to
   join; touch again to step out; the caller's touch cancels. At zero the
   relay deals the caller + touchers onto the ring and the raid takes
   over, wrapped in the void environment. **The floor never closes**:
   stay-behinds keep dancing and
   talking (players' voices sing from the stage while they're away),
   newcomers can still join the room, and when the podium settles every
   player is deposited back on the floor automatically. A departing host
   hands the room to the longest-standing member instead of folding the
   party.

Point clients at a hosted relay with `?server=wss://your-host:8788` (the
production default is `DEFAULT_RELAY` in `src/config.ts`).

### Hosting the relay

`render.yaml` in the repo root is a Render blueprint for exactly this
service: **New → Blueprint → this repo**, and Render builds `server/` and
runs it. Any Node host works — the relay needs nothing but `ws`, binds
`process.env.PORT`, and answers `GET /` with a JSON status line for health
checks. Then set `DEFAULT_RELAY` to the `wss://` URL it hands you.

**Until a relay is live, ENTER THE CLUB fails with "relay unreachable"** —
the club is a networked room, and there is nowhere to connect. Nothing
else in the game needs the server: the whole tour is playable solo.

## The music

Fifteen real tracks drive the game (`src/assets/music/`, registry in
`src/audio/tracks.ts`). Every number in that registry was **measured from the
files**, not guessed — the whole game is quantized to them, so they had to be:

| Track | BPM | Set length | Loudness | Where it plays |
| --- | --- | --- | --- | --- |
| MORNING | 96.665 | 5 phrases | −11.1 LUFS | tour: opening night · no ducking |
| TARGET | 91 | 11 phrases | −9.5 LUFS | tour |
| CAPTURE | 117 | 13 phrases | −15.0 LUFS | tour: first goop finale |
| DISCO BALL | 73.33 | 4 phrases | −12.6 LUFS | tour: peak-hours opener — the night after the first goop falls · no ducking |
| COMBAT | 135 | 12 phrases | −13.2 LUFS | quick raid |
| LOOP | 150 | 17 phrases | −11.2 LUFS | quick raid |
| DYNASTY | 155 | 10 phrases | −9.6 LUFS | tour: peak-hours finale |
| INFECTION | 138 | 15 phrases | −10.9 LUFS | tour: after hours |
| SPREAD | 150 | 17 phrases | −13.1 LUFS | tour: after hours · skips 6 bars in |
| BREAKCORE | 174 | 11 phrases | −8.3 LUFS | tour: the last night |
| ASSEMBLE | 125 | 16 phrases | −7.5 LUFS | quick raid · drops on the slam |
| SAKUPENED | 133.964 | 10 phrases | −8.1 LUFS | quick raid |
| UNITY | 117 | 17 phrases | −13.8 LUFS | quick raid · skips its ambient open |
| MONEY | 78.395 | 6 phrases | −14.5 LUFS | tour: peak hours · no ducking |
| SWAG | 91.974 | — | −15.7 LUFS | foyer loop |
| ECLIPSE | 70 | — | −10.4 LUFS | the club's house record |

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
- **The needle drop.** A record that opens with an ambient wash or a long
  quiet riser carries a `startAt`, and the needle goes down *there* — the
  intro never plays and the count-in stays a count-in instead of a minute of
  waiting. It has to sit on the bar grid (`downbeat + n×4 beats`) so the set
  still lands where the music does. ASSEMBLE is the extreme case: six seconds
  of near-silence climbing from −55 dB, then an 18 dB transient inside 5 ms,
  and the set begins **on that slam**.

**Set length follows the record.** A track's playable length becomes the number
of 8-bar phrases in the match, and the act boundaries are *fractions* of the
set — so MONEY (2.8 min) and LOOP (5.6 min) both get a full opening, build,
peak and finale.

**The lobby is never silent.** SWAG — the soft one — loops under the foyer
at reduced level, and publishes its own beat, so the
room is already grooving before anyone starts a set. The moment a room has
the floor (hosting or joined), **ECLIPSE** — the club's own slow-burn
70 BPM record — takes the decks, and the chandelier phases to it. Step
into THE STILL ROOM and the mix ducks to a murmur without stopping.

**Picking a record**: the board's **SOLO** tab is a SELECT SONG list — the
whole raid pool with each record's BPM and your best letter **at the
selected difficulty** beside it, and the song's page on the right: a local
**leaderboard** (top five finished solo runs — name, score, grade; campaign
nights and club raids never post here) over the START RAID seat. SHUFFLE
heads the list and derives the record from the match seed, so an online
room agrees on the song without anyone sending it (the club floor picks
from the SOCIAL panel's `♪` row); a host's explicit pick rides along in
the start message. Scores are signed by your **profile** — the card at the
board's top right, born a generic RAVER-#### tag; open it and RENAME on
the pop-up arcade keyboard. The same name rides your club tag. On THE
TOUR's map, each stop wears the best letter you've ever taken home from
that night.

**Picking a difficulty**: the EASY / NORMAL / HARD / EXPERT row under it is
the act floor for the whole song — every record used to open trivially easy
and ramp; now you choose the floor and the song lifts one act in its back
stretch. EXPERT's back stretch is act 4: six moves a phrase with no rest,
duck donut twice as common, and — on the charts that carry it — THE SWEPT
ROUTINE. Online, the ball carries the caller's difficulty with their song
pick.

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
  arena/               platform ring, stage, disco rig, the void kit +
                       the set's environment
  club/                the club: venue + void foyer build, layout,
                       materials, the ball, voice (capture + spatial
                       playback), mute/block store, static-merge helper
  game/                state, flow, ring math, rng, avatars
  systems/             Music, Choreo, Player, Avatar, Rank, Goopliath,
                       Disco, Hud, Menu, Network, Arena,
                       Club, ClubTeleport, ClubSocial, ClubBall
  net/                 room session + pose stores (ring + club floor)
server/index.mjs       the room relay (seats/seed/poses + club poses,
                       voice fan-out, THE BALL's clock, rooms that
                       outlive their sets)
tools/                 track analyzer · preview-shot · club-capture ·
                       social-check (two-headset end-to-end)
avatar-preview.html    dev-only dancer catwalk (never shipped)
```

`DESIGN.md` has the full design notes and the roadmap.

## Deploying

Two pipelines ship `dist/` (both in `.github/workflows/`):

- **GitHub Pages** — `deploy.yml`, on every push to main.
- **Firebase Hosting** — `firebase-deploy.yml` → project `raveraid-bc866`,
  site `raveraid` → **https://raveraid.web.app**. Needs a one-time repo
  secret `FIREBASE_SERVICE_ACCOUNT` (a service-account JSON key with the
  Firebase Hosting Admin role). PRs get ephemeral preview channels.
  `index.html` carries the project's Analytics tag (`G-3MV2K6R84H`); the
  full web-app config for future Firebase products:

  ```js
  const firebaseConfig = {
    apiKey: 'AIzaSyBqsUcpCKzs2bANP0db6J4Nz_SkKe4wXzI',
    authDomain: 'raveraid-bc866.firebaseapp.com',
    projectId: 'raveraid-bc866',
    storageBucket: 'raveraid-bc866.firebasestorage.app',
    messagingSenderId: '1090372809167',
    appId: '1:1090372809167:web:40f228c18bf6d1a0b022ba',
    measurementId: 'G-3MV2K6R84H',
  };
  ```

The static site is fully playable solo. Online rooms need the relay
(`server/index.mjs`) hosted somewhere reachable — see **Hosting the relay**
above; the client uses `DEFAULT_RELAY` in `src/config.ts` on https deploys
(any `?server=` wins). Neither deploy workflow ships the relay: they build
`dist` and upload static files, so the relay is a separate service.
