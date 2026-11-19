// Grading a finished game: each move's class (brilliant … blunder), game accuracy, an estimated
// game rating and accuracy by phase. Pure functions over the review's engine data, no DOM.
import { Chess } from '../vendor/chess.js';
import { winPct, scoreToCp, classify, moveAccuracy, PIECE_VALUE } from './util.js';

export const CLASSES = ['brilliant', 'great', 'best', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder'];
export const BAD = ['inaccuracy', 'mistake', 'miss', 'blunder'];
export const SYM = { brilliant: '!!', great: '!', best: '★', good: '✓', book: '📖', inaccuracy: '?!', mistake: '?', miss: '✕', blunder: '??' };
/** The class as it reads in a sentence: "Qf3 is a mistake". */
export const CLASS_PHRASE = {
  brilliant: 'a brilliant move', great: 'a great move', best: 'the best move', good: 'a good move', book: 'a book move',
  inaccuracy: 'an inaccuracy', mistake: 'a mistake', miss: 'a missed chance', blunder: 'a blunder',
};

const other = c => (c === 'w' ? 'b' : 'w');
const val = t => (t === 'k' ? 100 : PIECE_VALUE[t]);

function balance(chess, color) {
  let s = 0;
  for (const row of chess.board()) for (const p of row) if (p && p.type !== 'k') s += (p.color === color ? 1 : -1) * PIECE_VALUE[p.type];
  return s;
}

/**
 * What the side attacking `sq` wins by starting a capture sequence there (static exchange, no
 * x-rays or pins), never less than 0 since they can always decline.
 */
export function seeGain(chess, sq) {
  const target = chess.get(sq);
  if (!target) return 0;
  const vals = c => chess.attackers(sq, c).map(s => val(chess.get(s).type)).sort((a, b) => a - b);
  const lists = [vals(other(target.color)), vals(target.color)];
  if (!lists[0].length) return 0;
  if (lists[0][0] === 100 && lists[1].length) return 0; // the king cannot take a defended piece
  const ptr = [1, 0];
  const gain = [val(target.type)];
  let onSq = lists[0][0], side = 1;
  while (ptr[side] < lists[side].length) {
    const next = lists[side][ptr[side]];
    if (next === 100 && ptr[1 - side] < lists[1 - side].length) break;
    ptr[side]++;
    gain.push(onSq - gain[gain.length - 1]);
    onSq = next;
    side = 1 - side;
  }
  for (let k = gain.length - 1; k > 0; k--) gain[k - 1] = -Math.max(-gain[k - 1], gain[k]);
  return Math.max(0, gain[0]);
}

/**
 * Material the mover gives up with `m`, in pawns: the balance before the move against the balance
 * after it once the opponent takes the best thing on offer. A trade or a plain capture gives 0.
 */
export function sacrificed(fenBefore, m) {
  const before = new Chess(fenBefore);
  const after = new Chess(m.after);
  const me = m.color;
  let most = 0;
  for (const row of after.board()) for (const p of row) {
    if (!p || p.color !== me || p.type === 'k') continue;
    most = Math.max(most, seeGain(after, p.square));
  }
  return balance(before, me) - (balance(after, me) - most);
}

/** Game phase of a position, roughly as Lichess divides games. */
export function phaseOf(fen, ply) {
  const c = new Chess(fen);
  let pieces = 0;
  const back = { w: 0, b: 0 };
  for (const row of c.board()) for (const p of row) {
    if (!p || p.type === 'k') continue;
    if (p.type !== 'p') pieces++;
    if ((p.color === 'w' && p.square[1] === '1') || (p.color === 'b' && p.square[1] === '8')) back[p.color]++;
  }
  if (pieces <= 6) return 'endgame';
  if (pieces <= 10 || back.w < 4 || back.b < 4 || ply >= 30) return 'middlegame';
  return 'opening';
}

/**
 * Grade every move. `review` holds the engine data: cps (White's view, one per position), best,
 * alt (the second-best line per position: {move, score}) and deep (a deeper look at chosen moves).
 * `isBook(i)` says whether move i is still opening theory.
 */
export function gradeMoves(verbose, fens, review, isBook = () => false) {
  const { cps, best, alt = [] } = review;
  const out = [];
  verbose.forEach((m, i) => {
    const sign = m.color === 'w' ? 1 : -1;
    const pct = s => winPct(sign * scoreToCp(s));
    let bestPct = winPct(sign * cps[i]);
    let after = winPct(sign * cps[i + 1]);
    let bestUci = best[i];
    let second = alt[i] && alt[i].move !== bestUci ? pct(alt[i].score) : null;
    let drop = Math.max(0, bestPct - after);
    const d = review.deep?.[i];
    if (d) {
      // Both sides of the move were searched again, deeper. A move the engine ranked itself is
      // also graded by that ranking, whichever is kinder.
      bestPct = pct(d.lines[0].score);
      after = pct(d.after.score);
      const ranked = d.lines.find(l => l.move === m.lan);
      drop = bestPct - after;
      if (ranked) drop = Math.min(drop, bestPct - pct(ranked.score));
      drop = Math.max(0, drop);
      bestUci = d.lines[0].move;
      second = d.lines[1] ? pct(d.lines[1].score) : null;
    }
    const isBest = bestUci === m.lan;
    let cls = classify(drop, isBest);
    const prev = out[i - 1];
    const pos = new Chess(fens[i]);
    const forced = pos.moves().length <= 2;
    const cpAfter = d ? scoreToCp(d.after.score) : cps[i + 1];

    if (i < 24 && isBook(i)) cls = 'book';
    else if (cls === 'best' && !forced && !m.san.endsWith('#')) {
      // Brilliant: a sound sacrifice of at least a minor piece (or the exchange) that keeps you
      // at least level, in a position that was not already won anyway.
      if (after >= 50 && bestPct <= 92 && sacrificed(fens[i], m) >= 2) cls = 'brilliant';
      // Great: the only move that holds. Every other move throws a lot away. Obvious moves do not
      // count: a recapture, or taking a piece that was simply hanging.
      else if (isBest && second != null && bestPct - second >= 20 && after >= 30 && bestPct <= 97
        && !(prev && prev.captured && m.captured && m.to === prev.to)
        && !(m.captured && seeGain(pos, m.to) >= 2)) cls = 'great';
    } else if (BAD.includes(cls) && prev && ['mistake', 'blunder'].includes(prev.cls) && drop >= 10) {
      // Miss: they slipped and you let it go, without ending up worse than before their slip.
      // Losing more than that is a plain mistake or blunder.
      const beforeTheirSlip = 100 - prev.bestPct;
      if (after >= beforeTheirSlip - 5) cls = 'miss';
    }
    out.push({ ...m, idx: i, drop, cls, bestUci, bestPct, winAfter: after, cpAfter, phase: phaseOf(fens[i], i) });
  });
  return out;
}

/** Per-move accuracy as Lichess computes it, with its small bonus for imperfect analysis. */
export const accuracyOf = drop => Math.max(0, Math.min(100, moveAccuracy(drop) + 1));

const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const harmonic = a => a.length / a.reduce((s, x) => s + 1 / Math.max(1, x), 0);

/**
 * Game accuracy for `color`, the Lichess way: the mean of a volatility-weighted average (moves in
 * sharp positions count more) and the harmonic mean (one blunder weighs heavily).
 * `cps` is White's view of every position, so it has one more entry than `moves`.
 */
export function gameAccuracy(moves, cps, color) {
  const wins = cps.map(cp => winPct(cp));
  const ws = Math.max(2, Math.min(8, Math.floor(moves.length / 10)));
  const sd = a => { const mu = mean(a); return Math.sqrt(mean(a.map(x => (x - mu) ** 2))); };
  const accs = [], weights = [];
  moves.forEach((m, i) => {
    if (m.color !== color) return;
    const start = Math.max(0, i - ws + 2);
    const w = sd(wins.slice(start, start + ws));
    accs.push(accuracyOf(m.drop));
    weights.push(Math.max(0.5, Math.min(12, w)));
  });
  if (!accs.length) return null;
  const weighted = accs.reduce((s, a, k) => s + a * weights[k], 0) / weights.reduce((s, w) => s + w, 0);
  return (weighted + harmonic(accs)) / 2;
}

/** Accuracy over a subset of one side's moves (a phase), or null if there are none. */
export function partAccuracy(moves) {
  if (!moves.length) return null;
  const accs = moves.map(m => accuracyOf(m.drop));
  return (mean(accs) + harmonic(accs)) / 2;
}

/**
 * A rough rating for how one side played this one game, from its average centipawn loss
 * (3100·e^(−ACPL/100), a common rule of thumb). Too few moves give no estimate.
 */
export function gameRating(moves, color) {
  const mine = moves.filter(m => m.color === color);
  if (mine.length < 8) return null;
  const clamp = cp => Math.max(-1000, Math.min(1000, cp));
  const cpOfPct = p => { // inverse of winPct, for the best-move side of the deep look
    const x = Math.max(0.01, Math.min(99.99, p)) / 100;
    return Math.log(x / (1 - x)) / 0.00368208;
  };
  const losses = mine.map(m => {
    const sign = m.color === 'w' ? 1 : -1;
    return Math.max(0, clamp(cpOfPct(m.bestPct)) - clamp(sign * m.cpAfter));
  });
  const acpl = mean(losses);
  return Math.max(100, Math.min(3000, Math.round(3100 * Math.exp(-acpl / 100) / 50) * 50));
}
