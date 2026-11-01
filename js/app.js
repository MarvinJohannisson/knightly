// App shell: hash router, home screen, settings.
import { $, $$, esc, store, getSettings, setSetting, applySettings, confirmBox, toast } from './util.js';
import { renderPlaySetup, renderGame } from './play.js';
import { renderReview } from './review.js';
import { renderPuzzleHub, renderPuzzle, getPuzzleStats } from './puzzles.js';
import { renderLearnHub, renderLesson, renderCourse, nextLesson, lessonProgress } from './learn.js';
import { botById } from './bots.js';
import { tipOfTheDay } from './tips.js';
import { themeInfo } from './themes.js';
import { LESSONS } from './lessons.js';

const view = $('#view');
let cleanup = null;

const routes = {
  '': { title: 'Knightly', tab: 'home', render: renderHome },
  'play': { title: 'Play', tab: 'play', render: renderPlaySetup },
  'game': { title: 'Game', tab: 'play', back: '#/play', render: renderGame },
  'review': { title: 'Game review', tab: 'play', back: '#/play', render: renderReview },
  'puzzles': { title: 'Puzzles', tab: 'puzzles', render: renderPuzzleHub },
  'puzzle': { title: 'Puzzle', tab: 'puzzles', back: '#/puzzles', render: renderPuzzle,
    titleFn: p => p ? (themeInfo(p)?.name || 'Puzzle') : 'Rated puzzles' },
  'learn': { title: 'Learn', tab: 'learn', render: renderLearnHub },
  'lesson': { title: 'Lesson', tab: 'learn', back: '#/learn', render: renderLesson,
    titleFn: p => LESSONS.find(l => l.id === p)?.title || 'Lesson' },
  'course': { title: 'Opening', tab: 'learn', back: '#/learn', render: renderCourse },
  'settings': { title: 'Settings', tab: null, back: '#/', render: renderSettings },
};

function route() {
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const r = routes[parts[0]] || routes[''];
  const param = parts[1] ? decodeURIComponent(parts[1]) : undefined;
  $('#viewTitle').textContent = r.titleFn ? r.titleFn(param) : r.title;
  $('#backBtn').hidden = !r.back;
  $('#backBtn').onclick = () => { location.hash = r.back; };
  $$('#tabbar a').forEach(a => a.classList.toggle('active', a.dataset.tab === r.tab));
  view.innerHTML = '';
  window.scrollTo(0, 0);
  try { cleanup = r.render(view, param) || null; }
  catch (e) { console.error(e); view.innerHTML = `<div class="card">Something went wrong: ${esc(e.message)}</div>`; }
}

// ======================= Home =======================
function renderHome(v) {
  const game = store.get('game', null);
  const ps = getPuzzleStats();
  const stats = store.get('stats', { games: 0, wins: 0 });
  const nl = nextLesson();
  const done = Object.keys(lessonProgress()).length;
  const [tipTitle, tipText] = tipOfTheDay();
  v.innerHTML = `
    <div class="hero">
      ${game && !game.result && game.moves.length ? `
        <a class="tile accent" href="#/game"><div class="ico" style="background:#3c5c43">${botById(game.botId).avatar}</div>
          <div><div class="t">Continue your game</div><div class="s">vs ${esc(botById(game.botId).name)} · move ${Math.floor(game.moves.length / 2) + 1}</div></div><div class="go">›</div></a>` : ''}
      <a class="tile ${game && !game.result && game.moves.length ? '' : 'accent'}" href="#/play"><div class="ico" style="background:#3a4a6b">♟️</div>
        <div><div class="t">Play a bot</div><div class="s">10 opponents from beginner to master</div></div><div class="go">›</div></a>
      <a class="tile" href="#/puzzle"><div class="ico" style="background:#5c4a2e">🧩</div>
        <div><div class="t">Solve puzzles</div><div class="s">Rating ${Math.round(ps.rating)}${ps.streak > 1 ? ` · 🔥 ${ps.streak} streak` : ''}</div></div><div class="go">›</div></a>
      <a class="tile" href="${nl ? '#/lesson/' + nl.id : '#/learn'}"><div class="ico" style="background:#4b3560">🎓</div>
        <div><div class="t">${nl ? (done ? 'Next lesson' : 'Start learning') : 'Lessons & openings'}</div><div class="s">${nl ? esc(nl.title) : 'All lessons completed!'}</div></div><div class="go">›</div></a>
    </div>

    <div class="section-title">Tip of the day</div>
    <div class="card tip"><div class="h">💡 ${esc(tipTitle)}</div><div class="muted">${esc(tipText)}</div></div>

    <div class="section-title">Your stats</div>
    <div class="stats">
      <div class="stat"><div class="v">${stats.games || 0}</div><div class="l">Games</div></div>
      <div class="stat"><div class="v">${stats.wins || 0}</div><div class="l">Wins</div></div>
      <div class="stat"><div class="v">${ps.solved}</div><div class="l">Puzzles solved</div></div>
    </div>
    ${renderRecent()}
  `;
}

function renderRecent() {
  const archive = store.get('archive', []);
  if (!archive.length) return '';
  return `<div class="section-title">Recent games</div><div class="lesson-list">${archive.slice(0, 5).map((g, i) => {
    const b = botById(g.botId);
    const r = g.result;
    const res = !r ? '–' : !r.winner ? '½' : r.winner === g.playerColor ? 'Won' : 'Lost';
    const col = res === 'Won' ? 'var(--accent)' : res === 'Lost' ? 'var(--bad)' : 'var(--text-2)';
    return `<a class="lesson-item" href="#/review/a${i}"><div class="n">${b.avatar}</div>
      <div class="grow"><div class="t">vs ${esc(b.name)} <span class="muted small">~${b.rating}</span></div><div class="s">${r ? esc(r.reason) : ''} · ${Math.ceil(g.moves.length / 2)} moves · tap to review</div></div>
      <div style="font-weight:800;color:${col}">${res}</div></a>`;
  }).join('')}</div>`;
}

// ======================= Settings =======================
function renderSettings(v) {
  const s = getSettings();
  const tog = (key, label, desc) => `<label class="toggle-row"><div><div class="label">${label}</div>${desc ? `<div class="desc">${desc}</div>` : ''}</div>
    <span class="switch"><input type="checkbox" data-k="${key}" ${s[key] ? 'checked' : ''}><span></span></span></label>`;
  v.innerHTML = `
    <div class="section-title">Board</div>
    <div class="card">
      <div class="toggle-row"><div class="label">Board colours</div>
        <select class="select" id="boardSel">${[['forest', 'Forest'], ['walnut', 'Walnut'], ['ocean', 'Ocean'], ['slate', 'Slate'], ['rose', 'Rose']].map(([k, n]) => `<option value="${k}" ${s.board === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      ${tog('coords', 'Coordinates', 'Show a–h and 1–8 on the board')}
      ${tog('dests', 'Show legal moves', 'Dots on squares the selected piece can move to')}
      ${tog('animation', 'Animations')}
      ${tog('autoQueen', 'Auto-promote to queen')}
      ${tog('sound', 'Sounds')}
    </div>
    <div class="section-title">Games</div>
    <div class="card">
      ${tog('coach', 'Coach', 'Comments on your moves while playing bots')}
      ${tog('evalBar', 'Evaluation bar', 'Shows who is better during games')}
    </div>
    <div class="section-title">Data</div>
    <div class="card">
      <p class="small muted" style="margin-top:0">Your progress is stored only on this device.</p>
      <button class="btn danger block" id="resetBtn">Reset all progress</button>
    </div>
    <div class="section-title">About</div>
    <div class="card credits">
      <p><b>Knightly</b>: a free chess trainer. No ads, no account.</p>
      <p>Engine: <a href="https://github.com/official-stockfish/Stockfish" target="_blank" rel="noopener">Stockfish</a> (GPLv3) via <a href="https://github.com/niklasf/stockfish.js" target="_blank" rel="noopener">stockfish.js</a>.</p>
      <p>Rules: <a href="https://github.com/jhlywa/chess.js" target="_blank" rel="noopener">chess.js</a> (BSD-2).</p>
      <p>Puzzles and opening names: <a href="https://database.lichess.org/" target="_blank" rel="noopener">Lichess open database</a> (CC0).</p>
      <p>Pieces: "cburnett" by Colin M.L. Burnett (CC BY-SA 3.0).</p>
    </div>`;
  v.querySelectorAll('input[data-k]').forEach(i => i.addEventListener('change', () => setSetting(i.dataset.k, i.checked)));
  $('#boardSel', v).addEventListener('change', e => setSetting('board', e.target.value));
  $('#resetBtn', v).addEventListener('click', async () => {
    if (await confirmBox('Reset everything?', '<p class="muted">Games, puzzle rating, lessons and settings will be deleted from this device.</p>', 'Reset')) {
      store.clearAll(); applySettings(); toast('Progress reset'); route();
    }
  });
}

// ======================= Boot =======================
$('#settingsBtn').addEventListener('click', () => { location.hash = '#/settings'; });
window.addEventListener('hashchange', route);
applySettings();
route();

if ('serviceWorker' in navigator && location.protocol !== 'file:' && !location.search.includes('nosw')) {
  navigator.serviceWorker.register('sw.js').catch(() => { });
}
