import { runDbScript } from './global-setup';

/** Stops the embedded PostgreSQL only if global setup started it for this run. */
export default async function globalTeardown(): Promise<void> {
  if ((globalThis as { __SM_STARTED_PG__?: boolean }).__SM_STARTED_PG__) {
    runDbScript('stop');
  }
}
