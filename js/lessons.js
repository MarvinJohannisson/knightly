// Lesson content. Step kinds:
//  info:  { text, fen | line, arrows, marks, showMoves }
//  task:  { text, fen | line, task: { solution: [uci...alternating], accept: [uci] (first-move alternatives), anyMove, mate } , success }
//  play:  { text, fen, play: { goal: 'mate' | 'promote' }, success }
// `line` is a SAN move sequence from the start position (guarantees a legal setup).

export const SECTIONS = [
  { id: 'basics', title: 'The Basics', icon: '♙' },
  { id: 'opening', title: 'Opening Principles', icon: '📖' },
  { id: 'tactics', title: 'Tactics', icon: '⚔️' },
  { id: 'mates', title: 'Checkmate Patterns', icon: '♚' },
  { id: 'endgame', title: 'Endgames', icon: '🏁' },
  { id: 'thinking', title: 'Think Like a Player', icon: '🧠' },
];

export const LESSONS = [
  // ------------------------------------------------------------------ BASICS
  {
    id: 'pieces', section: 'basics', title: 'How the pieces move', sub: 'King, queen, rook, bishop, knight and pawn',
    steps: [
      { text: `<h3>The chessboard</h3><p>The board has 64 squares. Each player starts with 16 pieces. <b>White always moves first.</b></p><p>Tip: there is always a <b>light square in the bottom-right corner</b>. Columns are called <b>files</b> (a–h) and rows are <b>ranks</b> (1–8), so every square has a name like <b>e4</b>.</p>`,
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', marks: { e4: 'mark' } },
      { text: `<h3>The king ♔</h3><p>The king moves <b>one square in any direction</b>. It is the most important piece: if your king is trapped (checkmate), you lose.</p><p>Try it: move the king.</p>`,
        fen: '7k/8/8/8/3K4/8/8/8 w - - 0 1', showMoves: 'd4', task: { anyMove: true }, success: 'Kings are slow, but in the endgame they become strong fighters.' },
      { text: `<h3>The queen ♕</h3><p>The queen is the strongest piece. She moves <b>any number of squares</b> in a straight line or diagonally.</p><p>Move the queen anywhere.</p>`,
        fen: '7k/8/8/8/3Q4/8/8/K7 w - - 0 1', showMoves: 'd4', task: { anyMove: true }, success: 'The queen is worth about 9 pawns. Don\'t lose her!' },
      { text: `<h3>The rook ♖</h3><p>The rook moves any number of squares <b>straight</b>: up, down, left or right.</p>`,
        fen: '7k/8/8/8/3R4/8/8/K7 w - - 0 1', showMoves: 'd4', task: { anyMove: true }, success: 'Rooks are worth about 5 pawns and love open files.' },
      { text: `<h3>The bishop ♗</h3><p>The bishop moves any number of squares <b>diagonally</b>. A bishop always stays on the same colour.</p>`,
        fen: '7k/8/8/8/3B4/8/8/K7 w - - 0 1', showMoves: 'd4', task: { anyMove: true }, success: 'Bishops are worth about 3 pawns. Two bishops together are very strong.' },
      { text: `<h3>The knight ♘</h3><p>The knight moves in an <b>L-shape</b>: two squares in one direction and one to the side. It is the only piece that can <b>jump over</b> other pieces.</p>`,
        fen: '7k/8/8/2PPP3/2PNP3/2PPP3/8/K7 w - - 0 1', showMoves: 'd4', task: { anyMove: true }, success: 'Knights are worth about 3 pawns and are great at forks.' },
      { text: `<h3>The pawn ♙</h3><p>Pawns move <b>one square forward</b> (or two on their first move), but they <b>capture diagonally</b>.</p><p>Capture the black pawn!</p>`,
        fen: '7k/8/8/8/8/2p5/3P4/K7 w - - 0 1', showMoves: 'd2', task: { solution: ['d2c3'] }, success: 'Correct! Pawns capture one square diagonally forward.' },
    ],
  },
  {
    id: 'values', section: 'basics', title: 'Piece values', sub: 'Which trades are good for you?',
    steps: [
      { text: `<h3>Counting material</h3><p>Pieces have rough point values:</p><ul><li>Pawn = <b>1</b></li><li>Knight = <b>3</b>, Bishop = <b>3</b></li><li>Rook = <b>5</b></li><li>Queen = <b>9</b></li><li>King = priceless</li></ul><p>A good trade gives up fewer points than you get back.</p>`,
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' },
      { text: `<h3>Free or defended?</h3><p>Your queen can capture the knight on d5 or the bishop on g4. One of them is protected by a pawn, the other is <b>free</b>. Which capture wins material?</p>`,
        fen: '4k3/pp3ppp/2p5/3n4/6b1/8/PPP2PPP/3QK3 w - - 0 1', task: { solution: ['d1g4'] },
        success: 'Right! The knight was defended by the c6-pawn: Qxd5 cxd5 would lose your queen (9) for a knight (3).' },
      { text: `<h3>Always count</h3><p>Before you capture, ask two questions:</p><ul><li>Is the piece <b>defended</b>?</li><li>If I capture and they recapture, who comes out ahead?</li></ul><p>This simple habit will win you many games at every level.</p>` },
    ],
  },
  {
    id: 'special', section: 'basics', title: 'Special moves', sub: 'Castling, en passant and promotion',
    steps: [
      { text: `<h3>Castling</h3><p>Castling moves your king two squares toward a rook, and the rook jumps over to the other side. It keeps your king safe and brings your rook into play.</p><p>You can only castle if: neither piece has moved, the squares between them are empty, and your king is not in check and does not pass through or land on an attacked square.</p><p><b>Castle kingside</b>: move your king two squares to the right.</p>`,
        line: 'e4 e5 Nf3 Nc6 Bc4 Bc5', task: { solution: ['e1g1'], teach: true }, success: 'Your king is now safely tucked away on g1.' },
      { text: `<h3>En passant</h3><p>If an enemy pawn moves two squares and lands right <b>next to</b> your pawn, you may capture it as if it had moved only one square. You must do it immediately, or the chance is gone.</p><p>Black just played f7–f5. Capture it <b>en passant</b> with your e5-pawn.</p>`,
        line: 'e4 a6 e5 f5', arrows: [['f7', 'f5', 'yellow']], task: { solution: ['e5f6'], teach: true }, success: 'Your pawn lands on f6 and the black pawn disappears.' },
      { text: `<h3>Promotion</h3><p>When a pawn reaches the last rank it <b>promotes</b>, usually into a queen.</p><p>Push the pawn to e8 and choose a queen.</p>`,
        fen: '8/4P1k1/8/8/8/8/8/4K3 w - - 0 1', task: { solution: ['e7e8q'] }, success: 'A new queen! Pawns that are close to promoting are very dangerous.' },
    ],
  },
  {
    id: 'checkmate', section: 'basics', title: 'Check, checkmate & stalemate', sub: 'How a game is won (or drawn)',
    steps: [
      { text: `<h3>Check</h3><p>When a king is attacked, it is in <b>check</b>. You must get out of check immediately, in one of three ways:</p><ul><li><b>Move</b> the king</li><li><b>Block</b> the attack</li><li><b>Capture</b> the attacker</li></ul><p>Your king is in check from the rook. Get out of check!</p>`,
        fen: '4r1k1/8/8/8/8/8/3N1PPP/4K3 w - - 0 1', task: { anyMove: true }, success: 'You are out of check. Kf1 or Kd1 is best here: blocking with Ne4 is legal, but the rook simply takes the undefended knight.' },
      { text: `<h3>Checkmate</h3><p>If the king is in check and <b>none</b> of the three escapes works, it is <b>checkmate</b> and the game is over.</p><p>The black king is trapped behind its own pawns. Deliver checkmate in one move.</p>`,
        fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', task: { solution: ['d1d8'], mate: true }, success: 'Checkmate! This is called a back-rank mate.' },
      { text: `<h3>Another checkmate</h3><p>Use your king to support the queen. Find the checkmate.</p>`,
        fen: '7k/8/6K1/8/8/8/8/1Q6 w - - 0 1', task: { solution: ['b1b8'], mate: true }, success: 'Checkmate! Your king covers g7 and h7, and the queen controls the whole back rank.' },
      { text: `<h3>Stalemate: careful!</h3><p>If the player to move is <b>not in check</b> but has <b>no legal moves</b>, it is <b>stalemate</b>, and the game is a <b>draw</b>.</p><p>Here Black to move has no legal moves and is not in check. This is a draw, even though White has a whole extra queen. When you are winning, always make sure the enemy king has a square to move to until you deliver mate.</p>`,
        fen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', marks: { h8: 'wrong', g8: 'mark', h7: 'mark', g7: 'mark' } },
    ],
  },

  // ------------------------------------------------------------------ OPENING
  {
    id: 'principles', section: 'opening', title: 'The golden rules', sub: 'Center, development, king safety',
    steps: [
      { text: `<h3>1. Fight for the center</h3><p>The four central squares (d4, e4, d5, e5) are the most important. Pieces in the center control more squares. Start with a central pawn move like <b>e4</b> or <b>d4</b>.</p>`,
        fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', arrows: [['e2', 'e4', 'green'], ['d2', 'd4', 'green']], marks: { d4: 'mark', e4: 'mark', d5: 'mark', e5: 'mark' } },
      { text: `<h3>2. Develop your pieces</h3><p>Bring your knights and bishops off the back rank quickly, toward the center. A piece that hasn't moved is not helping.</p><p>Develop your knight to its best square.</p>`,
        line: 'e4 e5', task: { solution: ['g1f3'], accept: ['g1f3', 'b1c3'], successBy: { b1c3: 'Nc3 develops a piece toward the center and protects the e4-pawn.' } }, success: 'Nf3 develops a piece and attacks the e5-pawn at the same time.' },
      { text: `<h3>Knights before bishops</h3><p>A good rule of thumb: develop knights first (their best squares are obvious: f3/c3 or f6/c6), then bishops.</p><p>Now develop your bishop to an active square.</p>`,
        line: 'e4 e5 Nf3 Nc6', task: { solution: ['f1c4'], accept: ['f1c4', 'f1b5'], teach: true, successBy: { f1b5: 'The bishop now attacks the c6-knight, the piece defending e5.' } }, success: 'The bishop now aims at f7, the weakest point in Black\'s camp.' },
      { text: `<h3>3. Castle early</h3><p>Get your king to safety, usually within the first 10 moves. Castling also helps connect your rooks, once the pieces between them have moved.</p>`,
        line: 'e4 e5 Nf3 Nc6 Bc4 Bc5', task: { solution: ['e1g1'], teach: true }, success: 'Your king is safe and your rook can join the game.' },
      { text: `<h3>4. Don't bring the queen out too early</h3><p>An early queen gets chased around by enemy pieces, and every time she has to move, your opponent develops with tempo.</p><p>Here White moved the queen twice. Black kicked her with g6 and developed both knights.</p>`,
        line: 'e4 e5 Qh5 Nc6 Bc4 g6 Qf3 Nf6' },
      { text: `<h3>Summary</h3><ul><li>Control the center with pawns and pieces</li><li>Develop knights and bishops quickly</li><li>Castle early</li><li>Don't move the same piece twice without a reason</li><li>Don't bring the queen out too early</li><li>Connect your rooks</li></ul><p>Follow these and you'll get a good position against almost any opponent.</p>` },
    ],
  },
  {
    id: 'scholar', section: 'opening', title: "Stop Scholar's Mate", sub: 'Defend against the 4-move checkmate',
    steps: [
      { text: `<h3>The threat</h3><p>White's queen and bishop are both aiming at <b>f7</b>. If Black ignores it, <b>Qxf7#</b> is checkmate. This trap catches many beginners.</p><p>You are Black. Stop the threat, ideally while also attacking the queen.</p>`,
        line: 'e4 e5 Qh5 Nc6 Bc4', arrows: [['h5', 'f7', 'red'], ['c4', 'f7', 'red']],
        task: { solution: ['g7g6'], accept: ['g7g6', 'd8e7', 'd8f6'], teach: true, successBy: { d8e7: 'Well defended! Qe7 protects f7. (g6 also works, and kicks the queen away.)', d8f6: 'Well defended! Qf6 protects f7, though it takes the best square from your knight.' } }, success: 'Well defended! g6 blocks the attack and kicks the queen away. (Qe7 also defends f7.)' },
      { text: `<h3>It's not over</h3><p>White tries again: Qf3 renews the attack on f7. Defend once more, and develop a piece at the same time.</p>`,
        line: 'e4 e5 Qh5 Nc6 Bc4 g6 Qf3', arrows: [['f3', 'f7', 'red']],
        task: { solution: ['g8f6'] }, success: 'Nf6 blocks the queen and develops a piece. Black is already slightly better, because White wasted time with the queen.' },
    ],
  },

  {
    id: 'traps', section: 'opening', title: 'Opening traps', sub: "Fool's mate and Légal's mate",
    steps: [
      { text: `<h3>Learn from traps</h3><p>Opening traps are worth knowing, not to play for them, but because each one teaches a rule:</p><ul><li>Don't weaken the pawns in front of your king.</li><li>Don't grab material without checking what your opponent gets in return.</li><li>A pin against the queen is not a pin against the king: the pinned piece <b>can</b> move.</li></ul>` },
      { text: `<h3>Fool's mate</h3><p>White has pushed the f- and g-pawns, opening the diagonal to the king. You are Black. Deliver checkmate in one move.</p>`,
        line: 'f3 e5 g4', task: { solution: ['d8h4'], mate: true },
        success: "Checkmate! This is Fool's mate, the fastest checkmate possible. The f- and g-pawns shield your king, so don't push them early." },
      { text: `<h3>Légal's mate</h3><p>Black's bishop pins your knight to your queen, and Black has just played the slow g6. But this is only a <b>relative</b> pin: the knight is allowed to move.</p><p>Break the pin and win a pawn. If Black greedily grabs your queen, you have checkmate in three more moves.</p>`,
        line: 'e4 e5 Nf3 d6 Bc4 Bg4 Nc3 g6', arrows: [['g4', 'd1', 'red']],
        task: { solution: ['f3e5', 'g4d1', 'c4f7', 'e8e7', 'c3d5'], mate: true },
        success: "Légal's mate! Three minor pieces beat a whole queen. If Black had played 5...dxe5 instead, 6.Qxg4 would simply win a pawn." },
    ],
  },
  // ------------------------------------------------------------------ TACTICS
  {
    id: 'forks', section: 'tactics', title: 'Forks', sub: 'One piece attacks two',
    steps: [
      { text: `<h3>What is a fork?</h3><p>A <b>fork</b> is a move that attacks two enemy pieces at once. Your opponent can only save one of them.</p><p>Knights are the champions of forks, because their jumping attack is hard to see.</p>` },
      { text: `<h3>Royal fork</h3><p>Find the knight move that attacks the king <b>and</b> the rook.</p>`,
        fen: 'r3k3/pp3ppp/8/3N4/8/8/PP3PPP/4K3 w - - 0 1', task: { solution: ['d5c7', 'e8d7', 'c7a8'] }, success: 'The king must move, and you win the rook. A fork with check is especially strong.' },
      { text: `<h3>Pawn fork</h3><p>Even humble pawns can fork. Push a pawn to attack both black pieces.</p>`,
        fen: '4k3/8/8/2n1b3/8/3PP3/4K3/8 w - - 0 1', task: { solution: ['d3d4'] }, success: 'The pawn attacks the knight and the bishop. One of them will fall.' },
      { text: `<h3>Queen fork</h3><p>The queen can fork in eight directions. Find a check that also attacks the rook. Careful: the rook must not be able to capture your queen!</p>`,
        fen: '4k3/8/r7/8/8/8/8/3QK3 w - - 0 1', task: { solution: ['d1e2'] }, success: 'Qe2+ checks along the e-file and attacks the a6-rook along the diagonal. Next move you win it.' },
    ],
  },
  {
    id: 'pins', section: 'tactics', title: 'Pins', sub: "Pieces that can't move",
    steps: [
      { text: `<h3>What is a pin?</h3><p>A <b>pin</b> is when a piece can't move because a more valuable piece stands behind it on the same line.</p><ul><li><b>Absolute pin</b>: the piece behind is the king. Moving is illegal.</li><li><b>Relative pin</b>: the piece behind is valuable (e.g. a queen). Moving is legal but costly.</li></ul><p>Here the bishop pins the knight to the king.</p>`,
        line: 'e4 e5 Nf3 Nc6 Bb5 d6', arrows: [['b5', 'e8', 'red']] },
      { text: `<h3>Win the queen</h3><p>Pin the black queen to her king. (Your pawn protects the square you need.)</p>`,
        fen: '6k1/6pp/8/3q4/8/1P6/4BPPP/6K1 w - - 0 1', task: { solution: ['e2c4'] }, success: 'The queen is pinned and can\'t escape. Black loses the queen for a bishop.' },
    ],
  },
  {
    id: 'skewers', section: 'tactics', title: 'Skewers', sub: 'Attack through a piece',
    steps: [
      { text: `<h3>What is a skewer?</h3><p>A <b>skewer</b> is like a pin in reverse: you attack a valuable piece, it moves away, and you capture the piece <b>behind</b> it.</p><p>Find the bishop check that skewers the king and queen.</p>`,
        fen: '4q3/8/2k5/8/8/8/5PPP/3B2K1 w - - 0 1', task: { solution: ['d1a4', 'c6d6', 'a4e8'] }, success: 'The king had to step aside, and the queen behind it was lost.' },
    ],
  },
  {
    id: 'discovered', section: 'tactics', title: 'Discovered attacks', sub: 'Unleash a hidden attacker',
    steps: [
      { text: `<h3>Discovered attack</h3><p>When you move a piece out of the way, the piece behind it can suddenly attack. If the moving piece makes its own threat, your opponent faces <b>two threats at once</b>.</p><p>Your rook is aiming at the black king, but your own bishop is in the way. Move the bishop with a <b>discovered check</b> and attack the queen at the same time.</p>`,
        fen: '4k3/pp3ppp/8/7q/4B3/8/PP3PPP/4R1K1 w - - 0 1', task: { solution: ['e4f3'], accept: ['e4f3', 'e4g6'] }, success: 'Discovered check! Black must deal with the rook\'s check, and then you take the queen.' },
    ],
  },
  {
    id: 'doublecheck', section: 'tactics', title: 'Double check', sub: 'Two checks at once',
    steps: [
      { text: `<h3>Double check</h3><p>A <b>double check</b> is a discovered check where the piece that moves <b>also</b> gives check. The king is attacked by two pieces at once.</p><p>You can't block two lines with one move, and you can't capture two pieces at once. So against a double check, <b>the king must move</b>. If it has nowhere to go, it is checkmate.</p>` },
      { text: `<h3>Your turn</h3><p>Your knight on e4 stands between your rook and the black king. Move the knight so that it gives check too, and it is checkmate.</p>`,
        fen: 'r2qkb1r/pp1p1ppp/8/8/4N3/8/PP3PPP/4R1K1 w kq - 0 1', arrows: [['e1', 'e8', 'red']],
        task: { solution: ['e4d6'], accept: ['e4d6', 'e4f6'], mate: true },
        success: 'Checkmate by double check! Black is a queen up and could capture your knight, but that does nothing about the rook. The king has no square, so it\'s over.' },
    ],
  },
  {
    id: 'defender', section: 'tactics', title: 'Removing the defender', sub: 'Capture the piece that guards',
    steps: [
      { text: `<h3>Remove the guard</h3><p>Sometimes a piece is only safe because <b>one</b> other piece defends it. Capture or chase away that defender, and the piece it was guarding falls.</p><p>Your rook attacks the bishop on d5. Only the knight on f6 defends it. Remove the defender!</p>`,
        fen: '6k1/5ppp/5n2/3b2B1/8/8/5PPP/3R2K1 w - - 0 1', arrows: [['d1', 'd5', 'red'], ['f6', 'd5', 'yellow']],
        task: { solution: ['g5f6'] },
        success: 'Bxf6! After ...gxf6, Rxd5 wins the bishop. If Black saves the bishop instead, you have simply won the knight.' },
      { text: `<h3>How to spot it</h3><p>When you attack a piece and it is defended, don't give up. Ask: <i>"What defends it? Can I capture, chase or distract that defender?"</i></p><p>A piece that has to guard something is said to be <b>overloaded</b> if it has two jobs at once. Overloaded pieces are perfect targets.</p>` },
    ],
  },
  {
    id: 'hanging', section: 'tactics', title: 'Hanging pieces', sub: 'Spot free material',
    steps: [
      { text: `<h3>Look for free pieces</h3><p>Most games between beginners are decided by pieces left <b>undefended</b>. After every opponent move, ask: <i>"Is anything of theirs undefended? Did they leave something hanging?"</i></p><p>Black just played Bc5. Is that bishop safe?</p>`,
        line: 'e4 e5 Nf3 Nc6 d4 Bc5', task: { solution: ['d4c5'] }, success: 'Black\'s bishop was undefended. Free piece!' },
      { text: `<h3>Don't fall for traps</h3><p>The opposite matters too: before grabbing material, check that it isn't a trap. Is the piece really free, or will you lose more after the recapture?</p><p>A good habit before every capture: <b>count attackers and defenders</b> of that square.</p>` },
    ],
  },

  // ------------------------------------------------------------------ MATES
  {
    id: 'backrank', section: 'mates', title: 'Back-rank mate', sub: 'The most common checkmate',
    steps: [
      { text: `<h3>The back-rank weakness</h3><p>After castling, the king often sits behind three pawns. If those pawns haven't moved, the king has no escape square, and a rook or queen on the back rank delivers mate.</p><p>Deliver the back-rank mate.</p>`,
        fen: '6k1/5ppp/8/8/8/8/5PPP/2R3K1 w - - 0 1', task: { solution: ['c1c8'], mate: true }, success: 'Checkmate!' },
      { text: `<h3>How to avoid it</h3><p>When the position allows it, give your king some air (called <b>luft</b>) with a small pawn move like <b>h3</b> or <b>g3</b>. Then a back-rank check is no longer mate.</p>`,
        fen: '6k1/5pp1/7p/8/8/7P/5PP1/2R3K1 w - - 0 1', arrows: [['h2', 'h3', 'green'], ['h7', 'h6', 'green']] },
    ],
  },
  {
    id: 'smothered', section: 'mates', title: 'Smothered mate', sub: 'The knight\'s masterpiece',
    steps: [
      { text: `<h3>Smothered mate</h3><p>When the king is completely surrounded by its own pieces, a single knight check can be checkmate.</p><p>Find the knight checkmate.</p>`,
        fen: '6rk/6pp/8/6N1/8/8/8/6K1 w - - 0 1', task: { solution: ['g5f7'], mate: true }, success: 'Smothered mate! The king is trapped by its own rook and pawns.' },
    ],
  },
  {
    id: 'arabian', section: 'mates', title: 'Rook and knight mates', sub: "Arabian and Anastasia's mate",
    steps: [
      { text: `<h3>Arabian mate</h3><p>One of the oldest known checkmates. A knight guards the rook and covers an escape square, and the rook mates the king in the corner.</p><p>Your knight on f6 covers h7 and g8. Checkmate in one move.</p>`,
        fen: '7k/1R6/5N2/8/8/8/6PP/6K1 w - - 0 1', task: { solution: ['b7h7'], mate: true },
        success: 'Arabian mate! The rook checks, the knight protects it and covers g8.' },
      { text: `<h3>Anastasia's mate</h3><p>A knight on e7 takes away g8 and g6. If the h-file opens, a rook delivers mate on it.</p><p>Black is a queen up and threatening you, so you must strike now. Sacrifice to open the h-file: checkmate in two.</p>`,
        fen: 'r4r1k/pp2N1pp/8/7Q/8/4R3/1q3PPP/6K1 w - - 0 1', task: { solution: ['h5h7', 'h8h7', 'e3h3'], mate: true },
        success: "Anastasia's mate! The queen sacrifice dragged the king to h7, where the knight and rook trap it." },
    ],
  },
  {
    id: 'kqk', section: 'mates', title: 'Mate with king and queen', sub: 'A must-know technique',
    steps: [
      { text: `<h3>The box method</h3><p>With a queen and king against a lone king, you can always force checkmate:</p><ul><li>Use the queen to <b>shrink the box</b> the enemy king is in, staying a knight's move away from it.</li><li>When the king is on the edge, bring <b>your own king</b> closer.</li><li>Then deliver mate with the queen, protected by your king.</li></ul><p><b>Watch out for stalemate!</b> Always leave the enemy king a square until the final blow.</p>`,
        fen: '8/8/8/4k3/8/8/8/3QK3 w - - 0 1' },
      { text: `<h3>Your turn</h3><p>Checkmate the computer. It will defend as well as it can.</p>`,
        fen: '8/8/8/4k3/8/8/8/3QK3 w - - 0 1', play: { goal: 'mate' }, success: 'Checkmate! You now know one of the most important endgame techniques.' },
    ],
  },
  {
    id: 'ladder', section: 'mates', title: 'Ladder mate', sub: 'Two rooks working together',
    steps: [
      { text: `<h3>The ladder</h3><p>Two rooks (or rook and queen) can mate without help from the king. One rook cuts off a rank, the other gives check on the next rank, and they leapfrog toward the edge like climbing a ladder.</p><p>If the enemy king attacks a rook, simply move it far away to the other side of the board.</p>`,
        fen: '8/8/8/3k4/8/8/8/RR4K1 w - - 0 1', arrows: [['a1', 'a4', 'green'], ['b1', 'b5', 'green']] },
      { text: `<h3>Your turn</h3><p>Checkmate the computer using the ladder technique.</p>`,
        fen: '8/8/8/3k4/8/8/8/RR4K1 w - - 0 1', play: { goal: 'mate' }, success: 'Checkmate! The ladder is quick and easy once you know it.' },
    ],
  },
  {
    id: 'krk', section: 'mates', title: 'Mate with king and rook', sub: 'Teamwork between king and rook',
    steps: [
      { text: `<h3>King and rook vs king</h3><p>This takes a bit longer than with a queen. The idea:</p><ul><li>Use the rook to cut the enemy king off on a rank or file.</li><li>Walk your king toward the enemy king.</li><li>When the kings face each other (opposition), check with the rook to push the king back a line.</li><li>Repeat until it is pushed to the edge, then mate.</li></ul>`,
        fen: '8/8/8/4k3/8/8/8/4K2R w - - 0 1', arrows: [['h1', 'h4', 'green']] },
      { text: `<h3>Your turn</h3><p>Checkmate the computer. Take your time; if the rook gets attacked, move it far away along the same line.</p>`,
        fen: '8/8/8/4k3/8/8/8/4K2R w - - 0 1', play: { goal: 'mate' }, success: 'Excellent! This technique is a big milestone for every chess player.' },
    ],
  },

  // ------------------------------------------------------------------ ENDGAME
  {
    id: 'kpk', section: 'endgame', title: 'King and pawn endings', sub: 'Opposition and the square rule',
    steps: [
      { text: `<h3>The opposition</h3><p>When two kings stand on the same file with one square between them, the side that does <b>not</b> have to move "has the opposition". The other king must give way.</p><p>Here, if Black is to move, the black king must step aside and let the white king through.</p>`,
        fen: '8/8/4k3/8/4K3/8/8/8 b - - 0 1', marks: { e5: 'mark' } },
      { text: `<h3>The square rule</h3><p>Can a king catch a passed pawn? Draw an imaginary square from the pawn to its promotion rank. If the king can step <b>inside</b> the square, it catches the pawn.</p><p>Here the black king on f2 cannot reach the square, so the b-pawn will promote.</p>`,
        fen: '8/8/8/1P6/8/8/5k2/K7 b - - 0 1',
        marks: { b5: 'mark', c5: 'mark', d5: 'mark', e5: 'mark', b6: 'mark', c6: 'mark', d6: 'mark', e6: 'mark', b7: 'mark', c7: 'mark', d7: 'mark', e7: 'mark', b8: 'mark', c8: 'mark', d8: 'mark', e8: 'mark' } },
      { text: `<h3>King in front of the pawn</h3><p>A key rule: with your king on the <b>6th rank in front of your pawn</b> (not on the edge files), you always win.</p><p>Promote the pawn against the computer. Use your king to escort it!</p>`,
        fen: '4k3/8/4K3/4P3/8/8/8/8 w - - 0 1', play: { goal: 'promote' }, success: 'You promoted! Escorting the pawn with your king is the key idea.' },
    ],
  },
  {
    id: 'breakthrough', section: 'endgame', title: 'Passed pawns', sub: 'Create one and push it',
    steps: [
      { text: `<h3>Passed pawns must be pushed</h3><p>A <b>passed pawn</b> has no enemy pawns in front of it or on the files next to it. Nothing but pieces can stop it, so it ties down the enemy king or pieces.</p><p>Here White's d-pawn is passed. The black king has to go and stop it, and then the white king is free to attack the kingside pawns.</p>`,
        fen: '8/5kpp/8/8/3P4/8/5KPP/8 w - - 0 1', marks: { d4: 'good', d5: 'mark', d6: 'mark', d7: 'mark', d8: 'mark' } },
      { text: `<h3>The breakthrough</h3><p>Three pawns against three, and both kings are far away. White can force a passed pawn with a pawn sacrifice. Find the breakthrough!</p>`,
        fen: '8/ppp4k/8/PPP5/8/8/7K/8 w - - 0 1', task: { solution: ['b5b6', 'a7b6', 'c5c6', 'b7c6', 'a5a6'] },
        success: 'The a-pawn is through and will queen before the king can catch it. If Black takes with the c-pawn instead (1...cxb6), 2.a6! works the same way.' },
    ],
  },
  {
    id: 'rookend', section: 'endgame', title: 'Rook endgame rules', sub: 'Principles for the most common endgame',
    steps: [
      { text: `<h3>Rooks belong behind passed pawns</h3><p>Put your rook <b>behind</b> a passed pawn, yours or your opponent's. Behind your own pawn, the rook supports it all the way. Behind the enemy pawn, it gets more active as the pawn advances.</p>`,
        fen: '6k1/8/5r2/P7/8/8/6PK/R7 w - - 0 1', arrows: [['a1', 'a5', 'green']] },
      { text: `<h3>Activity is everything</h3><p>An active rook that attacks pawns and cuts off the enemy king is often worth more than an extra pawn. Avoid passive defence on your back rank when you can.</p><p>Cutting off the enemy king along a rank or file is one of the strongest things a rook can do.</p>`,
        fen: '8/8/5k2/8/8/3K4/3P4/4R3 w - - 0 1', arrows: [['e1', 'e8', 'green']] },
    ],
  },

  {
    id: 'lucena', section: 'endgame', title: 'The Lucena position', sub: 'Build a bridge to promote',
    steps: [
      { text: `<h3>The most important rook endgame</h3><p>Your pawn is on the 7th rank with your king in front of it, and your rook on the f-file keeps the black king away. But the black rook stops your king from leaving via the e-file, and if your king steps out to c7, the black rook just checks it along the c-file.</p><p>The winning method is called <b>building a bridge</b>:</p><ul><li>Put your rook on the <b>4th rank</b>.</li><li>Walk your king out. When the checks come, step toward your rook.</li><li>When the king reaches the 5th rank, <b>block the check with the rook</b>. The checks are over and the pawn promotes.</li></ul>`,
        fen: '3K4/3P2k1/8/8/8/8/4r3/5R2 w - - 0 1', arrows: [['f1', 'f4', 'green']] },
      { text: `<h3>Start the bridge</h3><p>Play the first move of the bridge.</p>`,
        fen: '3K4/3P2k1/8/8/8/8/4r3/5R2 w - - 0 1', task: { solution: ['f1f4'], teach: true },
        success: 'Rf4! Next comes Kc7, and against the checks Kd6, Ke6, Kd5 and then Rd4 blocks.' },
      { text: `<h3>Your turn</h3><p>Promote the pawn against the computer. Build the bridge!</p>`,
        fen: '3K4/3P2k1/8/8/8/8/4r3/5R2 w - - 0 1', play: { goal: 'promote' }, success: 'You won the Lucena position! Every strong player knows this technique.' },
    ],
  },
  // ------------------------------------------------------------------ THINKING
  {
    id: 'cct', section: 'thinking', title: 'Checks, captures, threats', sub: 'A checklist for every move',
    steps: [
      { text: `<h3>Look at forcing moves first</h3><p>Strong players look at <b>forcing moves</b> first, in this order:</p><ul><li><b>Checks</b>: every check you can give</li><li><b>Captures</b>: every capture</li><li><b>Threats</b>: moves that attack something</li></ul><p>Forcing moves limit your opponent's replies, so they are easier to calculate and often win.</p>` },
      { text: `<h3>Try it</h3><p>Go through the checks. One of them wins material.</p>`,
        fen: '4k3/8/r7/8/8/8/8/3QK3 w - - 0 1', task: { solution: ['d1e2'] }, success: 'Qe2+ forks the king and the rook. (Qa4+ looks similar, but the rook would just take your queen.)' },
      { text: `<h3>Do it for your opponent too</h3><p>After every move your opponent makes, ask: <i>"What does that move threaten? Which checks, captures and threats do they have now?"</i></p><p>This single habit prevents most blunders.</p>` },
    ],
  },
  {
    id: 'blundercheck', section: 'thinking', title: 'The blunder check', sub: 'Five seconds that save games',
    steps: [
      { text: `<h3>Before you touch a piece</h3><p>When you've found a move you like, stop and do a quick <b>blunder check</b>:</p><ul><li>After my move, is anything of mine <b>undefended</b>?</li><li>Does my move allow a <b>check</b>, <b>fork</b> or <b>pin</b>?</li><li>What is my opponent's <b>best reply</b>?</li></ul><p>If you find a problem, look for another move.</p>` },
      { text: `<h3>Have a plan</h3><p>When there are no tactics, improve your <b>worst piece</b>. Find the piece doing the least and give it a better square. Good plans are often that simple.</p><p>Practise these habits in your games against the bots with the coach turned on. It will point out moves where your blunder check failed.</p>` },
    ],
  },
];
