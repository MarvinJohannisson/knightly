// Stockfish running in Web Workers. All requests to one engine go through a serial queue; scores
// are reported from WHITE's point of view.
// - `engine` is the 2019 Stockfish the bots were tuned on (Skill Level, Contempt); it plays their moves.
// - `analyser` is Stockfish 19 lite (NNUE), much stronger and faster; it judges moves for the
//   coach, hints and the game review. It falls back to the old engine where WASM is missing.

const wasmSupported = typeof WebAssembly === 'object' &&
  WebAssembly.validate(Uint8Array.of(0x0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00));

export class Engine {
  /** file: worker script under vendor/; legacy: the 2019 build, which has the Contempt option. */
  constructor({ file = () => (wasmSupported ? 'stockfish/stockfish.wasm.js' : 'stockfish/stockfish.js'), legacy = true, hash = 16 } = {}) {
    this.file = file;
    this.legacy = legacy;
    this.hash = hash;
    this.worker = null;
    this.queue = [];
    this.current = null;
    this.readyPromise = null;
    this.opts = {};
    this.stopGen = 0;
    this._pendingNewGame = false;
  }

  init() {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = new Promise((resolve, reject) => {
      try {
        this.worker = new Worker(new URL('../vendor/' + this.file(), import.meta.url));
      } catch (e) { this.readyPromise = null; reject(e); return; }
      this._onReady = resolve;
      this._onReadyReject = reject;
      this.worker.onmessage = e => this._line(String(e.data));
      this.worker.onerror = e => this._fail(e);
      this._send('uci');
    });
    return this.readyPromise;
  }

  _fail(err) {
    console.error('Engine error', err);
    const rej = this._onReadyReject;
    this._onReady = null;
    this._onReadyReject = null;
    this.readyPromise = null;
    this.opts = {};
    this._pendingNewGame = false;
    if (this.worker) { try { this.worker.terminate(); } catch { } this.worker = null; }
    const cur = this.current;
    this.current = null;
    const queued = this.queue;
    this.queue = [];
    if (cur) cur.resolve({ bestmove: null, lines: [], score: null, cancelled: true });
    for (const job of queued) job.resolve({ bestmove: null, lines: [], score: null, cancelled: true });
    if (rej) rej(err);
  }

  _send(cmd) { if (this.worker) this.worker.postMessage(cmd); }

  _setOption(name, value) {
    if (this.opts[name] === value) return;
    this.opts[name] = value;
    this._send(`setoption name ${name} value ${value}`);
  }

  _line(line) {
    if (line === 'uciok') { this._send(`setoption name Hash value ${this.hash}`); this._send('isready'); return; }
    if (line === 'readyok') {
      if (this._onReady) {
        const done = this._onReady;
        this._onReady = null;
        this._onReadyReject = null;
        done();
        this._next();
      }
      return;
    }
    const job = this.current;
    if (!job) return;
    if (line.startsWith('info ') && line.includes(' pv ') && !line.includes('bound')) {
      const tok = line.split(' ');
      const get = k => { const i = tok.indexOf(k); return i >= 0 ? tok[i + 1] : null; };
      const multipv = +(get('multipv') || 1);
      const depth = +get('depth');
      const si = tok.indexOf('score');
      let score = null;
      if (si >= 0) {
        const v = +tok[si + 2];
        score = tok[si + 1] === 'mate' ? { mate: v } : { cp: v };
        if (job.blackToMove) score = score.mate != null ? { mate: -score.mate } : { cp: -score.cp };
      }
      const pv = tok.slice(tok.indexOf('pv') + 1);
      job.lines[multipv - 1] = { multipv, depth, score, pv, move: pv[0] };
      if (job.onInfo && !job.cancelled && multipv === 1) job.onInfo(job.lines[0]);
      // While a depth is being searched, the lines are a mix of this depth and the last one, and
      // a move can show up twice. Keep the last set in which every line comes from one depth.
      const set = job.lines.filter(Boolean);
      if (set.length >= job.whole.length && set.every(l => l.depth === depth) && new Set(set.map(l => l.move)).size === set.length) job.whole = set;
    } else if (line.startsWith('bestmove')) {
      const bm = line.split(' ')[1];
      this.current = null;
      const lines = job.whole;
      const best = bm && bm !== '(none)' ? bm : null;
      // Skill-level bots pick a weaker move on purpose, so only a plain multi-line search is re-ranked.
      const ranked = job.multipv > 1 && job.skill == null && lines.length > 1;
      job.resolve({
        bestmove: best && ranked ? lines[0].move : best,
        lines,
        score: lines[0] ? lines[0].score : null,
        cancelled: job.cancelled,
      });
      this._next();
    }
  }

  _next() {
    if (this.current || this._onReady || !this.worker) return;
    if (this._pendingNewGame) {
      this._pendingNewGame = false;
      this._send('ucinewgame');
    }
    if (!this.queue.length) return;
    const job = this.queue.shift();
    this.current = job;
    this._setOption('Skill Level', job.skill ?? 20);
    // Contempt favours the side to move, which would make every move look like it loses ~65cp.
    // Only the skill-level bots keep the default, so they still play on rather than take draws.
    // Stockfish 19 has no contempt.
    if (this.legacy) this._setOption('Contempt', job.skill == null ? 0 : 24);
    this._setOption('MultiPV', job.multipv || 1);
    this._send('position fen ' + job.fen);
    let go = 'go';
    if (job.depth) go += ' depth ' + job.depth;
    if (job.movetime) go += ' movetime ' + job.movetime;
    if (!job.depth && !job.movetime) go += ' depth 12';
    this._send(go);
  }

  /** analyse(fen, {depth, movetime, multipv, skill, onInfo}) -> Promise<{bestmove, score, lines, cancelled}> */
  analyse(fen, opts = {}) {
    const gen = this.stopGen;
    return this.init().then(() => {
      if (gen !== this.stopGen) return { bestmove: null, lines: [], score: null, cancelled: true };
      return new Promise(resolve => {
        this.queue.push({ ...opts, fen, resolve, lines: [], whole: [], blackToMove: fen.split(' ')[1] === 'b' });
        this._next();
      });
    });
  }

  /** Cancel all pending work. Pending promises resolve with cancelled: true. */
  stop() {
    this.stopGen++;
    for (const job of this.queue) job.resolve({ bestmove: null, lines: [], score: null, cancelled: true });
    this.queue = [];
    if (this.current && !this.current.cancelled) { this.current.cancelled = true; this._send('stop'); }
  }

  newGame() {
    if (!this.worker || this._onReady) return;
    if (this.current) this._pendingNewGame = true;
    else this._send('ucinewgame');
  }
}

export const engine = new Engine();
export const analyser = wasmSupported
  ? new Engine({ file: () => 'stockfish19/stockfish-19-lite-single.js', legacy: false, hash: 32 })
  : engine;
