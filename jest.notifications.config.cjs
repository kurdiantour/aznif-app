module.exports = {
  preset: "jest-expo", rootDir: ".",
  testMatch: ["<rootDir>/lib/notifications/__tests__/**/*.test.ts?(x)"],
  setupFilesAfterEnv: ["<rootDir>/okey/testing/jest-setup.ts"],
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/$1" },
};
