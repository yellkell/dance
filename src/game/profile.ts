/**
 * THE PROFILE — who this headset dances as.
 *
 * One name, persisted locally, born generic (RAVER-####) and renamed from
 * the board's profile card. It rides everything identity-shaped: the solo
 * leaderboards, the club's name tag over your head (net/session is handed
 * it at boot and on every rename), and whatever else ever needs to know
 * who set a score. A `?name=` share link still overrides the SESSION's
 * club tag without touching the stored profile.
 */

import { seatHue } from '../config.js';

const NAME_KEY = 'gdr-name';
const HUE_KEY = 'gdr-hue';
export const NAME_MAX = 12;

/** A coarse net over the worst of it — names ride a PUBLIC board now, and
 *  an arcade tag field with no filter at all becomes a billboard. It
 *  catches the obvious and nothing subtle; it is not moderation, and a
 *  board that ever gets real traffic needs a real report path. Matched
 *  against the name with separators stripped, so B-A-D reads as BAD. */
const BLOCKED = [
  'FUCK', 'SHIT', 'CUNT', 'NIGGER', 'NIGGA', 'FAGGOT', 'RAPE', 'NAZI',
  'HITLER', 'KKK', 'WHORE', 'SLUT', 'RETARD', 'BITCH', 'PEDO', 'DICK',
  'COCK', 'PUSSY', 'ANUS', 'TWAT', 'WANK',
];

export function nameIsClean(name: string): boolean {
  const flat = name.toUpperCase().replace(/[^A-Z]/g, '');
  return !BLOCKED.some((word) => flat.includes(word));
}

/** Uppercase arcade alphabet — exactly what the rename keyboard offers. */
export function sanitizeName(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9\- ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
}

function freshGenericName(): string {
  return `RAVER-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
}

let cached: string | null = null;

/** The stored name — minted generic on first ask and kept forever after. */
export function profileName(): string {
  if (cached) return cached;
  try {
    const stored = sanitizeName(localStorage.getItem(NAME_KEY) ?? '');
    if (stored) {
      cached = stored;
      return stored;
    }
  } catch {
    /* storage may be unavailable — mint per session */
  }
  cached = freshGenericName();
  try {
    localStorage.setItem(NAME_KEY, cached);
  } catch {
    /* fine */
  }
  return cached;
}

/* ── the colour ─────────────────────────────────────────────────────────── */

/**
 * YOUR COLOUR: the hue your platform, your sticks and your HUD wear.
 *
 * Seats hand out 24 distinct neons by a golden-angle walk, and that stays
 * the default — but a dancer who thinks of themselves as the green one
 * should get to be the green one on every stage. Stored as a hue (0..1),
 * null = whatever the seat says.
 *
 * It is a LOCAL preference and does not ride the wire: over in a room, the
 * others still see you in your seat's colour, so nobody can paint
 * themselves the same as the dancer beside them.
 */
let cachedHue: number | null | undefined;

export function profileHue(): number | null {
  if (cachedHue !== undefined) return cachedHue;
  try {
    const raw = localStorage.getItem(HUE_KEY);
    const n = raw === null ? NaN : Number(raw);
    cachedHue = Number.isFinite(n) && n >= 0 && n < 1 ? n : null;
  } catch {
    cachedHue = null;
  }
  return cachedHue;
}

/** Take a hue (0..1), or null to hand the colour back to the seat. */
export function setProfileHue(hue: number | null): void {
  cachedHue = hue === null ? null : ((hue % 1) + 1) % 1;
  try {
    if (cachedHue === null) localStorage.removeItem(HUE_KEY);
    else localStorage.setItem(HUE_KEY, cachedHue.toFixed(4));
  } catch {
    /* fine */
  }
}

/** The hue a dancer wears: yours if you picked one, else the seat's. */
export function danceHue(seat: number, isMine: boolean): number {
  const mine = isMine ? profileHue() : null;
  return mine === null ? seatHue(seat) : mine;
}

/** Rename: sanitised, persisted, empty (or blocked) keeps the old name. */
export function setProfileName(raw: string): string {
  const clean = sanitizeName(raw);
  if (!clean || !nameIsClean(clean)) return profileName();
  cached = clean;
  try {
    localStorage.setItem(NAME_KEY, clean);
  } catch {
    /* fine */
  }
  return clean;
}
