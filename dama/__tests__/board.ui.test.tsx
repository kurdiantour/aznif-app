import { fireEvent, render } from '@testing-library/react-native';

import { DamaBoard } from '../components/DamaBoard';
import type { Piece } from '../engine';

jest.mock('expo-image', () => ({ Image: 'Image' }));
const mockPieceRender = jest.fn();
jest.mock('../components/DamaPiece', () => ({
  DamaPiece: (props: unknown) => { mockPieceRender(props); return null; },
}));

const center = (row: number, column: number) => ({
  locationX: 40 + (column + 0.5) * 67,
  locationY: 40 + (row + 0.5) * 67,
});

test('tap and drag on the board reach the correct squares', () => {
  const onSquarePress = jest.fn();
  const onSquareDrag = jest.fn();
  const screen = render(<DamaBoard pieces={[]} selectedId={null} targets={[]}
    onSquarePress={onSquarePress} onSquareDrag={onSquareDrag} />);
  const board = screen.getByLabelText('Dama board, eight by eight');
  fireEvent(board, 'layout', { nativeEvent: { layout: { width: 615, height: 615 } } });
  expect(board.props.onStartShouldSetResponder()).toBe(true);

  fireEvent(board, 'responderGrant', { nativeEvent: center(5, 2) });
  fireEvent(board, 'responderRelease', { nativeEvent: center(5, 2) });
  expect(onSquarePress).toHaveBeenCalledWith({ row: 5, column: 2 });

  fireEvent(board, 'responderGrant', { nativeEvent: center(5, 2) });
  fireEvent(board, 'responderRelease', { nativeEvent: center(4, 2) });
  expect(onSquareDrag).toHaveBeenCalledWith({ row: 5, column: 2 }, { row: 4, column: 2 });
});

test('black perspective maps visible taps and drags back to logical engine squares', () => {
  const onSquarePress = jest.fn();
  const onSquareDrag = jest.fn();
  const screen = render(<DamaBoard pieces={[]} selectedId={null} targets={[]} perspective="black"
    onSquarePress={onSquarePress} onSquareDrag={onSquareDrag} />);
  const board = screen.getByLabelText('Dama board, eight by eight');
  fireEvent(board, 'layout', { nativeEvent: { layout: { width: 615, height: 615 } } });

  fireEvent(board, 'responderGrant', { nativeEvent: center(5, 2) });
  fireEvent(board, 'responderRelease', { nativeEvent: center(5, 2) });
  expect(onSquarePress).toHaveBeenCalledWith({ row: 2, column: 5 });

  fireEvent(board, 'responderGrant', { nativeEvent: center(5, 2) });
  fireEvent(board, 'responderRelease', { nativeEvent: center(4, 2) });
  expect(onSquareDrag).toHaveBeenCalledWith({ row: 2, column: 5 }, { row: 3, column: 5 });
});

test('moving one piece does not rerender the other occupied squares', () => {
  mockPieceRender.mockClear();
  const pieces: Piece[] = [
    { id: 'cream-one', color: 'cream', row: 5, column: 2, king: false },
    { id: 'black-one', color: 'black', row: 2, column: 5, king: false },
  ];
  const screen = render(<DamaBoard pieces={pieces} selectedId={null} targets={[]}
    onSquarePress={() => undefined} onSquareDrag={() => undefined} />);
  const board = screen.getByLabelText('Dama board, eight by eight');
  fireEvent(board, 'layout', { nativeEvent: { layout: { width: 615, height: 615 } } });
  const rendersBeforeMove = mockPieceRender.mock.calls.length;
  expect(rendersBeforeMove).toBeGreaterThan(0);

  const nextPieces = pieces.map((piece) => piece.id === 'cream-one' ? { ...piece, row: 4 } : { ...piece });
  screen.rerender(<DamaBoard pieces={nextPieces} selectedId={null} targets={[]}
    onSquarePress={() => undefined} onSquareDrag={() => undefined} />);
  expect(mockPieceRender).toHaveBeenCalledTimes(rendersBeforeMove + 1);
});

test('changing selected side and turn highlights keeps both piece colors stable', () => {
  mockPieceRender.mockClear();
  const pieces: Piece[] = [
    { id: 'cream-one', color: 'cream', row: 5, column: 2, king: false },
    { id: 'black-one', color: 'black', row: 2, column: 5, king: false },
  ];
  const screen = render(<DamaBoard pieces={pieces} selectedId={null} targets={[]}
    onSquarePress={() => undefined} onSquareDrag={() => undefined} />);
  const board = screen.getByLabelText('Dama board, eight by eight');
  fireEvent(board, 'layout', { nativeEvent: { layout: { width: 615, height: 615 } } });
  const colorsBefore = mockPieceRender.mock.calls.slice(-2).map(([props]) => (props as { color: string }).color).sort();

  screen.rerender(<DamaBoard pieces={pieces.map((piece) => ({ ...piece }))} selectedId="black-one" targets={[]}
    onSquarePress={() => undefined} onSquareDrag={() => undefined} />);

  const colorsAfter = mockPieceRender.mock.calls.slice(-2).map(([props]) => (props as { color: string }).color).sort();
  expect(colorsAfter).toEqual(colorsBefore);
});
