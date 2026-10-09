module.exports = {
  ...require("./jest.okey.config.cjs"),
  testMatch: ["<rootDir>/domino/multiplayer/__ui_tests__/**/*.test.ts?(x)"],
  collectCoverageFrom: [],
};
