/**
 * Dependency Resolution - Helper functions for subtask dependency handling
 *
 * Provides utilities for:
 * - Checking which subtasks are ready to spawn based on dependency status
 * - Validating dependency graphs for cycles and missing references
 *
 * Used by the coordinator to automatically handle depends_on relationships.
 */

import type { HiveAdapter } from "swarm-mail";

export interface DependencyStatus {
  bead_id: string;
  status: "open" | "in_progress" | "blocked" | "completed" | "closed" | "missing";
}

export interface ReadyToSpawn {
  bead_id: string;
  title: string;
  ready: boolean;
  blocking_deps: DependencyStatus[];
}

/**
 * Check which subtasks are ready to spawn based on dependency status.
 * A subtask is ready when ALL its depends_on beads are completed.
 */
export async function getReadySubtasks(params: {
  hive: HiveAdapter;
  project_key: string;
  epic_id: string;
  subtasks: Array<{ bead_id: string; title: string; depends_on?: string[] }>;
}): Promise<ReadyToSpawn[]> {
  const { hive, project_key, subtasks } = params;

  const results: ReadyToSpawn[] = [];

  for (const subtask of subtasks) {
    const dependsOn = subtask.depends_on ?? [];
    const blockingDeps: DependencyStatus[] = [];

    for (const depId of dependsOn) {
      const cell = await hive.getCell(project_key, depId);
      const status: DependencyStatus["status"] = cell
        ? (cell.status as DependencyStatus["status"])
        : "missing";
      if (status !== "completed" && status !== "closed") {
        blockingDeps.push({ bead_id: depId, status });
      }
    }

    results.push({
      bead_id: subtask.bead_id,
      title: subtask.title,
      ready: blockingDeps.length === 0,
      blocking_deps: blockingDeps,
    });
  }

  return results;
}

/**
 * Validate dependency graph for cycles and missing references.
 */
export async function validateDependencies(params: {
  hive: HiveAdapter;
  project_key: string;
  epic_id: string;
  subtasks: Array<{ bead_id: string; depends_on?: string[] }>;
}): Promise<{ valid: boolean; errors: string[] }> {
  const { hive, project_key, subtasks } = params;
  const errors: string[] = [];

  const beadIds = new Set(subtasks.map((s) => s.bead_id));

  for (const subtask of subtasks) {
    const dependsOn = subtask.depends_on ?? [];
    for (const depId of dependsOn) {
      if (!beadIds.has(depId)) {
        const cell = await hive.getCell(project_key, depId);
        if (!cell) {
          errors.push(
            `Subtask ${subtask.bead_id} depends on non-existent bead ${depId}`,
          );
        }
      }
    }
  }

  if (errors.length === 0) {
    const graph = new Map<string, string[]>();
    for (const subtask of subtasks) {
      graph.set(subtask.bead_id, subtask.depends_on ?? []);
    }

    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const path: string[] = [];

    function dfs(node: string): boolean {
      visited.add(node);
      recursionStack.add(node);
      path.push(node);

      const deps = graph.get(node) ?? [];
      for (const dep of deps) {
        if (!visited.has(dep)) {
          if (dfs(dep)) return true;
        } else if (recursionStack.has(dep)) {
          const cycleStart = path.indexOf(dep);
          const cyclePath = path.slice(cycleStart).concat(dep);
          errors.push(`Cycle detected: ${cyclePath.join(" → ")}`);
          return true;
        }
      }

      path.pop();
      recursionStack.delete(node);
      return false;
    }

    for (const node of graph.keys()) {
      if (!visited.has(node)) {
        dfs(node);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}