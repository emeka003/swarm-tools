/**
 * Dependency Resolution Tests
 *
 * Tests for dependency handling in swarm subtask spawning.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { createInMemorySwarmMailLibSQL, type SwarmMailAdapter } from "swarm-mail";
import { createHiveAdapter, type HiveAdapter } from "swarm-mail";
import { getReadySubtasks, validateDependencies } from "./dependency-resolution";

describe("dependency-resolution", () => {
  let swarmMail: SwarmMailAdapter;
  let hive: HiveAdapter;
  const projectKey = "/test/project";
  const epicId = "epic-1";

  beforeEach(async () => {
    swarmMail = await createInMemorySwarmMailLibSQL("test-dep-resolution");
    const db = await swarmMail.getDatabase();
    hive = createHiveAdapter(db, projectKey);
    await hive.runMigrations();
  });

  afterEach(async () => {
    await swarmMail.close();
  });

  describe("getReadySubtasks", () => {
    test("returns all subtasks as ready when no dependencies", async () => {
      const subtasks = [
        { bead_id: "a", title: "Task A" },
        { bead_id: "b", title: "Task B" },
      ];

      const result = await getReadySubtasks({
        hive,
        project_key: projectKey,
        epic_id: epicId,
        subtasks,
      });

      expect(result).toHaveLength(2);
      expect(result.every((r) => r.ready)).toBe(true);
      expect(result[0].blocking_deps).toHaveLength(0);
    });

    test("blocks subtask when dependency is not completed", async () => {
      const depCell = await hive.createCell(projectKey, {
        title: "Dependency",
        type: "task",
        priority: 2,
      });
      await hive.changeCellStatus(projectKey, depCell.id, "in_progress");

      const subtasks = [
        { bead_id: "a", title: "Task A", depends_on: [depCell.id] },
      ];

      const result = await getReadySubtasks({
        hive,
        project_key: projectKey,
        epic_id: epicId,
        subtasks,
      });

      expect(result).toHaveLength(1);
      expect(result[0].ready).toBe(false);
      expect(result[0].blocking_deps).toHaveLength(1);
      expect(result[0].blocking_deps[0].bead_id).toBe(depCell.id);
      expect(result[0].blocking_deps[0].status).toBe("in_progress");
    });

    test("allows subtask when dependency is completed", async () => {
      const depCell = await hive.createCell(projectKey, {
        title: "Dependency",
        type: "task",
        priority: 2,
      });
      await hive.changeCellStatus(projectKey, depCell.id, "in_progress");
      await hive.closeCell(projectKey, depCell.id, "Done");

      const subtasks = [
        { bead_id: "a", title: "Task A", depends_on: [depCell.id] },
      ];

      const result = await getReadySubtasks({
        hive,
        project_key: projectKey,
        epic_id: epicId,
        subtasks,
      });

      expect(result).toHaveLength(1);
      expect(result[0].ready).toBe(true);
      expect(result[0].blocking_deps).toHaveLength(0);
    });

    test("handles missing dependency reference", async () => {
      const subtasks = [
        { bead_id: "a", title: "Task A", depends_on: ["nonexistent-id"] },
      ];

      const result = await getReadySubtasks({
        hive,
        project_key: projectKey,
        epic_id: epicId,
        subtasks,
      });

      expect(result).toHaveLength(1);
      expect(result[0].ready).toBe(false);
      expect(result[0].blocking_deps).toHaveLength(1);
      expect(result[0].blocking_deps[0].status).toBe("missing");
    });

    test("handles empty subtask list", async () => {
      const result = await getReadySubtasks({
        hive,
        project_key: projectKey,
        epic_id: epicId,
        subtasks: [],
      });

      expect(result).toHaveLength(0);
    });
  });

  describe("validateDependencies", () => {
    test("validates when no dependencies", async () => {
      const subtasks = [
        { bead_id: "a", depends_on: [] },
        { bead_id: "b" },
      ];

      const result = await validateDependencies({
        hive,
        project_key: projectKey,
        epic_id: epicId,
        subtasks,
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("detects cycles", async () => {
      const subtasks = [
        { bead_id: "a", depends_on: ["b"] },
        { bead_id: "b", depends_on: ["a"] },
      ];

      const result = await validateDependencies({
        hive,
        project_key: projectKey,
        epic_id: epicId,
        subtasks,
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Cycle detected"))).toBe(
        true,
      );
    });

    test("detects transitive cycles (3+ node)", async () => {
      const subtasks = [
        { bead_id: "a", depends_on: ["b"] },
        { bead_id: "b", depends_on: ["c"] },
        { bead_id: "c", depends_on: ["a"] },
      ];

      const result = await validateDependencies({
        hive,
        project_key: projectKey,
        epic_id: epicId,
        subtasks,
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("Cycle detected"))).toBe(
        true,
      );
      expect(result.errors.some((e) => e.includes("→"))).toBe(true);
    });

    test("detects missing dependency references", async () => {
      const subtasks = [{ bead_id: "a", depends_on: ["nonexistent"] }];

      const result = await validateDependencies({
        hive,
        project_key: projectKey,
        epic_id: epicId,
        subtasks,
      });

      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.includes("non-existent bead")),
      ).toBe(true);
    });

    test("allows valid dependency chain", async () => {
      const subtasks = [
        { bead_id: "a", depends_on: [] },
        { bead_id: "b", depends_on: ["a"] },
        { bead_id: "c", depends_on: ["b"] },
      ];

      const result = await validateDependencies({
        hive,
        project_key: projectKey,
        epic_id: epicId,
        subtasks,
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    test("allows dependency on existing bead not in subtask list", async () => {
      const depCell = await hive.createCell(projectKey, {
        title: "Existing dependency",
        type: "task",
        priority: 2,
      });

      const subtasks = [{ bead_id: "a", depends_on: [depCell.id] }];

      const result = await validateDependencies({
        hive,
        project_key: projectKey,
        epic_id: epicId,
        subtasks,
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});