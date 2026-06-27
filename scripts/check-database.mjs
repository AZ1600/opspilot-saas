import pg from "pg";

const { Pool } = pg;

const requiredTables = [
  "businesses",
  "users",
  "connected_accounts",
  "customers",
  "business_actions",
  "revenue_leaks",
  "customer_risks",
  "inbox_messages",
  "ingestions",
  "knowledge_documents",
  "timeline_events",
  "approval_events",
  "impact_entries",
  "execution_jobs",
];

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required to check the database.");
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
  const connection = await pool.query(
    "select current_database() as database_name, current_user as user_name",
  );
  const tableResult = await pool.query(
    `select table_name
     from information_schema.tables
     where table_schema = 'public' and table_name = any($1)
     order by table_name`,
    [requiredTables],
  );
  const presentTables = new Set(tableResult.rows.map((row) => row.table_name));
  const missingTables = requiredTables.filter((table) => !presentTables.has(table));

  console.log(
    JSON.stringify(
      {
        ok: missingTables.length === 0,
        database: connection.rows[0].database_name,
        user: connection.rows[0].user_name,
        requiredTables: requiredTables.length,
        presentTables: presentTables.size,
        missingTables,
      },
      null,
      2,
    ),
  );

  if (missingTables.length > 0) {
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
