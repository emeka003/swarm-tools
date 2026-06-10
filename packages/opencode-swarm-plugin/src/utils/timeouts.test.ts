import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  getToolTimeoutMs,
  withToolTimeout,
  ToolTimeoutError,
  DEFAULT_TOOL_TIMEOUT_MS,
  ENV_TOOL_TIMEOUT_KEY,
  wrapToolsWithTimeout,
} from "./timeouts";

describe("getToolTimeoutMs", () => {
  const ORIGINAL_ENV = process.env[ENV_TOOL_TIMEOUT_KEY];

  beforeEach(() => {
    delete process.env[ENV_TOOL_TIMEOUT_KEY];
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env[ENV_TOOL_TIMEOUT_KEY];
    } else {
      process.env[ENV_TOOL_TIMEOUT_KEY] = ORIGINAL_ENV;
    }
  });

  test("returns default when env var is unset", () => {
    expect(getToolTimeoutMs()).toBe(DEFAULT_TOOL_TIMEOUT_MS);
  });

  test("returns default when env var is empty string", () => {
    process.env[ENV_TOOL_TIMEOUT_KEY] = "";
    expect(getToolTimeoutMs()).toBe(DEFAULT_TOOL_TIMEOUT_MS);
  });

  test("reads SWARM_TOOL_TIMEOUT_MS from env when set", () => {
    process.env[ENV_TOOL_TIMEOUT_KEY] = "120000";
    expect(getToolTimeoutMs()).toBe(120000);
  });

  test("accepts a defaultMs override", () => {
    expect(getToolTimeoutMs(7_777)).toBe(7_777);
  });

  test("env var wins over defaultMs override", () => {
    process.env[ENV_TOOL_TIMEOUT_KEY] = "999";
    expect(getToolTimeoutMs(50_000)).toBe(999);
  });

  test("falls back to defaultMs when env var is not a number", () => {
    process.env[ENV_TOOL_TIMEOUT_KEY] = "not-a-number";
    expect(getToolTimeoutMs(12_345)).toBe(12_345);
  });

  test("falls back to defaultMs when env var is zero or negative", () => {
    process.env[ENV_TOOL_TIMEOUT_KEY] = "0";
    expect(getToolTimeoutMs(8_888)).toBe(8_888);

    process.env[ENV_TOOL_TIMEOUT_KEY] = "-1";
    expect(getToolTimeoutMs(8_888)).toBe(8_888);
  });

  test("default timeout is 300000ms (5 minutes)", () => {
    expect(DEFAULT_TOOL_TIMEOUT_MS).toBe(300_000);
  });

  test("env var key is SWARM_TOOL_TIMEOUT_MS", () => {
    expect(ENV_TOOL_TIMEOUT_KEY).toBe("SWARM_TOOL_TIMEOUT_MS");
  });
});

describe("withToolTimeout", () => {
  test("resolves with the original value when promise completes first", async () => {
    const result = await withToolTimeout("fast-tool", async () => "ok", 5_000);
    expect(result).toBe("ok");
  });

  test("throws ToolTimeoutError when promise exceeds timeout", async () => {
    const slow = new Promise<string>((resolve) =>
      setTimeout(() => resolve("late"), 200),
    );
    let captured: unknown = null;
    try {
      await withToolTimeout("slow-tool", () => slow, 25);
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(ToolTimeoutError);
    const err = captured as ToolTimeoutError;
    expect(err.toolName).toBe("slow-tool");
    expect(err.timeoutMs).toBe(25);
    expect(err.message).toContain("slow-tool");
    expect(err.message).toContain("25");
  });

  test("propagates non-timeout errors from the wrapped promise", async () => {
    class BoomError extends Error {}
    const boom = new BoomError("kaboom");
    let captured: unknown = null;
    try {
      await withToolTimeout(
        "explode",
        async () => {
          throw boom;
        },
        1_000,
      );
    } catch (err) {
      captured = err;
    }
    expect(captured).toBe(boom);
  });

  test("uses SWARM_TOOL_TIMEOUT_MS env var when no defaultMs supplied", async () => {
    process.env[ENV_TOOL_TIMEOUT_KEY] = "30";
    try {
      const slow = new Promise<string>((resolve) =>
        setTimeout(() => resolve("late"), 200),
      );
      let captured: unknown = null;
      try {
        await withToolTimeout("env-tool", () => slow);
      } catch (err) {
        captured = err;
      }
      expect(captured).toBeInstanceOf(ToolTimeoutError);
    } finally {
      delete process.env[ENV_TOOL_TIMEOUT_KEY];
    }
  });
});

describe("ToolTimeoutError", () => {
  test("extends Error and exposes structured fields", () => {
    const err = new ToolTimeoutError("my-tool", 5_000);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ToolTimeoutError");
    expect(err.toolName).toBe("my-tool");
    expect(err.timeoutMs).toBe(5_000);
    expect(err.message).toContain("my-tool");
    expect(err.message).toContain("5000");
  });
});

describe("wrapToolsWithTimeout", () => {
  test("preserves description and args on each wrapped tool", () => {
    const tools = {
      ping: {
        description: "ping a service",
        args: { name: "value" },
        execute: async () => "pong",
      },
    };
    const wrapped = wrapToolsWithTimeout(tools, 60_000);
    expect(wrapped.ping.description).toBe("ping a service");
    expect(wrapped.ping.args).toEqual({ name: "value" });
  });

  test("returns the tool result when execute completes before timeout", async () => {
    const tools = {
      fast: { description: "fast", args: {}, execute: async () => "ok" },
    };
    const wrapped = wrapToolsWithTimeout(tools, 60_000);
    const result = await wrapped.fast.execute({} as never, {} as never);
    expect(result).toBe("ok");
  });

  test("throws ToolTimeoutError with the tool's key when execute hangs", async () => {
    const tools = {
      slow: {
        description: "slow",
        args: {},
        execute: () => new Promise<string>((resolve) => setTimeout(() => resolve("late"), 200)),
      },
    };
    const wrapped = wrapToolsWithTimeout(tools, 20);
    let captured: unknown = null;
    try {
      await wrapped.slow.execute({} as never, {} as never);
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(ToolTimeoutError);
    const err = captured as ToolTimeoutError;
    expect(err.toolName).toBe("slow");
    expect(err.timeoutMs).toBe(20);
  });

  test("propagates non-timeout errors from the wrapped execute", async () => {
    class CustomBoom extends Error {}
    const tools = {
      explode: {
        description: "explode",
        args: {},
        execute: async () => {
          throw new CustomBoom("kaboom");
        },
      },
    };
    const wrapped = wrapToolsWithTimeout(tools, 60_000);
    let captured: unknown = null;
    try {
      await wrapped.explode.execute({} as never, {} as never);
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(CustomBoom);
  });

  test("wraps every tool in the registry, not just the first", () => {
    const tools = {
      a: { description: "a", args: {}, execute: async () => "a" },
      b: { description: "b", args: {}, execute: async () => "b" },
      c: { description: "c", args: {}, execute: async () => "c" },
    };
    const wrapped = wrapToolsWithTimeout(tools, 60_000);
    expect(Object.keys(wrapped).sort()).toEqual(["a", "b", "c"]);
    expect(wrapped.a).not.toBe(tools.a);
    expect(wrapped.b).not.toBe(tools.b);
    expect(wrapped.c).not.toBe(tools.c);
  });
});
