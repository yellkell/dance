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

const NAME_KEY = 'gdr-name';
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
