import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { getSiblingWorkerContext } from "./sibling-context";
import { createInMemorySwarmMailLibSQL, type SwarmMailAdapter } from "swarm-mail";
import { createHiveAdapter, type HiveAdapter } from "swarm-mail";

describe("getSiblingWorkerContext", () => {
  let swarmMail: SwarmMailAdapter;
  let hive: HiveAdapter;
  const testProjectPath = "/test/project";

  beforeEach(async () => {
    swarmMail = await createInMemorySwarmMailLibSQL("test-sibling-context");
    const db = await swarmMail.getDatabase();
    hive = createHiveAdapter(db, testProjectPath);
    await hive.runMigrations();
  });

  afterEach(async () => {
    await swarmMail.close();
  });

  test("returns empty context when no siblings", async () => {
    const context = await getSiblingWorkerContext({
      project_path: testProjectPath,
      current_bead_id: "epic-1.task-1",
      epic_id: "epic-1",
    });

    expect(context.active_workers).toHaveLength(0);
    expect(context.summary).toBe("No active sibling workers in this epic.");
  });

  test("returns active workers from same epic", async () => {
    const epic = await hive.createCell(testProjectPath, {
      title: "Test Epic",
      type: "epic",
    });

    const cell1 = await hive.createCell(testProjectPath, {
      title: "Task 1",
      type: "task",
      parent_id: epic.id,
    });
    await hive.changeCellStatus(testProjectPath, cell1.id, "in_progress");

    const cell2 = await hive.createCell(testProjectPath, {
      title: "Task 2",
      type: "task",
      parent_id: epic.id,
    });
    await hive.changeCellStatus(testProjectPath, cell2.id, "in_progress");

    const context = await getSiblingWorkerContext({
      project_path: testProjectPath,
      current_bead_id: cell1.id,
      epic_id: epic.id,
      adapter: hive,
    });

    expect(context.active_workers).toHaveLength(1);
    expect(context.active_workers[0].bead_id).toBe(cell2.id);
    expect(context.active_workers[0].title).toBe("Task 2");
  });

  test("excludes current worker from siblings", async () => {
    const epic = await hive.createCell(testProjectPath, {
      title: "Test Epic",
      type: "epic",
    });

    const cell1 = await hive.createCell(testProjectPath, {
      title: "Current Task",
      type: "task",
      parent_id: epic.id,
    });
    await hive.changeCellStatus(testProjectPath, cell1.id, "in_progress");

    const cell2 = await hive.createCell(testProjectPath, {
      title: "Other Task",
      type: "task",
      parent_id: epic.id,
    });
    await hive.changeCellStatus(testProjectPath, cell2.id, "in_progress");

    const context = await getSiblingWorkerContext({
      project_path: testProjectPath,
      current_bead_id: cell1.id,
      epic_id: epic.id,
      adapter: hive,
    });

    expect(context.active_workers).toHaveLength(1);
    expect(context.active_workers[0].bead_id).toBe(cell2.id);
  });

  test("formats summary correctly", async () => {
    const epic = await hive.createCell(testProjectPath, {
      title: "Test Epic",
      type: "epic",
    });

    const cell1 = await hive.createCell(testProjectPath, {
      title: "Task 1",
      type: "task",
      parent_id: epic.id,
    });
    await hive.changeCellStatus(testProjectPath, cell1.id, "in_progress");

    const cell2 = await hive.createCell(testProjectPath, {
      title: "Task 2",
      type: "task",
      parent_id: epic.id,
    });
    await hive.changeCellStatus(testProjectPath, cell2.id, "in_progress");

    const context = await getSiblingWorkerContext({
      project_path: testProjectPath,
      current_bead_id: cell1.id,
      epic_id: epic.id,
      adapter: hive,
    });

    expect(context.summary).toContain("Active workers in this epic:");
    expect(context.summary).toContain(cell2.id);
    expect(context.summary).toContain("Task 2");
  });

  test("handles workers without files", async () => {
    const epic = await hive.createCell(testProjectPath, {
      title: "Test Epic",
      type: "epic",
    });

    const cell1 = await hive.createCell(testProjectPath, {
      title: "Current Task",
      type: "task",
      parent_id: epic.id,
    });
    await hive.changeCellStatus(testProjectPath, cell1.id, "in_progress");

    const cell2 = await hive.createCell(testProjectPath, {
      title: "Other Task",
      type: "task",
      parent_id: epic.id,
    });
    await hive.changeCellStatus(testProjectPath, cell2.id, "in_progress");

    const context = await getSiblingWorkerContext({
      project_path: testProjectPath,
      current_bead_id: cell1.id,
      epic_id: epic.id,
      adapter: hive,
    });

    expect(context.active_workers).toHaveLength(1);
    expect(context.summary).toContain(cell2.id);
    expect(context.summary).toContain("Other Task");
  });
});
