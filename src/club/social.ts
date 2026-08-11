/**
 * Club social safety state: who YOU have muted or blocked, persisted across
 * nights. Keyed by DANCER NAME (lowercased) — the one stable handle across
 * visits (relay member indices are per-session). Same law as FIRE FIGHT's
 * club, same store shape:
 *
 *   MUTE  — you stop hearing their voice; they stay visible.
 *   BLOCK — mute plus their figure and name tag vanish for you.
 *
 * Both are strictly LOCAL (nothing crosses the wire); the A-button SOCIAL
 * panel edits them, ClubSocialSystem applies them every frame.
 */

import { SOCIAL_KEYS } from './config.js';

function load(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return new Set((JSON.parse(raw) as string[]).map((n) => n.toLowerCase()));
  } catch {
    /* fresh slate */
  }
  return new Set();
}

function save(key: string, set: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    /* session-only */
  }
}

const muted = load(SOCIAL_KEYS.muted);
const blocked = load(SOCIAL_KEYS.blocked);

const keyOf = (name: string): string => name.trim().toLowerCase();

export function socialMuted(name: string): boolean {
  return muted.has(keyOf(name));
}

export function socialBlocked(name: string): boolean {
  return blocked.has(keyOf(name));
}

export function toggleSocialMute(name: string): void {
  const k = keyOf(name);
  if (!k) return;
  if (muted.has(k)) muted.delete(k);
  else muted.add(k);
  save(SOCIAL_KEYS.muted, muted);
}

export function toggleSocialBlock(name: string): void {
  const k = keyOf(name);
  if (!k) return;
  if (blocked.has(k)) blocked.delete(k);
  else blocked.add(k);
  save(SOCIAL_KEYS.blocked, blocked);
}
