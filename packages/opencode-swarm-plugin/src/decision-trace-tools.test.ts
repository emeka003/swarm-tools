/**
 * Decision Trace Tools Tests
 *
 * Tests the MCP tools that expose decision traces to LLM agents.
 * Follows TDD: write failing tests first, then implement.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { decisionTraceTools } from "./decision-trace-tools.js";
import { createLibSQLAdapter, createLibSQLStreamsSchema, getDatabasePath } from "swarm-mail";
import type { DatabaseAdapter } from "swarm-mail";

describe("Decision Trace Tools", () => {
  const testProjectKey = "/tmp/decision-trace-tools-test";
  let testDb: DatabaseAdapter;

  beforeAll(async () => {
    const testDbPath = getDatabasePath(testProjectKey);
    testDb = await createLibSQLAdapter({ url: `file:${testDbPath}` });
    await createLibSQLStreamsSchema(testDb);
  });

  afterAll(async () => {
    await testDb.close?.();
  });

  describe("swarm_record_decision", () => {
    test("creates a decision trace", async () => {
      const tool = decisionTraceTools.swarm_record_decision;
      expect(tool).toBeDefined();
      expect(tool.execute).toBeDefined();

      const result = await tool.execute({
        epic_id: "epic-123",
        decision_type: "spawn",
        decision: "Spawn worker BlueLake for auth task",
        reason: "Task requires parallel execution",
        evidence: ["Task complexity > 5", "Files: src/auth/*"],
        alternatives_considered: ["Sequential execution"],
      }, { sessionID: "test-session" });

      expect(result).toContain("epic_id");
      expect(result).toContain("epic-123");
      expect(result).toContain("spawn");
    });

    test("validates required fields", async () => {
      const tool = decisionTraceTools.swarm_record_decision;
      
      // Missing epic_id should fail with validation error
      const result = await tool.execute({
        decision_type: "spawn",
        decision: "Spawn worker",
        reason: "Reason",
      }, { sessionID: "test-session" });
      
      const parsed = JSON.parse(result);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toBeDefined();
    });
  });

  describe("swarm_get_decision_traces", () => {
    test("returns traces for an epic", async () => {
      const tool = decisionTraceTools.swarm_get_decision_traces;
      expect(tool).toBeDefined();
      expect(tool.execute).toBeDefined();

      // First record a trace
      await decisionTraceTools.swarm_record_decision.execute({
        epic_id: "epic-456",
        decision_type: "approve",
        decision: "Approved worker output",
        reason: "All tests passing",
      }, { sessionID: "test-session" });

      // Then query it
      const result = await tool.execute({
        epic_id: "epic-456",
      }, { sessionID: "test-session" });

      expect(result).toContain("epic-456");
      expect(result).toContain("approve");
    });

    test("filters by decision_type", async () => {
      // Record different types
      await decisionTraceTools.swarm_record_decision.execute({
        epic_id: "epic-789",
        decision_type: "reject",
        decision: "Rejected output",
        reason: "Tests failing",
      }, { sessionID: "test-session" });

      await decisionTraceTools.swarm_record_decision.execute({
        epic_id: "epic-789",
        decision_type: "spawn",
        decision: "Spawn new worker",
        reason: "Replacement needed",
      }, { sessionID: "test-session" });

      // Query only reject decisions
      const result = await decisionTraceTools.swarm_get_decision_traces.execute({
        epic_id: "epic-789",
        decision_type: "reject",
      }, { sessionID: "test-session" });

      expect(result).toContain("reject");
      expect(result).not.toContain("spawn");
    });

    test("filters by agent", async () => {
      // Record traces from different agents
      await decisionTraceTools.swarm_record_decision.execute({
        epic_id: "epic-101",
        decision_type: "spawn",
        decision: "Spawn worker",
        reason: "Task needs implementation",
      }, { sessionID: "test-session" });

      const result = await decisionTraceTools.swarm_get_decision_traces.execute({
        epic_id: "epic-101",
        agent: "swarm-worker-v2-2",
      }, { sessionID: "test-session" });

      expect(result).toContain("swarm-worker-v2-2");
    });
  });
});