import { render } from '@testing-library/react-native';
import { Circle } from 'react-native-svg';

import { DamaPlayerSeat } from '../components/DamaPlayerSeat';

jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('@/components/player/PlayerAvatar', () => ({ PlayerAvatar: 'View' }));

const player = { id: 'human', username: 'Human', pieceColor: 'cream' as const, capturedCount: 0, isCurrentTurn: true };
const props = { player, capturedPieceColor: 'black' as const, width: 120, avatarSize: 48 };

test('active avatar stroke shrinks from full circumference to zero without a number', () => {
  const screen = render(<DamaPlayerSeat {...props} turnRemainingMs={15_000} />);
  const full = screen.UNSAFE_getByType(Circle);
  const fullLength = Number(full.props.strokeDasharray.split(' ')[0]);
  expect(fullLength).toBeGreaterThan(0);
  expect(screen.queryByText('15')).toBeNull();

  screen.rerender(<DamaPlayerSeat {...props} turnRemainingMs={7_500} />);
  const half = screen.UNSAFE_getByType(Circle);
  expect(Number(half.props.strokeDasharray.split(' ')[0])).toBeCloseTo(fullLength / 2);

  screen.rerender(<DamaPlayerSeat {...props} turnRemainingMs={0} />);
  expect(screen.UNSAFE_queryByType(Circle)).toBeNull();

  screen.rerender(<DamaPlayerSeat {...props} player={{ ...player, isCurrentTurn: false }} turnRemainingMs={15_000} />);
  expect(screen.UNSAFE_queryByType(Circle)).toBeNull();
});
