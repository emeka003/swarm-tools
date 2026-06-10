import { getHiveAdapter } from "./hive";
import type { HiveAdapter } from "swarm-mail";

export interface SiblingWorkerContext {
  active_workers: Array<{ bead_id: string; title: string }>;
  summary: string;
}

export async function getSiblingWorkerContext(params: {
  project_path: string;
  current_bead_id: string;
  epic_id: string;
  adapter?: HiveAdapter;
}): Promise<SiblingWorkerContext> {
  const adapter = params.adapter || await getHiveAdapter(params.project_path);

  const cells = await adapter.queryCells(params.project_path, {
    parent_id: params.epic_id,
    status: "in_progress",
  });

  const active_workers = cells
    .filter((cell) => cell.id !== params.current_bead_id)
    .map((cell) => ({
      bead_id: cell.id,
      title: cell.title,
    }));

  const summary = formatSiblingSummary(active_workers);

  return {
    active_workers,
    summary,
  };
}

function formatSiblingSummary(
  workers: Array<{ bead_id: string; title: string }>
): string {
  if (workers.length === 0) {
    return "No active sibling workers in this epic.";
  }

  const lines = workers.map((worker) => {
    return `- **${worker.bead_id}**: ${worker.title}`;
  });

  return `Active workers in this epic:\n${lines.join("\n")}`;
}
