/**
 * THE CONDUCTOR — one clock owns the ride, and one small procedural kit
 * plays over it.
 *
 * The transport advances on SIMULATION delta, not the wall clock: departures,
 * countdowns, wayfinding and lights all read `bars`, so the music and the
 * floor can never disagree about when a platform leaves.
 *
 * The kit is synthesised rather than played off a record — a four-minute
 * master would have to be cut to a lap length nobody has run yet, and the
 * one thing the drone has to do is CLIMB with you: the root rises seven
 * semitones between the floor and the skywalk, which is the well's descent
 * from the movement notes played the other way up (research/01 §6). It hangs
 * off the club's own AudioContext and the user's music fader, so the door
 * doesn't open a second mixer nobody can turn down.
 */

import { audioContext, ensureAudio } from '../audio/sfx.js';
import { musicBus } from '../audio/music.js';
import { MUSIC } from './config.js';

const BEAT_SEC = 60 / MUSIC.bpm;
const BAR_SEC = BEAT_SEC * MUSIC.beatsPerBar;
const LOOKAHEAD_SEC = 0.14;

class Conductor {
  bars = 0;
  playing = false;

  private ctx: AudioContext | undefined;
  private master: GainNode | undefined;
  private crush!: BiquadFilterNode;
  private droneOsc: OscillatorNode[] = [];
  private droneGain!: GainNode;
  private noiseBuf!: AudioBuffer;
  private scheduledBeat8 = -1; // last scheduled eighth-note index
  private climb01 = 0;
  private arpLevel = 0;

  get barPhase(): number {
    return this.bars - Math.floor(this.bars);
  }

  advance(dt: number): void {
    if (!this.playing) return;
    this.bars += dt / BAR_SEC;
    this.schedule();
  }

  /** The door opens: take the clock back to the start line and wake the kit. */
  start(): void {
    this.bars = 0;
    this.scheduledBeat8 = -1;
    this.playing = true;
    this.build();
    if (this.master) this.master.gain.setTargetAtTime(0.85, this.ctx!.currentTime, 0.08);
  }

  /** The door closes: the void goes quiet without ever cutting a tail short. */
  stop(): void {
    this.playing = false;
    if (this.ctx && this.master) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.12);
    }
  }

  /** 0 on the floor → 1 at the skywalk; the drone root rises with it. */
  setClimb(climb01: number): void {
    this.climb01 = Math.min(1, Math.max(0, climb01));
  }

  setArpLevel(level01: number): void {
    this.arpLevel = Math.min(1, Math.max(0, level01));
  }

  private ready(): boolean {
    return !!this.ctx && !!this.master && this.ctx.state === 'running';
  }

  /** Build the graph on the club's context (idempotent). */
  private build(): void {
    if (this.ctx) return;
    ensureAudio();
    const ctx = audioContext();
    const out = musicBus();
    if (!ctx || !out) return;
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.crush = ctx.createBiquadFilter();
    this.crush.type = 'lowpass';
    this.crush.frequency.value = 16000;
    this.master.connect(this.crush).connect(out);

    const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.2), ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = noise;

    // The drone: two detuned saws through a slow lowpass. Its root follows
    // the climb — the void brightens in pitch as you rise through it.
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0.05;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 480;
    this.droneGain.connect(lp).connect(this.master);
    for (const mult of [1, 1.5]) {
      for (const cents of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = 55 * mult;
        o.detune.value = cents;
        o.connect(this.droneGain);
        o.start();
        this.droneOsc.push(o);
      }
    }
  }

  private schedule(): void {
    if (!this.ready()) {
      this.build();
      if (!this.ready()) return;
    }
    const ctx = this.ctx!;
    const beat8Now = this.bars * MUSIC.beatsPerBar * 2;
    const target = Math.floor(beat8Now + (LOOKAHEAD_SEC / BEAT_SEC) * 2);
    if (this.scheduledBeat8 < Math.floor(beat8Now) - 4) {
      this.scheduledBeat8 = Math.floor(beat8Now) - 1; // dropped frames: skip, don't burst
    }
    const root = 55 * Math.pow(2, (7 / 12) * this.climb01);
    for (const [i, o] of this.droneOsc.entries()) {
      const mult = i < 2 ? 1 : 1.5;
      o.frequency.setTargetAtTime(root * mult, ctx.currentTime, 0.6);
    }
    while (this.scheduledBeat8 < target) {
      this.scheduledBeat8++;
      const b8 = this.scheduledBeat8;
      const at = ctx.currentTime + Math.max(0.005, (b8 / 2 - beat8Now / 2) * BEAT_SEC);
      if (b8 % 2 === 0) this.kick(at, (b8 / 2) % MUSIC.beatsPerBar === 0);
      this.hat(at, b8 % 2 === 1);
      if (this.arpLevel > 0) this.arp(at, b8);
    }
  }

  private kick(at: number, downbeat: boolean): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(downbeat ? 170 : 145, at);
    o.frequency.exponentialRampToValueAtTime(46, at + 0.08);
    g.gain.setValueAtTime(downbeat ? 0.62 : 0.44, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.22);
    o.connect(g).connect(this.master!);
    o.start(at);
    o.stop(at + 0.24);
  }

  private hat(at: number, off: boolean): void {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7800 - this.climb01 * 800;
    const g = ctx.createGain();
    const base = off ? 0.055 : 0.095;
    g.gain.setValueAtTime(base * (1 + this.climb01 * 0.3), at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.05);
    s.connect(hp).connect(g).connect(this.master!);
    s.start(at);
    s.stop(at + 0.06);
  }

  private static ARP = [0, 7, 3, 5, 0, 10, 7, 12];
  private arp(at: number, b8: number): void {
    const ctx = this.ctx!;
    const semis = Conductor.ARP[b8 % Conductor.ARP.length];
    const root = 220 * Math.pow(2, (7 / 12) * this.climb01);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = root * Math.pow(2, semis / 12);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1300;
    bp.Q.value = 2.2;
    g.gain.setValueAtTime(0.055 * this.arpLevel, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.11);
    o.connect(bp).connect(g).connect(this.master!);
    o.start(at);
    o.stop(at + 0.12);
  }

  /** A clean handover: the pentatonic step, climbing with flow. */
  chime(step: number): void {
    if (!this.ready()) return;
    const ctx = this.ctx!;
    const at = ctx.currentTime + 0.01;
    const penta = [0, 3, 5, 7, 10];
    const f = 440 * Math.pow(2, penta[step % penta.length] / 12);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    const m = ctx.createOscillator();
    const mg = ctx.createGain();
    m.frequency.value = f * 2.01;
    mg.gain.value = 90;
    m.connect(mg).connect(o.frequency);
    g.gain.setValueAtTime(0.12, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.7);
    o.connect(g).connect(this.master!);
    o.start(at);
    m.start(at);
    o.stop(at + 0.75);
    m.stop(at + 0.75);
  }

  /** Departure countdown click; pitch climbs as the beats run out. */
  tick(beatsLeft: number): void {
    if (!this.ready()) return;
    const ctx = this.ctx!;
    const at = ctx.currentTime + 0.005;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = 900 + (4 - Math.min(4, beatsLeft)) * 180;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2100;
    bp.Q.value = 5;
    g.gain.setValueAtTime(0.07, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.06);
    o.connect(bp).connect(g).connect(this.master!);
    o.start(at);
    o.stop(at + 0.07);
  }

  /** A slip: the ground went without you. The whole mix ducks dark for a
   *  beat — the miss is audible as absence. */
  thud(): void {
    if (!this.ready()) return;
    const ctx = this.ctx!;
    const at = ctx.currentTime + 0.005;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 240;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.3);
    s.connect(lp).connect(g).connect(this.master!);
    s.start(at);
    s.stop(at + 0.32);
    this.crush.frequency.cancelScheduledValues(at);
    this.crush.frequency.setValueAtTime(700, at);
    this.crush.frequency.exponentialRampToValueAtTime(16000, at + 0.9);
  }

  /** A lap closes: one deep bell over the drone. */
  bell(step: number): void {
    if (!this.ready()) return;
    const ctx = this.ctx!;
    const at = ctx.currentTime + 0.01;
    const penta = [0, 3, 5, 7, 10];
    const f = 220 * Math.pow(2, penta[step % penta.length] / 12);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    const m = ctx.createOscillator();
    const mg = ctx.createGain();
    m.frequency.value = f * 1.41; // inharmonic partial: bell, not chime
    mg.gain.value = 160;
    m.connect(mg).connect(o.frequency);
    g.gain.setValueAtTime(0.17, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 1.8);
    o.connect(g).connect(this.master!);
    o.start(at);
    m.start(at);
    o.stop(at + 1.9);
    m.stop(at + 1.9);
  }
}

export const conductor = new Conductor();
