import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { runQualityGates, type QualityGateResult } from "./quality-gates";

const TEST_DIR = join(import.meta.dir, "__test-quality-gates");

beforeAll(async () => {
  await mkdir(TEST_DIR, { recursive: true });
});

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

async function createTestFile(name: string, content: string): Promise<string> {
  const path = join(TEST_DIR, name);
  await writeFile(path, content, "utf-8");
  return path;
}

describe("runQualityGates", () => {
  test("returns passed when bug scanner disabled", async () => {
    const result = await runQualityGates({
      files: [],
      config: { enableBugScanner: false },
    });
    expect(result.passed).toBe(true);
    expect(result.checks).toHaveLength(0);
  });

  test("detects TODO comments", async () => {
    const file = await createTestFile("todo.ts", "// TODO: implement this\nconst x = 1;");
    const result = await runQualityGates({
      files: [file],
      config: { enableBugScanner: true },
    });
    expect(result.passed).toBe(true);
    const todoCheck = result.checks.find((c) => c.name === "no-todo-fixme-hack");
    expect(todoCheck).toBeDefined();
    expect(todoCheck!.passed).toBe(false);
    expect(todoCheck!.message).toContain("TODO");
  });

  test("detects FIXME comments", async () => {
    const file = await createTestFile("fixme.ts", "// FIXME: broken\nconst x = 1;");
    const result = await runQualityGates({
      files: [file],
      config: { enableBugScanner: true },
    });
    const todoCheck = result.checks.find((c) => c.name === "no-todo-fixme-hack");
    expect(todoCheck).toBeDefined();
    expect(todoCheck!.passed).toBe(false);
  });

  test("detects HACK comments", async () => {
    const file = await createTestFile("hack.ts", "// HACK: workaround\nconst x = 1;");
    const result = await runQualityGates({
      files: [file],
      config: { enableBugScanner: true },
    });
    const todoCheck = result.checks.find((c) => c.name === "no-todo-fixme-hack");
    expect(todoCheck).toBeDefined();
    expect(todoCheck!.passed).toBe(false);
  });

  test("detects console.log", async () => {
    const file = await createTestFile("console.ts", 'console.log("debug");');
    const result = await runQualityGates({
      files: [file],
      config: { enableBugScanner: true },
    });
    expect(result.passed).toBe(true);
    const consoleCheck = result.checks.find((c) => c.name === "no-console-log");
    expect(consoleCheck).toBeDefined();
    expect(consoleCheck!.passed).toBe(false);
    expect(consoleCheck!.message).toContain("console.log");
  });

  test("allows console.warn and console.error", async () => {
    const file = await createTestFile("warn.ts", 'console.warn("warning");\nconsole.error("error");');
    const result = await runQualityGates({
      files: [file],
      config: { enableBugScanner: true },
    });
    const consoleCheck = result.checks.find((c) => c.name === "no-console-log");
    expect(consoleCheck).toBeDefined();
    expect(consoleCheck!.passed).toBe(true);
  });

  test("detects hardcoded secrets", async () => {
    const file = await createTestFile("secret.ts", 'const password = "hunter2";');
    const result = await runQualityGates({
      files: [file],
      config: { enableBugScanner: true },
    });
    expect(result.passed).toBe(false);
    const secretCheck = result.checks.find((c) => c.name === "no-hardcoded-secrets");
    expect(secretCheck).toBeDefined();
    expect(secretCheck!.passed).toBe(false);
    expect(secretCheck!.severity).toBe("error");
  });

  test("detects api_key patterns", async () => {
    const file = await createTestFile("apikey.ts", 'const api_key = "abc123";');
    const result = await runQualityGates({
      files: [file],
      config: { enableBugScanner: true },
    });
    const secretCheck = result.checks.find((c) => c.name === "no-hardcoded-secrets");
    expect(secretCheck).toBeDefined();
    expect(secretCheck!.passed).toBe(false);
  });

  test("detects empty catch blocks", async () => {
    const file = await createTestFile("catch.ts", "try { x() } catch (e) {}");
    const result = await runQualityGates({
      files: [file],
      config: { enableBugScanner: true },
    });
    expect(result.passed).toBe(false);
    const catchCheck = result.checks.find((c) => c.name === "error-handling-present");
    expect(catchCheck).toBeDefined();
    expect(catchCheck!.passed).toBe(false);
    expect(catchCheck!.severity).toBe("error");
  });

  test("passes when no issues found", async () => {
    const file = await createTestFile("clean.ts", "const x = 1;\nexport default x;");
    const result = await runQualityGates({
      files: [file],
      config: { enableBugScanner: true },
    });
    expect(result.passed).toBe(true);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });

  test("respects maxWarnings config", async () => {
    const file1 = await createTestFile("warn1.ts", "// TODO: a");
    const file2 = await createTestFile("warn2.ts", "// TODO: b");
    const file3 = await createTestFile("warn3.ts", "// TODO: c");
    const file4 = await createTestFile("warn4.ts", "// TODO: d");
    const file5 = await createTestFile("warn5.ts", "// TODO: e");
    const file6 = await createTestFile("warn6.ts", "// TODO: f");

    const result = await runQualityGates({
      files: [file1, file2, file3, file4, file5, file6],
      config: { enableBugScanner: true, maxWarnings: 3 },
    });
    expect(result.passed).toBe(false);
  });

  test("handles missing files gracefully", async () => {
    const result = await runQualityGates({
      files: ["/nonexistent/file.ts"],
      config: { enableBugScanner: true },
    });
    expect(result.passed).toBe(true);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });
});
