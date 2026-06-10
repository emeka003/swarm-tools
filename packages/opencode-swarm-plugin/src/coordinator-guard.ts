/**
 * Coordinator Guard - Runtime Violation Enforcement
 *
 * Detects and REJECTS coordinator protocol violations at runtime.
 * Unlike planning-guardrails.ts (which only warns), this guard throws errors
 * to prevent coordinators from performing work that should be delegated to workers.
 *
 * Coordinators MUST:
 * - Spawn workers via swarm_spawn_subtask
 * - Review worker output via swarm_review
 * - Coordinate and monitor, not implement
 *
 * Coordinators MUST NOT:
 * - Edit or write files (use workers)
 * - Run tests (workers verify their own work)
 * - Reserve files (workers reserve before editing)
 *
 * The companion `checkGitSafetyGate` blocks destructive git operations and
 * recursive force removal for any agent (coordinator or worker) when safe mode
 * is active. It runs AFTER `checkCoordinatorGuard` in the tool hook.
 *
 * @module coordinator-guard
 */

import { resolveSafetyConfig, type SafetyConfig } from "./safety-config.js";

/**
 * Custom error for coordinator guard violations
 *
 * Thrown when a coordinator attempts to perform work that should be delegated to workers.
 * Includes helpful suggestions for the correct approach.
 */
export class CoordinatorGuardError extends Error {
  /** Type of violation that occurred */
  public violationType:
    | "coordinator_edited_file"
    | "coordinator_ran_tests"
    | "coordinator_reserved_files";

  /** Additional context about the violation */
  public payload: Record<string, unknown>;

  /** Helpful suggestion for fixing the violation */
  public suggestion?: string;

  constructor(
    message: string,
    violationType:
      | "coordinator_edited_file"
      | "coordinator_ran_tests"
      | "coordinator_reserved_files",
    payload: Record<string, unknown> = {},
    suggestion?: string
  ) {
    super(message);
    this.name = "CoordinatorGuardError";
    this.violationType = violationType;
    this.payload = payload;
    this.suggestion = suggestion;
  }
}

/**
 * Tool names that modify files
 *
 * Coordinators should NEVER call these tools directly.
 * Workers reserve files and make modifications.
 */
const FILE_MODIFICATION_TOOLS = ["edit", "write"] as const;

/**
 * Tool names for file reservations
 *
 * Coordinators don't reserve files - workers do this
 * before editing to prevent conflicts.
 */
const RESERVATION_TOOLS = ["swarmmail_reserve", "agentmail_reserve"] as const;

/**
 * Regex patterns that indicate test execution in bash commands
 *
 * Coordinators review test results, workers run tests.
 * Matches common test runners and test file patterns.
 */
const TEST_EXECUTION_PATTERNS = [
  /\bbun\s+test\b/i,
  /\bnpm\s+(run\s+)?test/i,
  /\byarn\s+(run\s+)?test/i,
  /\bpnpm\s+(run\s+)?test/i,
  /\bjest\b/i,
  /\bvitest\b/i,
  /\bmocha\b/i,
  /\bava\b/i,
  /\btape\b/i,
  /\.test\.(ts|js|tsx|jsx)\b/i,
  /\.spec\.(ts|js|tsx|jsx)\b/i,
] as const;

/**
 * Result of coordinator guard check
 */
export interface GuardCheckResult {
  /** Whether the tool call is blocked */
  blocked: boolean;

  /** Error if blocked */
  error?: CoordinatorGuardError;
}

/**
 * Check if the current agent context is a coordinator
 *
 * @param agentContext - Agent context type
 * @returns True if coordinator, false otherwise
 */
export function isCoordinator(
  agentContext: "coordinator" | "worker" | string
): agentContext is "coordinator" {
  return agentContext === "coordinator";
}

/**
 * Check coordinator guard for potential violations
 *
 * This is the main entry point for the guard. It checks if the current tool call
 * violates coordinator protocol and returns a result indicating whether to block
 * the call and what error to throw.
 *
 * @param params - Guard check parameters
 * @returns Guard check result with block status and optional error
 *
 * @example
 * ```ts
 * const result = checkCoordinatorGuard({
 *   agentContext: "coordinator",
 *   toolName: "edit",
 *   toolArgs: { filePath: "src/auth.ts" },
 * });
 *
 * if (result.blocked) {
 *   throw result.error; // Prevents coordinator from editing files
 * }
 * ```
 */
export function checkCoordinatorGuard(params: {
  agentContext: "coordinator" | "worker" | string;
  toolName: string;
  toolArgs: Record<string, unknown>;
}): GuardCheckResult {
  const { agentContext, toolName, toolArgs } = params;

  // Workers are allowed to do everything
  if (!isCoordinator(agentContext)) {
    return { blocked: false };
  }

  // Check for file modification violation
  if (FILE_MODIFICATION_TOOLS.includes(toolName as any)) {
    const file = (toolArgs.filePath as string) || "unknown";

    return {
      blocked: true,
      error: new CoordinatorGuardError(
        `❌ COORDINATOR VIOLATION: Coordinators must spawn a worker to edit files.

You attempted to ${toolName}: ${file}

Coordinators orchestrate work, they don't implement it.

Instead:
1. Use swarm_spawn_subtask to spawn a worker for this file
2. Let the worker reserve the file and make edits
3. Review the worker's output when complete

This guard exists to prevent the #1 coordinator anti-pattern.`,
        "coordinator_edited_file",
        { tool: toolName, file },
        "Use swarm_spawn_subtask to spawn a worker, then let the worker edit the file"
      ),
    };
  }

  // Check for test execution violation
  if (toolName === "bash") {
    const command = (toolArgs.command as string) || "";
    const isTestCommand = TEST_EXECUTION_PATTERNS.some((pattern) =>
      pattern.test(command)
    );

    if (isTestCommand) {
      return {
        blocked: true,
        error: new CoordinatorGuardError(
          `❌ COORDINATOR VIOLATION: Coordinators must not run tests.

You attempted to run: ${command}

Workers run tests as part of their implementation verification.
Coordinators review the test results.

Instead:
1. Let workers run tests in their implementation workflow
2. Workers call swarm_complete which runs tests automatically
3. Review test results from worker output

This guard prevents coordinators from doing workers' verification work.`,
          "coordinator_ran_tests",
          { tool: toolName, command },
          "Let workers run tests via swarm_complete"
        ),
      };
    }
  }

  // Check for file reservation violation
  if (RESERVATION_TOOLS.includes(toolName as any)) {
    const paths = (toolArgs.paths as string[]) || [];

    return {
      blocked: true,
      error: new CoordinatorGuardError(
        `❌ COORDINATOR VIOLATION: Coordinators must not reserve files.

You attempted to reserve: ${paths.join(", ")}

Workers reserve files before editing to prevent conflicts.
Coordinators don't edit files, so they don't reserve them.

Instead:
1. Spawn workers via swarm_spawn_subtask
2. Workers will reserve files they need to modify
3. Coordinate if multiple workers need the same files

This guard prevents coordinators from performing worker setup steps.`,
        "coordinator_reserved_files",
        { tool: toolName, paths },
        "Spawn workers who will reserve files themselves"
      ),
    };
  }

  // No violation detected
  return { blocked: false };
}

/**
 * Result of a git safety gate check
 *
 * Unlike the coordinator guard, this gate returns a permissive `allowed`
 * boolean (the gate does NOT throw). Callers decide whether to throw,
 * prompt for confirmation, or simply log.
 */
export interface GitSafetyCheckResult {
  /** Whether the tool call is allowed under current safety config */
  allowed: boolean;

  /** Human-readable reason the call is blocked (only set when allowed=false) */
  reason?: string;
}

/**
 * Destructive git subcommand patterns.
 *
 * Each entry pairs a subcommand regex with a destructiveness predicate
 * so we only block the dangerous flag combinations.
 */
interface DestructivePattern {
  /** Human label for error messages */
  label: string;
  /** Regex matched against the lowercased command */
  pattern: RegExp;
}

/**
 * Subcommand patterns ordered from most specific to least specific.
 *
 * - `git reset --hard` / `git reset -H`     - throws away working tree + index
 * - `git clean -f` / `git clean --force`     - deletes untracked files
 * - `git push --force` / `git push -f`       - rewrites remote history
 */
const DESTRUCTIVE_GIT_PATTERNS: DestructivePattern[] = [
  {
    label: "git reset --hard",
    pattern: /\bgit\s+reset\s+(-[A-Za-z]*[Hh][A-Za-z]*|--hard)\b/,
  },
  {
    label: "git clean --force",
    pattern: /\bgit\s+clean\s+(-[A-Za-z]*[fF][A-Za-z]*|--force)\b/,
  },
  {
    label: "force push",
    pattern: /\bgit\s+push\s+(?:-[A-Za-z]*[fF][A-Za-z]*\b|--force\b)/,
  },
];

/**
 * Path inside a project's worktree directory.
 * Mirrors `WORKTREE_DIR` in `swarm-worktree.ts` so the gate stays
 * in lock-step with the worktree layout.
 */
const WORKTREE_PATH = ".swarm/worktrees";

/**
 * Recursive force removal pattern.
 *
 * Captures the combined flag string and the target path. The match is
 * treated as destructive only when the flag string contains BOTH a
 * recursive flag (`r` or `R`) AND a force flag (`f` or `F`). This accepts
 * both combined forms (`-rf`, `-fr`, `-Rfv`) and separated forms
 * (`-r -f`, `-f -v -R`) without enumerating every permutation.
 */
const RECURSIVE_FORCE_REMOVE_PATTERN = /\brm\s+((?:-[A-Za-z]+(?:\s+-[A-Za-z]+)*))\s+([^\s;|&]+)/;

/**
 * Check if a path is inside the worktree allowlist.
 *
 * Both `.swarm/worktrees/...` and absolute paths containing that segment are
 * considered safe; everything else triggers the recursive removal block.
 */
function isInsideWorktreeAllowlist(path: string): boolean {
  const normalized = path.replace(/\\/g, "/");
  return normalized === WORKTREE_PATH || normalized.startsWith(`${WORKTREE_PATH}/`);
}

/**
 * Check if a destructive git operation appears in a command string.
 *
 * @param command - Lowercased command to scan
 * @returns The matching destructive pattern label, or null if none
 */
function findDestructiveGitCommand(command: string): string | null {
  for (const { label, pattern } of DESTRUCTIVE_GIT_PATTERNS) {
    if (pattern.test(command)) return label;
  }
  return null;
}

/**
 * Check if a recursive force removal targets a path outside the worktree
 * allowlist.
 *
 * @param command - Original-case command to scan
 * @returns Reason string if blocked, null if allowed
 */
function findUnsafeRecursiveRemove(command: string): string | null {
  const match = command.match(RECURSIVE_FORCE_REMOVE_PATTERN);
  if (!match) return null;
  const flags = match[1] ?? "";
  // Must contain both a recursive flag (r/R) and a force flag (f/F)
  if (!/[rR]/.test(flags) || !/[fF]/.test(flags)) return null;
  const target = match[2] ?? "";
  if (!target) return null;
  if (isInsideWorktreeAllowlist(target)) return null;
  return `recursive removal of '${target}' is blocked outside ${WORKTREE_PATH}`;
}

/**
 * Check the git safety gate for destructive operations.
 *
 * Runs AFTER `checkCoordinatorGuard` and applies to all agent contexts.
 * When `safe_mode` is disabled the gate short-circuits to `allowed: true`.
 * The `allow_auto_push` flag only relaxes the force-push rule; reset and
 * clean remain blocked regardless.
 *
 * @param params - Gate parameters
 * @param params.toolName - Name of the tool being called
 * @param params.toolArgs - Arguments passed to the tool
 * @param params.config - Optional safety config override (defaults to resolved env config)
 * @returns Result with `allowed` boolean and optional `reason`
 *
 * @example
 * ```ts
 * const result = checkGitSafetyGate({
 *   toolName: "bash",
 *   toolArgs: { command: "git reset --hard" },
 * });
 *
 * if (!result.allowed) {
 *   throw new Error(result.reason);
 * }
 * ```
 */
export function checkGitSafetyGate(params: {
  toolName: string;
  toolArgs: Record<string, unknown>;
  config?: SafetyConfig;
}): GitSafetyCheckResult {
  const config = params.config ?? resolveSafetyConfig();

  if (!config.safe_mode) {
    return { allowed: true };
  }

  if (params.toolName !== "bash") {
    return { allowed: true };
  }

  const rawCommand = params.toolArgs.command;
  if (typeof rawCommand !== "string" || rawCommand.length === 0) {
    return { allowed: true };
  }

  const lowerCommand = rawCommand.toLowerCase();

  const destructiveGit = findDestructiveGitCommand(lowerCommand);
  const forcePushAllowed = destructiveGit === "force push" && config.allow_auto_push;
  if (destructiveGit !== null && !forcePushAllowed) {
    return {
      allowed: false,
      reason: `${destructiveGit} is blocked by the safety gate. Disable safe_mode or set allow_auto_push for force push.`,
    };
  }

  const unsafeRemove = findUnsafeRecursiveRemove(rawCommand);
  if (unsafeRemove !== null) {
    return { allowed: false, reason: unsafeRemove };
  }

  return { allowed: true };
}
