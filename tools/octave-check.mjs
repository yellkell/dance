#!/usr/bin/env node
/**
 * Tempo OCTAVE check — is the analyser's answer the beat, or a subdivision
 * of it?
 *
 *   node tools/octave-check.mjs <bpm> <file> [<bpm> <file> …]
 *
 * The fine sweep in `analyze-track` only searches ±4%, so it can lock a
 * grid that is a clean fraction of the real one and never notice — which is
 * exactly what happened to DISCO BALL, measured at 73.33 when the kicks
 * were on 110 (see the note in audio/tracks.ts).
 *
 * The tell is ALTERNATION. Put a grid at twice the candidate tempo: if the
 * beats it adds land on real onsets, the faster grid is the true one. If
 * they land in the gaps, the slower one was right and the added beats are
 * just quiet. So compare the mean onset energy on the beats a candidate
 * SHARES with the candidate below it against the beats it ADDS.
 */

import { execFileSync } from 'node:child_process';

const SR = 22050;
const HOP = 512;
const FPS = SR / HOP;

const args = process.argv.slice(2);
if (args.length < 2 || args.length % 2) {
  console.error('usage: node tools/octave-check.mjs <bpm> <file> [<bpm> <file> …]');
  process.exit(1);
}

function decodeMono(file) {
  const raw = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'],
    { maxBuffer: 1 << 30 },
  );
  return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
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
  return flux;
}

const sampleAt = (flux, t) => {
  const i = Math.floor(t);
  if (i < 0 || i + 1 >= flux.length) return 0;
  const fr = t - i;
  return flux[i] * (1 - fr) + flux[i + 1] * fr;
};

function gridScore(flux, bpm, ph) {
  const period = (60 / bpm) * FPS;
  let s = 0;
  let k = 0;
  for (let t = ph; t < flux.length - 1; t += period, k++) s += sampleAt(flux, t);
  return k ? s / k : 0;
}

function bestPhase(flux, bpm) {
  const period = (60 / bpm) * FPS;
  let best = { ph: 0, score: -Infinity };
  for (let ph = 0; ph < period; ph += 0.25) {
    const score = gridScore(flux, bpm, ph);
    if (score > best.score) best = { ph, score };
  }
  return best;
}

/** Mean onset energy on the beats a doubled grid ADDS (the off-beats). */
function offbeatScore(flux, bpm, ph) {
  const period = (60 / bpm) * FPS;
  let s = 0;
  let k = 0;
  for (let t = ph + period / 2; t < flux.length - 1; t += period, k++) s += sampleAt(flux, t);
  return k ? s / k : 0;
}

for (let a = 0; a < args.length; a += 2) {
  const bpm = Number(args[a]);
  const file = args[a + 1];
  const flux = fluxOf(decodeMono(file));
  const mean = flux.reduce((s, v) => s + v, 0) / flux.length;

  console.log(`\n${file}  (analyser said ${bpm})`);
  const cands = [bpm, bpm * 1.5, bpm * 2, bpm * 3];
  let verdict = bpm;
  for (const c of cands) {
    if (c > 210) continue;
    const { ph, score } = bestPhase(flux, c);
    const off = offbeatScore(flux, c, ph);
    // "on" is the grid itself; "added" is what a doubling of it would add.
    const ratio = off / (score || 1e-9);
    console.log(
      `  ${c.toFixed(3).padStart(8)} BPM  on-grid ${(score / mean).toFixed(2)}×mean` +
        `   its own off-beats ${(off / mean).toFixed(2)}×mean   (added/on = ${ratio.toFixed(2)})`,
    );
    // If the off-beats of candidate c are nearly as strong as its beats,
    // the real pulse is twice c.
    if (c === verdict && ratio > 0.8) verdict = c * 2;
  }
  console.log(`  → beats look like ${verdict} BPM${verdict !== bpm ? '  ** the analyser was an octave (or third) low **' : ''}`);
}
