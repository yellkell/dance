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

## The premise, corrected

> "we can't charge for it"

That isn't a platform limit. The Horizon Store sells PWAs the same way it
sells anything else — paid app, paid app plus optional subscription, free
app with in-app purchases, free app behind a mandatory subscription. A
WebXR PWA is not a second-class citizen at the till.

So free-with-a-shop should be a **decision**, not an inheritance. It is
probably still the right decision, for three reasons that have nothing to
do with what Meta allows:

- A club is worth more the more people are in it. RAVE RAID is a
  twenty-four-seat room with a relay and a ball; a price tag at the door
  empties the floor before the shop ever opens.
- The game already lives free on the open web. Charging on Quest for the
  thing that is free at `raveraid.web.app` is a bad look and a worse
  support burden.
- Records are the natural unit. The game is already built around a record
  box — twenty-four measured masters, twenty of them charted. Selling
  records is selling the thing the game is about. Selling *access to the
  game* is selling the wrapper.

One real caveat, and it is the big one: see **The rights**. Free
distribution and paid distribution are not the same licence.

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
happens, making it lazy is also the first half of building a shop.

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

## "Use them anywhere"

This is the hard part, and it is entirely a problem of identity.

A Meta entitlement is scoped to a Meta account and is only readable from
inside the packaged app. The open-web build has no Meta identity and never
will. So "buy on Quest, play anywhere" requires **an account system of our
own**, with Meta as one of the ways to prove you own something:

```
Quest app                     Our backend                     Web build
─────────                     ───────────                     ─────────
listPurchases()  ──token──▶   verify_entitlement
GetUserProof()   ──nonce──▶   (graph.oculus.com)
                                   │
                                   ▼
                              entitlements/{ourUserId}
                              { 'track.breakcore': {...} }
                                   │
             ◀── link code ────────┼──── link code ──▶  bind web account
                                   ▼
                              our own session token ──▶ gated audio URLs
```

The pieces:

- **A user identity that isn't the headset.** `profileName()` currently
  persists a name in `localStorage` under `gdr-name` and that is the
  entire notion of "who you are". A purchase cannot hang off that.
- **An entitlements store.** Firestore is already deployed
  (`raveraid-bc866`) with `firestore.rules` as the security model, and the
  README is explicit that the client is trusted for nothing. Entitlements
  belong there, writable only by a server, readable by their owner.
- **A verification function.** Something server-side that takes
  `{ itemId, purchaseToken, userProof }`, calls `verify_entitlement`, and
  writes the grant. Cloud Functions is the shortest path from where this
  repo already is.
- **A link code.** Six digits shown in the Quest app, typed on the web —
  the same shape as the club's four-digit room codes, which players
  already understand. This is account linking, not purchasing, which keeps
  it on the right side of the steering rule.

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

### Which model

| Model | What happens | Verdict |
| --- | --- | --- |
| Everyone must own it | Host picks a paid record; anyone who doesn't own it is blocked | Kills the social hook. The club is the reason to buy, not the reward for buying |
| **Host unlocks the room** | Host owns it, everyone in that room plays it, for that set | **Recommended.** Makes buying feel generous, turns owners into promoters, and the room code is a natural licence boundary |
| Guest preview | Non-owners get a clip or a degraded version | Sounds reasonable, is miserable — a rhythm game is the full record or nothing |

Host-unlocks means the audio has to be served, not shipped: a
**short-lived signed URL scoped to the room code**, issued by the backend
after checking that the *host* owns the record. Playable in that room,
not a permanent download.

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

## The rights

**This gates everything above.** No amount of billing plumbing matters if
the records can't legally be sold.

Selling a song inside a game needs two grants per track: a **sync
licence** (the composition) and a **master use licence** (that specific
recording), and both have to permit *distribution in a commercial product*
— which is a different, more expensive thing than permission to use it in
something free. A track that is fine to give away at `raveraid.web.app`
may be flatly unsellable.

Rough shape of the market: indie developers typically pay **$500–$2,000
per track** for traditionally licensed music; royalty-free and buyout
catalogues are far cheaper. For scale, Beat Saber — which chose the DLC
model precisely to contain this problem — sells music packs around $13 or
roughly $2 a track. US statutory damages run to **$150,000 per infringed
work**, which is the number that makes this a gating item rather than a
launch-week item.

The twenty-four masters currently in `src/assets/music/` need documented,
written rights before a single one is put behind a price. Three paths that
actually work:

1. **Commission originals.** Work-for-hire with a full buyout. Most
   expensive up front, cleanest forever, and the only one that makes the
   record box an asset rather than a liability.
2. **Royalty-free with explicit resale rights.** Cheap, fast, and legally
   fine *if* the licence names commercial redistribution inside a game.
   Read the actual licence; "royalty-free" alone does not mean this.
3. **Real label deals** for a marquee pack. Slow, expensive, and the thing
   that sells headsets — a later chapter, not chapter one.

A fourth, worth naming because it fits this game unusually well: **let
players bring their own audio.** Charting is deterministic and the
analyser already exists (`tools/analyze-track.mjs`). Sell the *tooling*
and the *club*, not the recordings. It sidesteps the licensing problem
entirely and it is the reason custom-song ecosystems out-live their
official ones. It also raises its own moderation problem on a public
relay, so it isn't free either.

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
2. **Make the record box lazy.** Move audio out of the static import graph
   and load it after the WebXR session begins. Buys the
   Quest.Performance.3 VRC *and* is half the shop.
3. **Ship free on the Horizon Store.** Bubblewrap, no billing, no
   `alphaDependencies`. Clear VRCs, IARC, age self-certification, privacy
   policy, Data Use Checkup on a build with no revenue riding on it.
4. **Settle the rights.** In parallel with 1–3, and slower than all of
   them. Nothing after this point can ship without it.
5. **Identity and entitlements.** Firestore collection + a verify
   function + a session token. Grant one free record through it end-to-end
   before any money moves.
6. **Turn on the till.** `horizonBilling` + `alphaDependencies` + the
   Application ID; durable add-ons in the Dashboard; test at the $0.01
   developer price.
7. **The web rail and account linking.** Paddle or Lemon Squeezy, plus the
   six-digit link code.
8. **Host unlocks the room.** Signed room-scoped stream URLs, and kill
   that silent `?? seeded pick` fallback for good.

---

## Still to verify

`developers.meta.com` was unreachable from this environment, so the
following came from search summaries rather than the source, and each one
should be confirmed against the live page before it is relied on:

- The exact current wording of the in-app-purchase and commerce clauses in
  **App policies**, and whether the "windows into an existing service"
  exception has moved.
- Whether Horizon Billing has left alpha since `1.0.0-alpha11`.
- The current PWA-specific VRC list, and the exact
  Quest.Performance.3 threshold.
- Quest Browser's actual storage quota for a PWA — Meta's guidance says
  only "avoid storing large assets locally", which for a 95 MB record box
  is not a number anyone can plan against. Measure it on-device with
  `navigator.storage.estimate()`.
- Whether `navigator.storage.persist()` is honoured in the packaged TWA.
