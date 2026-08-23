/**
 * HudSystem — your numbers, OUT of your sightline. A small readout floats
 * off to your LEFT at a natural glance height, turned toward you like a
 * monitor wedge at a gig: the score, the ×multiplier (only while a chain
 * is alive) and the GROOVE row. No labels, no words, and NO LIFE COUNTER —
 * you dance the whole record. The centre of your view belongs to the
 * giant and the blocks.
 *
 * THE CHAIN WARNING is the exception, and it is silent until it matters:
 * take a hit and a row of marks appears, one lit per clipped landing back
 * to back. Three and the night is over. Dodge once and the row vanishes
 * as if it never happened — because the count didn't survive either.
 *
 * THE GRADE takes the centre when the record ends: one big letter, S to
 * F, with the share of landings you survived under it.
 *
 * THE GROOVE ROW is how you see the combo catch: four pips light one per
 * rhythmic swap as it winds up — and once it's running the pips KEEP
 * DANCING: the cycle walks 1-2-3-4 with your swaps, and the pip whose
 * turn it is hops with a lens-glint sparkle, with the points the streak
 * has paid beside. It dies with the streak, so the row always reads
 * "this run". The sparks off the sticks are still the loud half of the
 * answer; this is the quiet ledger.
 *
 * The count-in and the final grade take the centre — they're cards you
 * READ while nothing is trying to kill you — and the flair pops
 * (PERFECT! / HIT) ride high off to the right, where they can shout
 * without standing between you and the next landing.
 *
 * NO PANELS. Menus get panels, gameplay gets ink: every glyph wears a
 * thick near-black casing so it reads against the void, the lasers, and
 * the gel creature all at once.
 */

import { createSystem, Vector3 } from '@iwsdk/core';
import {
  CanvasTexture,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from 'three';
import { GRADE, SCORE, TOUR } from '../config.js';
import { trackById } from '../audio/tracks.js';
import { danceHue } from '../game/profile.js';
import { dodgeRate, type Flair, gradeOf, match, me, showBeat } from '../game/state.js';
import { font } from '../ui/fonts.js';

const SET_COLORS = ['#8cff70', '#ff6ee0', '#ffd24a'];

/** The centre card (count-in / grade). */
const CW = 768;
const CH = 384;
/** The wedge strip (live readout). */
const SW = 512;
const SH = 288;
/** The groove's own colour — electric ice, never the seat's, so the two
 *  never blur. Turquoise, per the boss. */
const GROOVE_CSS = '#1cf5c9';
/** THE ALARM: getting clipped. One red, shared by the HIT pop and the
 *  chain marks so the two always read as the same event — and a deep,
 *  full-chroma one: the old coral sat too light to alarm anybody. */
const ALARM_CSS = '#ff0033';

const _head = new Vector3();

/** Heavy club lettering: a thick near-black casing, then the colour. */
function ink(
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  px: number,
  fill: string,
  maxWidth?: number,
): void {
  g.font = font(700, px);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.lineWidth = Math.max(6, px * 0.22);
  g.strokeStyle = 'rgba(0,2,6,0.96)';
  if (maxWidth) g.strokeText(text, x, y, maxWidth);
  else g.strokeText(text, x, y);
  g.fillStyle = fill;
  if (maxWidth) g.fillText(text, x, y, maxWidth);
  else g.fillText(text, x, y);
}

/** Ink with a neon halo — the same casing, then the colour BLOOMS. The
 *  whites stay white; everything coloured earns a glow of its own hue,
 *  which is where the vibrance lives (a saturated fill with no bloom
 *  reads as flat print, not light).
 *
 *  TWO bloom passes, wide then tight. One pass is a haze around a letter;
 *  two compound into something that reads as actually emitting, which is
 *  the difference between a coloured numeral and a lit one. */
function neon(
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  px: number,
  fill: string,
  glow = fill,
  maxWidth?: number,
): void {
  ink(g, text, x, y, px, fill, maxWidth);
  g.fillStyle = fill;
  g.font = font(700, px);
  g.shadowColor = glow;
  for (const blur of [Math.max(20, px * 0.55), Math.max(11, px * 0.24)]) {
    g.shadowBlur = blur;
    if (maxWidth) g.fillText(text, x, y, maxWidth);
    else g.fillText(text, x, y);
  }
  g.shadowBlur = 0;
}

/** A seat's colour at FULL neon: hue straight to hsl, no muddying through
 *  the palette's dimmer value curve. */
function seatNeonCss(hue: number): string {
  return `hsl(${Math.round(hue * 360)}, 100%, 62%)`;
}

/**
 * THE POP'S KICK — an underdamped spring settling on 1, the same language
 * the boss's hands are written in (game/poseMotion.ts). It arrives PAST its
 * mark and rocks back instead of easing politely up to size, so a pop lands
 * as a punch rather than a fade-in — and one arriving on the tail of the
 * last re-kicks instead of sliding. Starts near 0.58, tops out ~13% over at
 * ~0.13 s, and is home well inside the 0.9 s the pop holds before it fades.
 *
 * Exported because it cannot be audited any other way: a container's
 * software GL runs this scene at about three frames a second, so the whole
 * bounce lives inside a single frame there and sampling the live plane
 * proves nothing about its shape. tools/perfect-pop.mjs reads the curve
 * straight from here.
 */
export function popScale(age: number): number {
  return 1 - 0.42 * Math.exp(-age * 9) * Math.cos(age * 24);
}

export class HudSystem extends createSystem({}) {
  /** The centre card: count-in, "cueing", the final grade. */
  private cardCanvas = document.createElement('canvas');
  private cardTex!: CanvasTexture;
  private card!: Mesh;
  /** The monitor wedge: the live readout, low off the front-left rim. */
  private stripCanvas = document.createElement('canvas');
  private stripTex!: CanvasTexture;
  private strip!: Mesh;
  /** A plane, not a Sprite — flair text must never roll with the head. */
  private flair!: Mesh;
  private flairMat!: MeshBasicMaterial;
  private flairCanvas = document.createElement('canvas');
  private flairTex!: CanvasTexture;
  private flairAge = 9;
  private lastKey = '';

  init(): void {
    this.cardCanvas.width = CW;
    this.cardCanvas.height = CH;
    this.cardTex = new CanvasTexture(this.cardCanvas);
    this.card = new Mesh(
      new PlaneGeometry(0.9, 0.45),
      new MeshBasicMaterial({ map: this.cardTex, transparent: true, side: DoubleSide, depthWrite: false }),
    );
    this.card.renderOrder = 30;
    this.card.position.set(0, 0.62, -1.06);
    this.card.rotation.x = -0.5;
    this.scene.add(this.card);

    this.stripCanvas.width = SW;
    this.stripCanvas.height = SH;
    this.stripTex = new CanvasTexture(this.stripCanvas);
    this.strip = new Mesh(
      new PlaneGeometry(0.5, 0.28),
      new MeshBasicMaterial({ map: this.stripTex, transparent: true, side: DoubleSide, depthWrite: false }),
    );
    this.strip.renderOrder = 30;
    // Glance height, not floor height: off the left shoulder, a little
    // below eye line, where a look costs a flick of the eyes and never a
    // drop of the chin. Everything on it is CENTRED in the plane — content
    // pushed to the outer edge would sit further into the periphery than
    // the wedge itself, which is how the first pass hid its own numbers.
    this.strip.position.set(-0.52, 1.2, -0.9);
    this.scene.add(this.strip);

    this.flairCanvas.width = 512;
    this.flairCanvas.height = 160;
    this.flairTex = new CanvasTexture(this.flairCanvas);
    this.flairMat = new MeshBasicMaterial({
      map: this.flairTex,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    // Smaller than it was, and BENEATH the wedge instead of floating high
    // right: the pop and the numbers it explains now live in one glance,
    // and the action line above stays clear.
    this.flair = new Mesh(new PlaneGeometry(0.76, 0.24), this.flairMat);
    this.flair.renderOrder = 31;
    this.flair.position.set(-0.52, 0.93, -0.88);
    this.scene.add(this.flair);
  }

  update(delta: number): void {
    const inSet = match.screen === 'countdown' || match.screen === 'raid';
    // The record is over: the grade owns the centre while the board reads
    // out the ranks behind it.
    const podium = match.screen === 'podium';
    _head.set(match.headX, match.headY, match.headZ);

    // Flair pops.
    const next = match.flairs.shift();
    if (next) {
      this.drawFlair(next.text, next.tone);
      this.flairAge = 0;
    }
    this.flairAge += delta;
    const t = this.flairAge;
    const fade = Math.max(0, 1 - Math.max(0, t - 0.9) / 0.5);
    this.flair.visible = inSet && fade > 0;
    if (this.flair.visible) this.flair.lookAt(_head);
    // THE KICK (see popScale). Every pop resets the age, so each change
    // bounces on its own — a perfect landing on the tail of the last one
    // re-kicks rather than sliding quietly to the new number.
    const pop = popScale(t);
    this.flair.scale.set(pop, pop, 1);
    this.flairMat.opacity = fade;

    // The count-in and the final grade take the centre; the live game gets
    // the wedge.
    const cardUp = podium || (inSet && match.screen === 'countdown');
    this.card.visible = cardUp;
    this.strip.visible = inSet && !cardUp;
    if (this.strip.visible) this.strip.lookAt(_head);
    if (cardUp) {
      // The count-in and the grade are MOMENTS — hang them at eye line,
      // big, facing you. Nothing else is happening; nothing is blocked.
      this.card.position.set(0, 1.42, -1.55);
      this.card.scale.setScalar(podium ? 1.5 : 1.3);
      this.card.lookAt(_head);
    }

    if (!inSet && !podium) return;

    const d = me();
    const beat = match.beat;
    const countdown = match.screen === 'countdown' && Number.isFinite(beat) && beat < 0;
    // The count-in counts the RECORD's beats — a doubled chart's count of
    // eight eighths ticked past like a stopwatch; four real beats is a
    // count-in you can nod to.
    const count = countdown ? Math.ceil(-showBeat()) : 0;
    const key = [
      match.screen,
      count,
      Number.isFinite(match.beat), // the "cueing the record" card
      match.trackId,
      match.mySeat,
      d?.score,
      d?.combo,
      d?.hits,
      d?.missChain,
      d?.dodges,
      d?.alive,
      match.grooveStreak,
      match.grooveScore,
      // The RUNNING groove animates (the turn pip hops on every swap), so
      // while it runs the strip repaints on a sub-beat clock — ten frames
      // a beat — and not at all when the row is cold or winding up.
      match.grooveStreak > 4 ? Math.floor((showBeat() % 1) * 10) : -1,
    ].join(':');
    if (key !== this.lastKey) {
      this.lastKey = key;
      if (podium) this.drawGrade();
      else if (cardUp) this.drawCard(count);
      else this.drawStrip();
    }
  }

  /* ── the grade: what the night actually earned you ────────────────────── */

  private drawGrade(): void {
    const g = this.cardCanvas.getContext('2d')!;
    g.clearRect(0, 0, CW, CH);
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    const d = me();
    if (!d) {
      this.cardTex.needsUpdate = true;
      return;
    }
    const letter = gradeOf(d);
    const color = GRADE.colors[letter] ?? '#f4f6fb';
    const faced = d.dodges + d.hits;

    // The letter needs no introduction — a giant glowing grade IS the
    // headline ("THE SET SAYS" above it was saying nothing). Only a
    // chain-out still earns one: GAME OVER explains why the night ended
    // early and why the letter under it is an F.
    if (!d.alive) ink(g, 'GAME OVER', CW / 2, 46, 32, '#ff5040');
    // The letter, huge, with its own halo.
    g.shadowColor = color;
    g.shadowBlur = 40;
    ink(g, letter, CW / 2, CH / 2 + 6, 190, color);
    g.shadowBlur = 0;
    // The number behind the letter, so the grade is never a mystery.
    ink(
      g,
      faced > 0 ? `${d.dodges}/${faced} CLEAN · ${Math.round(dodgeRate(d) * 100)}%` : 'NOTHING THROWN',
      CW / 2,
      CH - 66,
      30,
      'rgba(240,244,250,1)',
    );
    if (d.perfects > 0) ink(g, `${d.perfects} PERFECT`, CW / 2, CH - 28, 26, '#ffd75e');
    this.cardTex.needsUpdate = true;
  }

  /* ── the centre card: things you READ while nothing hunts you ─────────── */

  private drawCard(count: number): void {
    const g = this.cardCanvas.getContext('2d')!;
    g.clearRect(0, 0, CW, CH);
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    if (!Number.isFinite(match.beat)) {
      // The record is still decoding — the clock stays parked until it's
      // ready, so nothing can land early.
      ink(g, 'CUEING…', CW / 2, CH / 2, 46, '#ffd9f6');
      this.cardTex.needsUpdate = true;
      return;
    }

    // Clean: the number, the record, and (on tour) the night. No slogan.
    const cued = trackById(match.trackId);
    if (match.tour) {
      const set = TOUR.sets[match.tour.set];
      ink(
        g,
        `${set?.name ?? 'THE TOUR'} · ${match.tour.song + 1}`,
        CW / 2,
        58,
        26,
        SET_COLORS[match.tour.set % SET_COLORS.length],
      );
    }
    // A flat magenta numeral reads DARK on a black card, however saturated
    // it is: magenta's own luminance is low. Real neon is a near-white core
    // inside a coloured halo, so that is what the count wears now.
    neon(g, `${Math.max(1, count)}`, CW / 2, CH / 2 - 4, 150, '#ffe3f8', '#ff2ad5');
    if (cued) neon(g, `♪ ${cued.title}`, CW / 2, CH - 52, 36, '#7dffb2');
    this.cardTex.needsUpdate = true;
  }

  /* ── the wedge: score, ×mult, lives — glanceable, wordless ────────────── */

  private drawStrip(): void {
    const g = this.stripCanvas.getContext('2d')!;
    g.clearRect(0, 0, SW, SH);
    g.textBaseline = 'middle';

    const d = me();
    const seatCss = seatNeonCss(danceHue(match.mySeat, true));
    const cx = SW / 2;

    // Score — big and white with the faintest white bloom (the whites are
    // right; they just get to be LIGHT). The multiplier below it wears the
    // seat's hue at full neon.
    g.textAlign = 'center';
    neon(g, `${d?.score ?? 0}`, cx, 74, 92, '#ffffff', 'rgba(255,255,255,0.55)');
    if (d && d.alive && d.combo > 0) {
      const mult = 1 + SCORE.comboStep * Math.min(d.combo, SCORE.comboCap);
      neon(g, `×${mult.toFixed(1)}`, cx, 150, 54, seatCss);
    }

    if (d?.alive !== false) this.drawGroove(g, cx);

    if (d?.alive === false) {
      ink(g, 'SPECTATING', cx, 252, 34, 'rgba(240,244,250,0.92)');
    } else if (d && d.missChain > 0) {
      // THE CHAIN WARNING — nothing at all until you're clipped, then a
      // row of marks counting toward the end of the night. One dodge and
      // the whole row disappears.
      const r = 14;
      const gapX = 46;
      const x0 = cx - (gapX * (GRADE.chainOut - 1)) / 2;
      const last = d.missChain === GRADE.chainOut - 1;
      for (let i = 0; i < GRADE.chainOut; i++) {
        const lit = i < d.missChain;
        g.beginPath();
        g.arc(x0 + i * gapX, 254, r, 0, Math.PI * 2);
        // A thinner casing: the ring used to eat a third of the disc, so
        // what little red survived read as a dull bead.
        g.lineWidth = 5;
        g.strokeStyle = 'rgba(0,2,6,0.96)';
        g.stroke();
        if (lit) {
          g.shadowColor = ALARM_CSS;
          g.shadowBlur = last ? 34 : 22;
          g.fillStyle = ALARM_CSS;
          g.fill();
          g.fill(); // twice through the bloom — the mark burns, not blushes
        } else {
          g.fillStyle = 'rgba(70,78,92,0.85)';
          g.fill();
        }
        g.shadowBlur = 0;
      }
    }

    this.stripTex.needsUpdate = true;
  }

  /**
   * THE GROOVE ROW — the combo catching, then running.
   *
   * Cold: four hollow pips, an invitation. Winding up: one fills per
   * rhythmic swap, so the very first paid swap is visible. Running (past
   * the fourth): the pips stay on the floor and keep dancing — the cycle
   * walks 1-2-3-4 with every paid swap, and the pip whose turn it is
   * grows a touch and HOPS, a four-point lens glint riding it and dying
   * out through the beat, with the streak's earnings beside. (This
   * replaced a fill bar that crept toward the pay ceiling: the tally
   * already says what the groove is worth, and a meter filling under the
   * row said it twice — while four dots dancing your own one-up-one-down
   * back at you says the thing the sticks are saying.) It all vanishes
   * when the groove drops — you always know whether you're on or off.
   */
  private drawGroove(g: CanvasRenderingContext2D, cx: number): void {
    const streak = match.grooveStreak;
    const PIPS = 4;
    const y = 202;
    // The row is [meter][tally], centred as a pair — so it stays balanced
    // whether the tally is there or not.
    const meterW = 150;
    const tally = match.grooveScore > 0 ? `+${match.grooveScore}` : '';
    const tallyW = tally ? 96 : 0;
    const left = cx - (meterW + tallyW) / 2;

    if (streak <= PIPS) {
      const gap = meterW / PIPS;
      for (let i = 0; i < PIPS; i++) {
        g.beginPath();
        g.arc(left + gap / 2 + i * gap, y, 11, 0, Math.PI * 2);
        g.lineWidth = 6;
        g.strokeStyle = 'rgba(0,2,6,0.96)';
        g.stroke();
        if (i < streak) {
          g.shadowColor = GROOVE_CSS;
          g.shadowBlur = 14;
          g.fillStyle = GROOVE_CSS;
        } else {
          g.fillStyle = 'rgba(58,66,82,0.8)';
        }
        g.fill();
        g.shadowBlur = 0;
      }
    } else {
      // RUNNING: whose turn it is walks the row with every paid swap, and
      // the hop rides the front of the beat — up and home again before the
      // next swap is due.
      const gap = meterW / PIPS;
      const turn = (streak - 1) % PIPS;
      const phase = Math.min(1, Math.max(0, showBeat() % 1));
      const hop = phase < 0.6 ? Math.sin((phase / 0.6) * Math.PI) : 0;
      let sx = 0;
      let sy = 0;
      for (let i = 0; i < PIPS; i++) {
        const active = i === turn;
        const px = left + gap / 2 + i * gap;
        const py = y - (active ? hop * 7 : 0);
        g.beginPath();
        g.arc(px, py, 11 + (active ? hop * 3 : 0), 0, Math.PI * 2);
        g.lineWidth = 6;
        g.strokeStyle = 'rgba(0,2,6,0.96)';
        g.stroke();
        g.shadowColor = GROOVE_CSS;
        g.shadowBlur = active ? 14 + hop * 12 : 12;
        g.fillStyle = GROOVE_CSS;
        g.fill();
        g.shadowBlur = 0;
        if (active) {
          sx = px;
          sy = py;
        }
      }
      // The sparkle: a four-point lens glint (the glowsticks' own language)
      // flaring off the hopping pip and dying out through the beat.
      if (hop > 0.04) {
        const arm = 12 + hop * 9;
        const w2 = 2.4;
        g.globalAlpha = Math.min(1, hop * 1.4);
        g.shadowColor = GROOVE_CSS;
        g.shadowBlur = 10;
        g.fillStyle = '#eafffb';
        g.beginPath();
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          g.moveTo(sx + dx * arm, sy + dy * arm);
          g.lineTo(sx + dy * w2, sy - dx * w2);
          g.lineTo(sx - dy * w2, sy + dx * w2);
          g.closePath();
        }
        g.fill();
        g.globalAlpha = 1;
        g.shadowBlur = 0;
      }
    }

    // What the streak has paid — the combo's own ledger, dying with it.
    if (tally) {
      g.textAlign = 'left';
      neon(g, tally, left + meterW + 14, y, 40, GROOVE_CSS);
    }
  }

  private drawFlair(text: string, tone: Flair['tone']): void {
    const g = this.flairCanvas.getContext('2d')!;
    g.clearRect(0, 0, 512, 160);
    // The house semantic set — each tone unmistakably its own: green
    // survived, WHITE rode the last beat (a perfect is the cleanest thing
    // you can do, and white is the cleanest thing on the strip), the alarm
    // red got clipped, magenta is a milestone, cyan is information.
    const color =
      tone === 'perfect'
        ? '#ffffff'
        : tone === 'hit'
          ? ALARM_CSS
          : tone === 'milestone'
            ? '#ff2ad5'
            : tone === 'info'
              ? '#6fc8ff'
              : '#2be28a';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = color;
    // The alarm blooms hardest: a deep red only reads as VIVID against the
    // void if it throws light, and this is the pop you must not miss.
    g.shadowBlur = tone === 'hit' ? 22 : 12;
    ink(g, text, 256, 80, 52, color, 490);
    g.shadowBlur = 0;
    if (tone === 'hit') {
      // ...then a crisp core ON TOP of its own bloom. A heavy casing eats
      // into 52px glyphs, and a halo brighter than the letters it surrounds
      // reads as dark text in a red fog — the opposite of vivid.
      g.fillStyle = color;
      g.font = font(700, 52);
      g.fillText(text, 256, 80, 490);
    }
    this.flairTex.needsUpdate = true;
  }
}
