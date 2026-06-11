/**
 * Parallel Review Module
 *
 * Supports multi-stage review pipelines where multiple reviewers
 * evaluate code in parallel. Results are aggregated based on a
 * configurable strategy.
 *
 * Features:
 * - Parallel review execution across stages
 * - Configurable aggregation (all_must_pass, majority, any)
 * - Default pipeline: Security → Quality → Architecture
 * - Integration with swarm_complete review gate
 */

// ============================================================================
// Types
// ============================================================================

export interface ReviewStage {
  name: string;
  reviewer: string;
  criteria: string[];
  required: boolean;
}

export interface ParallelReviewConfig {
  stages: ReviewStage[];
  aggregation: "all_must_pass" | "majority" | "any";
}

export interface ReviewResult {
  stage: string;
  reviewer: string;
  passed: boolean;
  issues: string[];
}

export interface AggregatedReviewOutcome {
  passed: boolean;
  results: ReviewResult[];
  issues: string[];
}

// ============================================================================
// Default Pipeline
// ============================================================================

export const DEFAULT_REVIEW_PIPELINE: ParallelReviewConfig = {
  stages: [
    {
      name: "security",
      reviewer: "security-reviewer",
      criteria: ["no_vulnerabilities", "no_secrets", "input_validation"],
      required: true,
    },
    {
      name: "quality",
      reviewer: "quality-reviewer",
      criteria: ["type_safety", "error_handling", "test_coverage"],
      required: true,
    },
    {
      name: "architecture",
      reviewer: "arch-reviewer",
      criteria: [
        "module_boundaries",
        "no_circular_deps",
        "separation_of_concerns",
      ],
      required: false,
    },
  ],
  aggregation: "all_must_pass",
};

// ============================================================================
// Aggregation Logic
// ============================================================================

/**
 * Aggregate review results based on the configured strategy.
 *
 * @param results - Results from individual review stages
 * @param aggregation - Strategy: all_must_pass, majority, or any
 * @returns Aggregated outcome with pass/fail and combined issues
 */
export function aggregateReviews(
  results: ReviewResult[],
  aggregation: ParallelReviewConfig["aggregation"]
): AggregatedReviewOutcome {
  const issues = results
    .filter((r) => !r.passed)
    .flatMap((r) => r.issues);

  let passed: boolean;

  switch (aggregation) {
    case "all_must_pass": {
      passed = results.every((r) => r.passed);
      break;
    }
    case "majority": {
      const passCount = results.filter((r) => r.passed).length;
      passed = passCount > results.length / 2;
      break;
    }
    case "any": {
      passed = results.some((r) => r.passed);
      break;
    }
  }

  return {
    passed,
    results,
    issues,
  };
}

// ============================================================================
// Parallel Review Runner
// ============================================================================

/**
 * Run parallel reviews across multiple stages.
 * Each stage runs independently and results are aggregated.
 *
 * @param params - Review parameters including project, bead, files, and config
 * @returns Aggregated review outcome
 */
export async function runParallelReviews(params: {
  project_path: string;
  bead_id: string;
  files: string[];
  config?: ParallelReviewConfig;
}): Promise<AggregatedReviewOutcome> {
  const config = params.config ?? DEFAULT_REVIEW_PIPELINE;

  // TODO: Implement real review logic per stage. Currently a stub that always passes.
  const reviewPromises = config.stages.map(async (stage): Promise<ReviewResult> => {
    try {
      const criteriaList = stage.criteria.join(", ");
      return {
        stage: stage.name,
        reviewer: stage.reviewer,
        passed: true,
        issues: [],
      };
    } catch (error) {
      return {
        stage: stage.name,
        reviewer: stage.reviewer,
        passed: false,
        issues: [
          `Review stage "${stage.name}" failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ],
      };
    }
  });

  const results = await Promise.all(reviewPromises);

  return aggregateReviews(results, config.aggregation);
}
