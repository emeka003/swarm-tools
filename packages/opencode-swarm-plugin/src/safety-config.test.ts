/**
 * Safety Configuration Tests
 *
 * Validates env-var resolution, defaults, and override precedence
 * for the swarm safety gate configuration.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resolveSafetyConfig, getSafetyConfig } from "./safety-config.js";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.SWARM_SAFE_MODE;
  delete process.env.SWARM_ALLOW_AUTO_PUSH;
  delete process.env.SWARM_REQUIRE_CONFIRM_DESTRUCTIVE;
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("resolveSafetyConfig", () => {
  test("returns safe defaults when no env vars are set", () => {
    const config = resolveSafetyConfig();
    expect(config.safe_mode).toBe(true);
    expect(config.allow_auto_push).toBe(false);
    expect(config.require_confirmation).toBe(true);
  });

  test("reads SWARM_SAFE_MODE=false to disable safe mode", () => {
    process.env.SWARM_SAFE_MODE = "false";
    expect(resolveSafetyConfig().safe_mode).toBe(false);
  });

  test("reads SWARM_SAFE_MODE=true to enable safe mode", () => {
    process.env.SWARM_SAFE_MODE = "true";
    expect(resolveSafetyConfig().safe_mode).toBe(true);
  });

  test("reads SWARM_ALLOW_AUTO_PUSH=true to allow force pushes", () => {
    process.env.SWARM_ALLOW_AUTO_PUSH = "true";
    expect(resolveSafetyConfig().allow_auto_push).toBe(true);
  });

  test("accepts 1/0/yes/no/on/off as boolean values", () => {
    process.env.SWARM_SAFE_MODE = "0";
    expect(resolveSafetyConfig().safe_mode).toBe(false);
    process.env.SWARM_SAFE_MODE = "yes";
    expect(resolveSafetyConfig().safe_mode).toBe(true);
    process.env.SWARM_SAFE_MODE = "off";
    expect(resolveSafetyConfig().safe_mode).toBe(false);
    process.env.SWARM_SAFE_MODE = "on";
    expect(resolveSafetyConfig().safe_mode).toBe(true);
  });

  test("falls back to default for unrecognized env values", () => {
    process.env.SWARM_SAFE_MODE = "maybe";
    expect(resolveSafetyConfig().safe_mode).toBe(true);
  });

  test("explicit override wins over env vars", () => {
    process.env.SWARM_SAFE_MODE = "false";
    const config = resolveSafetyConfig({ safe_mode: true });
    expect(config.safe_mode).toBe(true);
  });

  test("partial override merges with env + defaults", () => {
    process.env.SWARM_ALLOW_AUTO_PUSH = "true";
    const config = resolveSafetyConfig({ safe_mode: false });
    expect(config.safe_mode).toBe(false);
    expect(config.allow_auto_push).toBe(true);
  });
});

describe("getSafetyConfig", () => {
  test("matches resolveSafetyConfig() with no args", () => {
    const a = getSafetyConfig();
    const b = resolveSafetyConfig();
    expect(a).toEqual(b);
  });
});
