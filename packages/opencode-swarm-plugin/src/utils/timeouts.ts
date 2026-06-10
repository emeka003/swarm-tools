/**
 * Centralized Tool Timeout Configuration
 *
 * Single source of truth for tool execution timeouts in the OpenCode Swarm Plugin.
 *
 * Reads `SWARM_TOOL_TIMEOUT_MS` from the environment (default: 300000ms / 5 minutes).
 * Per-call overrides can be supplied via the `defaultMs` parameter to
 * `getToolTimeoutMs` or the explicit timeout argument to `withToolTimeout`.
 *
 * Why centralize?
 * - Scattered timeouts (BUNX_TIMEOUT_MS=10000, TIMEOUT_MS=30000, TIMEOUT_MS=60000)
 *   were hard-coded across tool-availability, storage, and skills modules.
 * - Operators need ONE knob to tune the entire plugin's tool execution budget.
 * - Tests need ONE place to override behavior deterministically.
 *
 * Usage:
 * ```typescript
 * import { getToolTimeoutMs, withToolTimeout } from "./utils/timeouts";
 *
 * // Wrap an async operation
 * const result = await withToolTimeout(
 *   "hive_query",
 *   () => doHiveQuery(),
 *   getToolTimeoutMs(),
 * );
 * ```
 */

export const ENV_TOOL_TIMEOUT_KEY = "SWARM_TOOL_TIMEOUT_MS";

export const DEFAULT_TOOL_TIMEOUT_MS = 300_000;

/**
 * Read the tool timeout (in ms) from the environment.
 *
 * Resolution order:
 * 1. `SWARM_TOOL_TIMEOUT_MS` env var (if it parses to a positive integer)
 * 2. `defaultMs` parameter (if provided and > 0)
 * 3. `DEFAULT_TOOL_TIMEOUT_MS` (300_000)
 *
 * Invalid values (non-numeric, zero, negative) fall through to the next step.
 */
export function getToolTimeoutMs(defaultMs?: number): number {
  const raw = process.env[ENV_TOOL_TIMEOUT_KEY];
  if (raw !== undefined && raw !== "") {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  if (defaultMs !== undefined && defaultMs > 0) {
    return defaultMs;
  }
  return DEFAULT_TOOL_TIMEOUT_MS;
}

/**
 * Thrown when a tool handler exceeds its timeout budget.
 *
 * Carries `toolName` and `timeoutMs` so callers (and tests) can assert
 * structured timeout failures without parsing the message string.
 */
export class ToolTimeoutError extends Error {
  readonly toolName: string;
  readonly timeoutMs: number;

  constructor(toolName: string, timeoutMs: number) {
    super(`Tool '${toolName}' timed out after ${timeoutMs}ms`);
    this.name = "ToolTimeoutError";
    this.toolName = toolName;
    this.timeoutMs = timeoutMs;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ToolTimeoutError);
    }
  }
}

/**
 * Race a tool handler against a timeout. If the handler resolves first,
 * return its value. If the timeout fires first, throw `ToolTimeoutError`.
 *
 * Note: the handler promise is NOT cancelled when the timeout fires.
 * Callers that need cancellation (e.g. process spawns) should still
 * clean up via their own AbortController.
 */
export async function withToolTimeout<T>(
  toolName: string,
  fn: () => Promise<T>,
  timeoutMs?: number,
): Promise<T> {
  const budget = timeoutMs ?? getToolTimeoutMs();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ToolTimeoutError(toolName, budget));
    }, budget);
  });
  try {
    return await Promise.race([fn(), timeoutPromise]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Minimal tool shape required to wrap a tool registry with a timeout.
 *
 * This duck-typed interface intentionally mirrors the runtime shape of
 * `ToolDefinition` from `@opencode-ai/plugin` so we don't need to import
 * the plugin type into this utility module (which is also unit-tested
 * in isolation). The `args` and `execute` are typed loosely so any
 * concrete tool definition (with its own zod-derived args) is assignable.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface TimeoutableTool {
  description: string;
  args: any;
  execute: (...args: any[]) => Promise<string>;
}

/**
 * Wrap a tool registry so each tool's `execute` is raced against
 * `SWARM_TOOL_TIMEOUT_MS` (or an explicit `timeoutMs`).
 *
 * On timeout, `ToolTimeoutError` is thrown with the tool's key as
 * `toolName`. The original tool's `args`, `description`, and any
 * other properties are preserved.
 */
export function wrapToolsWithTimeout(
  tools: Record<string, TimeoutableTool>,
  timeoutMs?: number,
): Record<string, TimeoutableTool> {
  const wrapped: Record<string, TimeoutableTool> = {};
  for (const [name, def] of Object.entries(tools)) {
    const originalExecute = def.execute.bind(def);
    wrapped[name] = {
      ...def,
      execute: ((
        ...args: Parameters<TimeoutableTool["execute"]>
      ) => withToolTimeout(name, () => originalExecute(...args), timeoutMs)) as TimeoutableTool["execute"],
    };
  }
  return wrapped;
}
