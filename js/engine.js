// Stockfish (WASM, with asm.js fallback) running in a Web Worker.
// All requests go through a serial queue; scores are reported from WHITE's point of view.

const wasmSupported = typeof WebAssembly === 'object' &&
  WebAssembly.validate(Uint8Array.of(0x0, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00));

class Engine {
  constructor() {
    this.worker = null;
    this.queue = [];
    this.current = null;
    this.readyPromise = null;
    this.opts = {};
  }

  init() {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = new Promise((resolve, reject) => {
      try {
        const file = wasmSupported ? 'stockfish.wasm.js' : 'stockfish.js';
        this.worker = new Worker(new URL('../vendor/stockfish/' + file, import.meta.url));
      } catch (e) { reject(e); return; }
      this._onReady = resolve;
      this.worker.onmessage = e => this._line(String(e.data));
      this.worker.onerror = e => console.error('Engine error', e);
      this._send('uci');
    });
    return this.readyPromise;
  }

  _send(cmd) { this.worker.postMessage(cmd); }

  _setOption(name, value) {
    if (this.opts[name] === value) return;
    this.opts[name] = value;
    this._send(`setoption name ${name} value ${value}`);
  }

  _line(line) {
    if (line === 'uciok') { this._send('setoption name Hash value 16'); this._send('isready'); return; }
    if (line === 'readyok') {
      if (this._onReady) { this._onReady(); this._onReady = null; this._next(); }
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
      if (job.onInfo && multipv === 1) job.onInfo(job.lines[0]);
    } else if (line.startsWith('bestmove')) {
      const bm = line.split(' ')[1];
      this.current = null;
      job.resolve({
        bestmove: bm && bm !== '(none)' ? bm : null,
        lines: job.lines.filter(Boolean),
        score: job.lines[0] ? job.lines[0].score : null,
        cancelled: job.cancelled,
      });
      this._next();
    }
  }

  _next() {
    if (this.current || this._onReady || !this.queue.length) return;
    const job = this.queue.shift();
    this.current = job;
    this._setOption('Skill Level', job.skill ?? 20);
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
    return this.init().then(() => new Promise(resolve => {
      this.queue.push({ ...opts, fen, resolve, lines: [], blackToMove: fen.split(' ')[1] === 'b' });
      this._next();
    }));
  }

  /** Cancel all pending work. Pending promises resolve with cancelled: true. */
  stop() {
    for (const job of this.queue) job.resolve({ bestmove: null, lines: [], score: null, cancelled: true });
    this.queue = [];
    if (this.current) { this.current.cancelled = true; this._send('stop'); }
  }

  newGame() { if (this.worker) this._send('ucinewgame'); }
}

export const engine = new Engine();
