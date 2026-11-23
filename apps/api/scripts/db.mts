// Local PostgreSQL 16 without Docker: runs the binaries shipped by the `embedded-postgres` dev
// dependency. The server is daemonised with pg_ctl, so it keeps running after this script exits.
//
//   tsx scripts/db.mts start    initialise (first run), start on :PGPORT, create the databases
//   tsx scripts/db.mts stop     fast shutdown
//   tsx scripts/db.mts status   exit 0 if running
//
// Local development only: credentials match the placeholders in .env.example, and the server
// listens on localhost only. Data lives in apps/api/.data/pg (git-ignored).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataRoot = join(apiRoot, '.data');
const dataDir = join(dataRoot, 'pg');
const logFile = join(dataRoot, 'pg.log');
const port = Number(process.env.PGPORT ?? 5432);
const USER = 'savemeal';
const PASSWORD = 'savemeal';
const DATABASES = ['savemeal', 'savemeal_test'];

async function pgCtlPath(): Promise<string> {
  const platformPackage = `@embedded-postgres/${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}`;
  const binaries = (await import(platformPackage)) as { pg_ctl: string };
  return binaries.pg_ctl;
}

function pg(): EmbeddedPostgres {
  return new EmbeddedPostgres({
    databaseDir: dataDir,
    user: USER,
    password: PASSWORD,
    port,
    persistent: true,
    authMethod: 'scram-sha-256',
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: () => undefined,
    onError: (error) => console.error(String(error)),
  });
}

/**
 * Runs pg_ctl. `start` must not pipe stdio: the daemonised server inherits the handles and
 * spawnSync would wait for them forever. Its output goes to the server log file instead.
 */
function pgCtl(binary: string, args: string[], { detach = false } = {}): { ok: boolean; output: string } {
  const result = spawnSync(binary, args, detach ? { stdio: 'ignore', windowsHide: true } : { encoding: 'utf8' });
  return { ok: result.status === 0, output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
}

async function isRunning(binary: string): Promise<boolean> {
  return existsSync(join(dataDir, 'PG_VERSION')) && pgCtl(binary, ['status', '-D', dataDir]).ok;
}

async function ensureDatabases(): Promise<void> {
  const client = pg().getPgClient('postgres', 'localhost');
  await client.connect();
  try {
    for (const name of DATABASES) {
      const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
      if (exists.rowCount === 0) {
        await client.query(`CREATE DATABASE ${client.escapeIdentifier(name)}`);
        console.log(`created database ${name}`);
      }
    }
  } finally {
    await client.end();
  }
}

async function start(): Promise<void> {
  const binary = await pgCtlPath();
  if (!existsSync(join(dataDir, 'PG_VERSION'))) {
    mkdirSync(dataRoot, { recursive: true });
    console.log(`initialising PostgreSQL cluster in ${dataDir}`);
    await pg().initialise();
  }
  if (await isRunning(binary)) {
    console.log(`PostgreSQL already running on localhost:${port}`);
  } else {
    const started = pgCtl(binary, [
      'start',
      '-D',
      dataDir,
      '-l',
      logFile,
      '-w',
      '-t',
      '60',
      '-o',
      `-p ${port} -c listen_addresses=localhost -c TimeZone=UTC`,
    ], { detach: true });
    if (!started.ok) throw new Error(`pg_ctl start failed (see ${logFile}):\n${started.output}`);
    console.log(`PostgreSQL started on localhost:${port}`);
  }
  await ensureDatabases();
}

async function stop(): Promise<void> {
  const binary = await pgCtlPath();
  if (!(await isRunning(binary))) {
    console.log('PostgreSQL is not running');
    return;
  }
  const stopped = pgCtl(binary, ['stop', '-D', dataDir, '-m', 'fast', '-w']);
  if (!stopped.ok) throw new Error(`pg_ctl stop failed:\n${stopped.output}`);
  console.log('PostgreSQL stopped');
}

async function status(): Promise<void> {
  const running = await isRunning(await pgCtlPath());
  console.log(running ? `PostgreSQL running (data: ${dataDir})` : 'PostgreSQL is not running');
  process.exitCode = running ? 0 : 1;
}

const commands: Record<string, () => Promise<void>> = { start, stop, status };
const command = commands[process.argv[2] ?? ''];
if (!command) {
  console.error('usage: tsx scripts/db.mts <start|stop|status>');
  process.exit(2);
}
command().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
