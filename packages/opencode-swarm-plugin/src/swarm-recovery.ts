import { getSwarmMailLibSQL, type SwarmMailAdapter } from "swarm-mail";
import type { HiveAdapter } from "swarm-mail";

export interface RecoveryResult {
  recovered: boolean;
  epic_id?: string;
  active_workers?: string[];
  blocked_tasks?: string[];
  checkpoint?: Record<string, unknown>;
}

export async function autoRecoverOnStartup(params: {
  project_path: string;
  swarmMail?: SwarmMailAdapter;
  hive?: HiveAdapter;
}): Promise<RecoveryResult> {
  try {
    const swarmMail =
      params.swarmMail ?? (await getSwarmMailLibSQL(params.project_path));
    const db = await swarmMail.getDatabase();

    const result = await db.query<{
      epic_id: string;
      bead_id: string;
      recovery: string;
      updated_at: number;
    }>(
      `SELECT epic_id, bead_id, recovery, updated_at 
       FROM swarm_contexts 
       WHERE project_key = $1 
       ORDER BY updated_at DESC 
       LIMIT 50`,
      [params.project_path],
    );

    if (result.rows.length === 0) {
      return { recovered: false };
    }

    const epicIds = [...new Set(result.rows.map((r) => r.epic_id))];

    for (const epicId of epicIds) {
      try {
        let hiveAdapter: HiveAdapter;
        if (params.hive) {
          hiveAdapter = params.hive;
        } else {
          const { getHiveAdapter } = await import("./hive.js");
          hiveAdapter = await getHiveAdapter(params.project_path);
        }

        const cells = await hiveAdapter.queryCells(params.project_path, {
          parent_id: epicId,
        });

        const inProgress = cells.filter(
          (c) => c.status === "in_progress",
        );
        const blocked = cells.filter(
          (c) => c.status === "blocked",
        );

        if (inProgress.length > 0) {
          const latestCheckpoint = result.rows.find(
            (r) => r.epic_id === epicId,
          );
          const recoveryData = latestCheckpoint
            ? JSON.parse(latestCheckpoint.recovery)
            : {};

          return {
            recovered: true,
            epic_id: epicId,
            active_workers: inProgress.map((c) => c.id),
            blocked_tasks: blocked.map((c) => c.id),
            checkpoint: recoveryData,
          };
        }
      } catch {
        continue;
      }
    }

    return { recovered: false };
  } catch {
    return { recovered: false };
  }
}
