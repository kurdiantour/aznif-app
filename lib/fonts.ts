import { Text, TextInput } from 'react-native';
import type { TextStyle } from 'react-native';

export const appFonts = {
  regular: 'Speda-Regular',
  bold: 'Speda-Bold',
} as const;

export const appFontAssets = {
  [appFonts.regular]: require('@/assets/fonts/Speda-Regular.ttf'),
  [appFonts.bold]: require('@/assets/fonts/Speda-Bold.ttf'),
};

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
    fontFamily: appFonts.regular,
    fontWeight: '400',
  } satisfies TextStyle,
  bold: {
    fontFamily: appFonts.bold,
    fontWeight: '400',
  } satisfies TextStyle,
  regularRtl: {
    fontFamily: appFonts.regular,
    fontWeight: '400',
    writingDirection: 'rtl',
    textAlign: 'right',
  } satisfies TextStyle,
  boldRtl: {
    fontFamily: appFonts.bold,
    fontWeight: '400',
    writingDirection: 'rtl',
    textAlign: 'right',
  } satisfies TextStyle,
  centerRegularRtl: {
    fontFamily: appFonts.regular,
    fontWeight: '400',
    writingDirection: 'rtl',
    textAlign: 'center',
  } satisfies TextStyle,
  centerBoldRtl: {
    fontFamily: appFonts.bold,
    fontWeight: '400',
    writingDirection: 'rtl',
    textAlign: 'center',
  } satisfies TextStyle,
};
