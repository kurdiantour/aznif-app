import { fireEvent, render } from '@testing-library/react-native';

import { DamaBoard } from '../components/DamaBoard';

jest.mock('expo-image', () => ({ Image: 'Image' }));

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
