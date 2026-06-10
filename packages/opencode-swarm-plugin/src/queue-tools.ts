/**
 * Queue Tools - BullMQ Queue Management for Swarm
 *
 * MCP tools for managing background job queues with BullMQ.
 * Supports job submission, status tracking, listing, and cancellation.
 *
 * Key features:
 * - Submit jobs with type, payload, priority, delay, retry options
 * - Query job status by ID
 * - List jobs by state (waiting, active, completed, failed)
 * - Cancel/remove jobs by ID
 * - Queue metrics and health monitoring
 */

import { tool } from "@opencode-ai/plugin";
import { createSwarmQueue } from "swarm-queue";
import type { SwarmQueue } from "swarm-queue";
import type { JobOptions } from "swarm-queue";
import { safeEmitEvent } from "./utils/event-utils";

// ============================================================================
// Types
// ============================================================================

/** Tool execution context from OpenCode plugin */
interface ToolContext {
	sessionID: string;
}

// ============================================================================
// Queue Cache
// ============================================================================

let cachedQueue: SwarmQueue | null = null;
let cachedQueueName: string | null = null;

/**
 * Get or create queue client for the specified queue
 */
async function getQueue(queueName: string = "swarm"): Promise<SwarmQueue> {
	if (cachedQueue && cachedQueueName === queueName) {
		return cachedQueue;
	}

	// Close old queue if exists
	if (cachedQueue) {
		await cachedQueue.close();
	}

	// Create new queue
	cachedQueue = createSwarmQueue({
		name: queueName,
		connection: {
			host: process.env.SWARM_REDIS_HOST || process.env.REDIS_HOST || "localhost",
			port: parseInt(process.env.SWARM_REDIS_PORT || process.env.REDIS_PORT || "6379", 10),
		},
		defaultJobOptions: {
			attempts: 3,
			backoff: {
				type: "exponential",
				delay: 2000,
			},
		},
	});

	cachedQueueName = queueName;

	return cachedQueue;
}

/**
 * Reset queue cache (for testing)
 */
export function resetQueueCache(): void {
	if (cachedQueue) {
		cachedQueue.close().catch(() => {
			// Ignore close errors during reset
		});
	}
	cachedQueue = null;
	cachedQueueName = null;
}

// ============================================================================
// Core Tools
// ============================================================================

/**
 * queue_submit - Submit a job to the queue
 */
export const queue_submit = tool({
	description:
		"Submit a job to the background queue with type, payload, and options (priority, delay, attempts). Returns job ID for tracking.",
	args: {
		type: tool.schema.string().describe("Job type identifier (required)"),
		payload: tool.schema
			.string()
			.describe("Job payload as JSON string (required)"),
		queue_name: tool.schema
			.string()
			.optional()
			.describe("Queue name (default: 'swarm')"),
		priority: tool.schema
			.number()
			.optional()
			.describe("Job priority (lower = higher priority, default: 0)"),
		delay: tool.schema
			.number()
			.optional()
			.describe("Delay in milliseconds before job can be processed"),
		attempts: tool.schema
			.number()
			.optional()
			.describe("Number of retry attempts on failure (default: 3)"),
		remove_on_complete: tool.schema
			.boolean()
			.optional()
			.describe("Remove job after successful completion (default: false)"),
	},
	async execute(
		args: {
			type: string;
			payload: string;
			queue_name?: string;
			priority?: number;
			delay?: number;
			attempts?: number;
			remove_on_complete?: boolean;
		},
		ctx: ToolContext,
	) {
		const queue = await getQueue(args.queue_name);

		// Parse payload
		let parsedPayload: unknown;
		try {
			parsedPayload = JSON.parse(args.payload);
		} catch (error) {
			return JSON.stringify({
				success: false,
				error: `Invalid JSON payload: ${error instanceof Error ? error.message : String(error)}`,
			});
		}

		// Build job options
		const options: JobOptions = {};
		if (args.priority !== undefined) options.priority = args.priority;
		if (args.delay !== undefined) options.delay = args.delay;
		if (args.attempts !== undefined) options.attempts = args.attempts;
		if (args.remove_on_complete !== undefined)
			options.removeOnComplete = args.remove_on_complete;

		// Submit job
		try {
			const jobId = await queue.addJob(args.type, parsedPayload, options);

			// Emit event
			await safeEmitEvent(
				"queue_job_submitted",
				{
					job_id: jobId,
					job_type: args.type,
					queue_name: args.queue_name || "swarm",
					priority: args.priority,
					delay: args.delay,
				},
				"queue",
			);

			return JSON.stringify(
				{
					success: true,
					job_id: jobId,
					type: args.type,
					queue: args.queue_name || "swarm",
				},
				null,
				2,
			);
		} catch (error) {
			return JSON.stringify({
				success: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	},
});

/**
 * queue_status - Get job status by ID
 */
export const queue_status = tool({
	description:
		"Get status of a job by ID. Returns job state, progress, data, and error info if failed.",
	args: {
		job_id: tool.schema.string().describe("Job ID to query (required)"),
		queue_name: tool.schema
			.string()
			.optional()
			.describe("Queue name (default: 'swarm')"),
	},
	async execute(
		args: { job_id: string; queue_name?: string },
		ctx: ToolContext,
	) {
		const queue = await getQueue(args.queue_name);

		try {
			const job = await queue.getJob(args.job_id);

			if (!job) {
				return JSON.stringify({
					success: false,
					error: `Job not found: ${args.job_id}`,
				});
			}

			const state = await job.getState();
			const progress = job.progress;
			const data = job.data;
			const returnValue = job.returnvalue;
			const failedReason = job.failedReason;
			const attemptsMade = job.attemptsMade;

			return JSON.stringify(
				{
					success: true,
					job_id: args.job_id,
					type: data.type,
					state,
					progress,
					data: data.payload,
					result: returnValue,
					failed_reason: failedReason,
					attempts_made: attemptsMade,
					timestamp: job.timestamp,
					processed_on: job.processedOn,
					finished_on: job.finishedOn,
				},
				null,
				2,
			);
		} catch (error) {
			return JSON.stringify({
				success: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	},
});

/**
 * queue_list - List jobs by state
 */
export const queue_list = tool({
	description:
		"List jobs by state (waiting, active, completed, failed, delayed). Returns job IDs, types, and basic info.",
	args: {
		state: tool.schema
			.string()
			.optional()
			.describe(
				"Job state filter: waiting, active, completed, failed, delayed (default: all)",
			),
		queue_name: tool.schema
			.string()
			.optional()
			.describe("Queue name (default: 'swarm')"),
		limit: tool.schema
			.number()
			.optional()
			.describe("Maximum number of jobs to return (default: 10)"),
	},
	async execute(
		args: { state?: string; queue_name?: string; limit?: number },
		ctx: ToolContext,
	) {
		const queue = await getQueue(args.queue_name);
		const limit = args.limit || 10;

		try {
			// Get metrics first
			const metrics = await queue.getMetrics();

			// If state is specified, get jobs for that state
			let jobs: any[] = [];
			if (args.state) {
				const validStates = ["waiting", "active", "completed", "failed", "delayed"];
				if (!validStates.includes(args.state)) {
					return JSON.stringify({
						success: false,
						error: `Invalid state: ${args.state}. Must be one of: ${validStates.join(", ")}`,
					});
				}

				// Use underlying BullMQ queue to get jobs
				const bullJobs = await queue.underlying.getJobs(
					args.state as any,
					0,
					limit - 1,
				);

				jobs = await Promise.all(
					bullJobs.map(async (job) => ({
						job_id: job.id,
						type: job.data.type,
						state: await job.getState(),
						timestamp: job.timestamp,
						processed_on: job.processedOn,
						finished_on: job.finishedOn,
						attempts_made: job.attemptsMade,
					})),
				);
			}

			return JSON.stringify(
				{
					success: true,
					queue: args.queue_name || "swarm",
					metrics,
					jobs: args.state ? jobs : [],
					showing: args.state ? jobs.length : 0,
					limit,
				},
				null,
				2,
			);
		} catch (error) {
			return JSON.stringify({
				success: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	},
});

/**
 * queue_cancel - Cancel/remove a job by ID
 */
export const queue_cancel = tool({
	description:
		"Cancel and remove a job by ID. Works for jobs in any state (waiting, delayed, active, completed, failed).",
	args: {
		job_id: tool.schema.string().describe("Job ID to cancel (required)"),
		queue_name: tool.schema
			.string()
			.optional()
			.describe("Queue name (default: 'swarm')"),
	},
	async execute(
		args: { job_id: string; queue_name?: string },
		ctx: ToolContext,
	) {
		const queue = await getQueue(args.queue_name);

		try {
			// Check if job exists first
			const job = await queue.getJob(args.job_id);
			if (!job) {
				return JSON.stringify({
					success: false,
					error: `Job not found: ${args.job_id}`,
				});
			}

			const state = await job.getState();

			// Remove the job
			await queue.removeJob(args.job_id);

			// Emit event
			await safeEmitEvent(
				"queue_job_cancelled",
				{
					job_id: args.job_id,
					queue_name: args.queue_name || "swarm",
					previous_state: state,
				},
				"queue",
			);

			return JSON.stringify(
				{
					success: true,
					job_id: args.job_id,
					previous_state: state,
					message: "Job cancelled and removed",
				},
				null,
				2,
			);
		} catch (error) {
			return JSON.stringify({
				success: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	},
});

// ============================================================================
// Tool Registry
// ============================================================================

/**
 * All queue tools for registration in plugin
 *
 * Register with spread operator: { ...queueTools }
 */
export const queueTools = {
	queue_submit,
	queue_status,
	queue_list,
	queue_cancel,
} as const;
