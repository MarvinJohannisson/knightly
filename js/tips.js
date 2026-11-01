// Short chess tips, shown one per day on the home screen.
export const TIPS = [
  ['Check, capture, threat', 'Before every move, look at all checks, captures and threats, for you and for your opponent.'],
  ['What did they just do?', 'After each opponent move, ask yourself: "Why did they play that? What does it attack?"'],
  ['Develop before attacking', 'Bring out your knights and bishops before launching an attack. Attacks with one or two pieces rarely work.'],
  ['Castle early', 'A king in the center is a target. Castle in the first 10 moves in most games.'],
  ['Knights on the rim are dim', 'A knight on the edge of the board controls only 2–4 squares. In the center it controls up to 8.'],
  ['Don\'t grab pawns with your queen', 'Hunting pawns with your queen in the opening wastes time and often gets the queen trapped.'],
  ['Count attackers and defenders', 'Before capturing, count how many pieces attack and defend the square. If you have more attackers, the capture usually works.'],
  ['Rooks love open files', 'Put your rooks on files with no pawns. From there they can invade the 7th rank.'],
  ['The 7th rank', 'A rook on your opponent\'s second rank (your 7th) attacks pawns and traps the king. Two rooks there are often decisive.'],
  ['Trade when ahead', 'When you are up material, trade pieces (not pawns). The fewer pieces left, the bigger your advantage becomes.'],
  ['Activate your king', 'In the endgame the king is a strong piece. Bring it to the center.'],
  ['Passed pawns must be pushed', 'A passed pawn (no enemy pawns in front or beside it) is a big asset in the endgame. Push it!'],
  ['Bishops vs knights', 'Bishops prefer open positions with pawns on both wings. Knights prefer closed positions and outposts.'],
  ['Outposts', 'A square that enemy pawns can never attack is an "outpost". A knight there can be as strong as a rook.'],
  ['Weak f7 and f2', 'At the start, f7 (and f2) are protected only by the king. Many early tactics target these squares.'],
  ['Don\'t play hope chess', 'Don\'t make a move hoping your opponent misses the reply. Assume they will find the best answer.'],
  ['Improve your worst piece', 'No obvious plan? Find your least active piece and put it on a better square.'],
  ['Pawns can\'t move backwards', 'Every pawn move creates permanent weaknesses. Think twice before pushing pawns in front of your king.'],
  ['Use your time', 'In slower games, use your time on critical moves: captures, sacrifices and moves that change the pawn structure.'],
  ['Learn from losses', 'Review every game you lose. Find the moment where it went wrong, and the lesson behind it.'],
  ['Mate threats first', 'A checkmate beats everything. Even if you\'re losing material, check if you have a forced mate.'],
  ['Pinned pieces don\'t defend', 'A piece pinned to the king can\'t move, so it doesn\'t really defend anything. Attack what it "protects".'],
  ['Opposite castling = race', 'If kings castle on opposite sides, both players usually storm the enemy king with pawns. Speed matters!'],
  ['Central control beats a wing attack', 'The best answer to a flank attack is often a strike in the center.'],
  ['Puzzles daily', 'Solving a few puzzles every day trains your pattern recognition faster than anything else.'],
  ['Every move should have a purpose', 'Develop, control the center, improve a piece, create a threat, or stop the opponent\'s plan.'],
  ['Stalemate traps', 'When you are way ahead, always check that your opponent still has a legal move after yours.'],
  ['Two bishops', 'The bishop pair is a long-term advantage, especially in open positions. Avoid trading a bishop for a knight without reason.'],
  ['Backward pawns', 'A pawn that can\'t be protected by other pawns and can\'t safely advance is a long-term target.'],
  ['Play the board, not the rating', 'Strong players blunder too. Weaker players find good moves too. Focus on the position.'],
];

export function tipOfTheDay() {
  const day = Math.floor(Date.now() / 86400000);
  return TIPS[day % TIPS.length];
}
