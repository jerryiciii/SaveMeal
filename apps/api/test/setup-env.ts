// Runs in every e2e worker before the tests: point Prisma at the test database.
import { testDatabaseUrl } from './test-db';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testDatabaseUrl();
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'error';
