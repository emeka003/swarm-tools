/**
 * Coordinator Guard Tests
 * 
 * Tests for runtime enforcement of coordinator protocol violations.
 * Coordinators must NOT edit files, run tests, or reserve files.
 * These actions must be delegated to workers via swarm_spawn_subtask.
 */

import { describe, test, expect } from "bun:test";
import {
  checkCoordinatorGuard,
  checkGitSafetyGate,
  CoordinatorGuardError,
  isCoordinator,
} from "./coordinator-guard.js";
import type { SafetyConfig } from "./safety-config.js";

describe("isCoordinator", () => {
  test("returns true when agent context is 'coordinator'", () => {
    expect(isCoordinator("coordinator")).toBe(true);
  });

  test("returns false when agent context is 'worker'", () => {
    expect(isCoordinator("worker")).toBe(false);
  });

  test("returns false for unknown context", () => {
    expect(isCoordinator("unknown" as any)).toBe(false);
  });

  test("returns false for undefined context", () => {
    expect(isCoordinator(undefined as any)).toBe(false);
  });

  test("returns false for null context", () => {
    expect(isCoordinator(null as any)).toBe(false);
  });
});

describe("checkCoordinatorGuard", () => {
  test("allows workers to edit files", () => {
    const result = checkCoordinatorGuard({
      agentContext: "worker",
      toolName: "edit",
      toolArgs: { filePath: "src/test.ts" },
    });

    expect(result.blocked).toBe(false);
    expect(result.error).toBeUndefined();
  });

  test("blocks coordinators from editing files", () => {
    const result = checkCoordinatorGuard({
      agentContext: "coordinator",
      toolName: "edit",
      toolArgs: { filePath: "src/test.ts" },
    });

    expect(result.blocked).toBe(true);
    expect(result.error).toBeInstanceOf(CoordinatorGuardError);
    expect(result.error?.message).toContain("must spawn a worker");
    expect(result.error?.violationType).toBe("coordinator_edited_file");
  });

  test("blocks coordinators from writing files", () => {
    const result = checkCoordinatorGuard({
      agentContext: "coordinator",
      toolName: "write",
      toolArgs: { filePath: "src/new.ts", content: "code" },
    });

    expect(result.blocked).toBe(true);
    expect(result.error).toBeInstanceOf(CoordinatorGuardError);
    expect(result.error?.violationType).toBe("coordinator_edited_file");
  });

  test("blocks coordinators from running tests via bash", () => {
    const result = checkCoordinatorGuard({
      agentContext: "coordinator",
      toolName: "bash",
      toolArgs: { command: "bun test src/" },
    });

    expect(result.blocked).toBe(true);
    expect(result.error).toBeInstanceOf(CoordinatorGuardError);
    expect(result.error?.violationType).toBe("coordinator_ran_tests");
    expect(result.error?.message).toContain("Workers run tests");
  });

  test("allows coordinators to run non-test bash commands", () => {
    const result = checkCoordinatorGuard({
      agentContext: "coordinator",
      toolName: "bash",
      toolArgs: { command: "git status" },
    });

    expect(result.blocked).toBe(false);
  });

  test("blocks coordinators from reserving files", () => {
    const result = checkCoordinatorGuard({
      agentContext: "coordinator",
      toolName: "swarmmail_reserve",
      toolArgs: { paths: ["src/auth/**"] },
    });

    expect(result.blocked).toBe(true);
    expect(result.error).toBeInstanceOf(CoordinatorGuardError);
    expect(result.error?.violationType).toBe("coordinator_reserved_files");
  });

  test("allows workers to reserve files", () => {
    const result = checkCoordinatorGuard({
      agentContext: "worker",
      toolName: "swarmmail_reserve",
      toolArgs: { paths: ["src/auth/**"] },
    });

    expect(result.blocked).toBe(false);
  });

  test("allows coordinators to use swarm_spawn_subtask", () => {
    const result = checkCoordinatorGuard({
      agentContext: "coordinator",
      toolName: "swarm_spawn_subtask",
      toolArgs: { bead_id: "bd-123.1", epic_id: "bd-123" },
    });

    expect(result.blocked).toBe(false);
  });

  test("allows coordinators to use hive_create_epic", () => {
    const result = checkCoordinatorGuard({
      agentContext: "coordinator",
      toolName: "hive_create_epic",
      toolArgs: { epic_title: "Add auth", subtasks: [] },
    });

    expect(result.blocked).toBe(false);
  });

  test("error contains helpful suggestion", () => {
    const result = checkCoordinatorGuard({
      agentContext: "coordinator",
      toolName: "edit",
      toolArgs: { filePath: "src/auth.ts" },
    });

    expect(result.error?.message).toContain("swarm_spawn_subtask");
    expect(result.error?.suggestion).toBeDefined();
  });

  test("test execution patterns match various test runners", () => {
    const testCommands = [
      "bun test",
      "npm test",
      "npm run test",
      "yarn test",
      "pnpm test",
      "jest",
      "vitest run",
      "mocha spec/",
      "ava tests/",
    ];

    for (const command of testCommands) {
      const result = checkCoordinatorGuard({
        agentContext: "coordinator",
        toolName: "bash",
        toolArgs: { command },
      });

      expect(result.blocked).toBe(true);
      expect(result.error?.violationType).toBe("coordinator_ran_tests");
    }
  });
});

describe("CoordinatorGuardError", () => {
  test("includes violation type and payload", () => {
    const error = new CoordinatorGuardError(
      "Test message",
      "coordinator_edited_file",
      { file: "test.ts" },
      "Use swarm_spawn_subtask instead"
    );

    expect(error.violationType).toBe("coordinator_edited_file");
    expect(error.payload).toEqual({ file: "test.ts" });
    expect(error.suggestion).toBe("Use swarm_spawn_subtask instead");
    expect(error.name).toBe("CoordinatorGuardError");
  });
});

const STRICT_CONFIG: SafetyConfig = {
  safe_mode: true,
  allow_auto_push: false,
};

describe("checkGitSafetyGate", () => {
  test("blocks git reset --hard in bash", () => {
    const result = checkGitSafetyGate({
      toolName: "bash",
      toolArgs: { command: "git reset --hard HEAD~1" },
      config: STRICT_CONFIG,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("git reset");
  });

  test("blocks git reset --hard even on a fresh branch", () => {
    const result = checkGitSafetyGate({
      toolName: "bash",
      toolArgs: { command: "git reset --hard origin/main" },
      config: STRICT_CONFIG,
    });

    expect(result.allowed).toBe(false);
  });

  test("blocks git clean with force flag", () => {
    const result = checkGitSafetyGate({
      toolName: "bash",
      toolArgs: { command: "git clean -fd" },
      config: STRICT_CONFIG,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("git clean");
  });

  test("blocks git clean --force variant", () => {
    const result = checkGitSafetyGate({
      toolName: "bash",
      toolArgs: { command: "git clean --force -d" },
      config: STRICT_CONFIG,
    });

    expect(result.allowed).toBe(false);
  });

  test("blocks git push with --force flag", () => {
    const result = checkGitSafetyGate({
      toolName: "bash",
      toolArgs: { command: "git push --force origin main" },
      config: STRICT_CONFIG,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("force push");
  });

  test("blocks git push with -f flag", () => {
    const result = checkGitSafetyGate({
      toolName: "bash",
      toolArgs: { command: "git push -f origin feature" },
      config: STRICT_CONFIG,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("force push");
  });

  test("allows normal git push without force", () => {
    const result = checkGitSafetyGate({
      toolName: "bash",
      toolArgs: { command: "git push origin main" },
      config: STRICT_CONFIG,
    });

    expect(result.allowed).toBe(true);
  });

  test("allows git reset --soft (non-destructive)", () => {
    const result = checkGitSafetyGate({
      toolName: "bash",
      toolArgs: { command: "git reset --soft HEAD~1" },
      config: STRICT_CONFIG,
    });

    expect(result.allowed).toBe(true);
  });

  test("allows safe worktree cleanup inside .swarm/worktrees", () => {
    const result = checkGitSafetyGate({
      toolName: "bash",
      toolArgs: { command: "rm -rf .swarm/worktrees/bd-abc123.1" },
      config: STRICT_CONFIG,
    });

    expect(result.allowed).toBe(true);
  });

  test("blocks recursive force removal outside .swarm/worktrees", () => {
    const result = checkGitSafetyGate({
      toolName: "bash",
      toolArgs: { command: "rm -rf /tmp/some-build" },
      config: STRICT_CONFIG,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("recursive removal");
  });

  test("blocks rm -rf on home directory paths", () => {
    const result = checkGitSafetyGate({
      toolName: "bash",
      toolArgs: { command: "rm -rf ~/important-data" },
      config: STRICT_CONFIG,
    });

    expect(result.allowed).toBe(false);
  });

  test("allows non-destructive bash commands", () => {
    const result = checkGitSafetyGate({
      toolName: "bash",
      toolArgs: { command: "git status" },
      config: STRICT_CONFIG,
    });

    expect(result.allowed).toBe(true);
  });

  test("allows non-bash tools by default", () => {
    const result = checkGitSafetyGate({
      toolName: "read",
      toolArgs: { filePath: "src/auth.ts" },
      config: STRICT_CONFIG,
    });

    expect(result.allowed).toBe(true);
  });

  test("allows everything when safe_mode is disabled", () => {
    const relaxed: SafetyConfig = { safe_mode: false, allow_auto_push: false };
    const result = checkGitSafetyGate({
      toolName: "bash",
      toolArgs: { command: "git reset --hard" },
      config: relaxed,
    });

    expect(result.allowed).toBe(true);
  });

  test("allows force push when allow_auto_push is true", () => {
    const pushy: SafetyConfig = { safe_mode: true, allow_auto_push: true };
    const result = checkGitSafetyGate({
      toolName: "bash",
      toolArgs: { command: "git push --force origin main" },
      config: pushy,
    });

    expect(result.allowed).toBe(true);
  });

  test("still blocks git reset --hard even when allow_auto_push is true", () => {
    const pushy: SafetyConfig = { safe_mode: true, allow_auto_push: true };
    const result = checkGitSafetyGate({
      toolName: "bash",
      toolArgs: { command: "git reset --hard" },
      config: pushy,
    });

    expect(result.allowed).toBe(false);
  });

  test("returns allowed true with no reason when nothing is blocked", () => {
    const result = checkGitSafetyGate({
      toolName: "bash",
      toolArgs: { command: "ls -la" },
      config: STRICT_CONFIG,
    });

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });
});

describe("git safety gate wiring in tool.execute.before hook", () => {
  test("checkGitSafetyGate blocks destructive git operations for any agent", () => {
    const result = checkGitSafetyGate({
      toolName: "bash",
      toolArgs: { command: "git reset --hard HEAD~1" },
      config: STRICT_CONFIG,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBeDefined();
    expect(result.reason).toContain("git reset");
  });

  test("checkGitSafetyGate allows non-destructive commands", () => {
    const result = checkGitSafetyGate({
      toolName: "bash",
      toolArgs: { command: "git status" },
      config: STRICT_CONFIG,
    });

    expect(result.allowed).toBe(true);
  });

  test("checkGitSafetyGate returns structured result for hook consumption", () => {
    const result = checkGitSafetyGate({
      toolName: "bash",
      toolArgs: { command: "git push --force origin main" },
      config: STRICT_CONFIG,
    });

    expect(result).toHaveProperty("allowed");
    expect(result).toHaveProperty("reason");
    expect(typeof result.allowed).toBe("boolean");
  });
});
