#!/usr/bin/env node
/**
 * Track analyser — prints a ready-to-paste `TRACKS` row for a music file.
 *
 *   npm run analyze -- src/assets/music/newtune.m4a [more.mp3 …]
 *
 * Measures the three things audio/tracks.ts needs, because the whole game is
 * quantized to them and guessing any one of them is felt immediately:
 *
 *   bpm       onset-flux autocorrelation for a coarse tempo, then a fine
 *             sweep (±4%, 0.005 BPM steps) scored by how much onset energy
 *             lands on that grid across the WHOLE track. Locking over
 *             hundreds of beats is what pins the tempo tightly enough that a
 *             four-minute set doesn't drift off the kick.
 *   downbeat  beat phase, then a 4-beat vote for which beat of the bar is
 *             the downbeat (downbeats hit hardest). Eyeball this one.
 *   lufs      EBU R128 integrated loudness, for gain-matching at playback.
 *
 * Requires ffmpeg on PATH.
 */

import { execFileSync } from 'node:child_process';
import { basename, extname } from 'node:path';

const SR = 22050;
const HOP = 512;
const FPS = SR / HOP;

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: npm run analyze -- <audio file> [...]');
  process.exit(1);
}

function ffmpeg(args, opts = {}) {
  return execFileSync('ffmpeg', args, { maxBuffer: 1 << 30, ...opts });
}

function decodeMono(file) {
  const raw = ffmpeg(['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-']);
  return new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 4));
}

function duration(file) {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
    { encoding: 'utf8' },
  );
  return parseFloat(out.trim());
}

function loudnessOf(file) {
  // ffmpeg writes the ebur128 summary to stderr, success or not.
  const text = execFileSync(
    'sh',
    ['-c', `ffmpeg -hide_banner -nostats -i ${JSON.stringify(file)} -af ebur128=peak=true -f null - 2>&1`],
    { encoding: 'utf8', maxBuffer: 1 << 28 },
  );
  const m = text.match(/Integrated loudness[\s\S]*?I:\s*(-?[\d.]+)\s*LUFS/);
  const p = text.match(/True peak[\s\S]*?Peak:\s*(-?[\d.]+)\s*dBFS/);
  return { lufs: m ? parseFloat(m[1]) : NaN, truePeak: p ? parseFloat(p[1]) : NaN };
}

function fluxOf(x) {
  const frames = Math.floor(x.length / HOP);
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let e = 0;
    const s = f * HOP;
    for (let i = s; i < s + HOP; i++) e += x[i] * x[i];
    energy[f] = e / HOP;
  }
  const flux = new Float32Array(frames);
  for (let f = 1; f < frames; f++) {
    const d = Math.log(energy[f] + 1e-10) - Math.log(energy[f - 1] + 1e-10);
    flux[f] = d > 0 ? d : 0;
  }
  return { energy, flux };
}

/** Mean onset energy landing on the grid of `bpm` at frame phase `ph`. */
function gridScore(flux, bpm, ph) {
  const period = (60 / bpm) * FPS;
  let s = 0;
  let k = 0;
  for (let t = ph; t < flux.length - 1; t += period, k++) {
    const i = Math.floor(t);
    const fr = t - i;
    s += flux[i] * (1 - fr) + flux[i + 1] * fr;
  }
  return k ? s / k : 0;
}

function bestPhase(flux, bpm, step = 0.25) {
  const period = (60 / bpm) * FPS;
  let best = { ph: 0, score: -Infinity };
  for (let ph = 0; ph < period; ph += step) {
    const score = gridScore(flux, bpm, ph);
    if (score > best.score) best = { ph, score };
  }
  return best;
}

for (const file of files) {
  const x = decodeMono(file);
  const { energy, flux } = fluxOf(x);
  const frames = flux.length;

  let mean = 0;
  for (let f = 0; f < frames; f++) mean += flux[f];
  mean /= frames;
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) env[f] = flux[f] - mean;

  const lagFor = (bpm) => (60 / bpm) * FPS;
  const minLag = Math.floor(lagFor(190));
  const maxLag = Math.ceil(lagFor(60));
  const ac = new Map();
  let peak = { lag: minLag, s: -Infinity };
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    const count = frames - lag;
    for (let f = 0; f < count; f++) s += env[f] * env[f + lag];
    s /= count;
    ac.set(lag, s);
    if (s > peak.s) peak = { lag, s };
  }
  let coarse = (60 * FPS) / peak.lag;
  // Fold tempo octaves into the danceable range.
  for (const mult of [4, 2, 0.5, 0.25]) {
    const cand = coarse * mult;
    if (cand < 100 || cand > 180) continue;
    const l = Math.round(lagFor(cand));
    if (l >= minLag && l <= maxLag && (ac.get(l) ?? -Infinity) > peak.s * 0.4) coarse = cand;
  }

  let fine = { bpm: coarse, score: -Infinity, ph: 0 };
  for (let bpm = coarse * 0.96; bpm <= coarse * 1.04; bpm += 0.005) {
    const { ph, score } = bestPhase(flux, bpm);
    if (score > fine.score) fine = { bpm, score, ph };
  }
  // An exact integer that scores within a whisker is the likelier truth.
  const rounded = Math.round(fine.bpm);
  const roundedFit = bestPhase(flux, rounded);
  if (roundedFit.score >= fine.score * 0.995) {
    fine = { bpm: rounded, score: roundedFit.score, ph: roundedFit.ph };
  }

  const bpm = fine.bpm;
  const beatLen = 60 / bpm;
  const period = beatLen * FPS;

  let bar = { b: 0, s: -Infinity };
  for (let b = 0; b < 4; b++) {
    let s = 0;
    let k = 0;
    for (let t = fine.ph + b * period; t < frames - 1; t += period * 4, k++) s += flux[Math.floor(t)];
    if (k && s / k > bar.s) bar = { b, s: s / k };
  }
  let downbeat = (fine.ph + bar.b * period) / FPS;
  while (downbeat >= beatLen * 4) downbeat -= beatLen * 4;

  // Grid confidence: on-grid onset energy vs the track average. Comfortably
  // above 1 means the tempo is locked; near 1 means don't trust it.
  let avg = 0;
  for (let f = 0; f < frames; f++) avg += flux[f];
  avg /= frames;
  const confidence = gridScore(flux, bpm, fine.ph) / (avg || 1);

  const secs = duration(file);
  const { lufs, truePeak } = loudnessOf(file);
  const id = basename(file, extname(file)).toLowerCase().replace(/[^a-z0-9]/g, '');
  const countIn = 8;
  const zero = downbeat + countIn * beatLen;
  const phrases = Math.max(2, Math.floor(((secs - zero) / beatLen - 4) / 32));

  console.log(`\n// ${basename(file)} — grid confidence ${confidence.toFixed(2)}, true peak ${truePeak} dBFS`);
  console.log(`// ≈ ${phrases} phrases of set (${(secs / 60).toFixed(1)} min)`);
  console.log(`  {
    id: '${id}',
    title: '${id.toUpperCase()}',
    url: ${id}Url,
    bpm: ${Number.isInteger(bpm) ? bpm.toFixed(1) : bpm.toFixed(3)},
    downbeat: ${downbeat.toFixed(4)},
    seconds: ${secs.toFixed(2)},
    lufs: ${lufs},
    roles: ['raid'],
  },`);
}
