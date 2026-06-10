/**
 * Memory Default Repair Migration (v13)
 *
 * Strips outer single-quote characters from text columns whose Drizzle
 * schema defaults were previously specified with embedded SQL quotes.
 *
 * ## Background
 *
 * Drizzle's `text("col").default("'value'")` stores the literal string
 * `'value'` (apostrophes included) because Drizzle passes the value
 * through as a SQL literal, escaping the inner apostrophes. When a row
 * is inserted without an explicit value, the stored value contains
 * apostrophes, so a `WHERE col = 'value'` filter matches nothing.
 *
 * Affected columns (Drizzle schema path: src/db/schema/memory.ts):
 * - memories.metadata
 * - memories.collection
 * - memories.tags
 * - memories.status
 * - memories.access_count
 * - entities.alt_labels
 *
 * The Drizzle schema has been fixed to drop the embedded quotes. This
 * migration repairs existing rows that were stored with the broken
 * defaults by stripping the leading and trailing apostrophe characters
 * when both are present.
 *
 * Idempotent - safe to re-run.
 *
 * @module db/migrations/memory-default-repair
 */

import type { Migration } from "../../streams/migrations.js";

/**
 * Columns to repair, grouped by table.
 *
 * `nullMarker` is a sentinel used to detect columns whose value is
 * exactly two single quotes (an empty string from a stripped default).
 * These are reset to NULL instead of the empty string.
 */
export const MEMORY_REPAIR_COLUMNS: Record<string, string[]> = {
  memories: [
    "metadata",
    "collection",
    "tags",
    "status",
    "access_count",
  ],
  entities: [
    "alt_labels",
  ],
};

/**
 * Build a SQL UPDATE statement that strips outer single quotes from a
 * column when both the first and last characters are single quotes.
 *
 * SQLite string-literal syntax: `''''` is a single apostrophe character.
 * SUBSTR(x, 2, LENGTH(x) - 2) returns the inner substring.
 */
function buildStripUpdateSql(table: string, column: string): string {
  return `
    UPDATE ${table}
    SET ${column} = CASE
      WHEN ${column} IS NULL THEN NULL
      WHEN LENGTH(${column}) = 2 AND SUBSTR(${column}, 1, 1) = '''' AND SUBSTR(${column}, 2, 1) = '''' THEN NULL
      WHEN LENGTH(${column}) >= 2
           AND SUBSTR(${column}, 1, 1) = ''''
           AND SUBSTR(${column}, -1) = '''' THEN SUBSTR(${column}, 2, LENGTH(${column}) - 2)
      ELSE ${column}
    END
    WHERE ${column} IS NOT NULL
      AND LENGTH(${column}) >= 2
      AND (
        (LENGTH(${column}) = 2 AND SUBSTR(${column}, 1, 1) = '''')
        OR (SUBSTR(${column}, 1, 1) = '''' AND SUBSTR(${column}, -1) = '''')
      );
  `;
}

/**
 * Migration v13 (libSQL): Repair memory default values.
 *
 * Idempotent - re-running is a no-op once values are clean.
 */
export const memoryDefaultRepairMigrationLibSQL: Migration = {
  version: 13,
  description: "Repair memory columns: strip outer single quotes from values stored via buggy Drizzle defaults",
  up: (() => {
    const updates: string[] = [];
    for (const [table, columns] of Object.entries(MEMORY_REPAIR_COLUMNS)) {
      for (const column of columns) {
        updates.push(buildStripUpdateSql(table, column));
      }
    }
    return updates.join("\n");
  })(),
  down: `
    -- No-op: cannot reverse a data repair
    SELECT 1;
  `,
};

/**
 * Migration v13 (PGlite): Repair memory default values.
 *
 * PostgreSQL uses standard_conforming_strings and E'\\'' for escaping,
 * but we only need the simple form because the Drizzle defaults target
 * the libSQL schema. PGlite databases do not have the apostrophe issue
 * because PGlite's memoryMigration uses JSONB and standard TEXT defaults
 * without the Drizzle quoting bug.
 *
 * Kept as a no-op so the version is recorded for parity.
 */
export const memoryDefaultRepairMigration: Migration = {
  version: 13,
  description: "Repair memory columns: no-op for PGlite (Drizzle quote bug is libSQL-only)",
  up: `
    -- PGlite memory defaults are stored without the apostrophe bug.
    -- This migration is a no-op marker for version parity with libSQL.
    SELECT 1;
  `,
  down: `
    -- No-op: cannot reverse a data repair
    SELECT 1;
  `,
};
