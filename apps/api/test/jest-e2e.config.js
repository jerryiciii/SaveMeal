/**
 * End-to-end tests: supertest against the real app and a real PostgreSQL test database
 * (TEST_DATABASE_URL, default savemeal_test on localhost). Run serially (--runInBand).
 * @type {import('jest').Config}
 */
module.exports = {
  testEnvironment: 'node',
  rootDir: '..',
  roots: ['<rootDir>/test'],
  testRegex: '\\.e2e-spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  moduleNameMapper: { '^@savemeal/shared$': '<rootDir>/../../packages/shared/src' },
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  globalSetup: '<rootDir>/test/global-setup.ts',
  globalTeardown: '<rootDir>/test/global-teardown.ts',
  testTimeout: 30000,
};
