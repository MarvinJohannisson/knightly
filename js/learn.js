// Learn: interactive lessons and opening courses.
import { Chess } from '../vendor/chess.js';
import { Board, destsFrom, checkSquare } from './board.js';
import { engine } from './engine.js';
import { SECTIONS, LESSONS } from './lessons.js';
import { COURSES } from './courses.js';
import { $, esc, store, sound, sleep, getSettings, uciToMove } from './util.js';

export function lessonProgress() { return store.get('lessons', {}); }
export function nextLesson() { const d = lessonProgress(); return LESSONS.find(l => !d[l.id]) || null; }

// ======================= Hub =======================
export function renderLearnHub(view) {
  const done = lessonProgress();
  const cp = store.get('courses', {});
  const total = LESSONS.length, n = LESSONS.filter(l => done[l.id]).length;
  let html = `<div class="card"><div class="row"><div class="grow"><div style="font-weight:750">Your progress</div>
    <div class="small muted">${n} of ${total} lessons completed</div></div><div style="font-weight:800;font-size:20px">${Math.round(n / total * 100)}%</div></div>
    <div class="progress" style="margin-top:10px"><div style="width:${n / total * 100}%"></div></div></div>`;
  for (const s of SECTIONS) {
    const ls = LESSONS.filter(l => l.section === s.id);
    html += `<div class="section-title">${s.icon} ${esc(s.title)}</div><div class="lesson-list">`;
    ls.forEach(l => {
      const i = LESSONS.indexOf(l) + 1;
      html += `<a class="lesson-item ${done[l.id] ? 'done' : ''}" href="#/lesson/${l.id}">
        <div class="n">${done[l.id] ? '✓' : i}</div>
        <div class="grow"><div class="t">${esc(l.title)}</div><div class="s">${esc(l.sub)}</div></div><div class="muted">›</div></a>`;
    });
    html += '</div>';
  }
  html += `<div class="section-title">♞ Opening courses</div><p class="small muted" style="margin:0 4px 8px">Learn a repertoire move by move, then practise it until you know it by heart.</p><div class="lesson-list">`;
  for (const c of COURSES) {
    const p = cp[c.id];
    html += `<a class="lesson-item opening-card ${p && p.mastered ? 'done' : ''}" href="#/course/${c.id}">
      <div class="n">${p && p.mastered ? '✓' : c.side === 'w' ? '♔' : '♚'}</div>
      <div class="grow"><div class="t">${esc(c.name)}</div><div class="s">${esc(c.level)} · as ${c.side === 'w' ? 'White' : 'Black'}${p && p.practised ? ` · practised ${p.practised}×` : ''}</div></div>
      <span class="side ${c.side}">${c.eco}</span></a>`;
  }
  html += '</div>';
  view.innerHTML = html;
}

function fenFromLine(line) {
  const c = new Chess();
  let last = null;
  for (const s of line.trim().split(/\s+/)) last = c.move(s);
  return { fen: c.fen(), last };
}

// ======================= Lesson =======================
export function renderLesson(view, id) {
  const lesson = LESSONS.find(l => l.id === id);
  if (!lesson) { location.hash = '#/learn'; return; }
  let idx = 0;
  let destroyed = false;
  let st = null;

  view.innerHTML = `
    <div class="progress" style="max-width:560px;margin:0 auto 12px"><div id="prog"></div></div>
    <div class="board-wrap" id="boardWrap"></div>
    <div class="lesson-text card" id="text"></div>
    <div class="lesson-nav"><button class="btn ghost" id="prevBtn">Back</button><button class="btn primary" id="nextBtn">Next</button></div>`;
  const board = new Board($('#boardWrap', view), { onMove: (f, t) => onMove(f, t) });

  function feedback(kind, html) {
    let fb = $('#fb', view);
    if (!fb) { fb = document.createElement('div'); fb.id = 'fb'; $('#text', view).appendChild(fb); }
    fb.className = 'feedback ' + kind;
    fb.innerHTML = html;
  }

  function show(i) {
    idx = i;
    engine.stop();
    const step = lesson.steps[i];
    $('#prog', view).style.width = ((i + 1) / lesson.steps.length * 100) + '%';
    $('#text', view).innerHTML = step.text;
    $('#prevBtn', view).disabled = i === 0;
    $('#nextBtn', view).textContent = i === lesson.steps.length - 1 ? 'Finish' : 'Next';

    let fen = step.fen, last = null;
    if (!fen && step.line) ({ fen, last } = (() => { const r = fenFromLine(step.line); return { fen: r.fen, last: r.last }; })());
    $('#boardWrap', view).hidden = !fen;
    st = { step, fen, done: !(step.task || step.play), pos: 0, wrong: 0, gen: (st ? st.gen + 1 : 0) };
    $('#nextBtn', view).disabled = !st.done;
    if (!fen) return;

    const chess = new Chess(fen);
    st.chess = chess;
    const interactive = !!(step.task || step.play);
    board.setOrientation(interactive ? chess.turn() : (step.orient || 'w'));
    board.setPosition(fen, { lastMove: last ? [last.from, last.to] : null, check: checkSquare(chess), animate: false });
    board.setArrows((step.arrows || []).map(a => ({ from: a[0], to: a[1], color: a[2] || 'green' })));
    const marks = { ...(step.marks || {}) };
    if (step.showMoves) for (const m of chess.moves({ square: step.showMoves, verbose: true })) marks[m.to] = 'mark';
    board.setMarks(marks);
    board.setMovable(interactive ? chess.turn() : null, destsFrom(chess));
    if (step.play) feedback('info', 'Your move. The computer will defend.');
    else if (step.task) feedback('info', step.task.anyMove ? 'Your move.' : `${chess.turn() === 'w' ? 'White' : 'Black'} to move. Find the best move.`);
  }

  function complete(msg) {
    st.done = true;
    board.setMovable(null);
    sound.play('success');
    feedback('ok', '✓ ' + (msg || st.step.success || 'Correct!'));
    $('#nextBtn', view).disabled = false;
  }

  async function onMove(from, to) {
    if (!st || st.done || !st.chess) return;
    const { chess, step } = st;
    const g = st.gen;
    const piece = chess.get(from);
    let promotion;
    if (piece && piece.type === 'p' && (to[1] === '8' || to[1] === '1')) {
      promotion = getSettings().autoQueen ? 'q' : await board.promote(piece.color);
      if (!promotion) { board.setPosition(chess.fen(), { animate: false }); board.setMovable(chess.turn(), destsFrom(chess)); return; }
    }
    const uci = from + to + (promotion || '');
    let move;
    try { move = chess.move({ from, to, promotion }); } catch { return; }
    board.setMarks({}); board.setArrows([]);

    if (step.play) return playMove(move, g);

    const t = step.task;
    const expected = t.solution ? t.solution[st.pos] : null;
    const okList = st.pos === 0 && t.accept ? t.accept : [expected];
    const correct = t.anyMove || okList.includes(uci) || (t.mate && chess.isCheckmate());
    if (!correct) {
      chess.undo();
      sound.play('error');
      st.wrong++;
      board.setPosition(move.after, { lastMove: [from, to] });
      board.setMarks({ [to]: 'wrong' });
      board.setMovable(null);
      feedback('fail', st.wrong >= 2 && expected ? `Not quite. Hint: look at the piece on <b>${expected.slice(0, 2)}</b>.` : 'Not quite. Try again!');
      await sleep(650);
      if (destroyed || g !== st.gen) return;
      board.setMarks(st.wrong >= 2 && expected ? { [expected.slice(0, 2)]: 'hint' } : {});
      board.setPosition(chess.fen(), { check: checkSquare(chess) });
      board.setMovable(chess.turn(), destsFrom(chess));
      return;
    }
    sound.forMove(move, chess);
    board.setPosition(chess.fen(), { lastMove: [from, to], check: checkSquare(chess) });
    board.setMarks({ [to]: 'good' });
    st.pos++;
    if (t.anyMove || !t.solution || st.pos >= t.solution.length || chess.isGameOver()) return complete(t.successBy?.[uci]);
    board.setMovable(null);
    feedback('ok', 'Good! Keep going…');
    await sleep(550);
    if (destroyed || g !== st.gen) return;
    const reply = chess.move(uciToMove(t.solution[st.pos]));
    st.pos++;
    sound.forMove(reply, chess);
    board.setMarks({});
    board.setPosition(chess.fen(), { lastMove: [reply.from, reply.to], check: checkSquare(chess) });
    board.setMovable(chess.turn(), destsFrom(chess));
    feedback('info', 'Your move.');
  }

  async function playMove(move, g) {
    const { chess, step } = st;
    sound.forMove(move, chess);
    board.setPosition(chess.fen(), { lastMove: [move.from, move.to], check: checkSquare(chess) });
    const goal = step.play.goal;
    if (goal === 'promote' && move.promotion) return complete();
    if (chess.isCheckmate()) return complete();
    if (chess.isDraw()) return playFail(chess.isStalemate() ? 'Stalemate! The king had no legal moves. Remember to leave it a square.' : 'The game is a draw.');
    board.setMovable(null);
    feedback('info', 'Computer is thinking…');
    const r = await engine.analyse(chess.fen(), { depth: 10 });
    if (destroyed || g !== st.gen || r.cancelled || !r.bestmove) return;
    await sleep(250);
    if (destroyed || g !== st.gen) return;
    const reply = chess.move(uciToMove(r.bestmove));
    sound.forMove(reply, chess);
    board.setPosition(chess.fen(), { lastMove: [reply.from, reply.to], check: checkSquare(chess) });
    if (chess.isDraw()) return playFail(reply.captured ? 'The computer captured your piece, and now it\'s a draw.' : 'The game is a draw.');
    if (goal === 'promote' && !chess.board().flat().some(p => p && p.type === 'p')) return playFail('Your pawn was captured.');
    board.setMovable(chess.turn(), destsFrom(chess));
    feedback('info', `Your move. <span class="muted small">(${Math.ceil(chess.history().length / 2)} moves played)</span>`);
  }

  function playFail(msg) {
    board.setMovable(null);
    sound.play('error');
    feedback('fail', `${msg} <a href="javascript:void 0" id="retry">Try again</a>`);
    $('#retry', view).addEventListener('click', () => show(idx));
  }

  $('#prevBtn', view).addEventListener('click', () => idx > 0 && show(idx - 1));
  $('#nextBtn', view).addEventListener('click', () => {
    if (idx < lesson.steps.length - 1) return show(idx + 1);
    const d = lessonProgress(); d[lesson.id] = true; store.set('lessons', d);
    const li = LESSONS.indexOf(lesson);
    const nxt = LESSONS[li + 1];
    view.innerHTML = `<div class="card center" style="padding:28px 16px">
      <div style="font-size:48px">🎉</div><h2 style="margin:8px 0">Lesson complete!</h2>
      <p class="muted">${esc(lesson.title)}</p>
      <div class="stack" style="margin-top:18px">
        ${nxt ? `<a class="btn primary big" href="#/lesson/${nxt.id}">Next: ${esc(nxt.title)}</a>` : ''}
        ${lesson.section === 'tactics' || lesson.section === 'mates' ? `<a class="btn block" href="#/puzzles">Practise with puzzles</a>` : ''}
        <a class="btn ghost block" href="#/learn">All lessons</a>
      </div></div>`;
  });

  show(0);
  return () => { destroyed = true; engine.stop(); };
}

// ======================= Opening course =======================
export function renderCourse(view, id) {
  const course = COURSES.find(c => c.id === id);
  if (!course) { location.hash = '#/learn'; return; }
  let destroyed = false;
  let mode = 'learn';
  let ply = 0;
  const line = [];
  { const c = new Chess(); for (const s of course.moves) line.push(c.move(s)); }
  const fenAt = n => (n === 0 ? new Chess().fen() : line[n - 1].after);
  let pr = null; // practice state

  view.innerHTML = `
    <div class="card">
      <div class="row"><div class="grow"><div style="font-weight:800;font-size:18px">${esc(course.name)}</div>
      <div class="small muted">${course.eco} · ${esc(course.level)} · you play ${course.side === 'w' ? 'White' : 'Black'}</div></div></div>
      <p class="small" style="margin:8px 0 0">${esc(course.summary)}</p>
      <details style="margin-top:6px"><summary class="small" style="cursor:pointer;color:var(--accent);font-weight:650">Key ideas</summary>
      <ul class="small" style="margin:6px 0 0;padding-left:18px">${course.ideas.map(i => `<li>${esc(i)}</li>`).join('')}</ul></details>
    </div>
    <div class="seg" id="modeSeg" style="max-width:560px;margin:12px auto"><button data-m="learn">📖 Learn the line</button><button data-m="practice">🎯 Practise</button></div>
    <div class="board-wrap" id="boardWrap"></div>
    <div class="coach"><div class="avatar">🎓</div><div class="grow"><div class="msg" id="note"></div></div></div>
    <div class="moves" id="moves"></div>
    <div class="navbar" id="nav">
      <button class="btn" data-nav="first">⏮</button><button class="btn" data-nav="prev">◀</button>
      <button class="btn" data-nav="next">▶</button><button class="btn" data-nav="last">⏭</button>
    </div>
    <div style="max-width:560px;margin:10px auto 0" id="practiceBar" hidden><button class="btn block" id="restartBtn">Restart practice</button></div>`;

  const board = new Board($('#boardWrap', view), { orientation: course.side, onMove: (f, t) => onPracticeMove(f, t) });

  function renderMoves(upto, highlight) {
    let html = '';
    for (let i = 0; i < upto; i++) {
      if (i % 2 === 0) html += `<span class="num">${i / 2 + 1}.</span>`;
      html += `<span class="mv ${i + 1 === highlight ? 'cur' : ''}" data-ply="${i + 1}">${esc(line[i].san)}</span>`;
    }
    const el = $('#moves', view); el.innerHTML = html; el.scrollLeft = el.scrollWidth;
  }

  function showLearn(n) {
    ply = Math.max(0, Math.min(line.length, n));
    const m = line[ply - 1];
    board.setPosition(fenAt(ply), { lastMove: m ? [m.from, m.to] : null });
    board.setMovable(null);
    board.setArrows([]); board.setMarks({});
    const note = ply === 0 ? `Step through the main line with ▶. Each important move is explained.` :
      `<b>${Math.ceil(ply / 2)}.${m.color === 'b' ? '..' : ''} ${esc(m.san)}</b> ${course.notes[ply - 1] ? esc(course.notes[ply - 1]) : ''}`;
    $('#note', view).innerHTML = note + (ply === line.length ? ` <br><span class="muted small">End of the line. Now try <b>Practise</b>!</span>` : '');
    renderMoves(line.length, ply);
  }

  function setMode(m) {
    mode = m;
    view.querySelectorAll('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.m === m));
    $('#nav', view).hidden = m !== 'learn';
    $('#practiceBar', view).hidden = m !== 'practice';
    if (m === 'learn') { pr = null; showLearn(0); } else startPractice();
  }

  // ---------- practice ----------
  function startPractice() {
    pr = { chess: new Chess(), mistakes: 0, wrongHere: 0, gen: (pr ? pr.gen + 1 : 1) };
    board.setArrows([]); board.setMarks({});
    board.setPosition(pr.chess.fen(), { animate: false });
    renderMoves(0, 0);
    $('#note', view).innerHTML = `Play the moves of the ${esc(course.name)} from memory. I'll play the other side.`;
    advance();
  }

  async function advance() {
    const g = pr.gen;
    const c = pr.chess;
    const n = c.history().length;
    if (n >= line.length) return finishPractice();
    if (c.turn() !== course.side) {
      board.setMovable(null);
      await sleep(450);
      if (destroyed || !pr || g !== pr.gen) return;
      const m = c.move(line[n].san);
      sound.forMove(m, c);
      board.setPosition(c.fen(), { lastMove: [m.from, m.to], check: checkSquare(c) });
      renderMoves(c.history().length, c.history().length);
      if (course.notes[n]) $('#note', view).innerHTML = `<b>${esc(m.san)}</b> ${esc(course.notes[n])}`;
      return advance();
    }
    pr.wrongHere = 0;
    board.setMovable(course.side, destsFrom(c));
  }

  async function onPracticeMove(from, to) {
    if (mode !== 'practice' || !pr) return;
    const c = pr.chess;
    const n = c.history().length;
    const target = line[n];
    let move;
    try { move = c.move({ from, to, promotion: 'q' }); } catch { return; }
    if (move.san !== target.san) {
      c.undo();
      sound.play('error');
      pr.mistakes++; pr.wrongHere++;
      board.setPosition(move.after, { lastMove: [from, to] });
      board.setMovable(null);
      const g = pr.gen;
      await sleep(500);
      if (destroyed || !pr || g !== pr.gen) return;
      board.setPosition(c.fen(), { lastMove: n ? [line[n - 1].from, line[n - 1].to] : null });
      board.setMovable(course.side, destsFrom(c));
      if (pr.wrongHere >= 2) {
        board.setArrows([{ from: target.from, to: target.to, color: 'blue' }]);
        $('#note', view).innerHTML = `The book move is <b>${esc(target.san)}</b>. ${course.notes[n] ? esc(course.notes[n]) : ''}`;
      } else {
        board.setMarks({ [target.from]: 'hint' });
        $('#note', view).innerHTML = `<span style="color:var(--bad);font-weight:700">Not the book move.</span> ${move.san} isn't part of this line. Hint: move the highlighted piece.`;
      }
      return;
    }
    sound.forMove(move, c);
    board.setArrows([]); board.setMarks({});
    board.setPosition(c.fen(), { lastMove: [from, to], check: checkSquare(c) });
    renderMoves(c.history().length, c.history().length);
    $('#note', view).innerHTML = `<span style="color:var(--accent);font-weight:700">✓ ${esc(move.san)}</span> ${course.notes[n] ? esc(course.notes[n]) : ''}`;
    advance();
  }

  function finishPractice() {
    board.setMovable(null);
    sound.play('success');
    const cp = store.get('courses', {});
    const p = cp[course.id] || { practised: 0, mastered: false };
    p.practised++;
    if (pr.mistakes === 0) p.mastered = true;
    cp[course.id] = p; store.set('courses', cp);
    $('#note', view).innerHTML = pr.mistakes === 0
      ? `🎉 <b>Perfect!</b> You played the whole line without mistakes. This opening is now marked as mastered.`
      : `<b>Line complete</b> with ${pr.mistakes} mistake${pr.mistakes > 1 ? 's' : ''}. Practise again to master it!`;
  }

  $('#modeSeg', view).addEventListener('click', e => { const b = e.target.closest('button'); if (b) setMode(b.dataset.m); });
  $('#nav', view).addEventListener('click', e => {
    const b = e.target.closest('[data-nav]'); if (!b) return;
    const prev = ply;
    ({ first: () => showLearn(0), prev: () => showLearn(ply - 1), next: () => showLearn(ply + 1), last: () => showLearn(line.length) })[b.dataset.nav]();
    if (ply === prev + 1 && line[ply - 1]) sound.forMove(line[ply - 1], new Chess(fenAt(ply)));
  });
  $('#moves', view).addEventListener('click', e => { const m = e.target.closest('[data-ply]'); if (m && mode === 'learn') showLearn(+m.dataset.ply); });
  $('#restartBtn', view).addEventListener('click', startPractice);

  setMode('learn');
  return () => { destroyed = true; };
}
