/**
 * Swarm Safety Configuration
 *
 * Centralized configuration for destructive-operation safety gates.
 * Environment variables override defaults to support emergency overrides
 * and CI / automation overrides.
 *
 * @module safety-config
 */

/**
 * Safety gate configuration
 *
 * - `safe_mode`           - When true (default), destructive operations are blocked
 *                           unless explicitly allowed. Override via SWARM_SAFE_MODE=false.
 * - `allow_auto_push`     - When true, force pushes are allowed (CI/automation only).
 *                           Defaults to false. Override via SWARM_ALLOW_AUTO_PUSH=true.
 * - `require_confirmation` - When true, destructive git operations require explicit
 *                           confirmation. Defaults to true. Override via
 *                           SWARM_REQUIRE_CONFIRM_DESTRUCTIVE=false.
 */
export interface SafetyConfig {
  safe_mode: boolean;
  allow_auto_push: boolean;
  require_confirmation?: boolean;
}

const DEFAULT_SAFETY_CONFIG: SafetyConfig = {
  safe_mode: true,
  allow_auto_push: false,
  require_confirmation: true,
};

/**
 * Parse an env-var string into a boolean.
 *
 * Truthy values: "1", "true", "yes", "on" (case-insensitive).
 * Falsy values : "0", "false", "no", "off", "" (case-insensitive).
 * Any other value is treated as undefined so the default applies.
 */
function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off" || v === "") return false;
  return undefined;
}

/**
 * Resolve the current safety configuration.
 *
 * Precedence (highest first):
 *   1. Explicit `override` argument
 *   2. Environment variables (SWARM_SAFE_MODE, SWARM_ALLOW_AUTO_PUSH, SWARM_REQUIRE_CONFIRM_DESTRUCTIVE)
 *   3. Compiled-in defaults
 *
 * @param override - Optional partial config to merge over env + defaults
 * @returns Fully resolved safety config
 */
export function resolveSafetyConfig(override: Partial<SafetyConfig> = {}): SafetyConfig {
  const envSafeMode = parseBoolean(process.env.SWARM_SAFE_MODE);
  const envAllowAutoPush = parseBoolean(process.env.SWARM_ALLOW_AUTO_PUSH);
  const envRequireConfirm = parseBoolean(process.env.SWARM_REQUIRE_CONFIRM_DESTRUCTIVE);

  return {
    safe_mode: override.safe_mode ?? envSafeMode ?? DEFAULT_SAFETY_CONFIG.safe_mode,
    allow_auto_push:
      override.allow_auto_push ?? envAllowAutoPush ?? DEFAULT_SAFETY_CONFIG.allow_auto_push,
    require_confirmation:
      override.require_confirmation ??
      envRequireConfirm ??
      DEFAULT_SAFETY_CONFIG.require_confirmation,
  };
}

/**
 * Convenience accessor for the current resolved config.
 *
 * Equivalent to `resolveSafetyConfig()` with no overrides.
 */
export function getSafetyConfig(): SafetyConfig {
  return resolveSafetyConfig();
}
