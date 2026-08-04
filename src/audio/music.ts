/**
 * THE DECKS — real-file music playback and the beat clock the whole game
 * runs on.
 *
 * The clock contract is unchanged from the synth days: something declares
 * "game beat 0 happens at AudioContext time T", and every system (telegraph
 * starts, landings, the GOOPLIATH's bounce, the lights) derives its timing
 * from `beatNow()`. What's new is that T is now pinned to a real recording:
 *
 *     beat 0  =  file start  +  track.downbeat  +  countIn beats
 *
 * Because an AudioBufferSourceNode plays at exactly 1.0 rate off the audio
 * hardware clock, the only error left is tempo precision — measured to
 * ±0.005 BPM, i.e. under 10 ms of drift across a four-minute set.
 *
 * Signal chain (per slot):  source → track gain (LUFS match) → music bus
 * (user volume) → limiter → out. The limiter is the safety net that lets a
 * −8 LUFS master and a −15.7 LUFS master share one mix without either
 * disappearing or clipping.
 *
 * If a file can't be decoded — a browser without AAC, a bad network — the
 * synthesised set from techno.ts takes over at the same BPM and the game
 * carries on. Nobody gets a silent raid.
 */

import { audioContext, ensureAudio, sfxOut } from './sfx.js';
import * as synth from './techno.js';
import { beatLenOf, trackGain, type Track } from './tracks.js';

const MUSIC_VOL_KEY = 'gdr-music-vol';

export type SetState = 'off' | 'loading' | 'scheduled' | 'playing' | 'synth';

export interface SetOptions {
  track: Track;
  /** Beats of count-in before game beat 0 (the "get ready" bars). */
  countInBeats: number;
  /** Set length in beats — the last landing lives before this. */
  endBeat: number;
  /** Seeds the fallback synth if the file won't decode. */
  seed: number;
  /** Musical intensity 0..3 for a beat (drives the fallback synth only). */
  actAt: (beat: number) => number;
  /** Online: the shared AudioContext time for beat 0. */
  beatZeroAt?: number;
  /**
   * Loop the record (rehearsals, which run until you clear them and can
   * outlast the song). The loop is cut to a whole number of BARS from the
   * first downbeat, so the audio re-enters exactly in phase and the beat
   * clock — which just keeps counting — stays true.
   */
  loop?: boolean;
}

let musicVol = ((): number => {
  try {
    const n = parseFloat(localStorage.getItem(MUSIC_VOL_KEY) ?? '');
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.6;
  } catch {
    return 0.6;
  }
})();

const buffers = new Map<string, AudioBuffer>();
const loading = new Map<string, Promise<AudioBuffer | null>>();

let bus: GainNode | null = null;
let limiter: DynamicsCompressorNode | null = null;

/** The live set slot. */
let setSrc: AudioBufferSourceNode | null = null;
let setGain: GainNode | null = null;
let setTrack: Track | null = null;
let beatZero = 0;
let beatLen = 0.5;
let state: SetState = 'off';
let setToken = 0; // guards against a slow decode landing after a new start

/** The lobby loop slot. */
let ambSrc: AudioBufferSourceNode | null = null;
let ambGain: GainNode | null = null;
let ambTrack: Track | null = null;
let ambZero = 0;
let ambToken = 0;

export function musicVolume(): number {
  return musicVol;
}

export function setMusicVolume(v: number): void {
  musicVol = Math.min(1, Math.max(0, v));
  try {
    localStorage.setItem(MUSIC_VOL_KEY, String(musicVol));
  } catch {
    /* storage may be unavailable */
  }
  if (bus) bus.gain.value = musicVol;
  synth.setMusicVolume(musicVol);
}

function ctx(): AudioContext | null {
  ensureAudio();
  return audioContext();
}

function chain(c: AudioContext): GainNode {
  if (bus) return bus;
  bus = c.createGain();
  bus.gain.value = musicVol;
  limiter = c.createDynamicsCompressor();
  // A brick-ish safety limiter: the masters here span 7.6 dB and a couple
  // of them already clip their own true peak, so the mix gets a net.
  limiter.threshold.value = -6;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  bus.connect(limiter);
  const out = sfxOut();
  limiter.connect(out ? out.context.destination : c.destination);
  return bus;
}

/** Fetch + decode a track (cached). Returns null if it can't be decoded. */
export function loadTrack(track: Track): Promise<AudioBuffer | null> {
  const hit = buffers.get(track.id);
  if (hit) return Promise.resolve(hit);
  const pending = loading.get(track.id);
  if (pending) return pending;

  const job = (async (): Promise<AudioBuffer | null> => {
    try {
      const c = ctx();
      if (!c) return null;
      const res = await fetch(track.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = await res.arrayBuffer();
      const buf = await c.decodeAudioData(bytes);
      buffers.set(track.id, buf);
      return buf;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[music] ${track.id} unavailable — falling back to the synth`, err);
      return null;
    } finally {
      loading.delete(track.id);
    }
  })();
  loading.set(track.id, job);
  return job;
}

/** Warm a track so the drop is instant (called from the lobby). */
export function preload(track: Track): void {
  void loadTrack(track);
}

export function setPlaybackState(): SetState {
  return state;
}

export function setRunning(): boolean {
  return state === 'playing' || state === 'scheduled' || state === 'synth';
}

/** Continuous song position in beats — negative through the count-in. */
export function beatNow(): number {
  if (state === 'synth') return synth.beatNow();
  if (state === 'off' || state === 'loading') return -Infinity;
  const c = audioContext();
  const now = c ? c.currentTime : performance.now() / 1000;
  if (state === 'scheduled' && now >= beatZero - beatLen * 0.5) state = 'playing';
  return (now - beatZero) / beatLen;
}

/** AudioContext time of a song beat — for scheduling one-shots on the grid. */
export function timeOfBeat(beat: number): number {
  return beatZero + beat * beatLen;
}

export function currentTrack(): Track | null {
  return setTrack;
}

/**
 * Drop the needle. Resolves the "beat 0 at time T" contract immediately when
 * the track is already decoded; otherwise it loads first and schedules as
 * soon as it can (an online set keeps its dictated beat-zero and simply
 * starts mid-file if the decode ran long).
 */
export function startSet(opts: SetOptions): void {
  stopSet(0.12);
  const token = ++setToken;
  const track = opts.track;
  setTrack = track;
  beatLen = beatLenOf(track);
  state = 'loading';

  const c = ctx();
  if (!c) {
    fallback(opts);
    return;
  }

  void loadTrack(track).then((buf) => {
    if (token !== setToken) return; // a newer set already started
    if (!buf) {
      fallback(opts);
      return;
    }
    const now = c.currentTime;
    const lead = 0.12;
    const fileZero = Math.max(track.downbeat, track.startAt ?? 0);
    // Where beat 0 lands: dictated online, else as soon as we can play.
    const zero = opts.beatZeroAt ?? now + lead + fileZero + opts.countInBeats * beatLen;
    // File time 0 must occur at (zero − fileZero − countIn).
    const fileStart = zero - fileZero - opts.countInBeats * beatLen;

    const gain = c.createGain();
    gain.gain.value = trackGain(track);
    gain.connect(chain(c));

    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(gain);
    if (opts.loop) {
      const bar = beatLen * 4;
      const bars = Math.floor((buf.duration - track.downbeat) / bar);
      if (bars >= 4) {
        src.loop = true;
        src.loopStart = track.downbeat;
        src.loopEnd = track.downbeat + bars * bar;
      }
    }
    if (fileStart >= now + 0.02) {
      src.start(fileStart);
    } else {
      // Late (slow decode, or a late join): skip into the file so the grid
      // stays exactly where the room agreed it would be.
      const offset = now + 0.02 - fileStart;
      if (offset < buf.duration) src.start(now + 0.02, offset);
      else return; // the set is already over — nothing to play
    }

    setSrc = src;
    setGain = gain;
    beatZero = zero;
    state = 'scheduled';
  });
}

/** The synth takes the set at the same tempo and the same beat-zero rules. */
function fallback(opts: SetOptions): void {
  const track = opts.track;
  beatLen = beatLenOf(track);
  beatZero = synth.startSet({
    bpm: track.bpm,
    countInBeats: opts.countInBeats,
    endBeat: opts.endBeat,
    seed: opts.seed,
    actAt: opts.actAt,
    beatZeroAt: opts.beatZeroAt,
  });
  state = 'synth';
}

export function stopSet(fade = 0.5): void {
  setToken++;
  if (state === 'synth') synth.stopSet(fade);
  const c = audioContext();
  const src = setSrc;
  const gain = setGain;
  setSrc = null;
  setGain = null;
  setTrack = null;
  state = 'off';
  if (!c || !src || !gain) return;
  const now = c.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(0.0001, now + fade);
  try {
    src.stop(now + fade + 0.05);
  } catch {
    /* already stopped */
  }
}

/* ── the lobby loop ─────────────────────────────────────────────────────── */

/**
 * The room is never dead: the soft track loops under the lobby and the
 * rehearsal map at reduced level, and publishes its own beat so the mirror
 * ball, the lasers and the GOOPLIATH's idle bounce are already grooving
 * before anyone starts a set.
 */
export function startAmbient(track: Track, level = 0.55): void {
  if (ambTrack?.id === track.id && ambSrc) return;
  stopAmbient(0.3);
  const token = ++ambToken;
  ambTrack = track;

  const c = ctx();
  if (!c) return;
  void loadTrack(track).then((buf) => {
    if (token !== ambToken || !buf) return;
    const gain = c.createGain();
    gain.gain.value = trackGain(track) * level;
    gain.connect(chain(c));
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    // Loop the musical body, not the file: out of the last whole bar, back
    // to the first downbeat — so the lobby groove never hiccups.
    const bar = beatLenOf(track) * 4;
    const bars = Math.floor((buf.duration - track.downbeat) / bar);
    src.loopStart = track.downbeat;
    src.loopEnd = track.downbeat + bars * bar;
    src.connect(gain);
    const at = c.currentTime + 0.1;
    src.start(at);
    ambSrc = src;
    ambGain = gain;
    ambZero = at + track.downbeat;
  });
}

export function stopAmbient(fade = 0.4): void {
  ambToken++;
  const c = audioContext();
  const src = ambSrc;
  const gain = ambGain;
  ambSrc = null;
  ambGain = null;
  ambTrack = null;
  if (!c || !src || !gain) return;
  const now = c.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(0.0001, now + fade);
  try {
    src.stop(now + fade + 0.05);
  } catch {
    /* already stopped */
  }
}

export function ambientRunning(): boolean {
  return ambSrc !== null;
}

/** The lobby loop's beat position — the club's idle pulse. */
export function ambientBeat(): number {
  const c = audioContext();
  if (!ambSrc || !ambTrack || !c) return -Infinity;
  return (c.currentTime - ambZero) / beatLenOf(ambTrack);
}
