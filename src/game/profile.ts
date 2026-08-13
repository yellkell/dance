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

/** Rename: sanitised, persisted, empty falls back to the current name. */
export function setProfileName(raw: string): string {
  const clean = sanitizeName(raw);
  if (!clean) return profileName();
  cached = clean;
  try {
    localStorage.setItem(NAME_KEY, clean);
  } catch {
    /* fine */
  }
  return clean;
}
