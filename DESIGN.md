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
- **Passthrough is the venue.** No skybox, no floor plane — your room, plus
  furniture made of neon and a four-metre gel creature where your sofa used
  to be.

## The set (match structure)

14 phrases of 8 bars at 128 BPM ≈ a four-minute set.

| Phrases | Act | Moves/phrase | Rest | New |
| --- | --- | --- | --- | --- |
| 0 | intro | 0 | — | count-in, dance, calibrate |
| 1–3 | 0 | 2 | 4 beats | slam, sweep |
| 4–7 | 1 | 3 | 3 beats | beam, seesaw, 2-disc slams, claps on 2 & 4 |
| 8–10 | 2 | 4 | 2 beats | surge, nova, double beams, rave stabs |
| 11–13 | 3 | 5 | 1 beat | 3-disc slams, 5-stage seesaws, tight novas |

Ends at the final downbeat — or the moment one dancer remains.

## Scoring

- Dodge: `100 × (1 + 0.1 × min(combo, 30))` → ×4 ceiling.
- PERFECT (inside the zone at T−1 beat, clear at T): ×1.5 on top.
- Survival trickle: +10 per bar alive (separates flawless dancers late).
- Hit: combo → 0, one of 3 lives, 2 beats of i-frames.
- Rank law: alive > eliminated; alive by score; eliminated by who fell last.

## The rank made physical

Top ten platforms rise (+0.42 m), the champion higher (+0.85 m), the fallen
sink (−0.35 m) and dim. Rendered **relative to your own tier** — your platform
is your real floor and can never move, so leading feels like the ring dropping
away, and being out feels like the winners towering overhead. Same trick as
the seat transforms: subtract yourself from the world.

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
them). Move gestures reuse the boxing moveset as tells: overhand = slam,
cross = beam, backfist spin = sweep, clap = seesaw, spin-kick = surge,
uppercut = nova. Raymarch budget drops while a limb is extended (the exact
frame-spike moment), exactly as in FIRE FIGHT.

## Rehearsal campaign

Five gooplings, one move each, at 100–112 BPM, on a private one-seat ring:
GOOPLET (slam) → DRIZZLE (beam) → SLOSHA (sweep) → BIG SPILL (seesaw) →
GLOBULON (nova). Clear N reps of the move to pass; progress in localStorage;
clearing the row flags you RAVE READY. Same ChoreoSystem, same judge — a
lesson is just a set-list with one song and one move.

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
