import { Text, TextInput } from 'react-native';
import type { TextStyle } from 'react-native';

export const appFonts = {
  regular: 'SpedaRegular',
  bold: 'SpedaBold',
} as const;

export const appFontAssets = {
  SpedaRegular: require('../assets/fonts/Speda-Regular.ttf'),
  SpedaBold: require('../assets/fonts/Speda-Bold.ttf'),
};

export const typography = {
  regular: {
    fontFamily: 'SpedaRegular',
  },
  bold: {
    fontFamily: 'SpedaBold',
  },
} satisfies Record<'regular' | 'bold', TextStyle>;

let defaultsApplied = false;

export function applyAppFontDefaults() {
  if (defaultsApplied) return;

  const textComponent = Text as typeof Text & { defaultProps?: any };
  const textInputComponent = TextInput as typeof TextInput & { defaultProps?: any };

  textComponent.defaultProps = textComponent.defaultProps ?? {};
  textComponent.defaultProps.style = [
    { fontFamily: appFonts.regular },
    textComponent.defaultProps.style,
  ];

  textInputComponent.defaultProps = textInputComponent.defaultProps ?? {};
  textInputComponent.defaultProps.style = [
    { fontFamily: appFonts.regular },
    textInputComponent.defaultProps.style,
  ];

  defaultsApplied = true;
}

export const fontStyles = {
  regular: {
    ...typography.regular,
  } satisfies TextStyle,
  bold: {
    ...typography.bold,
  } satisfies TextStyle,
  regularRtl: {
    ...typography.regular,
    writingDirection: 'rtl',
    textAlign: 'right',
  } satisfies TextStyle,
  boldRtl: {
    ...typography.bold,
    writingDirection: 'rtl',
    textAlign: 'right',
  } satisfies TextStyle,
  centerRegularRtl: {
    ...typography.regular,
    writingDirection: 'rtl',
    textAlign: 'center',
  } satisfies TextStyle,
  centerBoldRtl: {
    ...typography.bold,
    writingDirection: 'rtl',
    textAlign: 'center',
  } satisfies TextStyle,
};
