import "dotenv/config";
import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL_POOLED && !process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL_POOLED (preferred) or DATABASE_URL must be set for drizzle-kit. " +
      "Copy .env.example to .env.local and fill in the Neon connection strings.",
  );
}

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: (process.env.DATABASE_URL_POOLED ?? process.env.DATABASE_URL) as string,
  },
  strict: true,
  verbose: true,
  casing: "snake_case",
});
