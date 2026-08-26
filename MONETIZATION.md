# THE DOOR CHARGE

How RAVE RAID gets onto the Meta Horizon Store as a PWA, and how it sells
records once it's there.

This is a research document, not a plan of record. Everything in the
**Packaging** and **The till** sections was read out of Meta's own
Bubblewrap fork (`meta-quest/bubblewrap`, CLI `1.24.1`) — that source is
authoritative and it is quoted exactly. Everything attributed to Meta's
documentation site came through search summaries: `developers.meta.com` is
blocked from this environment, so **every policy line below wants a second
read against the live page before anyone signs anything.**

---

## Why the door is free, and has to be

> "we can't charge for it"

Correct, and there is a specific mechanism behind it — worth writing down,
because the same mechanism decides how the shop has to be built.

**VRC.Quest.Security.1** requires an app sold on the Horizon Store to
perform a **Platform Entitlement check within 10 seconds of launch**, and
to handle a failed check by quitting, erroring, or dropping into a limited
demo. It is the store's anti-piracy floor: prove this user actually bought
this, or don't run.

A PWA cannot satisfy it, and not because of a missing API. **A PWA has
nothing to gate.** The app is a Trusted Web Activity — an Android shell
that opens a URL. The game isn't in the binary; it's at
`raveraid.web.app`, where anybody with a headset and a browser can load it
for free, entitlement or no entitlement. There is no version of that check
that means anything. Charging for the shell would be charging for a
bookmark.

So: free at the door is not a compromise, it is the only shape the
platform allows. Good — the reasons to want it were already there:

- A club is worth more the more people are in it. RAVE RAID is a
  twenty-four-seat room with a relay and a ball; a price tag at the door
  empties the floor before the shop ever opens.
- The game already lives free on the open web. Charging on Quest for the
  thing that is free at `raveraid.web.app` is a bad look and a worse
  support burden.
- Records are the natural unit. The game is already built around a record
  box — twenty-four measured masters, twenty of them charted. Selling
  records is selling the thing the game is about.

### The part that actually matters

**The same argument applies to a song.**

An add-on you sell for $2.99 whose audio sits at
`raveraid.web.app/assets/breakcore-a3f9c2.mp3` is exactly as unsellable as
the paid app was, for exactly the same reason: it is public, and the
purchase gates nothing. Meta couldn't solve this for the app. You have to
solve it for the record.

Which turns the lazy-loading work from a performance chore into **the
product itself**. Gated audio isn't step two of a shop — it *is* the shop.
Everything else (billing wiring, add-on SKUs, the Dashboard) is plumbing
attached to it.

### The one lever that could change the app-level answer

`--metaquest` silently enables `horizonPlatformSDK` on every build
(`cmds/init.ts:304`) — it is not a prompt, you get it whether you asked or
not — pulling in `com.meta.androidbrowserhelper:horizonplatformsdk:1.1.0`
and registering a `HorizonPlatformSdkRequestHandler` on the delegation
service. That is a JS↔platform bridge sitting in the app already.

If it exposes an entitlement check to the page, a paid PWA becomes
*arguable* (you'd still need the web build to refuse to run un-entitled,
which is its own fight). What that bridge actually exposes could not be
confirmed here — Meta's docs are unreachable from this environment. **It
is worth thirty minutes on-device to enumerate.** Log what the handler
answers; that's the cheapest experiment in this whole document.

---

## Packaging

The Horizon Store takes PWAs through Meta's fork of Google's Bubblewrap,
which wraps the live site in a Trusted Web Activity — an Android shell
whose whole job is to open your URL in a chromeless Quest Browser that the
OS treats as an app.

```
npm i -g @meta-quest/bubblewrap-cli        # NOT @bubblewrap/cli — the fork
bubblewrap init --manifest=https://raveraid.web.app/manifest.webmanifest --metaquest
bubblewrap build                            # → app-release-signed.apk + .aab
```

`--metaquest` changes the interview. It asks for an **app mode** —
`immersive` or `2D` — and `immersive` is the one that launches straight
into WebXR. Choosing it forces `display: standalone` and
`orientation: default` and skips the theme-colour question entirely
(`cmds/init.ts:85`). It then offers the Quest-only permissions:
microphone (`enableMicrophone` → `RECORD_AUDIO`) and scene
(`enableXRScene` → `com.oculus.permission.USE_SCENE`). The club has voice,
so the microphone one is a yes.

The generated `AndroidManifest.xml` picks up
`<category android:name="com.oculus.intent.category.VR" />` on the
launcher, and hand tracking rides along as
`oculus.software.handtracking` when asked for.

### What this repo is missing

**There is no PWA yet.** `index.html` has no `<link rel="manifest">`,
there is no `manifest.webmanifest` anywhere in the tree, and no service
worker. Bubblewrap's first argument is a manifest URL, so this is step
zero and nothing else can start before it.

What has to exist on the live origin:

| Thing | Where | Note |
| --- | --- | --- |
| `manifest.webmanifest` | site root | `name`, `short_name`, `start_url`, `scope`, `display: standalone`, icons (192 + 512, plus a maskable) |
| Service worker | site root | Scope must cover `start_url`. Registration alone satisfies installability |
| `/.well-known/assetlinks.json` | site root | Binds the signing key to the origin. `bubblewrap fingerprint` generates it |
| HTTPS | — | Already true on Firebase Hosting |
| Signing keystore | local, backed up | `keytool`, created during `init`. **Lose it and you cannot ship an update, ever** |

`vite.config.ts` sets `base: './'`, which is right for the wrapped app —
but `start_url` and `scope` in the manifest must be absolute and must
match the origin in `assetlinks.json`, or the TWA falls out of trusted
mode and renders with a browser address bar over the top of the rave.

### The VRC that will bite

PWAs are held to the same Virtual Reality Checks as native apps, and the
one everybody fails first is **Quest.Performance.3**, on startup time. A
WebXR PWA launches *directly* into immersive mode, so everything loaded
before the session begins is counted against the clock.

RAVE RAID currently ships **95 MB of audio** in `src/assets/music/`, all
of it reachable from the static import graph in `src/audio/tracks.ts`.
Meta's own advice for PWAs is to load as much as possible *after* the
WebXR session initiates. The record box needs to become lazy before
submission regardless of whether anything is ever sold — and, as it
happens, moving the audio off the public origin is not *half* the shop —
it is the whole thing that makes a record sellable at all.

---

## The till

Since Connect 2024, a WebXR PWA on the Horizon Store can take in-app
payments through the **Digital Goods API** — the same web standard that
backs Play Billing in a TWA, pointed at Meta's payment method instead of
Google's.

### Wiring it, exactly

In `twa-manifest.json`:

```jsonc
{
  "features": {
    "horizonBilling": { "enabled": true, "horizonOSAppMode": "immersive" }
  },
  "alphaDependencies": { "enabled": true },   // ← REQUIRED, see below
  "enableNotifications": true,
  "applicationId": "1234567890123456"          // 16–17 digits, from the Dashboard
}
```

Three traps, all read out of the fork's source:

1. **`alphaDependencies` is not optional.** `FeatureManager.ts:80` will
   silently drop the whole billing feature and log
   `Skipping HorizonBillingFeature. Enable alphaDependencies to add
   HorizonBillingFeature.` if it is missing. You get a build that
   installs, runs, and has no payment method — with one line in a log you
   probably didn't read.
2. **It is alpha.** The dependency is literally
   `com.meta.androidbrowserhelper:horizonbilling:1.0.0-alpha11`. Treat the
   version as a moving target and pin it in CI.
3. **The Application ID is validated as `/^\d{16,17}$/`.** It's the
   numeric Meta Horizon Application ID from the Developer Dashboard, not a
   package name and not a slug.

Bubblewrap only *enforces* `enableNotifications` for Play billing
(`cmds/shared.ts:127`), but the fork carries an
`errorHorizonBillingEnableNotifications` string for the Horizon case, so
set it true anyway.

Enabling the feature injects a `PaymentActivity` that answers
`org.chromium.intent.action.PAY`, declares
`org.chromium.default_payment_method_name` as
**`https://quest.meta.com/billing`**, plus an `IS_READY_TO_PAY` service and
a `DigitalGoodsRequestHandler` on the delegation service.

### The API, in the game

```js
// Only resolves inside the packaged app — see the note below.
const store = await window.getDigitalGoodsService('https://quest.meta.com/billing');

const [record] = await store.getDetails(['track.breakcore']);
// → { itemId, title, description, price: { currency: 'USD', value: '2.99' } }

const request = new PaymentRequest(
  [{ supportedMethods: 'https://quest.meta.com/billing',
     data: { itemId: record.itemId } }],
  { total: { label: record.title, amount: record.price } },
);
const response = await request.show();
// response.details carries the purchase token → send it to your server
await response.complete('success');

// On every boot, restore what they own:
for (const p of await store.listPurchases()) {
  // { itemId, purchaseToken } → verify server-side, then unlock
}
```

Records are **durable** add-ons — bought once, owned forever, never
consumed. `consume()` is for the repeatable kind (coins, lives), which
this game has no use for.

> **The load-bearing limitation:** the payment method resolves through an
> Android intent handled by an activity *inside the APK*. Open
> `raveraid.web.app` in plain Quest Browser and `getDigitalGoodsService`
> rejects. The shop must degrade to "you own N records, buy more in the
> Quest app / on the web" rather than throwing. Feature-detect, never
> assume.

### The Dashboard side

Add-ons are defined in the Developer Dashboard under
**Platform Services → Add-ons**. SKUs allow alphanumerics, `.`, `-`, `_`,
and there is one SKU across every language. Price is set in USD and Meta
converts it. A `$0.01` developer-org price exists for testing, which is
how you QA a purchase flow without spending real money.

Verify server-side, always:

```
POST https://graph.oculus.com/{APP_ID}/verify_entitlement
     ?access_token=...&user_id=...&sku=track.breakcore
```

with `POST .../consume_entitlement` for consumables and
`Platform.Users.GetUserProof()` + a nonce to prove the user is who the
client claims. Client-side `listPurchases()` decides what to *show*; the
server decides what to *unlock*.

### Meta's cut, and what not to plan around

**30%.** A $2.99 record nets $2.09.

**Meta Credits are dead for this purpose.** Credits stopped being
purchasable on the Horizon Store on **9 June 2026** and developers can no
longer opt in for VR purchases. They survive only inside Horizon Worlds.
Any tutorial that tells you to price in credits is stale.

Also on the shelf, if the shop ever grows past records: subscriptions,
season passes, bundles, app referrals, and Meta Horizon+.

---

## The rules

The policy that governs the whole design, near-verbatim:

> Apps hosted on the Meta Horizon platform may not contain, use, or make
> available commerce solutions — including for app payment processing,
> in-app purchases, or in-app advertising — except as specifically
> provided in Meta's policies, the platform SDK, or otherwise expressly
> agreed by developers and Meta in writing.

And, plainly: if your app has in-app purchases and is distributed through
the Horizon Store, you **must** use Platform In-App Purchases for that
payment processing. The exceptions are narrow and none of them fit a $2
song:

- bulk licences sold off-platform to business customers (companies,
  schools);
- "windows into an existing service" selling access to *pre-existing,
  off-platform subscription* content;
- physical goods, with express written agreement from Meta.

Two consequences worth internalising:

**No steering.** Do not put "cheaper on our website" — or any purchase
link at all — inside the Quest build. Meta also blocks monetising
cross-app deep links without written permission. An account-linking flow
is fine; a buy-elsewhere flow is not, and it is exactly the thing review
is looking for.

**Selling on the web is fine; routing Quest users there is not.** Nothing
stops raveraid.web.app selling records with its own payment rail, and
nothing stops those records lighting up on Quest. What is forbidden is the
Quest app *sending people* to that rail.

### The rest of the submission checklist

| Requirement | Detail |
| --- | --- |
| IARC rating | Mandatory for every Store title. Questionnaire-driven |
| Age group self-certification | Separate from IARC, also mandatory. Mixed-age apps must implement the Get Age Category API within 30 days |
| Privacy policy | Required by VRC. Must cover the relay, Firestore leaderboards, voice, and Analytics |
| Data Use Checkup | Required for platform API access, re-certified annually. Each extra API lengthens it |
| Minimum permissions | Ask for microphone and nothing else you don't use |
| Lead time | Submit **at least two weeks** before target launch. Metadata review alone is 1–2 business days |

The profanity filter in `src/game/profile.ts` is honest about being "a
coarse net… not moderation". Names ride a public board and now a paid
product; a real report path is a store-review risk, not just a nicety.

---

## WHO YOU ARE — accounts, and where the login goes

The instinct is right: there is no account, so a new headset is a
stranger. But the fix should **not** be a login in front of the store, and
the reason is worth being precise about.

### On Quest, Meta already solved the purchase half

`listPurchases()` is scoped to the **Meta account**, not the headset. New
device, same Meta account, install the app, and the call returns every
record ever bought. That is the restore path, it is free, it is more
reliable than anything we would build, and it works with no login screen
at all.

So the specific scenario — *buy a track, pick up a different headset,
they're gone* — **is already handled on Quest**, on one condition:
entitlements must rehydrate from `listPurchases()` at boot rather than
from anything local. Get that right and there is nothing left to fix
there.

Three reasons a login wall in front of the store would actively hurt:

1. It asks for a signup immediately before asking for money. That is
   exactly where conversion dies.
2. It duplicates, worse, an identity Meta is already handing us.
3. **Typing in VR is miserable.** Email and a password on a floating
   keyboard is a genuinely bad minute of someone's life. This game already
   knows that — room codes are four digits on a keypad *because* that is
   what VR text entry can bear.

### Where the gap is actually real

Three places, and the first is bigger than the one that prompted this:

- **Progress, not purchases.** The name in `localStorage` under
  `gdr-name`, the hue under `gdr-hue`, campaign progress, personal bests —
  all device-local. A new headset loses every bit of it. That hits *every*
  player, not just paying ones, and somebody forty hours in who lost their
  name and their bests is far angrier than somebody who lost a £3 record
  Meta will hand straight back.
- **The web has no store to fall back on.** A web purchase held in
  `localStorage` dies when someone clears site data. Web buyers genuinely
  do need an account — this is the one place a login is *required*.
- **The bridge.** Bought on Quest, playing on the web. No Meta identity
  exists there.

### We already have the container

**`signInAnonymously()` is already in this repo** — `src/net/scores.ts:107`
— minting a real Firebase UID that the world board already keys every row
on. It isn't a nickname; it's an actual account that simply has no
credentials attached yet.

Which matters because of one Firebase behaviour:

> `linkWithCredential()` upgrades an anonymous account to a real one
> **without changing the UID.**

Every score, every entitlement, every row keyed on that UID survives the
upgrade untouched. "Log in to save your old account" is not a system to
build — it is a call to make against an account system already running
here.

Two changes to what exists:

1. **Sign in at boot, not on demand.** Today the Firebase import is lazy
   and only fires when a board is asked for. The UID needs to exist before
   anything wants to hang an entitlement on it.
2. **Move the profile onto it.** Name, hue and progress stop being
   `localStorage` keys and become fields on the account, cached locally.

### The shape

**Meta is the account on Quest. Ours exists to carry things off Quest,
and it is optional.**

- **Quest boot:** anonymous sign-in → `listPurchases()` → verify → records
  unlock. No login, ever.
- **The account is offered as "keep this", never "sign in to continue".**
  At the profile card, after a strong run, after a purchase. Dismissible,
  and offered again later.
- **Web:** anonymous by default; an account is required *to buy*, never to
  play.

**Create accounts where typing is easy; claim them where it isn't.** Six
digits in the headset, typed at `raveraid.web.app/link` on a phone — the
same keypad idiom the club already uses for rooms. The account itself is
created on the web, where a real keyboard exists. No email is ever entered
in VR.

```
Quest app                     Our backend                     Web build
─────────                     ───────────                     ─────────
anon UID (exists already)
listPurchases()  ──token──▶   verify_entitlement
GetUserProof()   ──nonce──▶   (graph.oculus.com)
                                   │
                                   ▼
                              player/{playerId}
                              identities: [ meta:1234…, firebase:abc… ]
                              entitlements: { 'track.breakcore': {…} }
                                   │
             ◀── 6-digit code ─────┼──── typed on a phone ──▶ linkWithCredential()
                                   ▼                          (UID survives)
                              session token ──▶ keys + gated audio
```

### Three things to design in now, not later

- **Key the server record on a player, with identities attached** —
  `meta:<user_id>`, `firebase:<uid>`, `email:<…>` — rather than on the
  Firebase UID directly. A fresh install mints a *new* anonymous UID, so
  without this the Meta identity arrives at the server pointing at
  entitlements filed under a UID nobody has any more. The identity graph
  is what makes that a merge instead of an orphan.
- **Decide the merge policy while it's free.** Someone plays anonymously
  on the web *and* on Quest, then links: take the max score per chart,
  union the entitlements, keep the older name. Cheap now, miserable to
  retrofit.
- **Anonymous is a container, not a guarantee.** A Firebase anonymous UID
  lives in browser storage — cleared data means it is gone with no
  recovery. On Quest `listPurchases()` is the recovery. On the web,
  *only a linked account is*. Say so honestly in the "keep this" prompt;
  it's also the most persuasive reason to accept it.

One consequence worth pricing: an email address is PII, which widens the
privacy policy, the Data Use Checkup, and whatever GDPR posture we take.
Not a blocker — a line item.

---

## Hosting a record in the club

Here is the good news: **this is already wired.**

The caller's song pick rides the ball. `ball-up` carries
`track: <id>` (`server/index.mjs:489`), it is copied onto the `start`
broadcast (`server/index.mjs:311`), and the client hands it to
`startRaid({ trackId })` (`src/net/session.ts:331`). The relay never looks
at the string. One person picks a record and the whole room dances to it.

And here is the bug that a shop would create:

```ts
// src/audio/tracks.ts:421
export function trackById(id: string): Track | undefined {
  return TRACKS.find((t) => t.id === id);
}
```

`startRaid` does `trackById(opts.trackId) ?? <seeded pick>`
(`src/game/flow.ts:90`). A guest who doesn't have the host's record
doesn't get an error — they get a **different song**, silently, while the
choreography runs off the shared seed. Twenty-four people dancing the same
chart to twenty-four different records. That fallback has to become an
explicit branch the moment any track is ownable.

### DOWNLOAD PLAY — the decided model

**One cartridge in the room and everybody races.** A guest who doesn't own
the record still hears it, still dances it, still scores it — for that
set, in that room, because somebody there owns it.

That's settled. What Mario Kart DS actually got right, and what carries
over:

- **The guest keeps nothing.** Turn the DS off and it's gone. Here: the
  unlock is scoped to the set, not to the person. Nothing lands in their
  library.
- **Zero setup for the guest.** No store page, no download, no account,
  no "the host has invited you to install". You joined a room; the music
  plays. Any friction here kills the entire point.
- **The owner is the reason the party is happening.** That is the whole
  business model, and Nintendo proved it sells cartridges.

The one thing to *not* carry over is Download Play's crippled guest mode
(Shy Guy, four tracks). A rhythm game is the full record or it is nothing
— a guest gets the real chart at the real length, or the club is worse
than not having the feature.

### The grant is the cartridge

The room code cannot be the credential. Codes are four digits — ten
thousand of them — and `case 'public'` walks any stranger into the fullest
public room on the floor. "I'm in room 4096" is not proof of anything.

So the thing that gets shared is a **signed, short-lived, room-scoped
grant**, and it rides the wire the game already has:

```
 HOST                    ENTITLEMENT SERVER              GUEST
  │                             │                          │
  │ POST /room-grant            │                          │
  │  { room, sku, session } ───▶│  verifies HOST owns it    │
  │                             │                          │
  │◀── grant ────────────────── │  JWT{ room, sku, exp+15m, jti }
  │                             │                          │
  │ ball-up { track, grant } ──────── relay ──────────────▶ │
  │      (relay just forwards the string — as it already does)
  │                             │                          │
  │                             │◀── POST /track { grant } ─│
  │                             │                          │
  │                             │── measured row ─────────▶ │  bpm, downbeat,
  │                             │   + signed audio URL      │  lufs, phrases
  │                             │      (5 min TTL)          │
```

Why this shape and not another:

- **The relay stays dumb.** `server/index.mjs` simulates nothing and knows
  nobody; `ball-up` already carries `track` as an opaque string. This adds
  one more string beside it. No entitlement logic ever enters the relay,
  which is the property that makes that file good.
- **The grant carries the measurements.** A record is a file *plus* its
  measured row — without `bpm`/`downbeat`/`lufs` there is no chart to
  dance. One round trip delivers both.
- **It expires with the night.** It is a capability, not a key. Nobody
  accumulates a library of grants.

### The 60-second gift

`BALL_MS` is `60_000`. There is a **full minute** between the ball going
up and `fireBall()` — a minute in which the disco ball hangs there and
people decide whether to touch it.

That is exactly the download window, and it is already the right length.
The moment `ball-up` lands, every client redeems the grant and calls
`preload(track)` — which already exists (`src/audio/music.ts:176`) and is
already how the lobby warms a record so the drop is instant. By the time
the ball fires, a room of strangers is buffered and nobody waited for
anything. The feature needs no new timing machinery; it needs to use the
minute that's already sitting there.

### Where this actually leaks, honestly

**You cannot stop someone ripping the audio.** Web Audio has to decode it,
so it is decodable, so a determined person with a network tab gets an MP3.
EME/Widevine for a $2.99 record is a multi-week rabbit hole that ends with
a worse product and the same outcome. The goal is friction and fairness,
not DRM — and every web game ever shipped is in the same position.

**Public rooms will be farmed, and that's fine.** Someone will join the
fullest public room to hear records they don't own. Look closely at that
sentence: it is indistinguishable from the feature working. A grant buys
one set in one room. Let it.

The things actually worth doing: keep the TTL short (fifteen minutes,
invalidated on `end`), never let a grant name a user, and rate-limit
redemption per grant so one leaked token doesn't become a CDN bill.

### Then why does anybody buy?

Same reason one kid in the room bought the cartridge.

- **Only owners can send the ball up on it.** The purchase buys the right
  to *call* the set. Hosting is the product; hearing is the demo.
- **Solo requires ownership.** The club is where records are discovered;
  the tour and quick-raid shelves are where they're owned. This mirrors
  Download Play exactly — guest mode was always multiplayer-only — and it
  falls along a seam this codebase already has.
- **The conversion moment is the last beat of the set.** They just danced
  a record they don't own, in front of people, and the score is on screen.
  There will never be higher intent than that. On Quest that button is a
  Digital Goods `PaymentRequest`; on the web it's the other rail; it is
  **never** a link out of the Quest build.
- **Make ownership visible.** The club already has THE CROWN, name tags
  and hues. Whoever brought the record should be legible on the floor —
  that's the social proof doing the selling, not a banner.

Two open decisions, both cheap to get wrong and cheap to change:

1. **Does a guest's score count on the WORLD board?** Say yes. Voiding it
   is punitive, confusing, and removes the sting that sells the record.
2. **The twenty charted records already in the box should stay free
   forever.** They're the floor a new player lands on and the reason the
   club is worth joining. The shop is what comes *next*, not a fence
   around what exists.

### What that costs this codebase

Two things, and the second one is the one people forget:

**1. The audio leaves the bundle.** `src/audio/tracks.ts` performs 24
static imports of files in `src/assets/music/`. Vite fingerprints all of
them into `dist/assets/` where anyone can read them off the network tab.
Anything sold has to move to a runtime fetch against a gated endpoint.
Free records can stay exactly where they are.

**2. A record is not a file — it's a file plus its measurements.** The
whole game is quantised to numbers that were *measured* off each master:

```ts
{ id, url, bpm: 133.964, downbeat: 0.412, lufs: -8.1, roles: ['raid'] }
```

`mountTrack` derives beat length and phrase count from `bpm`
(`src/game/flow.ts:33`), `trackGain` matches loudness from `lufs`, and the
whole set-list is generated from that grid. **A purchased track without
its measured row cannot be charted at all.** So the catalog — not just the
audio — has to come from the server, and `npm run analyze` becomes part of
the publishing pipeline for every record ever sold.

The upside: charts are deterministic from `(seed, track)` and are computed
client-side, so there is nothing to ship per chart and nothing to protect.
The DRM boundary is the audio, and only the audio.

---

## THE UNLOCK — buying without leaving the room

Two questions, both yes, and the second one resolves a tension left
hanging above.

### Does the purchase happen in-headset?

**The evidence says yes, and one thing needs testing.**

`HorizonBillingFeature` declares the payment activity like this:

```ts
const category = config.horizonOSAppMode == '2D'
  ? ''
  : '<category android:name="com.oculus.intent.category.VR" />';
```

Meta wrote a *branch* for this. In immersive mode the payment activity is
tagged as a VR-category activity; in 2D mode that category is empty. That
branch only exists because the immersive path renders differently — in the
headset. The theme backs it up: `Theme.Translucent.NoTitleBar`, a
chromeless activity drawn over whatever is behind it. That is the shape of
an overlay, not a screen you get thrown to.

**The unknown is what happens to the `XRSession`.** WebXR has three
visibility states — `visible`, `visible-blurred`, `hidden` — and
`visible-blurred` exists for exactly this: the scene is still rendering,
but input is going to a system UI. If Quest puts the session in
`visible-blurred` for checkout, this is perfect; the club keeps breathing
behind the dialog and you come back to the same frame. If the session
**ends** instead, the player gets dumped out of immersive and has to walk
back in, which is the outcome to design against.

Which one happens could not be confirmed here. **It is a fifteen-minute
test on-device**, and it should be the first thing run against the first
build that has billing in it — before the shop's placement is designed
around it.

Costs nothing to be safe either way:

- **Never call `show()` mid-set.** Only from the board, the club floor, or
  the post-set score screen — places where a pause is harmless. THE BALL's
  sixty-second window is fine. A live raid is not.
- **Write "purchase in flight" down before calling `show()`**, so a killed
  session resumes into the right screen with the record already unlocked
  rather than into confusion.
- Pause on `visibilitychange` when state leaves `visible`; the game
  already has to handle that for the system menu anyway.

### "Everybody's got it, it's just locked"

Right instinct, and it is how this should work — but it collides with the
rule from the top of this document: *if the audio sits somewhere public,
there is nothing to sell.* If the file is already on the device, isn't it
already taken?

**No — ship the ciphertext, sell the key.**

Paid records sit on the device as **AES-GCM encrypted blobs**. Public
bytes, useless bytes. The purchase does not deliver four megabytes of
audio; it delivers **thirty-two bytes of key**. Unlock is one small
request, a `crypto.subtle.decrypt`, and a decode.

And it lands in one place. `loadTrack()` (`src/audio/music.ts:147`) is
already the single choke point for every record in the game —
`fetch → arrayBuffer → decodeAudioData`. Encrypted records add one step in
the middle:

```
fetch(url) → arrayBuffer → [ decrypt(key) ] → decodeAudioData
```

One branch, in one function, in a file that already caches by track id and
already de-dupes concurrent loads. The runtime change is far smaller than
the feature sounds.

**This also unifies the club.** A Download Play grant and a purchase now
deliver the *same object* — a key. One is permanent, one expires with the
set. A guest in the club doesn't need four megabytes inside the ball's
sixty seconds; they need thirty-two bytes, and the ciphertext is already
warm.

### Four things to be honest about

**1. "Already got it" is probabilistic, not guaranteed.** The APK is a
shell — a TWA does not bundle web assets. "On the device" means "in the
Cache API, warmed in the background." First run, cleared storage, or quota
eviction and the bytes are simply not there, so there is a real download.
The UI has to handle both paths.

**Which is the actual argument for the download animation.** It is not
decoration — it is the thing that makes the slow path feel identical to
the fast path. Build it for that reason and it earns its place.

**2. It shouldn't lie, and it doesn't have to.** There is real work in an
unlock: the key fetch (~100–200 ms), the decrypt (fast — AES is
hardware-accelerated on the XR2), and `decodeAudioData` on a 4–5 MB master
(the real cost, likely a few hundred ms). Wire the bar to actual progress.
Where it genuinely is instant, a short confident **UNLOCKED** beat reads
better than a three-second fake — players clock a bar that isn't measuring
anything, and it cheapens the moment they just paid for.

**3. Storage is a real budget.** The free box is already 95 MB and
Meta's own guidance is "avoid storing large assets locally" with no number
attached. Do not pre-cache the whole paid catalogue. Check
`navigator.storage.estimate()` before warming anything, call
`persist()` to resist eviction, and warm selectively.

**4. The shop screen is the preloader.** Browsing a record starts caching
it in the background. By the time someone has heard the preview and made
up their mind, the bytes are there and the unlock genuinely is instant.
It costs nothing and it spends bandwidth at the highest-signal moment
there is.

### Two small things that make it feel bought

- **Ship a short unencrypted preview** (~30 s) per paid record. The shop
  can't sell a record nobody can hear, and a clip is cheap.
- **Unlock optimistically.** When `PaymentRequest` resolves success,
  unlock immediately and verify server-side in the background; re-lock only
  if verification fails. That is the difference between "bought it" and
  "waiting on a server", and the verification still happens.

---

## The music, as it actually is

The records are made by musicians we work with, paid a share of profit.
That is a **collaboration**, not a licensing deal, and almost everything
written about game music licensing is aimed at the other thing — clearing
somebody else's finished commercial recording, which is where the
$500–$2,000-a-track numbers and the sync/master two-step come from. None
of that applies here. Skip it.

What a collaboration needs is much smaller, and it is one page.

### The failure mode, precisely

Not a lawsuit. Nobody sues over a rhythm game. The thing that actually
happens is faster and dumber:

Meta operates notice-and-takedown under **DMCA §512(c)**. Anyone can file
a claim against a Store listing. Meta does not adjudicate — it pulls the
listing and sends you instructions for filing a counter-notification. Then
you wait.

So the risk is not "we get sued in two years." It is: *a musician who
feels short-changed six months in — reasonably or not — has a button that
takes the whole store listing down, and we cannot argue with it, because
the entity holding the button is Meta and Meta has no opinion.* An
undocumented handshake and a revenue split that only ever existed in a
group chat is precisely the setup where that happens.

### The one page

Per track, roughly fifteen minutes:

- who made it, and what it's called;
- the split — **% of net**, with "net" defined once (after the store's
  cut, after payment fees) so nobody is computing from a different number
  later;
- one sentence granting the right to distribute *and sell* this recording
  in RAVE RAID and its stores;
- what happens if they walk — does the track stay in the game or come out;
- a signature, and a date.

That is not the traditional route. The traditional route is a lawyer and
six weeks. This is a shared doc and a signature block, it moves as fast as
anything else in this repo, and it converts "one angry text away from a
takedown" into "impossible."

Do it per track as tracks land, not as a batch cleanup later. The batch
cleanup is the version that never happens.

### What the rev-share means for the build

This is the part that is engineering, not paperwork, and it is easy to
miss until it is expensive.

**Paying a % of profit requires per-track revenue attribution, from the
first sale.** Not from launch — from the *first sale*. If entitlements are
recorded as "this user owns `track.breakcore`" and nothing else, then in
twelve months, working out what one artist is owed means reconciling Meta
financial reports against Paddle CSVs against a Firestore collection that
never recorded a price. That reconciliation is miserable, it is done by
hand, and it is done in the same week as an awkward conversation about
money.

So the entitlement record is not a boolean. Every grant writes:

```ts
{
  sku:      'track.breakcore',
  rail:     'horizon' | 'web',     // whose cut applies
  gross:    2.99,
  currency: 'USD',
  fee:      0.90,                  // store or MoR cut, at time of sale
  net:      2.09,                  // what the split divides
  at:       <timestamp>,
  txn:      <purchase token / MoR order id>,
}
```

Then an artist statement is a query, payouts are a script, and the number
you show a musician is the same number they'd compute themselves. Build it
in step one; it costs a few extra fields now and it is the difference
between a rev-share that runs itself and one that quietly poisons the
thing that makes the music good.

### Worth keeping on the table

**Let players bring their own audio.** Charting is deterministic from
`(seed, track)` and the analyser already exists
(`tools/analyze-track.mjs`) — the game can chart a file it has never seen.
Sell the tooling and the club, not only the recordings. It is the reason
custom-song ecosystems outlive official ones, and it makes the record box
a showcase rather than the entire inventory. It carries its own moderation
problem on a public relay, so it isn't free — but it fits this codebase
better than it fits almost any other rhythm game.

---

## The web rail

For selling the same records at `raveraid.web.app`, the question is who is
legally the seller.

| | Cut | Merchant of record | Fit |
| --- | --- | --- | --- |
| **Stripe** (standard) | ~2.9% + 30¢ | **You are.** You owe VAT/GST wherever you have nexus | Fine US-only; a liability once EU/UK sales start |
| **Stripe Managed Payments** | +3.5% on top of processing | Stripe | Newer; the 3.5% is additive, not a replacement |
| **Paddle / Lemon Squeezy** | ~5% all-in | Them | **Recommended.** Global VAT handled, no monthly fee, no separate tax charge |

EU and UK digital-goods VAT has no small-seller threshold and enforcement
has tightened. For a two-person studio selling $2.99 records worldwide, a
merchant of record is worth more than the 2% it costs.

**Price at parity with the Store.** Undercutting Meta on the web is
precisely the behaviour the anti-steering rules exist to punish, and the
discovery is on the Store — that's what the 30% buys.

---

## Build order

Each step is shippable and each one is worth doing even if the next never
happens.

1. **Become a PWA.** `manifest.webmanifest`, a service worker, icons.
   Nothing else can start. *(Nothing to do with money; overdue anyway.)*
2. **Ship free on the Horizon Store.** Bubblewrap, no billing, no
   `alphaDependencies`. Clear the VRCs, IARC, age self-certification,
   privacy policy and Data Use Checkup on a build with no revenue riding
   on it. While in there: **enumerate what the `horizonPlatformSDK` bridge
   answers** — thirty minutes, and it's the only thing that could reopen
   the paid-app question.
3. **Gate the audio.** Records move out of the static import graph; paid
   ones ship as encrypted blobs and the catalog (including each track's
   measured row) is served, not bundled. One branch inside `loadTrack()`.
   This is not a performance chore — *this is the product.* It also
   happens to buy the Quest.Performance.3 VRC.
4. **Identity, entitlements, and the ledger.** Promote the anonymous UID
   that already exists to boot-time, move name/hue/progress onto it, and
   key the server record on a *player* with identities attached. Then the
   verify function, the session token, and the full revenue record on
   every grant (`sku / rail / gross / fee / net / txn`), from the first
   row. Grant one *free* record through the whole path end-to-end before
   any money moves. **No login screen in this step** — there is nothing
   yet for a login to be for.
5. **Turn on the till.** `horizonBilling` + `alphaDependencies` + the
   Application ID; durable add-ons in the Dashboard; test at the $0.01
   developer price.
6. **The web rail, and only now the login.** Paddle or Lemon Squeezy, the
   six-digit claim code, and `linkWithCredential()` on the UID that has
   been carrying everything since step 4. The account is created on the
   web where a keyboard exists; the headset only ever shows six digits.
7. **Host unlocks the room.** Signed room-scoped stream URLs, and kill
   that silent `?? seeded pick` fallback for good.

Running alongside, not blocking: **one page per musician, per track**, as
tracks land. It is fifteen minutes and it is the only thing standing
between a revenue disagreement and a §512(c) takedown of the whole
listing.

---

## Still to verify

`developers.meta.com` was unreachable from this environment, so the
following came from search summaries rather than the source, and each one
should be confirmed against the live page before it is relied on:

- **What checkout does to the `XRSession`.** Does Quest put it in
  `visible-blurred` and hand it back, or end it? This decides whether the
  shop can live anywhere in the club or only at the board. Fifteen
  minutes against the first billing build; nothing else in this document
  changes more design for less effort.
- **What the `horizonPlatformSDK` bridge exposes to the page.** Every
  `--metaquest` build ships it. If it answers an entitlement check, the
  paid-app question is open again. Enumerate it on-device; nothing else
  here has a better ratio of effort to consequence.
- The exact current wording of the in-app-purchase and commerce clauses in
  **App policies**, and whether the "windows into an existing service"
  exception has moved.
- Whether Horizon Billing has left alpha since `1.0.0-alpha11`.
- The current text of **VRC.Quest.Security.1** and whether it applies to
  free apps with in-app purchases, or only to paid apps. If a free app
  with add-ons is also expected to entitlement-check, that changes the
  shape of step 4.
- The current PWA-specific VRC list, and the exact
  Quest.Performance.3 threshold.
- Quest Browser's actual storage quota for a PWA — Meta's guidance says
  only "avoid storing large assets locally", which for a 95 MB record box
  is not a number anyone can plan against. Measure it on-device with
  `navigator.storage.estimate()`.
- Whether `navigator.storage.persist()` is honoured in the packaged TWA.
