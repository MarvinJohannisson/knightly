# Knightly – free chess trainer

A mobile-first chess app that runs entirely in the browser (no server, no account, works offline once loaded).

- **Play**: 10 bots from ~400 to full-strength Stockfish, with a coach that grades your moves, hints, takebacks, live opening names and a full game review with accuracy that explains your mistakes and lets you retry them. Turn on **Bot move** during a game to choose the bot's replies yourself and see how a line plays out (such games don't count in your stats).
- **Puzzles**: 4,232 rated puzzles from the Lichess database with your own puzzle rating, practice by theme, hints and explanations.
- **Learn**: 20 interactive lessons (basics, opening principles, tactics, mating patterns, endgames, thinking habits) and 11 opening courses you can practise move by move.

## Run locally

Any static file server works, e.g. `python -m http.server` in this folder, then open http://localhost:8000.
(Opening `index.html` directly from disk does not work because browsers block modules and workers on `file://`.)

## Deploy to GitHub Pages

1. Create a new public repository on GitHub (e.g. `knightly`).
2. Upload everything in this folder (drag and drop on the repo page works, or `git push`).
3. Repo **Settings → Pages → Build and deployment → Source: Deploy from a branch**, branch `main`, folder `/ (root)`.
4. After a minute the app is live at `https://<your-username>.github.io/knightly/`.
5. On your phone, open that URL and use **Add to Home Screen** (Safari: Share menu; Chrome: ⋮ menu) to install it like an app.

When you change files later, bump `VERSION` in `sw.js` so phones pick up the update.

## Tests

With the app served locally, open:
- `tests/test.html` checks every lesson position and solution against Stockfish, the opening lines, the puzzle data and the bots.
- `tests/e2e.html` plays through the app like a user (game, coach, hint, takeback, review, lessons, puzzle, course).
- `tests/phone.html#/route` previews a screen at phone size.
- `tests/calibrate.html` measures bot strength with matches and rated puzzles (slow; `?workers=N` runs engines in parallel).

## Structure

```
index.html, css/app.css, sw.js, manifest.webmanifest
js/app.js        router, home, settings
js/board.js      touch chessboard (tap or drag)
js/engine.js     Stockfish web worker wrapper
js/bots.js       bot personalities
js/play.js       game vs bot + coach
js/review.js     post-game analysis
js/puzzles.js    puzzle trainer      js/themes.js   theme explanations
js/learn.js      lessons + courses   js/lessons.js, js/courses.js   content
data/            puzzles.json, openings.json
vendor/          chess.js, stockfish
```

## Credits and licences

- Stockfish (GPLv3) via stockfish.js by Niklas Fiekas. See `vendor/stockfish/COPYING.txt`. Because Stockfish is GPL, keep the repository public so its source stays available.
- chess.js by Jeff Hlywa (BSD-2-Clause), `vendor/chess.js-LICENSE.txt`.
- Puzzles and opening names: Lichess open database (CC0).
- Piece set "cburnett" by Colin M.L. Burnett (CC BY-SA 3.0).
