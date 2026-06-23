import { I18nManager } from "react-native";
import { fontStyles } from "./fonts";

export const isKurdishRTL = true;

// Do not force RTL at the native layout-manager level. It mirrors every
// screen, including the domino board whose fixed coordinates must stay LTR.
// Menu routes receive RTL through the navigator's content direction instead.
I18nManager.allowRTL(false);
I18nManager.forceRTL(false);

export const rtlStyles = {
  row: {
    flexDirection: "row-reverse" as const,
  },
  rowWrap: {
    flexDirection: "row-reverse" as const,
    flexWrap: "wrap" as const,
  },
  text: {
    ...fontStyles.regular,
    writingDirection: "rtl" as const,
    textAlign: "right" as const,
  },
  boldText: {
    ...fontStyles.bold,
    writingDirection: "rtl" as const,
    textAlign: "right" as const,
  },
  centerText: {
    ...fontStyles.regular,
    writingDirection: "rtl" as const,
    textAlign: "center" as const,
  },
  centerBoldText: {
    ...fontStyles.bold,
    writingDirection: "rtl" as const,
    textAlign: "center" as const,
  },
  input: {
    ...fontStyles.regular,
    writingDirection: "rtl" as const,
    textAlign: "right" as const,
  },
  alignStart: {
    alignItems: "flex-end" as const,
  },
  alignEnd: {
    alignItems: "flex-start" as const,
  },
};
