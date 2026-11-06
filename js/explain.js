// Plain-language reasons why an engine move is strong, built from simple board
// heuristics (captures, forks, threats, safety, development) plus the engine's main line.
import { Chess } from '../vendor/chess.js';
import { esc, PIECE_VALUE, uciToMove, scoreToCp, fmtScore, winPct, classify, CLASS_LABEL } from './util.js';

const NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const val = t => (t === 'k' ? 100 : PIECE_VALUE[t]);
const other = c => (c === 'w' ? 'b' : 'w');

function pieces(chess, color) {
  const out = [];
  for (const row of chess.board()) for (const p of row) if (p && p.color === color) out.push(p);
  return out;
}

function material(chess, color) {
  let n = 0;
  for (const row of chess.board()) for (const p of row) if (p && p.type !== 'k') n += (p.color === color ? 1 : -1) * PIECE_VALUE[p.type];
  return n;
}

/** A piece is in danger if it is attacked and either undefended or attacked by something cheaper. */
function inDanger(chess, sq) {
  const p = chess.get(sq);
  if (!p || p.type === 'k') return false;
  const att = chess.attackers(sq, other(p.color));
  if (!att.length) return false;
  const def = chess.attackers(sq, p.color);
  if (!def.length || att.length > def.length) return true;
  return Math.min(...att.map(s => val(chess.get(s).type))) < val(p.type);
}

/** A checkmate the side NOT to move would have if it could move now (null-move threat). */
function mateThreat(chess) {
  if (chess.inCheck()) return null;
  const f = chess.fen().split(' ');
  f[1] = other(f[1]); f[3] = '-';
  let c;
  try { c = new Chess(f.join(' ')); } catch { return null; }
  for (const m of c.moves({ verbose: true })) {
    c.move(m);
    const mate = c.isCheckmate();
    c.undo();
    if (mate) return m.san;
  }
  return null;
}

/**
 * A list of UCI moves as plain words (HTML): "you play Rb1, they reply Kg8, then you play dxc6".
 * `me` is the side called "you"; it defaults to the side to move.
 */
export function movesInWords(fen, pv, max = 4, me = null) {
  const c = new Chess(fen);
  const you = me || c.turn();
  const out = [];
  for (const uci of pv.slice(0, max)) {
    const who = c.turn() === you ? 'you' : 'they';
    let m;
    try { m = c.move(uciToMove(uci)); } catch { break; }
    const i = out.length;
    out.push(`${i === 2 ? 'then ' : ''}${who} ${i % 2 ? 'reply' : 'play'} <b>${esc(m.san)}</b>`);
  }
  return out.join(', ');
}

/** Pawns the given side has more than the other. */
function pawnBalance(chess, color) {
  return pieces(chess, color).filter(p => p.type === 'p').length - pieces(chess, other(color)).filter(p => p.type === 'p').length;
}

/** Material the mover gains over the engine line (measured after the opponent's replies). */
function lineGain(fen, pv, me) {
  const c = new Chess(fen);
  const base = material(c, me), basePawns = pawnBalance(c, me);
  let gain = 0, plies = 0, pawns = 0;
  for (let i = 0; i < Math.min(pv.length, 6); i++) {
    try { c.move(uciToMove(pv[i])); } catch { break; }
    if (i % 2 === 1) {
      const g = material(c, me) - base;
      if (g !== gain) plies = i + 1; // shortest line that shows the final gain
      gain = g;
      pawns = pawnBalance(c, me) - basePawns;
    }
  }
  return { gain, plies, pawns };
}

function gainText(g, pawns) {
  if (g === 1 && pawns === 1) return 'a pawn';
  if (g === 2 && pawns === 2) return 'two pawns';
  if (g === 3 && pawns === 0) return 'a piece';
  return `material (+${g})`;
}

/**
 * Why a played move went wrong: one plain sentence (HTML), or '' when no simple reason shows.
 * `replyUci` is the opponent's best answer; `mateAgainst` and `hadMate` come from the engine scores.
 */
export function mistakeReason(fen, uci, { bestUci, replyUci, mateAgainst, hadMate } = {}) {
  const play = (f, u) => { try { return new Chess(f).move(uciToMove(u)); } catch { return null; } };
  const played = play(fen, uci);
  const best = play(fen, bestUci);
  const reply = played && play(played.after, replyUci);
  if (mateAgainst) return `It allows a forced checkmate${reply ? `, starting with <b>${esc(reply.san)}</b>` : ''}.`;
  if (hadMate && best) return `You had a forced checkmate starting with <b>${esc(best.san)}</b>!`;
  // A capture you can answer by retaking something at least as valuable is a trade, not a loss.
  const trade = reply && new Chess(reply.after).attackers(reply.to, played.color).length > 0 && val(reply.piece) >= PIECE_VALUE[reply.captured];
  if (reply && reply.captured && PIECE_VALUE[reply.captured] >= 3 && !trade) return `Your ${NAMES[reply.captured]} on ${reply.to} can be taken with <b>${esc(reply.san)}</b>.`;
  if (best && best.captured && PIECE_VALUE[best.captured] >= 3) return `You could have captured the ${NAMES[best.captured]} on ${best.to}.`;
  if (reply && reply.san.includes('+')) return `It allows <b>${esc(reply.san)}</b> with a strong check.`;
  return '';
}

/**
 * explainMove(fen, uci, analysis) -> { san, reasons: string[] (HTML), line, eval }
 * `analysis` is the engine result for `fen` ({ score, lines: [{ pv }] }); scores are White's POV.
 * `prev` is the verbose move that led to `fen`, used to spot recaptures.
 */
export function explainMove(fen, uci, analysis = {}, prev = null) {
  const c = new Chess(fen);
  const me = c.turn(), opp = other(me);
  const sign = me === 'w' ? 1 : -1;
  const fullmove = +fen.split(' ')[5] || 1;
  const wasCheck = c.inCheck();

  const dangerBefore = pieces(c, me).map(p => p.square).filter(sq => inDanger(c, sq));
  const threatBefore = mateThreat(c);
  const pv = analysis.lines?.[0]?.pv?.[0] === uci ? analysis.lines[0].pv : [uci];
  const score = analysis.score;
  const m = c.move(uciToMove(uci));
  const moved = m.promotion || m.piece;
  const reasons = [];
  const add = r => { if (r && !reasons.includes(r)) reasons.push(r); };

  // --- Decisive stuff first ---
  if (c.isCheckmate()) return { san: m.san, reasons: ['It\'s <b>checkmate</b>, the game is over!'], line: '', eval: '' };
  if (score?.mate != null && Math.sign(score.mate) === sign) {
    const n = Math.abs(score.mate);
    add(`It starts a <b>forced checkmate</b> in ${n} move${n > 1 ? 's' : ''}, whatever they reply.`);
  }
  if (m.promotion) add(`It <b>promotes</b> your pawn to a ${NAMES[m.promotion]}.`);

  // --- Captures ---
  let explainedGain = 0;
  if (m.captured) {
    const cv = PIECE_VALUE[m.captured], mv = PIECE_VALUE[m.piece];
    const defended = c.attackers(m.to, opp).length > 0;
    const sq = m.flags.includes('e') ? m.to[0] + m.from[1] : m.to; // en passant takes the pawn beside the mover
    if (!defended) { add(`It wins the ${NAMES[m.captured]} on ${sq} <b>for free</b>: nothing can take back.`); explainedGain = cv; }
    else if (cv > mv) { add(`It wins material: your ${NAMES[m.piece]} takes a more valuable ${NAMES[m.captured]}.`); explainedGain = cv - mv; }
    else if (prev?.captured && prev.to === m.to) add(`It <b>takes back</b> on ${m.to}, winning back the material.`);
    else if (cv === mv) add(`It trades off the ${NAMES[m.captured]} on ${sq}.`);
  }

  // --- Escaping check ---
  if (wasCheck) {
    if (m.piece === 'k') add('It gets your king out of check to a safe square.');
    else if (m.captured) add('It deals with the check by capturing the attacker.');
    else add('It blocks the check.');
  }

  // --- Forks and threats made by the moved piece ---
  const targets = pieces(c, opp).filter(p => {
    if (!c.attackers(p.square, me).includes(m.to)) return false;
    if (p.type === 'k') return true;
    const undefended = !c.attackers(p.square, opp).length;
    return p.type !== 'p' && (undefended || val(p.type) > val(moved));
  });
  const safeHere = !inDanger(c, m.to) || m.piece === 'k';
  if (targets.length >= 2 && safeHere) {
    const list = targets.map(p => (p.type === 'k' ? 'the king' : `the ${NAMES[p.type]} on ${p.square}`));
    add(`It's a <b>fork</b>: your ${NAMES[moved]} attacks ${list.slice(0, -1).join(', ')} and ${list.at(-1)} at once.`);
  } else if (targets.length === 1 && targets[0].type !== 'k' && safeHere) {
    add(`It <b>attacks</b> the ${NAMES[targets[0].type]} on ${targets[0].square}.`);
  }
  if (m.san.includes('+') && !reasons.some(r => r.includes('fork'))) add('It gives <b>check</b>, so they have to deal with that first.');

  // --- Stopping their threats ---
  if (threatBefore && !c.isCheck()) {
    const c2 = new Chess(c.fen());
    let still = false;
    try { c2.move(threatBefore); still = c2.isCheckmate(); } catch { }
    if (!still) add(`It <b>stops the threat</b> of ${esc(threatBefore)}, which would be checkmate.`);
  }

  // --- Safety of your own pieces ---
  if (dangerBefore.includes(m.from) && !inDanger(c, m.to)) add(`It moves your ${NAMES[m.piece]} <b>out of danger</b>.`);
  const saved = dangerBefore.filter(sq => sq !== m.from && c.get(sq)?.color === me && !inDanger(c, sq));
  if (saved.length) add(`It protects your ${NAMES[c.get(saved[0]).type]} on ${saved[0]}, which was under attack.`);

  // --- Follow-up in the engine line ---
  const { gain, plies, pawns } = lineGain(fen, pv, me);
  const hasTactic = reasons.some(r => r.includes('fork') || r.includes('checkmate'));
  const showsLine = !hasTactic && gain > explainedGain && gain >= 1 && pv.length >= 2;
  if (showsLine) {
    add(`It sets up a tactic: ${movesInWords(fen, pv, plies)}, and you've won ${gainText(gain, pawns)}.`);
  }

  // --- Positional ideas ---
  if (m.flags.includes('k') || m.flags.includes('q')) add('<b>Castling</b> tucks your king into safety and brings a rook toward the center.');
  const backRank = me === 'w' ? '1' : '8';
  if ((m.piece === 'n' || m.piece === 'b') && m.from[1] === backRank && fullmove <= 15) add(`It <b>develops</b> your ${NAMES[m.piece]}, bringing another piece into the game.`);
  if (m.piece === 'p' && !m.captured && ['d4', 'e4', 'd5', 'e5'].includes(m.to) && fullmove <= 15) add('It grabs space in the <b>center</b>.');
  if (m.piece === 'n' && ['c3', 'd4', 'e4', 'f3', 'c6', 'd5', 'e5', 'f6'].includes(m.to) && !reasons.some(r => r.includes('develops'))) add('Knights are strongest near the center.');
  if (m.piece === 'r') {
    const file = m.to[0];
    const pawnOnFile = c.board().some(row => row.some(p => p && p.type === 'p' && p.square[0] === file));
    if (!pawnOnFile) add('It puts your rook on an <b>open file</b>.');
    else if (m.to[1] === (me === 'w' ? '7' : '2')) add('A rook on the 7th rank attacks pawns and hems in the king.');
  }
  if (m.piece === 'p' && !m.captured) {
    const f = m.to.charCodeAt(0), r = +m.to[1], dir = me === 'w' ? 1 : -1;
    const blocked = pieces(c, opp).some(p => p.type === 'p' && Math.abs(p.square.charCodeAt(0) - f) <= 1 && (+p.square[1] - r) * dir > 0);
    if (!blocked && (me === 'w' ? r >= 5 : r <= 4)) add('It pushes a <b>passed pawn</b>: nothing can stop it with a pawn, so it heads toward promotion.');
  }

  // --- Fallback ---
  const cp = sign * scoreToCp(score);
  if (!reasons.length) {
    if (cp > 150) add('A calm move that keeps your advantage and leaves your opponent without counterplay.');
    else if (cp < -150) add('It\'s the toughest defense in a difficult position: other moves lose faster.');
    else add('A quiet improving move: no tactics yet, but it makes your position a bit better and keeps things balanced.');
  }

  // No line when the tactic reason already spells it out.
  return { san: m.san, reasons: reasons.slice(0, 3), line: pv.length > 1 && !showsLine ? movesInWords(fen, pv, 4) : '', eval: evalWords(score, me) };
}

/** How the position stands for `me`, in words. `score` is from White's point of view. */
export function evalWords(score, me) {
  if (!score) return '';
  const sign = me === 'w' ? 1 : -1;
  if (score.mate != null) return Math.sign(score.mate) === sign ? `you mate in ${Math.abs(score.mate)}` : `they mate in ${Math.abs(score.mate)}`;
  const cp = sign * scoreToCp(score);
  const s = fmtScore({ cp });
  return cp > 300 ? `you're clearly better (${s})` : cp > 100 ? `you're better (${s})` : cp > 40 ? `you're slightly better (${s})`
    : cp < -300 ? `you're clearly worse (${s})` : cp < -100 ? `you're worse (${s})` : cp < -40 ? `you're slightly worse (${s})` : `about equal (${s})`;
}

const tryMove = (fen, uci) => { try { return new Chess(fen).move(uciToMove(uci)); } catch { return null; } };
const reasonList = reasons => (reasons.length ? `<ul class="why">${reasons.map(r => `<li>${r}</li>`).join('')}</ul>` : '');
const footnote = (line, ev) => (line || ev ? `<div class="small muted">${line ? `Likely next: ${line}` : ''}${line && ev ? ' · ' : ''}${ev ? `${line ? 'Then' : 'Overall'} ${ev}` : ''}</div>` : '');

/** The end of the game in words, or '' while it goes on. `c` has just had move `m` played. */
function endInWords(c, m, me) {
  if (c.isCheckmate()) return `<b>${esc(m.san)}</b> is checkmate, so ${m.color === me ? 'you win' : 'you would lose'}.`;
  if (c.isStalemate()) return `<b>${esc(m.san)}</b> is stalemate, so the game is a draw.`;
  if (c.isDraw()) return `<b>${esc(m.san)}</b> ends the game in a draw.`;
  return '';
}

/**
 * What a move tried out on the analysis board leads to.
 * `before` and `after` are engine results for the positions either side of the move; neither is
 * needed when the move ends the game. `me` is the player's colour, whichever side moved.
 * -> { html, arrows: [{from, to, color}] }
 */
export function whatIfMove(fen, uci, before, after, me) {
  const c = new Chess(fen);
  const m = c.move(uciToMove(uci));
  const end = endInWords(c, m, me);
  if (end) return { html: end, arrows: [] };

  const fenAfter = c.fen();
  const mine = m.color === me;
  const sign = m.color === 'w' ? 1 : -1;
  const drop = winPct(sign * scoreToCp(before.score)) - winPct(sign * scoreToCp(after.score));
  const cls = classify(drop, before.bestmove === uci);
  const best = tryMove(fen, before.bestmove);
  const san = `<b>${esc(m.san)}</b>`;
  const bestSan = best ? `<b>${esc(best.san)}</b>` : 'another move';
  const reply = after.bestmove && tryMove(fenAfter, after.bestmove);
  const pv = after.lines?.[0]?.pv || [];
  const arrows = reply ? [{ from: reply.from, to: reply.to, color: mine ? 'red' : 'green' }] : [];

  if (mine) {
    let text = `<span class="tag ${cls}">${CLASS_LABEL[cls]}</span> `;
    if (cls === 'best') text += `${san} is as good as anything here.`;
    else if (cls === 'good') text += `${san} is fine, but ${bestSan} is slightly better.`;
    else {
      text += `${san} is weaker than ${bestSan}. ` + mistakeReason(fen, uci, {
        bestUci: before.bestmove, replyUci: after.bestmove,
        mateAgainst: after.score.mate != null && Math.sign(after.score.mate) === -sign,
        hadMate: before.score.mate != null && Math.sign(before.score.mate) === sign,
      });
    }
    if (reply) text += ` Their best reply is <b>${esc(reply.san)}</b>.`;
    return { html: text + footnote(pv.length > 1 ? movesInWords(fenAfter, pv, 4, me) : '', evalWords(after.score, me)), arrows };
  }

  const verdict = cls === 'best' ? `${san} is their best move here.`
    : cls === 'good' ? `${san} is a reasonable try for them.`
      : `${san} would be a mistake by them: ${bestSan} is stronger.`;
  if (!reply) return { html: verdict, arrows };
  const ex = explainMove(fenAfter, after.bestmove, after, m);
  return { html: `${verdict} Your best answer is <b>${esc(ex.san)}</b>.${reasonList(ex.reasons)}${footnote(ex.line, ex.eval)}`, arrows };
}

/**
 * The engine's top moves side by side, and why the first one beats the rest.
 * `analysis` needs several lines (multipv). `prev` is the move that led to `fen`.
 * -> { html, arrows: [{from, to, color}] }
 */
export function compareMoves(fen, analysis, me, prev = null) {
  const c = new Chess(fen);
  const mine = c.turn() === me;
  const sign = c.turn() === 'w' ? 1 : -1;
  const lines = (analysis.lines || []).map(l => ({ ...l, m: tryMove(fen, l.move) })).filter(l => l.m).slice(0, 3);
  if (!lines.length) return { html: 'No moves to compare here.', arrows: [] };

  const pct = l => winPct(sign * scoreToCp(l.score));
  const top = lines[0];
  const topSan = `<b>${esc(top.m.san)}</b>`;
  const gap = lines[1] ? pct(top) - pct(lines[1]) : 0;
  const whose = mine ? '' : ' for them';
  const summary = c.moves().length === 1 ? `${topSan} is the only legal move.`
    : gap >= 7 ? `${topSan} clearly stands out${whose}.`
      : gap >= 2 ? `${topSan} is a little better than the alternatives${whose}.`
        : `Several moves are about equally good${whose}.`;

  const rows = lines.map((l, i) => {
    let note = '';
    if (mine && i === 0) note = explainMove(fen, l.move, { score: l.score, lines: [l] }, prev).reasons[0] || '';
    else if (mine && pct(top) - pct(l) < 2) note = 'About as good.';
    else if (mine) {
      note = mistakeReason(fen, l.move, {
        bestUci: top.move, replyUci: l.pv[1],
        mateAgainst: l.score.mate != null && Math.sign(l.score.mate) === -sign,
        hadMate: top.score.mate != null && Math.sign(top.score.mate) === sign,
      });
    }
    const line = l.pv.length > 1 ? movesInWords(fen, l.pv, 3, me) : '';
    return `<li><b>${esc(l.m.san)}</b> <span class="muted">${evalWords(l.score, me)}</span>${note ? `<div>${note}</div>` : ''}${line ? `<div class="small muted">${line}</div>` : ''}</li>`;
  });
  const colors = ['green', 'blue', 'grey'];
  return { html: `${summary}<ol class="why compare">${rows.join('')}</ol>`, arrows: lines.map((l, i) => ({ from: l.m.from, to: l.m.to, color: colors[i] })) };
}
