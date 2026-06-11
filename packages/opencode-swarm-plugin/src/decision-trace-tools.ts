/**
 * Decision Trace Tools - MCP Tools for Decision Traces
 *
 * Exposes decision trace operations as tools for LLM agents.
 * Agents can record coordinator decisions and query decision history.
 *
 * Tools:
 * - swarm_record_decision: Record a coordinator decision trace
 * - swarm_get_decision_traces: Query decision traces for an epic
 */

import { tool } from "@opencode-ai/plugin";
import {
  traceStrategySelection,
  traceWorkerSpawn,
  traceReviewDecision,
  traceFileSelection,
  traceScopeChange,
  getEpicDecisionTraces,
  getDecisionTracesByType,
} from "./decision-trace-integration.js";

// ============================================================================
// Types
// ============================================================================

interface ToolContext {
  sessionID: string;
}

export interface RecordDecisionArgs {
  epic_id: string;
  project_path?: string;
  bead_id?: string;
  decision_type: "spawn" | "reject" | "retry" | "replan" | "block" | "approve" | "split";
  decision: string;
  reason: string;
  evidence?: string[];
  alternatives_considered?: string[];
}

export interface GetDecisionTracesArgs {
  epic_id: string;
  project_path?: string;
  decision_type?: string;
  agent?: string;
  limit?: number;
}

// ============================================================================
// Tool Definitions
// ============================================================================

export const decisionTraceTools = {
  swarm_record_decision: tool({
    description: "Record a coordinator decision trace",
    args: {
      epic_id: tool.schema.string(),
      project_path: tool.schema.string().optional(),
      bead_id: tool.schema.string().optional(),
      decision_type: tool.schema.enum(["spawn", "reject", "retry", "replan", "block", "approve", "split"]),
      decision: tool.schema.string(),
      reason: tool.schema.string(),
      evidence: tool.schema.array(tool.schema.string()).optional(),
      alternatives_considered: tool.schema.array(tool.schema.string()).optional(),
    },
    execute: async (args: RecordDecisionArgs, ctx: ToolContext) => {
      const {
        epic_id,
        project_path,
        bead_id,
        decision_type,
        decision,
        reason,
        evidence,
        alternatives_considered,
      } = args;

      if (!epic_id || typeof epic_id !== 'string' || epic_id.trim() === '') {
        return JSON.stringify({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "epic_id parameter is required and must be a non-empty string"
          }
        });
      }

      const projectKey = project_path ?? process.cwd();
      const agentName = ctx.sessionID || "unknown";
      const resolvedBeadId = bead_id ?? `bead-${Date.now()}`;

      let traceId = "";

      switch (decision_type) {
        case "spawn":
          traceId = await traceWorkerSpawn({
            projectKey,
            agentName,
            epicId: epic_id,
            beadId: resolvedBeadId,
            subtaskTitle: decision,
            files: [],
            rationale: reason,
          });
          break;

        case "approve":
        case "reject":
          traceId = await traceReviewDecision({
            projectKey,
            agentName,
            epicId: epic_id,
            beadId: resolvedBeadId,
            workerId: "unknown",
            status: decision_type === "approve" ? "approved" : "needs_changes",
            summary: decision,
            rationale: reason,
          });
          break;

        case "retry":
        case "replan":
        case "block":
        case "split":
          traceId = await traceStrategySelection({
            projectKey,
            agentName,
            epicId: epic_id,
            strategy: decision_type,
            reasoning: reason,
            alternatives: alternatives_considered?.map((alt) => ({
              strategy: alt,
              reason: "alternative considered",
            })),
          });
          break;
      }

      return JSON.stringify({
        success: true,
        trace_id: traceId,
        epic_id,
        decision_type,
        decision,
        reason,
        evidence,
        alternatives_considered,
        timestamp: new Date().toISOString(),
      });
    },
  }),

  swarm_get_decision_traces: tool({
    description: "Query decision traces for an epic",
    args: {
      epic_id: tool.schema.string(),
      project_path: tool.schema.string().optional(),
      decision_type: tool.schema.string().optional(),
      agent: tool.schema.string().optional(),
      limit: tool.schema.number().optional(),
    },
    execute: async (args: GetDecisionTracesArgs, ctx: ToolContext) => {
      const { epic_id, project_path, decision_type, agent, limit } = args;

      const projectKey = project_path ?? process.cwd();

      let traces;
      if (decision_type) {
        traces = await getDecisionTracesByType(projectKey, decision_type);
        traces = traces.filter((t) => t.epic_id === epic_id);
      } else {
        traces = await getEpicDecisionTraces(projectKey, epic_id);
      }

      // Filter by agent if specified
      if (agent) {
        traces = traces.filter((t) => t.agent_name === agent);
      }

      // Apply limit
      if (limit && traces.length > limit) {
        traces = traces.slice(0, limit);
      }

      return JSON.stringify({
        epic_id,
        decision_type,
        agent,
        limit,
        traces,
        count: traces.length,
        timestamp: new Date().toISOString(),
      });
    },
  }),
};