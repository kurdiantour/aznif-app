module.exports = {
  preset: "jest-expo",
  rootDir: ".",
  testMatch: ["<rootDir>/okey/**/__ui_tests__/**/*.test.ts?(x)"],
  setupFilesAfterEnv: ["<rootDir>/okey/testing/jest-setup.ts"],
  // npm's Deno-style layout stores packages beneath node_modules/.deno.
  // Let Jest reach the package's own node_modules so jest-expo can transform
  // React Native's ESM setup files there.
  transformIgnorePatterns: [
    "/node_modules/(?!(\\.deno/|\\.pnpm/|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|react-navigation|@react-navigation|@sentry/react-native|native-base|standard-navigation))",
    "/node_modules/react-native-reanimated/plugin/",
    "/node_modules/@react-native/babel-preset/",
  ],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  collectCoverageFrom: [
    "okey/components/**/*.{ts,tsx}",
    "okey/hooks/**/*.{ts,tsx}",
    "okey/feedback/**/*.{ts,tsx}",
    "okey/multiplayer/OkeyReturnToGameOverlay.tsx",
    "components/multiplayer/ReturnToGamePopup.tsx",
    "okey/presentation/**/*.{ts,tsx}",
    "okey/rack/**/*.{ts,tsx}",
    "!okey/**/*.d.ts",
  ],
};
