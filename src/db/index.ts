import { neon, neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle as drizzleHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzleWs } from "drizzle-orm/neon-serverless";

import * as schema from "./schema";

// Per ADR-0001: Neon Postgres. HTTP driver for request-time queries
// (no connection-pool exhaustion on Vercel functions); websocket pool
// for long-running jobs that need transactions or many statements
// (cron runs, transcription pipeline, migrations).

if (process.env.NODE_ENV !== "production") {
  // Local dev against `neon local` proxy can require this; harmless in cloud.
  neonConfig.fetchConnectionCache = true;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required env var ${name}. See .env.example for the full list.`,
    );
  }
  return value;
}

/**
 * Request-time DB client. Use this from Server Components, Route
 * Handlers, and Server Actions. One HTTP round-trip per query, no
 * persistent connection.
 *
 * Transactions are NOT supported by the HTTP driver; for multi-statement
 * atomic work, use `dbPooled` instead.
 */
export const db = drizzleHttp(neon(requireEnv("DATABASE_URL")), {
  schema,
  casing: "snake_case",
});

/**
 * Pooled DB client for cron jobs, migrations, and any code path that
 * needs transactions. Caller is responsible for `pool.end()` on
 * shutdown for short-lived scripts.
 */
export function makePooledDb() {
  const pool = new Pool({
    connectionString: requireEnv("DATABASE_URL_POOLED"),
  });
  return {
    db: drizzleWs(pool, { schema, casing: "snake_case" }),
    pool,
  };
}

export { schema };
export type Db = typeof db;
