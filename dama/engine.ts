export type Side = 'cream' | 'black';
export const DAMA_TURN_DURATION_MS = 15_000;
export type Square = { row: number; column: number };
export type Piece = Square & { id: string; color: Side; king: boolean };
export type Step = { to: Square; capturedId?: string };
export type Move = { pieceId: string; from: Square; steps: Step[] };
export type Result = { winner: Side | null; reason: 'no-pieces' | 'no-moves' | 'one-vs-one' | 'repetition' | 'quiet-limit' };
export type GameState = { pieces: Piece[]; turn: Side; ply: number; result: Result | null; quietPly?: number; history?: Record<string, number>; turnStartedAtMs?: number; turnDeadlineAtMs?: number | null };

const directions = [
  { row: -1, column: 0 }, { row: 1, column: 0 },
  { row: 0, column: -1 }, { row: 0, column: 1 },
] as const;
const opposite = (side: Side): Side => side === 'cream' ? 'black' : 'cream';
const inside = ({ row, column }: Square) => row >= 0 && row < 8 && column >= 0 && column < 8;
const at = (pieces: readonly Piece[], square: Square) => pieces.find((piece) => piece.row === square.row && piece.column === square.column);
const advance = (square: Square, direction: Square, distance = 1): Square => ({
  row: square.row + direction.row * distance,
  column: square.column + direction.column * distance,
});
const manDirections = (piece: Piece) => directions.filter((direction) =>
  piece.king || direction.row === 0 || direction.row === (piece.color === 'cream' ? -1 : 1));
const reverse = (a: Square, b: Square) => a.row === -b.row && a.column === -b.column;

export function createGame(nowMs = Date.now()): GameState {
  const pieces: Piece[] = [];
  for (const [color, rows] of [['black', [1, 2]], ['cream', [5, 6]]] as const) {
    for (const row of rows) for (let column = 0; column < 8; column++) {
      pieces.push({ id: `${color}-${row}-${column}`, color, row, column, king: false });
    }
  }
  const state: GameState = { pieces, turn: 'cream', ply: 0, result: null, quietPly: 0, history: {}, turnStartedAtMs: nowMs, turnDeadlineAtMs: nowMs + DAMA_TURN_DURATION_MS };
  state.history![positionKey(state)] = 1;
  return state;
}

function positionKey(state: GameState) {
  return `${state.turn}:${state.pieces.map((piece) => `${piece.color[0]}${piece.king ? 'K' : 'M'}${piece.row}${piece.column}`).sort().join(',')}`;
}

function captureSteps(pieces: readonly Piece[], piece: Piece, previousDirection?: Square):
  { step: Step; direction: Square }[] {
  const choices: { step: Step; direction: Square }[] = [];
  for (const direction of manDirections(piece)) {
    if (previousDirection && reverse(direction, previousDirection)) continue;
    if (!piece.king) {
      const victim = at(pieces, advance(piece, direction));
      const landing = advance(piece, direction, 2);
      if (victim && victim.color !== piece.color && inside(landing) && !at(pieces, landing)) {
        choices.push({ step: { to: landing, capturedId: victim.id }, direction });
      }
      continue;
    }
    let square = advance(piece, direction);
    while (inside(square) && !at(pieces, square)) square = advance(square, direction);
    const victim = inside(square) ? at(pieces, square) : undefined;
    if (!victim || victim.color === piece.color) continue;
    square = advance(square, direction);
    while (inside(square) && !at(pieces, square)) {
      choices.push({ step: { to: square, capturedId: victim.id }, direction });
      square = advance(square, direction);
    }
  }
  return choices;
}

function captureMoves(pieces: readonly Piece[], piece: Piece, from: Square, steps: Step[] = [],
  previousDirection?: Square): Move[] {
  const next = captureSteps(pieces, piece, previousDirection);
  if (next.length === 0) return steps.length ? [{ pieceId: piece.id, from, steps }] : [];
  return next.flatMap(({ step, direction }) => {
    const moved = { ...piece, ...step.to }; // Crowning takes effect after the complete turn.
    const remaining = pieces.filter((candidate) => candidate.id !== piece.id && candidate.id !== step.capturedId);
    return captureMoves([...remaining, moved], moved, from, [...steps, step], direction);
  });
}

function quietMoves(pieces: readonly Piece[], piece: Piece): Move[] {
  const moves: Move[] = [];
  for (const direction of manDirections(piece)) {
    let square = advance(piece, direction);
    while (inside(square) && !at(pieces, square)) {
      moves.push({ pieceId: piece.id, from: { row: piece.row, column: piece.column }, steps: [{ to: square }] });
      if (!piece.king) break;
      square = advance(square, direction);
    }
  }
  return moves;
}

export function getLegalMoves(state: GameState): Move[] {
  if (state.result) return [];
  const own = state.pieces.filter((piece) => piece.color === state.turn);
  const captures = own.flatMap((piece) => captureMoves(state.pieces, piece, { row: piece.row, column: piece.column }));
  if (captures.length) {
    const maximum = Math.max(...captures.map((move) => move.steps.length));
    return captures.filter((move) => move.steps.length === maximum);
  }
  return own.flatMap((piece) => quietMoves(state.pieces, piece));
}

export function projectMove(state: GameState, move: Move, stepCount = move.steps.length): GameState {
  const piece = state.pieces.find((candidate) => candidate.id === move.pieceId);
  if (!piece || stepCount < 0 || stepCount > move.steps.length) throw new Error('Invalid move projection');
  let pieces = state.pieces.map((candidate) => ({ ...candidate }));
  for (const step of move.steps.slice(0, stepCount)) {
    pieces = pieces.filter((candidate) => candidate.id !== step.capturedId);
    pieces = pieces.map((candidate) => candidate.id === piece.id ? { ...candidate, ...step.to } : candidate);
  }
  return { ...state, pieces };
}

export function getTurnRemainingMs(state: GameState, nowMs = Date.now()): number {
  if (state.result || state.turnDeadlineAtMs == null) return 0;
  return Math.max(0, Math.min(DAMA_TURN_DURATION_MS, state.turnDeadlineAtMs - nowMs));
}

export function isTurnExpired(state: GameState, nowMs = Date.now()): boolean {
  return !state.result && state.turnDeadlineAtMs != null && nowMs >= state.turnDeadlineAtMs;
}

function commitMove(state: GameState, requested: Move, nowMs: number): GameState {
  const legal = getLegalMoves(state).find((move) => move.pieceId === requested.pieceId &&
    JSON.stringify(move.steps) === JSON.stringify(requested.steps));
  if (!legal) throw new Error('Illegal Dama move');
  const next = projectMove(state, legal);
  const pieces = next.pieces.map((piece) => piece.id === legal.pieceId &&
    (piece.color === 'cream' ? piece.row === 0 : piece.row === 7)
    ? { ...piece, king: true } : piece);
  const turn = opposite(state.turn);
  const captured = legal.steps.some((step) => step.capturedId);
  const promoted = pieces.some((piece) => piece.id === legal.pieceId && piece.king &&
    !state.pieces.find((previous) => previous.id === piece.id)?.king);
  const candidate: GameState = { pieces, turn, ply: state.ply + 1, result: null,
    turnStartedAtMs: nowMs, turnDeadlineAtMs: nowMs + DAMA_TURN_DURATION_MS,
    quietPly: captured || promoted ? 0 : (state.quietPly ?? 0) + 1,
    history: { ...state.history } };
  const key = positionKey(candidate);
  candidate.history![key] = (candidate.history![key] ?? 0) + 1;
  const own = pieces.filter((piece) => piece.color === turn);
  const enemy = pieces.filter((piece) => piece.color !== turn);
  if (!own.length) candidate.result = { winner: state.turn, reason: 'no-pieces' };
  else if (!enemy.length) candidate.result = { winner: turn, reason: 'no-pieces' };
  else if (own.length === 1 && enemy.length === 1) candidate.result = { winner: null, reason: 'one-vs-one' };
  else if (!getLegalMoves(candidate).length) candidate.result = { winner: state.turn, reason: 'no-moves' };
  else if (candidate.history![key] >= 3) candidate.result = { winner: null, reason: 'repetition' };
  else if (candidate.quietPly! >= 80) candidate.result = { winner: null, reason: 'quiet-limit' };
  if (candidate.result) candidate.turnDeadlineAtMs = null;
  return candidate;
}

export function applyMove(state: GameState, requested: Move, nowMs = Date.now()): GameState {
  if (isTurnExpired(state, nowMs)) throw new Error('Dama turn expired');
  return commitMove(state, requested, nowMs);
}

export function resolveTurnTimeout(state: GameState, nowMs = Date.now()): GameState {
  if (!isTurnExpired(state, nowMs)) return state;
  const move = getLegalMoves(state)[0];
  if (!move) {
    return { ...state, result: { winner: opposite(state.turn), reason: 'no-moves' }, turnDeadlineAtMs: null };
  }
  return commitMove(state, move, state.turnDeadlineAtMs ?? nowMs);
}
