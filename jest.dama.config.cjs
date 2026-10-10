module.exports = {
  preset: 'jest-expo',
  rootDir: '.',
  testMatch: ['<rootDir>/dama/__tests__/*.ui.test.tsx'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
};
