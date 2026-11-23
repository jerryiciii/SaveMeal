// Runs in every e2e worker before the tests: point Prisma at the test database.
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testDatabaseUrl } from './test-db';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testDatabaseUrl();
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'error';
process.env.UPLOAD_DIR = join(tmpdir(), 'savemeal-test-uploads');
