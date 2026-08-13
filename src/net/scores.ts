/**
 * THE WORLD BOARD — every headset's solo runs, in one place.
 *
 * Firestore, talked to straight from the client with ANONYMOUS AUTH. The
 * shape is deliberate:
 *
 *   collection 'scores', doc id `<track>__<difficulty>__<uid>`
 *
 * One document per player per chart, so the board is a table of PERSONAL
 * BESTS, not a log — nobody can flood a chart with fifty entries, a better
 * run overwrites its own row, and the security rules can prove ownership
 * from the document's own name (see firestore.rules). The rules also
 * refuse a write that doesn't beat the row it replaces, so the ratchet is
 * server-side, not a favour the client does.
 *
 * WHAT THIS IS NOT: proof. The client computes the score, so a determined
 * cheater can post a fake one under their own name. The rules bound the
 * damage (shape, ranges, one row each, monotonic) — they can't make a
 * client honest. Moving submission behind the relay is the fix if the
 * board ever matters enough to be worth attacking.
 *
 * Everything here is LAZY and FAILS SOFT: no Firebase code loads until a
 * board is actually asked for, and a project without a database (or a
 * headset without a network) simply reports 'off' and leaves the local
 * record book — the real source of truth for your own bests — untouched.
 */

import type { FirebaseApp } from 'firebase/app';
import type { Firestore } from 'firebase/firestore';

/** The web app config (public by design — Firestore rules are the
 *  security boundary, not this). Mirrors the README's deploy section. */
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBqsUcpCKzs2bANP0db6J4Nz_SkKe4wXzI',
  authDomain: 'raveraid-bc866.firebaseapp.com',
  projectId: 'raveraid-bc866',
  storageBucket: 'raveraid-bc866.firebasestorage.app',
  messagingSenderId: '1090372809167',
  appId: '1:1090372809167:web:40f228c18bf6d1a0b022ba',
};

export const WORLD_TOP = 100;
/** Absurd-value guard, mirrored in the rules. Real sets land far under. */
export const SCORE_CAP = 5_000_000;
/** A board older than this refetches when something asks for it again. */
const TTL_MS = 60_000;
/** Nothing may hang forever. A blocked network (captive portal, a proxy
 *  that swallows the connection) doesn't fail — it just never answers, and
 *  an unbounded await leaves the board reading "loading…" for the rest of
 *  the session. Every round trip gets a deadline. */
const TIMEOUT_MS = 8_000;

function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), TIMEOUT_MS)),
  ]);
}

export interface WorldRow {
  uid: string;
  name: string;
  score: number;
  grade: string;
  /** True for the row this headset owns. */
  isMe: boolean;
}

export type BoardState = 'idle' | 'loading' | 'ready' | 'error' | 'off';

interface Board {
  state: BoardState;
  rows: WorldRow[];
  note: string;
  fetchedAt: number;
}

/** Bumped whenever any board changes — menus repaint when it moves (the
 *  same trick net.dirty plays). */
export const scores = { dirty: 0, uid: '' };

const boards = new Map<string, Board>();
const key = (track: string, diff: number): string => `${track}__${diff}`;

/* ── the connection, opened at most once and only on demand ───────────── */

type Live = { app: FirebaseApp; db: Firestore; uid: string };
let live: Live | null = null;
let opening: Promise<Live | null> | null = null;
/** Set when the project has no database (or auth is off) — one failure of
 *  that kind is permanent for the session; retrying every minute is just
 *  noise on a headset that will never reach it. */
let deadReason = '';

async function open(): Promise<Live | null> {
  if (live) return live;
  if (deadReason) return null;
  if (opening) return opening;
  opening = (async () => {
    try {
      const [{ initializeApp }, { getAuth, signInAnonymously }, { getFirestore }] = await Promise.all([
        import('firebase/app'),
        import('firebase/auth'),
        import('firebase/firestore'),
      ]);
      const app = initializeApp(FIREBASE_CONFIG);
      const cred = await withTimeout(signInAnonymously(getAuth(app)), 'sign-in');
      live = { app, db: getFirestore(app), uid: cred.user.uid };
      scores.uid = live.uid;
      scores.dirty++;
      return live;
    } catch (err) {
      // auth/configuration-not-found → anonymous sign-in isn't enabled;
      // anything else here is a network or project problem. Either way the
      // world board is simply unavailable this session.
      deadReason = String((err as { code?: string })?.code ?? err ?? 'unavailable');
      return null;
    } finally {
      opening = null;
    }
  })();
  return opening;
}

/** Is the world board reachable at all? (For the UI's offline note.) */
export function worldOffline(): boolean {
  return Boolean(deadReason);
}

/* ── reading ──────────────────────────────────────────────────────────── */

/**
 * The board for one chart. Returns immediately with whatever is known and
 * kicks off a fetch when the cache is cold or stale — call it from paint
 * code freely; it never blocks and never fetches twice at once.
 */
export function worldBoard(track: string, diff: number): Board {
  const k = key(track, diff);
  let board = boards.get(k);
  if (!board) {
    board = { state: 'idle', rows: [], note: '', fetchedAt: 0 };
    boards.set(k, board);
  }
  if (deadReason && board.state !== 'off') {
    board.state = 'off';
    board.note = 'no connection';
  }
  const stale = Date.now() - board.fetchedAt > TTL_MS;
  if (board.state !== 'loading' && board.state !== 'off' && stale) void refresh(track, diff, board);
  return board;
}

/** Force a refetch (after posting a run, or on an explicit retry). */
export function refreshWorldBoard(track: string, diff: number): void {
  const board = boards.get(key(track, diff));
  if (board) {
    board.fetchedAt = 0;
    // Back to 'idle', not just stale: the fetch guard below skips boards
    // parked at 'off', so leaving the state alone would make RETRY a
    // button that does nothing.
    if (board.state === 'off' || board.state === 'error') board.state = 'idle';
  }
  deadReason = ''; // an explicit retry gets one more chance at the network
  scores.dirty++;
}

async function refresh(track: string, diff: number, board: Board): Promise<void> {
  board.state = 'loading';
  scores.dirty++;
  const conn = await open();
  if (!conn) {
    board.state = 'off';
    board.note = 'no connection';
    board.fetchedAt = Date.now();
    scores.dirty++;
    return;
  }
  try {
    const { collection, getDocs, limit, orderBy, query, where } = await import('firebase/firestore');
    const snap = await withTimeout(
      getDocs(
        query(
          collection(conn.db, 'scores'),
          where('track', '==', track),
          where('diff', '==', diff),
          orderBy('score', 'desc'),
          limit(WORLD_TOP),
        ),
      ),
      'board',
    );
    const rows: WorldRow[] = [];
    snap.forEach((doc) => {
      const d = doc.data() as { uid?: string; name?: string; score?: number; grade?: string };
      rows.push({
        uid: String(d.uid ?? ''),
        name: String(d.name ?? 'RAVER').slice(0, 12),
        score: Number(d.score ?? 0),
        grade: String(d.grade ?? 'F'),
        isMe: d.uid === conn.uid,
      });
    });
    board.rows = rows;
    board.state = 'ready';
    board.note = '';
  } catch (err) {
    board.state = 'error';
    // A missing composite index is THE predictable first-run failure, and
    // its message carries the console link that creates it.
    board.note = String((err as { code?: string })?.code ?? 'unavailable');
  }
  board.fetchedAt = Date.now();
  scores.dirty++;
}

/* ── writing ──────────────────────────────────────────────────────────── */

/**
 * Post a finished solo run. Silent about failure by design: a set that
 * can't reach the world board is still a set you danced, already written
 * to this headset's book. Refuses obvious garbage before spending a round
 * trip on it (the rules refuse it again on the server).
 */
export async function submitWorldScore(
  track: string,
  diff: number,
  score: number,
  grade: string,
  name: string,
): Promise<void> {
  if (!track || !Number.isFinite(score) || score < 0 || score > SCORE_CAP) return;
  if (diff < 0 || diff > 3) return;
  const conn = await open();
  if (!conn) return;
  try {
    const { doc, serverTimestamp, setDoc } = await import('firebase/firestore');
    await withTimeout(
      setDoc(doc(conn.db, 'scores', `${track}__${diff}__${conn.uid}`), {
        track,
        diff,
        uid: conn.uid,
        name: name.slice(0, 12) || 'RAVER',
        score: Math.round(score),
        grade,
        at: serverTimestamp(),
      }),
      'submit',
    );
    refreshWorldBoard(track, diff);
  } catch {
    // Most often: the rules rejected it because the stored run was better.
    // That's the ratchet working, not an error worth surfacing.
  }
}
