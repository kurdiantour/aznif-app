import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function useAppLayout() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const safeWidth = width - insets.left - insets.right;
  const safeHeight = height - insets.top - insets.bottom;

  const isPortrait = height > width;
  const isLandscape = width > height;

  const isCompactWidth = width < 390;
  const isCompactHeight = height < 400;
  
  // A device is considered truly compact if its narrowest side is < 390
  const isCompact = Math.min(width, height) < 390;
  const isTablet = Math.min(width, height) >= 600;
  const isStandard = !isCompact && !isTablet;

  return {
    width,
    height,
    safeWidth,
    safeHeight,
    insets,
    isPortrait,
    isLandscape,
    isCompact,
    isCompactWidth,
    isCompactHeight,
    isStandard,
    isTablet,
  };
}
