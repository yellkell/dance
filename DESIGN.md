# DANCE RAID — design notes

The pitch in one line: **Goopliath's raid, but the whole floor at once, and
nobody throws a punch — you dance to stay alive.**

FIRE FIGHT's campaign proved two things worth stealing whole:

1. **The floor-telegraph language.** Souls-style readability on a two-metre
   stage: hazard shapes charge up ON your platform, the fill IS the countdown,
   and every shape has exactly one honest answer (step / sidestep / duck /
   cross / stand-here).
2. **The raid geometry trick.** Every seat faces the boss anchor at the same
   radius, so the boss lands at the same local coordinates in every player's
   frame — the entire boss/telegraph/dodge stack runs unchanged per client,
   and only *other* players need seat transforms.

DANCE RAID generalises the arc to a full circle of 4–24 seats and swaps the
win condition from "kill the titan" to "outlast the floor".

## Pillars

- **The music is the referee.** Everything is quantized: telegraphs start on
  beats, landings hit bar downbeats, i-frames are measured in beats, the boss
  bounces on the kick. If it doesn't happen on the grid, it doesn't happen.
- **The windup is sacred.** Difficulty escalates by *density* (moves per
  phrase, cascade stages, shorter rests), never by shrinking the read.
- **One giant, every floor.** Each move marks every live platform with the
  same seat-local pattern — fair by construction, spectacular by accident
  (24 decks lighting up as one). The NOVA is the deliberate exception: one
  canonical compass bearing for the whole ring, so the entire club rotates to
  the same safe ground together.
- **Your floor is the venue; the void is the view.** The dodge game happens
  on your real floor, always — but the game is FULL VR: THE VOID (an actual
  environment, below) is the only world, opaque backdrop and all. There is
  no passthrough mode and no dim slider; anything half-transparent read as
  neither AR nor VR and got cut.

## The set (match structure)

Acts set the tempo of danger; **DIFFICULTY sets the acts**. The old
universal ramp gave every record a trivially easy opening third — by the
last tour night that read as "barely move for half the song". Now the
board's EASY / NORMAL / HARD pick is the act floor for the whole record,
and the back stretch (from 60%) lifts exactly one act, because a set
still deserves a finale:

| Difficulty | Acts | Moves/phrase | Rest |
| --- | --- | --- | --- |
| EASY | 0 → 1 | 2 → 3 | 4 beats |
| NORMAL | 1 → 2 | 3 → 4 | 3 → 2 beats |
| HARD | 2 → 3 | 4 → 5 | 2 → 1 beats |
| EXPERT | 3 → 4 | 5 → 6 | 1 → 0 beats |

What each act brings: act 0 — beam, sweep, seesaw, gate (both axes),
crossfire; act 1 — donut one-twos, the routine, THE WAVE; act 2 — surge,
nova, rail traps, double beams, THE X; act 3 — duck donut, 5-stage
seesaws, tight novas; act 4 (EXPERT's back stretch) — six moves a phrase
with NO rest, duck donut twice as common, and THE SWEPT ROUTINE: on the
charts that carry it (a per-song coin, so the hardest nights stay
distinct), every blast of the routine arrives under the sweep's blade —
stand in the taught corner AND duck on every tick. Geometry barely
tightens at act 4 (gate 0.22 → 0.20, nova wedge 0.45 → 0.42 rad, donut
disc 0.34 → 0.30): expert lives in density and combinations, not in
slivers of safe ground. Online, the ball carries the caller's difficulty
with the song pick, so the whole ring dances one chart.

Getting HIT also knocks the rhythm out of your hands: the groove streak
(the one-up-one-down hand combo and its tally) resets on every clip, so
a clean grade and a deep groove are the same discipline.

Three laws above the table. The choreographer NEVER calls the same move
twice running. It tracks each move's dodge VERB (lateral, depth, radial,
duck…), damping any candidate that would repeat the previous one. And
THE FLOOR MANAGER carries a PARK — where the last move's correct dodge
left a dancer standing (the split's corridor and the seesaw's centreline
hug both park you middle, as surely as the donut does) — and re-rolls
any candidate whose danger never touches that ground. The park is a
model, not a sensor: decks stay identical and deterministic; the manager
just guarantees the chart itself never contains a "stand still and win"
step. The nova parks you somewhere unknowable (its wedge rotates per
seat), so the move after a nova is unconstrained.

Ends at the final downbeat — or the moment one dancer remains.

## Scoring

- Dodge: `100 × (1 + 0.1 × min(combo, 30))` → ×4 ceiling.
- PERFECT (inside the zone at T−1 beat, clear at T): ×1.5 on top.
- Survival trickle: +10 per bar alive (separates flawless dancers late).
- Hit: combo → 0, miss-chain +1, 2 beats of i-frames.
- **No lives — a grade.** The night ends with a letter: S (clean, and a
  quarter of the dodges taken on the last beat) / A ≥93% / B ≥82% /
  C ≥62% / F below. Points reward flair; the letter rewards not being hit,
  so the two say different things about the same set.
- **Game over = three clipped landings in a row.** A chain, not a budget:
  any dodge wipes it. It ends your night at an F and, on your own, ends
  the record then and there — with friends on the ring the set plays on
  without you, because their night isn't over. This is the only sudden
  death in the game, and it is the only thing the HUD ever interrupts
  itself to show.
- Rank law: alive > eliminated; alive by score; eliminated by who fell last.

## The rank made physical

Top ten platforms rise (+0.32 m), the champion higher (+0.7 m) — and the
lifts are **absolute**, so the raising effect never switches off just
because you happen to be winning. The VR height law holds: your platform
is your real floor and can never move, nothing ever renders below the
common floor, and nobody ever reads as SHORT — decks only rise, on lit
pedestal columns, and the eliminated dim out instead of dropping.

Your own lift can't move your floor, so it moves **everything else**:
when you lead, the whole show — stage, boss, board, void — eases DOWN by
your tier (THE RISE), and for as long as you hold #1 it keeps sinking at
0.09 m/s, up to +4.4 m (THE CLIMB), until the boss's crown is below your
eye line. Other decks ride the same drop (`tier − sunk`), so relative
heights stay honest on every client; lose the lead and it drains back at
double speed.

## Determinism (the multiplayer model)

A raid is a pure function of `(seed, seats)`:

- the set-list (kinds, beats, zone positions, nova bearings),
- every groupie's every dodge roll (`roll(seed, 0xB0B, seat, move, landing)`),
- even the placeholder track's bassline.

Clients therefore never exchange gameplay. The relay deals seats, rolls the
seed, and announces "beat 0 in N ms" (RTT-compensated); the wire then carries
10 Hz poses and 3 Hz score lines, and *victims judge themselves* (the FIRE
FIGHT law — your own headset is the only honest witness of your own body).
A leaver's dancer folds on the spot; a groupie's outcome is identical on
every client without a byte of sync.

## The GOOPLIATH on stage

The vendored gel sim runs man-sized inside a ×2.4 parent (≈4.3 m of goo) with
its clock at 0.55× so it reads as tons, not jelly. Dance layer: agitation
pulses on every kick; each phrase he re-pours into a different FIRE FIGHT
fighting-style silhouette (the styles make excellent dance stances); he
drifts a lazy orbit and always faces you (every client sees him watching
them). Move gestures reuse the boxing moveset as tells:
cross = beam, backfist spin = sweep, clap = seesaw, spin-kick = surge,
uppercut = nova. Raymarch budget drops while a limb is extended (the exact
frame-spike moment), exactly as in FIRE FIGHT.

## THE CLUB, THE VOID, and the three places

FIRE FIGHT's pub proved a third thing worth stealing whole: **a social room
on the same socket** — teleport-only movement, spatial PCM voice fanned out
by the relay, and local-only mute/block. Carried forward, and dressed up.
(The club has no name. The sign over the stage is a moon, not a word.)

The law of the land is **three places — where you are is what you're doing**:

1. **THE FOYER** (menu place): a piece of THE VOID — a floating platform
   hanging seven metres above a lit plain, with towers rising off that
   plain past the deck's edge, a small truss and four arches overhead, and
   a horizon beyond. The platform is BUILT: a neon-rimmed hex deck with an
   inlay of hairline rings and a crown of ticks, six radial ribs and a
   tapered keel underneath (half of what anyone sees of a floating thing
   is its underside). The board floats at its heart and the MC poses
   beside it — the club's door is the board's MULTIPLAYER seat, not a
   thing in the room. Solo players never leave.
2. **THE CLUB** (social place): ENTER THE CLUB (host) or join a room and
   the full hall swaps in — the warm human room between the voids.
   Everything the pub had, remade elegant; everything the raid needs,
   foreshadowed (the dance floor's brass inlay is the raid ring's ghost —
   24 seat ticks and all). The club keeps NO front desk: the board stays
   in the foyer, and the floor's controls (song, difficulty, the ball,
   voice, the door out) live on the SOCIAL panel at right Ⓐ — a console
   you summon, not furniture blocking the stage.
3. **THE SET** (game place): the raid, wrapped in THE VOID — an actual
   environment sharing the foyer's language at arena scale. Both interiors
   pack away; the rig re-plants at the spawn so "my platform IS the world
   origin" stays true no matter where you teleported. The void ducks with
   the light rig while a telegraph owns your deck — danger never competes
   with scenery.

### Building the void (what actually buys fidelity)

Four things, in order of how much they return per frame spent:

1. **The mirror.** A polished floor doubling every light is the biggest
   single signature of the scenes we're chasing, and it needs no render
   pass: clone the scenery upside down under a black-glass floor and
   RE-SHARE its instance buffers, so the reflection animates for free. A
   second camera would cost double in stereo; this costs one draw per bank.
2. **Depth in layers.** Near towers, mid towers, a far skyline, a horizon —
   four silhouette scales at four distances. Parallax does the rest.
3. **Structure, not sticks.** Towers carry pinstripes, panel bands,
   porthole rows and lit caps; the canopy is a truss with spars and lit
   joints. Detail at three scales (silhouette / panel / pinprick) is what
   "high fidelity" looks like from inside a headset.
4. **Air.** Narrow light shafts, drifting dust, a low horizon glow — an
   empty black gap reads as a wall until something drifts in it.

And one hard-won rule: **the sky stays black.** Wide additive volumes —
fog cones, zenith discs, tall horizon cylinders — subtend most of your view
and flatten the entire room into one colour. The first pass had all three
and looked worse than what it replaced. Light the STRUCTURE; keep the
horizon a line with a short gradient over it, never a wall.

Everything repeated is an InstancedMesh, and every animated glow is driven
through per-instance colour (MeshBasicMaterial multiplies `color` by
`instanceColor`), so a hundred towers pulsing independently is one draw
call. Measured: 48 draws, ~24k triangles, 1,521 instances for the set's
whole world, mirror included — about half the draw calls of the twelve
hand-built pylon groups it replaced.

### THE BALL (how a raid is called)

The pub's third lesson, invented here: games are OPT-IN, and the invitation
is physical. Anyone on the floor sends THE BALL up (SOCIAL panel; their
♪ pick, difficulty and ring-size preference ride along) and a mirror ball hangs
before them for sixty seconds — countdown plate, caller's name, one
orbiting pip per dancer who has touched in. Touch to join, touch again to
step out, caller's touch cancels. The RELAY owns the clock: at zero it
deals the caller + touchers onto the ring and tells everyone else who left
('game'); the floor NEVER closes — stay-behinds keep dancing (away
players' voices sing from the stage), newcomers still join the room, and
'game-out' brings each player home to the floor when their podium settles
(auto-deposited after the reading). One ball or one live set at a time;
a departing caller takes their ball with them.

Art direction — the opposite pole from the boozer: restrained Art Deco.
Charcoal lime plaster, smoked oak, champagne brass, oxblood velvet, dark
veined stone, ribbed glass. Saturated colour is reserved for LIGHT (coves,
candles, signage, drinks, the eclipse) — the rave's neon vocabulary stays
whole for the raid. The hero is the **eclipse chandelier**: five
counter-rotating brass rings over the dance floor whose glow phases around
the stack with the bars, a moon-disc heart half-swallowed by its own
shadow. Detail discipline: every edge carries thickness (skirting, dado,
picture rail, nosings, fluting, joints); wear where hands and feet go
(terrazzo scuff, marble condensation rings); no five adjacent modules
identical.

Perf discipline: the whole shell bakes to a handful of draw calls
(collapseStatic, the IBB merge helper vendored to `club/merge.ts`); four
real point lights + a hemisphere per interior; everything else is emissive
or a glow sprite; fog only while indoors. The club renders only on menu
screens, where no choreography runs — the raid's budget is untouched.

The social wire stays a handful of relay verbs: `cp` club poses
(world-space head+hands keyed by member idx, 12 Hz), binary voice frames
tagged with the sender idx (16 kHz Int16 PCM, HRTF-panned at the receiver —
the pub's exact recipe, because WebCodecs died on Quest and this didn't),
and the ball's lifecycle (`ball-up`/`ball-join`/`ball-off`, the server-side
sixty-second clock, `start` to the players only, `game` to the floor,
`game-out` on the way home) so **rooms outlive their sets** and never close
during one. A leaving host hands the room to the longest-standing member.
Blocking stays strictly local and keys on names, so it survives reconnects;
BLOCK hides figure + tag and drops their frames at the door.

## Roadmap

- **Real tracks.** Drop the produced music in, declare BPM + offset per
  track, act boundaries mapped to the actual arrangement. Track select in
  the lobby = set select.
- **The volley.** FIRE FIGHT's aimed goo-orbs as a seventh move (per-dancer
  aim breaks pure determinism — needs the pose stream as input, host-rolled).
- **Haptics + landing rumble** on dodge/hit (the IBB haptics kit is sitting
  right there).
- **Colocated mode**: several headsets in one real room, shared spatial
  anchor, one physical dancefloor.
- **Spectator drones**: eliminated dancers get a fly-camera and a horn to
  heckle with.
- **Cosmetics**: skins for your raver, trails for your combo, crowns that
  persist a night.
- **Seasonal goops**: new bosses = new gesture sets + new move weights over
  the same telegraph grammar.
