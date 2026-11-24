const DEFAULT_TEST_DATABASE_URL = 'postgresql://savemeal:savemeal@localhost:5432/savemeal_test?schema=public';

/** The e2e database. Guarded: it is reset on every run, so its name must end in `_test`. */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL;
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to run e2e tests against "${dbName}": the database name must end in _test.`);
  }
  return url;
}
