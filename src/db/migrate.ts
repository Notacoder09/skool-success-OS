import "dotenv/config";

import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { migrate } from "drizzle-orm/neon-serverless/migrator";

async function main() {
  const url = process.env.DATABASE_URL_POOLED ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL_POOLED (preferred) or DATABASE_URL must be set to run migrations.",
    );
  }

  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);

  console.warn("Running drizzle migrations from ./drizzle ...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.warn("Migrations complete.");

  await pool.end();
}

main().catch((err: unknown) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
