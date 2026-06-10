import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function isValidSha(sha: string): boolean {
  return /^[a-f0-9]{7,40}$/.test(sha);
}

export interface RollbackResult {
  success: boolean;
  reverted_files: string[];
  errors: string[];
}

/**
 * Revert specific files to their state at a given commit.
 * Uses git checkout to restore file contents.
 */
export async function revertFilesToCommit(params: {
  project_path: string;
  commit_sha: string;
  files: string[];
}): Promise<RollbackResult> {
  const { project_path, commit_sha, files } = params;
  if (!isValidSha(commit_sha)) {
    return { success: false, reverted_files: [], errors: ["Invalid commit SHA"] };
  }
  if (files.length === 0) {
    return { success: true, reverted_files: [], errors: [] };
  }

  try {
    const args = ["checkout", commit_sha, "--", ...files];
    await execFileAsync("git", args, { cwd: project_path });
    return { success: true, reverted_files: files, errors: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, reverted_files: [], errors: [message] };
  }
}

/**
 * Revert all changes since a given commit.
 * Uses git reset --hard to restore the entire working tree.
 */
export async function revertToCommit(params: {
  project_path: string;
  commit_sha: string;
}): Promise<RollbackResult> {
  const { project_path, commit_sha } = params;
  if (!isValidSha(commit_sha)) {
    return { success: false, reverted_files: [], errors: ["Invalid commit SHA"] };
  }
  try {
    await execFileAsync("git", ["reset", "--hard", commit_sha], {
      cwd: project_path,
    });
    return { success: true, reverted_files: [], errors: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, reverted_files: [], errors: [message] };
  }
}

/**
 * Create a safety commit before making changes.
 * Returns the commit SHA for later rollback.
 */
export async function createSafetyCommit(params: {
  project_path: string;
  message: string;
}): Promise<string | null> {
  const { project_path, message } = params;
  try {
    await execFileAsync("git", ["add", "-A"], { cwd: project_path });
    const { stdout } = await execFileAsync(
      "git",
      ["commit", "-m", message],
      { cwd: project_path },
    );
    const match = stdout.match(/\[([a-f0-9]+)\]/);
    if (match) {
      return match[1];
    }
    // Fallback: get HEAD commit
    const { stdout: headOut } = await execFileAsync(
      "git",
      ["rev-parse", "HEAD"],
      { cwd: project_path },
    );
    return headOut.trim();
  } catch (error) {
    console.warn("[createSafetyCommit] Failed to create safety commit:", error);
    return null;
  }
}