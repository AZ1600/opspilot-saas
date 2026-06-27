import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const schemaPath = join(rootDir, "database", "schema.sql");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required to apply the database schema.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.DATABASE_SSL === "true"
      ? { rejectUnauthorized: false }
      : undefined,
});

try {
  const schema = await readFile(schemaPath, "utf8");
  await pool.query(schema);
  console.log("OpsPilot database schema applied successfully.");
} finally {
  await pool.end();
}
