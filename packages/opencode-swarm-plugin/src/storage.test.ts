import { describe, test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import {
  createStorage,
  createStorageWithFallback,
  getDefaultStorageConfig,
  getTestCollectionName,
  isSemanticMemoryAvailable,
  resetCommandCache,
  resetAvailabilityCache,
  resetStorage,
  getStorage,
  setStorage,
  InMemoryStorage,
  type LearningStorage,
} from "./storage";
import type { FeedbackEvent } from "./learning";
import type { DecompositionPattern } from "./anti-patterns";

describe("Storage Command Resolution", () => {
  beforeAll(() => {
    resetCommandCache();
  });

  afterAll(() => {
    resetCommandCache();
  });

  test("resets command cache without error", () => {
    // Reset should not throw
    expect(() => resetCommandCache()).not.toThrow();
  });
});

describe("Storage Availability", () => {
  beforeAll(() => {
    resetAvailabilityCache();
  });

  afterAll(() => {
    resetAvailabilityCache();
  });

  test("resets availability cache without error", () => {
    resetAvailabilityCache();
    // After reset, next call should check again
    expect(true).toBe(true);
  });
});

describe("Storage Configuration", () => {
  test("getDefaultStorageConfig returns valid config", () => {
    const config = getDefaultStorageConfig();
    expect(config).toHaveProperty("backend");
    expect(config).toHaveProperty("collections");
    expect(config).toHaveProperty("useSemanticSearch");
    expect(config.backend).toBe("semantic-memory");
    expect(config.collections).toHaveProperty("feedback");
    expect(config.collections).toHaveProperty("patterns");
    expect(config.collections).toHaveProperty("maturity");
  });

  test("getTestCollectionName returns unique suffix", async () => {
    const name1 = getTestCollectionName();
    // Add small delay to ensure different timestamp
    await new Promise(resolve => setTimeout(resolve, 2));
    const name2 = getTestCollectionName();
    expect(name1).toMatch(/^test-\d+$/);
    expect(name2).toMatch(/^test-\d+$/);
    // Names should be different due to timestamp
    expect(name1).not.toBe(name2);
  });

  test("createStorage with memory backend creates InMemoryStorage", () => {
    const storage = createStorage({ backend: "memory" });
    expect(storage).toBeInstanceOf(InMemoryStorage);
  });

  test("createStorage with semantic-memory backend creates SemanticMemoryStorage", () => {
    const storage = createStorage({ backend: "semantic-memory" });
    expect(storage).toBeDefined();
    expect(typeof storage.storeFeedback).toBe("function");
  });

  test("createStorage throws on unknown backend", () => {
    expect(() => createStorage({ backend: "unknown" as any })).toThrow("Unknown storage backend");
  });
});

describe("InMemoryStorage", () => {
  let storage: LearningStorage;

  beforeAll(() => {
    storage = new InMemoryStorage();
  });

  afterAll(async () => {
    await storage.close();
  });

  test("stores and retrieves feedback", async () => {
    const event: FeedbackEvent = {
      criterion: "test-criterion",
      type: "positive",
      bead_id: "test-bead",
      timestamp: new Date().toISOString(),
      context: "test context",
    };

    await storage.storeFeedback(event);
    const retrieved = await storage.getFeedbackByCriterion("test-criterion");
    expect(retrieved.length).toBeGreaterThanOrEqual(1);
  });

  test("stores and retrieves patterns", async () => {
    const pattern: DecompositionPattern = {
      id: "test-pattern-1",
      kind: "good_pattern",
      is_negative: false,
      tags: ["test", "unit"],
      description: "Test pattern",
      examples: [],
      rationale: "For testing",
      created_at: new Date().toISOString(),
    };

    await storage.storePattern(pattern);
    const retrieved = await storage.getPattern("test-pattern-1");
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe("test-pattern-1");
  });

  test("findSimilarFeedback filters by query", async () => {
    const event: FeedbackEvent = {
      criterion: "unique-criterion-xyz",
      type: "positive",
      bead_id: "test-bead",
      timestamp: new Date().toISOString(),
      context: "test context",
    };

    await storage.storeFeedback(event);
    const results = await storage.findSimilarFeedback("unique-criterion-xyz");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test("close is idempotent", async () => {
    const tempStorage = new InMemoryStorage();
    await tempStorage.close();
    await tempStorage.close(); // Should not throw
  });
});

describe("Storage Factory with Fallback", () => {
  beforeEach(() => {
    resetStorage();
  });

  test("createStorageWithFallback with memory backend returns InMemoryStorage", async () => {
    const storage = await createStorageWithFallback({ backend: "memory" });
    expect(storage).toBeInstanceOf(InMemoryStorage);
    await storage.close();
  });

  test("createStorageWithFallback returns storage instance", async () => {
    const storage = await createStorageWithFallback();
    expect(storage).toBeDefined();
    expect(typeof storage.storeFeedback).toBe("function");
    await storage.close();
  });
});

describe("Global Storage", () => {
  beforeEach(async () => {
    await resetStorage();
  });

  test("getStorage returns storage instance", async () => {
    const storage = await getStorage();
    expect(storage).toBeDefined();
    expect(typeof storage.storeFeedback).toBe("function");
  });

  test("getStorage returns same instance on subsequent calls", async () => {
    const storage1 = await getStorage();
    const storage2 = await getStorage();
    expect(storage1).toBe(storage2);
  });

  test("setStorage sets custom storage", async () => {
    const customStorage = new InMemoryStorage();
    setStorage(customStorage);
    const retrieved = await getStorage();
    expect(retrieved).toBe(customStorage);
    await customStorage.close();
  });
});
