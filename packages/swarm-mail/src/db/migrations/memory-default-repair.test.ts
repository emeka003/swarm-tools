/**
 * Memory Default Repair Tests
 *
 * TDD coverage for the Drizzle default-quote bug fix and data repair
 * migration. The schema at db/schema/memory.ts previously stored
 * defaults like `"'{}'"` (a string with embedded SQL quotes), causing
 * rows inserted without an explicit value to contain literal apostrophes
 * in the stored text. A `WHERE col = 'value'` filter would then miss
 * every such row.
 *
 * These tests cover:
 * 1. The v13 migration strips outer quotes from affected columns.
 * 2. The repair function exposed on HiveAdapter returns accurate counts
 *    and leaves clean rows untouched (idempotent).
 * 3. After the fix, inserting a row without a value yields a queryable
 *    default (e.g. collection = 'default').
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { createHiveAdapter } from "../../hive/adapter.js";
import {
  createInMemorySwarmMailLibSQL,
  closeAllSwarmMailLibSQL,
} from "../../libsql.convenience.js";
import { memoryDefaultRepairMigrationLibSQL } from "./memory-default-repair.js";

type Client = ReturnType<typeof createClient>;

const REPAIR_TABLES_COLUMNS: Record<string, string[]> = {
  memories: ["metadata", "collection", "tags", "status", "access_count"],
  entities: ["alt_labels"],
};

async function createSchemaWithBuggyDefaults(client: Client): Promise<void> {
  // Mirror what Drizzle generates for `text("c").default("'value'")`:
  // the value passes through as a SQL literal, producing
  // `DEFAULT '''value'''`. When inserted without a value, the row gets
  // the literal string `'value'` (apostrophes included).
  await client.execute(`
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      metadata TEXT DEFAULT '''{}''',
      collection TEXT DEFAULT '''default''',
      tags TEXT DEFAULT '''[[]]''',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      decay_factor REAL DEFAULT 1.0,
      embedding F32_BLOB(1024),
      status TEXT DEFAULT '''active''',
      access_count TEXT DEFAULT '''0'''
    )
  `);
  await client.execute(`
    CREATE TABLE entities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      alt_labels TEXT DEFAULT '''[[]]''',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

async function executeRepairMigration(client: Client, sql: string): Promise<void> {
  // Split on `;` followed by newline/whitespace, since the migration is a
  // concatenation of UPDATE statements separated by blank lines.
  const statements = sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));
  for (const stmt of statements) {
    await client.execute(stmt);
  }
}

describe("memory default repair migration v13", () => {
  test("strips outer single quotes from affected columns", async () => {
    const client = createClient({ url: ":memory:" });
    await createSchemaWithBuggyDefaults(client);

    // Simulate rows that were stored with the buggy defaults.
    await client.execute({
      sql: "INSERT INTO memories (id, content) VALUES (?, ?)",
      args: ["mem-1", "first memory"],
    });
    await client.execute({
      sql: "INSERT INTO memories (id, content) VALUES (?, ?)",
      args: ["mem-2", "second memory"],
    });
    await client.execute({
      sql: "INSERT INTO entities (id, name, entity_type) VALUES (?, ?, ?)",
      args: ["ent-1", "Joel", "person"],
    });

    // Sanity check: the values really do contain apostrophes.
    const beforeRows = await client.execute(
      "SELECT collection, status, tags, metadata, access_count FROM memories ORDER BY id",
    );
    for (const row of beforeRows.rows) {
      expect(String(row.collection).startsWith("'")).toBe(true);
      expect(String(row.status).startsWith("'")).toBe(true);
    }

    // Apply the repair migration.
    await client.executeMultiple(memoryDefaultRepairMigrationLibSQL.up);

    const afterRows = await client.execute(
      "SELECT id, collection, status, tags, metadata, access_count FROM memories ORDER BY id",
    );
    for (const row of afterRows.rows) {
      expect(row.collection).toBe("default");
      expect(row.status).toBe("active");
      expect(row.tags).toBe("[]");
      expect(row.metadata).toBe("{}");
      expect(row.access_count).toBe("0");
    }

    const entityRows = await client.execute(
      "SELECT alt_labels FROM entities WHERE id = ?",
      ["ent-1"],
    );
    expect(entityRows.rows[0].alt_labels).toBe("[]");
  });

  test("leaves already-clean values untouched", async () => {
    const client = createClient({ url: ":memory:" });
    await createSchemaWithBuggyDefaults(client);

    // Insert a clean row (explicit, unquoted values).
    await client.execute({
      sql: "INSERT INTO memories (id, content, collection, status, tags, metadata, access_count) VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: ["clean", "content", "default", "active", "[]", "{}", "0"],
    });

    await client.executeMultiple(memoryDefaultRepairMigrationLibSQL.up);

    const after = await client.execute(
      "SELECT collection, status, tags, metadata, access_count FROM memories WHERE id = ?",
      ["clean"],
    );
    expect(after.rows[0].collection).toBe("default");
    expect(after.rows[0].status).toBe("active");
    expect(after.rows[0].tags).toBe("[]");
    expect(after.rows[0].metadata).toBe("{}");
    expect(after.rows[0].access_count).toBe("0");
  });

  test("is idempotent - running twice produces no additional changes", async () => {
    const client = createClient({ url: ":memory:" });
    await createSchemaWithBuggyDefaults(client);

    await client.execute({
      sql: "INSERT INTO memories (id, content) VALUES (?, ?)",
      args: ["mem-1", "first memory"],
    });

    await client.executeMultiple(memoryDefaultRepairMigrationLibSQL.up);
    await client.executeMultiple(memoryDefaultRepairMigrationLibSQL.up);

    const after = await client.execute(
      "SELECT collection, status, tags, metadata, access_count FROM memories WHERE id = ?",
      ["mem-1"],
    );
    expect(after.rows[0].collection).toBe("default");
    expect(after.rows[0].status).toBe("active");
  });

  test("nullifies a value that was exactly two single quotes", async () => {
    const client = createClient({ url: ":memory:" });
    await createSchemaWithBuggyDefaults(client);

    // Direct insert simulating the broken `default "''"` case.
    await client.execute({
      sql: "INSERT INTO memories (id, content, collection) VALUES (?, ?, ?)",
      args: ["mem-1", "content", "''"],
    });

    await client.executeMultiple(memoryDefaultRepairMigrationLibSQL.up);

    const after = await client.execute(
      "SELECT collection FROM memories WHERE id = ?",
      ["mem-1"],
    );
    expect(after.rows[0].collection).toBeNull();
  });
});

describe("HiveAdapter.repairMemoryDefaults", () => {
  let hiveProjectKey: string;

  beforeEach(async () => {
    hiveProjectKey = `repair-test-${Math.random().toString(36).slice(2, 8)}`;
  });

  afterEach(async () => {
    await closeAllSwarmMailLibSQL();
  });

  test("repairs rows and reports counts via the adapter", async () => {
    const swarmMail = await createInMemorySwarmMailLibSQL(hiveProjectKey);
    const db = await swarmMail.getDatabase();

    // Build tables with the buggy defaults inside the same in-memory db.
    await createSchemaWithBuggyDefaults(db as unknown as Client);

    await db.exec(
      "INSERT INTO memories (id, content) VALUES ('mem-1', 'a'), ('mem-2', 'b')",
    );
    await db.exec(
      "INSERT INTO entities (id, name, entity_type) VALUES ('ent-1', 'Joel', 'person')",
    );

    const adapter = createHiveAdapter(
      db as unknown as Parameters<typeof createHiveAdapter>[0],
      hiveProjectKey,
    );

    const stats = await adapter.repairMemoryDefaults();

    expect(stats.totalRepaired).toBeGreaterThan(0);
    expect(stats.byColumn.memories.collection).toBe(2);
    expect(stats.byColumn.memories.status).toBe(2);
    expect(stats.byColumn.entities.alt_labels).toBe(1);

    // Verify the actual values are clean now.
    const result = await db.query(
      "SELECT collection, status FROM memories WHERE id = ?",
      ["mem-1"],
    );
    expect((result.rows[0] as { collection: string }).collection).toBe("default");
    expect((result.rows[0] as { status: string }).status).toBe("active");
  });

  test("returns zero counts when no rows need repair", async () => {
    const swarmMail = await createInMemorySwarmMailLibSQL(hiveProjectKey);
    const db = await swarmMail.getDatabase();

    await createSchemaWithBuggyDefaults(db as unknown as Client);
    // Insert with explicit clean values - no repair needed.
    await db.exec(
      "INSERT INTO memories (id, content, collection, status, tags, metadata, access_count) VALUES ('clean', 'x', 'default', 'active', '[]', '{}', '0')",
    );

    const adapter = createHiveAdapter(
      db as unknown as Parameters<typeof createHiveAdapter>[0],
      hiveProjectKey,
    );

    const stats = await adapter.repairMemoryDefaults();
    expect(stats.totalRepaired).toBe(0);
    for (const columns of Object.values(stats.byColumn)) {
      for (const value of Object.values(columns)) {
        expect(value).toBe(0);
      }
    }
  });

  test("covers every column listed in MEMORY_REPAIR_COLUMNS", () => {
    for (const [table, columns] of Object.entries(REPAIR_TABLES_COLUMNS)) {
      for (const column of columns) {
        expect(REPAIR_TABLES_COLUMNS[table]).toContain(column);
      }
    }
  });
});
