import { describe, test, expect, beforeAll, afterAll, mock } from "bun:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  runTypecheckVerification,
  runTestVerification,
  runVerificationGate,
  type VerificationStep,
  type VerificationGateResult,
} from "./swarm-verify";

const TEST_DIR = join(import.meta.dir, "__test-swarm-verify");

beforeAll(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("runTypecheckVerification", () => {
  test("returns VerificationStep with correct structure", async () => {
    const result = await runTypecheckVerification();
    expect(result).toHaveProperty("name", "typecheck");
    expect(result).toHaveProperty("command", "tsc --noEmit");
    expect(result).toHaveProperty("passed");
    expect(result).toHaveProperty("exitCode");
  });

  test("skips when tsconfig.json not found", async () => {
    // Run in a directory without tsconfig.json
    const originalCwd = process.cwd();
    process.chdir(TEST_DIR);
    
    try {
      const result = await runTypecheckVerification();
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("No tsconfig.json found");
      expect(result.passed).toBe(true); // Should not block
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("handles tsc not available gracefully", async () => {
    // Run in a directory without tsconfig.json to trigger skip
    const testDir = join(TEST_DIR, "no-tsconfig");
    await mkdir(testDir, { recursive: true });
    
    const originalCwd = process.cwd();
    process.chdir(testDir);
    
    try {
      const result = await runTypecheckVerification();
      // Should be skipped when no tsconfig.json
      expect(result.skipped).toBe(true);
      expect(result.passed).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }
  });
});

describe("runTestVerification", () => {
  test("returns VerificationStep with correct structure", async () => {
    const result = await runTestVerification(["test.ts"]);
    expect(result).toHaveProperty("name", "tests");
    expect(result).toHaveProperty("command");
    expect(result).toHaveProperty("passed");
    expect(result).toHaveProperty("exitCode");
  });

  test("skips when no files touched", async () => {
    const result = await runTestVerification([]);
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toContain("No files touched");
    expect(result.passed).toBe(true); // Should not block
  });

  test("skips when no related test files found", async () => {
    const testDir = join(TEST_DIR, "no-tests");
    await mkdir(testDir, { recursive: true });
    
    const originalCwd = process.cwd();
    process.chdir(testDir);
    
    try {
      const result = await runTestVerification(["source.ts"]);
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toContain("No related test files found");
      expect(result.passed).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("detects test files with .test.ts pattern", async () => {
    const testDir = join(TEST_DIR, "with-tests");
    await mkdir(testDir, { recursive: true });
    await writeFile(join(testDir, "source.ts"), "export const x = 1;", "utf-8");
    await writeFile(join(testDir, "source.test.ts"), 'import { x } from "./source";', "utf-8");
    
    const originalCwd = process.cwd();
    process.chdir(testDir);
    
    try {
      const result = await runTestVerification(["source.ts"]);
      // Should find the test file
      expect(result.command).toContain("source.test.ts");
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("handles already test files", async () => {
    const testDir = join(TEST_DIR, "already-test");
    await mkdir(testDir, { recursive: true });
    await writeFile(join(testDir, "already.test.ts"), "export const x = 1;", "utf-8");
    
    const originalCwd = process.cwd();
    process.chdir(testDir);
    
    try {
      const result = await runTestVerification(["already.test.ts"]);
      expect(result.command).toContain("already.test.ts");
    } finally {
      process.chdir(originalCwd);
    }
  });
});

describe("runVerificationGate", () => {
  test("returns VerificationGateResult with correct structure", async () => {
    const result = await runVerificationGate([]);
    expect(result).toHaveProperty("passed");
    expect(result).toHaveProperty("steps");
    expect(result).toHaveProperty("summary");
    expect(result).toHaveProperty("blockers");
    expect(Array.isArray(result.steps)).toBe(true);
    expect(Array.isArray(result.blockers)).toBe(true);
  });

  test("combines typecheck and test results", async () => {
    const result = await runVerificationGate([]);
    // Should have exactly 2 steps: typecheck and tests
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].name).toBe("typecheck");
    expect(result.steps[1].name).toBe("tests");
  });

  test("passes when all steps pass or are skipped", async () => {
    // Run in a directory without tsconfig.json to ensure both steps are skipped
    const testDir = join(TEST_DIR, "gate-pass-test");
    await mkdir(testDir, { recursive: true });
    
    const originalCwd = process.cwd();
    process.chdir(testDir);
    
    try {
      const result = await runVerificationGate([]);
      // Both steps should be skipped (no tsconfig, no test files)
      expect(result.passed).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("includes passed count in summary", async () => {
    const result = await runVerificationGate([]);
    expect(result.summary).toContain("passed");
  });

  test("returns empty blockers when all pass", async () => {
    // Run in a directory without tsconfig.json to ensure both steps are skipped
    const testDir = join(TEST_DIR, "gate-blockers-test");
    await mkdir(testDir, { recursive: true });
    
    const originalCwd = process.cwd();
    process.chdir(testDir);
    
    try {
      const result = await runVerificationGate([]);
      // Both steps should be skipped, no blockers
      expect(result.blockers).toHaveLength(0);
    } finally {
      process.chdir(originalCwd);
    }
  });

  test("handles files that exist", async () => {
    const testDir = join(TEST_DIR, "gate-test");
    await mkdir(testDir, { recursive: true });
    await writeFile(join(testDir, "test.ts"), "export const x = 1;", "utf-8");
    
    const originalCwd = process.cwd();
    process.chdir(testDir);
    
    try {
      const result = await runVerificationGate(["test.ts"]);
      expect(result.steps).toHaveLength(2);
      // Typecheck should skip (no tsconfig) or pass
      expect(result.steps[0].passed).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }
  });
});
