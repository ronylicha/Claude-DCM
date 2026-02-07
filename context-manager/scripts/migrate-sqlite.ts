#!/usr/bin/env bun
/**
 * Migration Script: SQLite keyword_tool_scores -> PostgreSQL
 * Phase 2.1 & 2.2 - Data migration with integrity verification
 */

import { Database } from "bun:sqlite";
import postgres from "postgres";

const SQLITE_PATH = `${process.env["HOME"]}/.claude/routing.db`;
const PG_URL = "postgresql://rlicha:21081986Rl%40@localhost:5432/claude_context";

interface KeywordScore {
  keyword: string;
  tool_name: string;
  tool_type: string;
  score: number;
  usage_count: number;
  success_count: number;
  last_used: string;
}

async function migrate() {
  console.log("[Migration] Starting SQLite -> PostgreSQL migration");
  console.log(`[Migration] Source: ${SQLITE_PATH}`);

  // Step 1: Connect to SQLite
  const sqlite = new Database(SQLITE_PATH, { readonly: true });

  // Step 2: Count records in SQLite
  const sqliteCountResult = sqlite.query("SELECT COUNT(*) as count FROM keyword_tool_scores").get() as { count: number };
  const sqliteCount = sqliteCountResult.count;
  console.log(`[Migration] SQLite records: ${sqliteCount}`);

  if (sqliteCount === 0) {
    console.log("[Migration] No records to migrate. Exiting.");
    sqlite.close();
    return;
  }

  // Step 3: Read all records from SQLite
  const records = sqlite
    .query("SELECT keyword, tool_name, tool_type, score, usage_count, success_count, last_used FROM keyword_tool_scores")
    .all() as KeywordScore[];

  console.log(`[Migration] Read ${records.length} records from SQLite`);
  sqlite.close();

  // Step 4: Connect to PostgreSQL using postgres.js
  const sql = postgres(PG_URL, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
  });

  // Step 5: Verify PostgreSQL connection
  try {
    await sql`SELECT 1 as connected`;
    console.log("[Migration] PostgreSQL connection OK");
  } catch (error) {
    console.error("[Migration] PostgreSQL connection failed:", error);
    process.exit(1);
  }

  // Step 6: Check current PostgreSQL count
  const [pgBefore] = await sql`SELECT COUNT(*) as count FROM keyword_tool_scores`;
  console.log(`[Migration] PostgreSQL records before: ${pgBefore.count}`);

  // Step 7: Insert records in batches
  const BATCH_SIZE = 500;
  let inserted = 0;
  let updated = 0;
  let errors = 0;

  console.log(`[Migration] Inserting records in batches of ${BATCH_SIZE}...`);

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(records.length / BATCH_SIZE);

    try {
      // Process each record in the batch
      for (const record of batch) {
        try {
          // Convert SQLite datetime to PostgreSQL timestamp
          const lastUsed = record.last_used
            ? new Date(record.last_used.replace(" ", "T") + "Z")
            : new Date();

          const result = await sql`
            INSERT INTO keyword_tool_scores (keyword, tool_name, tool_type, score, usage_count, success_count, last_used)
            VALUES (${record.keyword}, ${record.tool_name}, ${record.tool_type}, ${record.score}, ${record.usage_count}, ${record.success_count}, ${lastUsed})
            ON CONFLICT (keyword, tool_name)
            DO UPDATE SET
              score = EXCLUDED.score,
              usage_count = EXCLUDED.usage_count,
              success_count = EXCLUDED.success_count,
              last_used = EXCLUDED.last_used
            RETURNING (xmax = 0) as is_insert
          `;
          if (result[0]?.is_insert) {
            inserted++;
          } else {
            updated++;
          }
        } catch (err) {
          errors++;
          if (errors <= 5) {
            console.error(`\n[Migration] Error on record: ${JSON.stringify(record)}`);
            console.error(`[Migration] Error: ${err instanceof Error ? err.message : err}`);
          }
        }
      }

      const progress = Math.round((i + batch.length) / records.length * 100);
      process.stdout.write(`\r[Migration] Progress: ${progress}% (batch ${batchNum}/${totalBatches})`);
    } catch (err) {
      console.error(`\n[Migration] Batch ${batchNum} failed:`, err);
      errors += batch.length;
    }
  }

  console.log("\n[Migration] Insertion complete");

  // Step 8: Verify counts match
  const [pgAfter] = await sql`SELECT COUNT(*) as count FROM keyword_tool_scores`;
  const pgCount = Number(pgAfter.count);

  console.log(`[Migration] PostgreSQL records after: ${pgCount}`);
  console.log(`[Migration] Inserted: ${inserted}, Updated: ${updated}, Errors: ${errors}`);

  // Step 9: Integrity check
  if (pgCount >= sqliteCount) {
    console.log("[Migration] SUCCESS - Record counts match or exceed source");
  } else {
    console.warn(`[Migration] WARNING - PostgreSQL has ${pgCount} records, SQLite had ${sqliteCount}`);
    console.warn("[Migration] Some records may have failed to migrate");
  }

  // Step 10: Sample verification
  console.log("\n[Migration] Sample verification (top 5 by score):");
  const samples = await sql`
    SELECT keyword, tool_name, score, usage_count
    FROM keyword_tool_scores
    ORDER BY score DESC, usage_count DESC
    LIMIT 5
  `;
  console.table(samples);

  // Close connection
  await sql.end();

  console.log("\n[Migration] Migration completed successfully!");
  return {
    sourceCount: sqliteCount,
    targetCount: pgCount,
    inserted,
    updated,
    errors,
  };
}

// Run migration
migrate()
  .then((result) => {
    if (result) {
      console.log("\n[Migration] Final result:", JSON.stringify(result, null, 2));
    }
    process.exit(0);
  })
  .catch((err) => {
    console.error("[Migration] Fatal error:", err);
    process.exit(1);
  });
