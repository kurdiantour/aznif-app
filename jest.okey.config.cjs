module.exports = {
  preset: "jest-expo",
  rootDir: ".",
  testMatch: ["<rootDir>/okey/**/__ui_tests__/**/*.test.ts?(x)"],
  setupFilesAfterEnv: ["<rootDir>/okey/testing/jest-setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  collectCoverageFrom: [
    "okey/components/**/*.{ts,tsx}",
    "okey/hooks/**/*.{ts,tsx}",
    "okey/presentation/**/*.{ts,tsx}",
    "okey/rack/**/*.{ts,tsx}",
    "!okey/**/*.d.ts",
  ],
};
