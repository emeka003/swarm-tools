import { describe, test, expect } from "bun:test";
import {
  runParallelReviews,
  aggregateReviews,
  DEFAULT_REVIEW_PIPELINE,
  type ParallelReviewConfig,
  type ReviewResult,
} from "./parallel-review";

describe("Parallel Review Module", () => {
  describe("DEFAULT_REVIEW_PIPELINE", () => {
    test("has three stages: security, quality, architecture", () => {
      expect(DEFAULT_REVIEW_PIPELINE.stages).toHaveLength(3);
      expect(DEFAULT_REVIEW_PIPELINE.stages[0]!.name).toBe("security");
      expect(DEFAULT_REVIEW_PIPELINE.stages[1]!.name).toBe("quality");
      expect(DEFAULT_REVIEW_PIPELINE.stages[2]!.name).toBe("architecture");
    });

    test("uses all_must_pass aggregation", () => {
      expect(DEFAULT_REVIEW_PIPELINE.aggregation).toBe("all_must_pass");
    });

    test("marks security and quality as required, architecture as optional", () => {
      expect(DEFAULT_REVIEW_PIPELINE.stages[0]!.required).toBe(true);
      expect(DEFAULT_REVIEW_PIPELINE.stages[1]!.required).toBe(true);
      expect(DEFAULT_REVIEW_PIPELINE.stages[2]!.required).toBe(false);
    });
  });

  describe("aggregateReviews", () => {
    const passingReview: ReviewResult = {
      stage: "quality",
      reviewer: "quality-reviewer",
      passed: true,
      issues: [],
    };

    const failingReview: ReviewResult = {
      stage: "security",
      reviewer: "security-reviewer",
      passed: false,
      issues: ["Found SQL injection vulnerability"],
    };

    test("all_must_pass: passes when all reviews pass", () => {
      const results = [passingReview, passingReview];
      const outcome = aggregateReviews(results, "all_must_pass");
      expect(outcome.passed).toBe(true);
      expect(outcome.results).toHaveLength(2);
    });

    test("all_must_pass: fails when any review fails", () => {
      const results = [passingReview, failingReview];
      const outcome = aggregateReviews(results, "all_must_pass");
      expect(outcome.passed).toBe(false);
    });

    test("majority: passes when majority pass", () => {
      const results = [passingReview, passingReview, failingReview];
      const outcome = aggregateReviews(results, "majority");
      expect(outcome.passed).toBe(true);
    });

    test("majority: fails when majority fail", () => {
      const results = [failingReview, failingReview, passingReview];
      const outcome = aggregateReviews(results, "majority");
      expect(outcome.passed).toBe(false);
    });

    test("any: passes when at least one passes", () => {
      const results = [failingReview, passingReview];
      const outcome = aggregateReviews(results, "any");
      expect(outcome.passed).toBe(true);
    });

    test("any: fails when all fail", () => {
      const results = [failingReview, failingReview];
      const outcome = aggregateReviews(results, "any");
      expect(outcome.passed).toBe(false);
    });

    test("collects all issues from failing reviews", () => {
      const anotherFailingReview: ReviewResult = {
        stage: "architecture",
        reviewer: "arch-reviewer",
        passed: false,
        issues: ["Circular dependency detected"],
      };
      const results = [failingReview, anotherFailingReview];
      const outcome = aggregateReviews(results, "all_must_pass");
      expect(outcome.issues).toContain("Found SQL injection vulnerability");
      expect(outcome.issues).toContain("Circular dependency detected");
    });
  });

  describe("runParallelReviews", () => {
    test("returns results for all stages in default pipeline", async () => {
      const result = await runParallelReviews({
        project_path: "/tmp/test",
        bead_id: "test-bead-1",
        files: ["src/test.ts"],
      });

      expect(result.passed).toBeDefined();
      expect(result.results).toHaveLength(3);
    });

    test("uses default pipeline when no config provided", async () => {
      const result = await runParallelReviews({
        project_path: "/tmp/test",
        bead_id: "test-bead-2",
        files: ["src/test.ts"],
      });

      const stageNames = result.results.map((r) => r.stage);
      expect(stageNames).toContain("security");
      expect(stageNames).toContain("quality");
      expect(stageNames).toContain("architecture");
    });

    test("uses custom config when provided", async () => {
      const customConfig: ParallelReviewConfig = {
        stages: [
          {
            name: "lint",
            reviewer: "lint-reviewer",
            criteria: ["no_errors"],
            required: true,
          },
        ],
        aggregation: "all_must_pass",
      };

      const result = await runParallelReviews({
        project_path: "/tmp/test",
        bead_id: "test-bead-3",
        files: ["src/test.ts"],
        config: customConfig,
      });

      expect(result.results).toHaveLength(1);
      expect(result.results[0]!.stage).toBe("lint");
    });

    test("aggregates results according to config", async () => {
      const customConfig: ParallelReviewConfig = {
        stages: [
          {
            name: "stage-a",
            reviewer: "reviewer-a",
            criteria: [],
            required: true,
          },
          {
            name: "stage-b",
            reviewer: "reviewer-b",
            criteria: [],
            required: true,
          },
        ],
        aggregation: "majority",
      };

      const result = await runParallelReviews({
        project_path: "/tmp/test",
        bead_id: "test-bead-4",
        files: [],
        config: customConfig,
      });

      expect(result.results).toHaveLength(2);
      expect(typeof result.passed).toBe("boolean");
    });
  });
});
