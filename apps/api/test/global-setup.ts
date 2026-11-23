// Jest e2e global setup: make sure a real PostgreSQL is reachable at TEST_DATABASE_URL (starting
// the embedded server if nothing listens on a localhost URL), then drop and re-create the local
// *_test database and apply every migration.
import { execFileSync } from 'node:child_process';
import { connect } from 'node:net';
import { join } from 'node:path';
import { Client } from 'pg';
import { testDatabaseUrl } from './test-db';

const apiRoot = join(__dirname, '..');
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = connect({ host, port });
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      resolvePromise(true);
    });
    socket.once('error', () => resolvePromise(false));
    socket.once('timeout', () => {
      socket.destroy();
      resolvePromise(false);
    });
  });
}

export function runDbScript(command: 'start' | 'stop'): void {
  const tsxCli = require.resolve('tsx/cli');
  execFileSync(process.execPath, [tsxCli, join(apiRoot, 'scripts', 'db.mts'), command], {
    cwd: apiRoot,
    stdio: 'inherit',
  });
}

export default async function globalSetup(): Promise<void> {
  const url = new URL(testDatabaseUrl());
  const host = url.hostname;
  const port = Number(url.port || 5432);

  if (!(await canConnect(host, port))) {
    if (host !== 'localhost' && host !== '127.0.0.1') {
      throw new Error(`No PostgreSQL reachable at ${host}:${port} (TEST_DATABASE_URL).`);
    }
    runDbScript('start');
    (globalThis as { __SM_STARTED_PG__?: boolean }).__SM_STARTED_PG__ = true;
  }

  await recreateTestDatabase(url);

  // Non-destructive: applies every migration to the fresh, empty test database.
  const prismaCli = require.resolve('prisma/build/index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: 'pipe',
  });
}

/**
 * Drops and re-creates the e2e database so every run starts empty. Double-guarded: only a
 * database whose name ends in `_test` (testDatabaseUrl) and only on a localhost server.
 */
async function recreateTestDatabase(url: URL): Promise<void> {
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!dbName.endsWith('_test') || !LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(`Refusing to recreate "${dbName}" on ${url.hostname}: only local *_test databases.`);
  }
  const client = new Client({
    host: url.hostname,
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: 'postgres',
  });
  await client.connect();
  try {
    const name = client.escapeIdentifier(dbName);
    await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${name}`);
  } finally {
    await client.end();
  }
}
