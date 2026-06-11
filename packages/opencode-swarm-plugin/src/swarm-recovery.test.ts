import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  createInMemorySwarmMailLibSQL,
  type SwarmMailAdapter,
} from "swarm-mail";
import { createHiveAdapter, type HiveAdapter } from "swarm-mail";
import { autoRecoverOnStartup } from "./swarm-recovery";

describe("autoRecoverOnStartup", () => {
  let swarmMail: SwarmMailAdapter;
  let hive: HiveAdapter;
  const projectKey = "/test/recovery";

  beforeEach(async () => {
    swarmMail = await createInMemorySwarmMailLibSQL("test-recovery");
    const db = await swarmMail.getDatabase();
    hive = createHiveAdapter(db, projectKey);
    await hive.runMigrations();
  });

  afterEach(async () => {
    await swarmMail.close();
  });

  test("returns recovered: false when no checkpoint exists", async () => {
    const result = await autoRecoverOnStartup({
      project_path: projectKey,
      swarmMail,
      hive,
    });
    expect(result.recovered).toBe(false);
  });

  test("returns recovered: false when swarm_contexts table is empty", async () => {
    const db = await swarmMail.getDatabase();
    const count = await db.query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM swarm_contexts",
    );
    expect(count.rows[0].cnt).toBe(0);

    const result = await autoRecoverOnStartup({
      project_path: projectKey,
      swarmMail,
      hive,
    });
    expect(result.recovered).toBe(false);
  });

  test("returns recovered: true when checkpoint exists with in_progress subtasks", async () => {
    const epicCell = await hive.createCell(projectKey, {
      title: "Test Epic",
      type: "epic",
      priority: 2,
    });

    const subtaskCell = await hive.createCell(projectKey, {
      title: "Subtask 1",
      type: "task",
      priority: 2,
      parent_id: epicCell.id,
    });
    await hive.changeCellStatus(projectKey, subtaskCell.id, "in_progress");

    const db = await swarmMail.getDatabase();
    await db.query(
      `INSERT INTO swarm_contexts (
        id, project_key, epic_id, bead_id, strategy, files, dependencies,
        directives, recovery, created_at, checkpointed_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $10)`,
      [
        subtaskCell.id,
        projectKey,
        epicCell.id,
        subtaskCell.id,
        "file-based",
        JSON.stringify(["src/test.ts"]),
        JSON.stringify([]),
        JSON.stringify({}),
        JSON.stringify({ progress_percent: 50 }),
        Date.now(),
      ],
    );

    const result = await autoRecoverOnStartup({
      project_path: projectKey,
      swarmMail,
      hive,
    });
    expect(result.recovered).toBe(true);
    expect(result.epic_id).toBe(epicCell.id);
    expect(result.active_workers).toContain(subtaskCell.id);
  });

  test("returns correct epic_id and active_workers", async () => {
    const epicCell = await hive.createCell(projectKey, {
      title: "Epic",
      type: "epic",
      priority: 2,
    });

    const worker1 = await hive.createCell(projectKey, {
      title: "Worker 1",
      type: "task",
      priority: 2,
      parent_id: epicCell.id,
    });
    await hive.changeCellStatus(projectKey, worker1.id, "in_progress");

    const worker2 = await hive.createCell(projectKey, {
      title: "Worker 2",
      type: "task",
      priority: 2,
      parent_id: epicCell.id,
    });
    await hive.changeCellStatus(projectKey, worker2.id, "in_progress");

    const db = await swarmMail.getDatabase();
    await db.query(
      `INSERT INTO swarm_contexts (
        id, project_key, epic_id, bead_id, strategy, files, dependencies,
        directives, recovery, created_at, checkpointed_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $10)`,
      [
        worker1.id,
        projectKey,
        epicCell.id,
        worker1.id,
        "file-based",
        JSON.stringify(["src/a.ts"]),
        JSON.stringify([]),
        JSON.stringify({}),
        JSON.stringify({ progress_percent: 25 }),
        Date.now(),
      ],
    );

    const result = await autoRecoverOnStartup({
      project_path: projectKey,
      swarmMail,
      hive,
    });
    expect(result.recovered).toBe(true);
    expect(result.epic_id).toBe(epicCell.id);
    expect(result.active_workers).toHaveLength(2);
    expect(result.active_workers).toContain(worker1.id);
    expect(result.active_workers).toContain(worker2.id);
  });

  test("returns recovered: false when no in_progress subtasks exist", async () => {
    const epicCell = await hive.createCell(projectKey, {
      title: "Epic",
      type: "epic",
      priority: 2,
    });

    const completedCell = await hive.createCell(projectKey, {
      title: "Completed",
      type: "task",
      priority: 2,
      parent_id: epicCell.id,
    });
    await hive.changeCellStatus(projectKey, completedCell.id, "closed");

    const db = await swarmMail.getDatabase();
    await db.query(
      `INSERT INTO swarm_contexts (
        id, project_key, epic_id, bead_id, strategy, files, dependencies,
        directives, recovery, created_at, checkpointed_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $10)`,
      [
        completedCell.id,
        projectKey,
        epicCell.id,
        completedCell.id,
        "file-based",
        JSON.stringify([]),
        JSON.stringify([]),
        JSON.stringify({}),
        JSON.stringify({ progress_percent: 100 }),
        Date.now(),
      ],
    );

    const result = await autoRecoverOnStartup({
      project_path: projectKey,
      swarmMail,
      hive,
    });
    expect(result.recovered).toBe(false);
  });

  test("includes checkpoint data in recovery result", async () => {
    const epicCell = await hive.createCell(projectKey, {
      title: "Epic",
      type: "epic",
      priority: 2,
    });

    const subtask = await hive.createCell(projectKey, {
      title: "Subtask",
      type: "task",
      priority: 2,
      parent_id: epicCell.id,
    });
    await hive.changeCellStatus(projectKey, subtask.id, "in_progress");

    const db = await swarmMail.getDatabase();
    const recoveryData = {
      progress_percent: 60,
      files_modified: ["src/foo.ts", "src/bar.ts"],
    };
    await db.query(
      `INSERT INTO swarm_contexts (
        id, project_key, epic_id, bead_id, strategy, files, dependencies,
        directives, recovery, created_at, checkpointed_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $10)`,
      [
        subtask.id,
        projectKey,
        epicCell.id,
        subtask.id,
        "feature-based",
        JSON.stringify(["src/foo.ts"]),
        JSON.stringify([]),
        JSON.stringify({ shared_context: "test context" }),
        JSON.stringify(recoveryData),
        Date.now(),
      ],
    );

    const result = await autoRecoverOnStartup({
      project_path: projectKey,
      swarmMail,
      hive,
    });
    expect(result.recovered).toBe(true);
    expect(result.checkpoint).toEqual(recoveryData);
  });

  test("handles database errors gracefully", async () => {
    const result = await autoRecoverOnStartup({
      project_path: "/nonexistent/project/path",
    });
    expect(result.recovered).toBe(false);
  });
});
