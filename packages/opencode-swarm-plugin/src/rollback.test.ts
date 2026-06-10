import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  revertFilesToCommit,
  revertToCommit,
  createSafetyCommit,
} from "./rollback";

const execFileAsync = promisify(execFile);

async function initGitRepo(dir: string) {
  await execFileAsync("git", ["init"], { cwd: dir });
  await execFileAsync("git", ["config", "user.email", "test@test.com"], {
    cwd: dir,
  });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: dir });
}

describe("rollback", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = join(tmpdir(), `rollback-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    await initGitRepo(tmpDir);
    // initial commit
    await writeFile(join(tmpDir, "initial.txt"), "initial", "utf-8");
    await execFileAsync("git", ["add", "-A"], { cwd: tmpDir });
    await execFileAsync("git", ["commit", "-m", "initial"], { cwd: tmpDir });
  });

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("createSafetyCommit creates a commit and returns SHA", async () => {
    await writeFile(join(tmpDir, "safety.txt"), "safety", "utf-8");
    const sha = await createSafetyCommit({
      project_path: tmpDir,
      message: "safety commit",
    });
    expect(sha).toBeString();
    expect(sha!.length).toBeGreaterThanOrEqual(7);
    // verify commit exists
    const { stdout } = await execFileAsync(
      "git",
      ["log", "--oneline", "-1", sha!],
      { cwd: tmpDir },
    );
    expect(stdout).toContain("safety commit");
  });

  test("revertFilesToCommit reverts specific files", async () => {
    // create a commit with file1.txt
    await writeFile(join(tmpDir, "file1.txt"), "version1", "utf-8");
    const sha1 = await createSafetyCommit({
      project_path: tmpDir,
      message: "add file1",
    });
    // modify file1.txt and add file2.txt
    await writeFile(join(tmpDir, "file1.txt"), "version2", "utf-8");
    await writeFile(join(tmpDir, "file2.txt"), "version2", "utf-8");
    // revert only file1.txt to sha1
    const result = await revertFilesToCommit({
      project_path: tmpDir,
      commit_sha: sha1!,
      files: ["file1.txt"],
    });
    expect(result.success).toBeTrue();
    expect(result.reverted_files).toEqual(["file1.txt"]);
    expect(result.errors).toHaveLength(0);
    // file1.txt should be reverted
    const { readFile } = await import("node:fs/promises");
    const content = await readFile(join(tmpDir, "file1.txt"), "utf-8");
    expect(content).toBe("version1");
    // file2.txt should remain
    const content2 = await readFile(join(tmpDir, "file2.txt"), "utf-8");
    expect(content2).toBe("version2");
  });

  test("revertToCommit reverts entire working tree", async () => {
    // we are at some commit, create new changes
    await writeFile(join(tmpDir, "revert-me.txt"), "to be reverted", "utf-8");
    await execFileAsync("git", ["add", "-A"], { cwd: tmpDir });
    await execFileAsync(
      "git",
      ["commit", "-m", "add revert-me"],
      { cwd: tmpDir },
    );
    // get current HEAD
    const { stdout: headBefore } = await execFileAsync(
      "git",
      ["rev-parse", "HEAD"],
      { cwd: tmpDir },
    );
    // add another commit
    await writeFile(join(tmpDir, "extra.txt"), "extra", "utf-8");
    await execFileAsync("git", ["add", "-A"], { cwd: tmpDir });
    await execFileAsync(
      "git",
      ["commit", "-m", "add extra"],
      { cwd: tmpDir },
    );
    // revert to previous commit
    const result = await revertToCommit({
      project_path: tmpDir,
      commit_sha: headBefore.trim(),
    });
    expect(result.success).toBeTrue();
    expect(result.errors).toHaveLength(0);
    // extra.txt should be gone
    const { readFile } = await import("node:fs/promises");
    let exists = true;
    try {
      await readFile(join(tmpDir, "extra.txt"), "utf-8");
    } catch {
      exists = false;
    }
    expect(exists).toBeFalse();
  });

  test("handles non-git directory gracefully", async () => {
    const nonGitDir = join(tmpdir(), `non-git-${Date.now()}`);
    await mkdir(nonGitDir, { recursive: true });
    const result = await revertFilesToCommit({
      project_path: nonGitDir,
      commit_sha: "abc123",
      files: ["file.txt"],
    });
    expect(result.success).toBeFalse();
    expect(result.errors.length).toBeGreaterThan(0);
    await rm(nonGitDir, { recursive: true, force: true });
  });
});