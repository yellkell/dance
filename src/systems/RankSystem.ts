/**
 * RankSystem — who's winning the night.
 *
 * The law: the living rank above the fallen; the living rank by score; the
 * fallen rank by who lasted longest. The top ten dance on RAISED platforms
 * and the current champion above them all — heights rendered RELATIVE to my
 * own tier, because my platform is my real floor and can never move. When
 * I'm champion the ring drops away below me; when I'm out, the leaders
 * tower overhead. The holo board over the stage carries the numbers.
 *
 * Also runs the podium: freeze the board, crown the winner, confetti, and
 * walk everyone back to the lobby.
 */

import { createSystem, Vector3 } from '@iwsdk/core';
import { PODIUM, RANK, hueToColor } from '../config.js';
import { arena } from '../arena/arena.js';
import { toLobby } from '../game/flow.js';
import { match, type Dancer } from '../game/state.js';
import { HoloBoard, type BoardRow } from '../ui/board.js';
import { discoRig } from './DiscoSystem.js';
import * as sfx from '../audio/sfx.js';

function standing(): Dancer[] {
  return [...match.players].sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (a.alive) return b.score - a.score || b.combo - a.combo || a.seat - b.seat;
    return b.elimAtBeat - a.elimAtBeat || b.score - a.score || a.seat - b.seat;
  });
}

function tierOf(d: Dancer | undefined): number {
  if (!d) return 0;
  if (!d.alive) return RANK.outSink;
  if (d.rank === 1) return RANK.championLift;
  if (d.rank <= 10) return RANK.topTenLift;
  return 0;
}

export class RankSystem extends createSystem({}) {
  private board = new HoloBoard();
  private refreshT = 0;
  private lastHash = '';
  private podiumT = 0;
  private podiumDone = false;

  init(): void {
    this.scene.add(this.board.group);
  }

  update(delta: number): void {
    const a = arena();
    if (!a) return;

    // The board floats over the stage — above the giant, under the ball —
    // riding the stage's rank-sink, facing me (every client's board faces
    // its own dancer: the holo conceit).
    this.board.group.position.set(a.stage.position.x, 5.6 + a.stage.position.y, a.stage.position.z);
    this.board.group.lookAt(_head.set(match.headX, match.headY, match.headZ));

    const inShow = match.screen === 'raid' || match.screen === 'podium';
    this.board.group.visible = inShow || match.screen === 'countdown';

    this.refreshT -= delta;
    if (this.refreshT <= 0) {
      this.refreshT = RANK.refresh;
      this.recompute();
    }

    // Platform lifts — eased, relative to my own tier. The GOOPLIATH's
    // stage does NOT rise with you: as you climb, it sinks by your tier,
    // staying down at floor level with the rest of the ring — the champion
    // looks DOWN on the show. (Boss, disco rig and board all ride it.)
    const meTier = tierOf(match.players.find((p) => p.kind === 'local'));
    const stageTarget = inShow ? -meTier : 0;
    a.stage.position.y += (stageTarget - a.stage.position.y) * Math.min(1, delta * RANK.lerp);
    for (const handle of a.platforms) {
      const d = match.players.find((p) => p.seat === handle.seat);
      const target = inShow ? tierOf(d) - meTier : 0;
      handle.lift += (target - handle.lift) * Math.min(1, delta * RANK.lerp);
      handle.root.position.y = handle.lift;
      // Elimination dims the deck's neon.
      const rimTarget = d && !d.alive ? 0.12 : 0.9;
      handle.rimMat.opacity += (rimTarget - handle.rimMat.opacity) * Math.min(1, delta * 3);
      handle.nameSprite.material.opacity = d && !d.alive ? 0.25 : 1;
    }

    // Podium choreography.
    if (match.screen === 'podium') {
      if (!this.podiumDone) {
        this.podiumDone = true;
        this.podiumT = 0;
        discoRig()?.popConfetti();
        sfx.matchEnd(match.players.find((p) => p.kind === 'local')?.rank === 1);
      }
      this.podiumT += delta;
      if (this.podiumT > PODIUM.holdSeconds) {
        this.podiumDone = false;
        toLobby();
      }
    } else {
      this.podiumDone = false;
    }
  }

  private recompute(): void {
    const order = standing();
    order.forEach((d, i) => {
      d.rank = i + 1;
    });

    const hash =
      match.screen + order.map((d) => `${d.seat}:${d.score}:${d.combo}:${d.alive ? 1 : 0}`).join('|');
    if (hash === this.lastHash) return;
    this.lastHash = hash;

    const me = match.players.find((p) => p.kind === 'local');
    const rows: BoardRow[] = [];
    const top = order.slice(0, 10);
    for (const d of top) rows.push(this.row(d));
    if (me && !top.includes(me)) rows.push(this.row(me));

    const podium = match.screen === 'podium';
    const winner = order[0];
    this.board.redraw(
      podium ? '🏆 FINAL' : 'LIVE RANKING',
      podium && winner ? `${winner.name} OWNS THE NIGHT` : `${match.players.filter((p) => p.alive).length} ON THE FLOOR`,
      rows,
      podium ? '#ffd75e' : '#ff2ad5',
    );
  }

  private row(d: Dancer): BoardRow {
    return {
      rank: d.rank,
      name: d.name,
      score: d.score,
      combo: d.combo,
      alive: d.alive,
      isMe: d.kind === 'local',
      colorCss: `#${hueToColor(d.hue, 0.62).toString(16).padStart(6, '0')}`,
    };
  }
}

const _head = new Vector3();
