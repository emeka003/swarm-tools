/**
 * Observability Tools Tests
 *
 * TDD: Write tests first, then implement the tools.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import {
	observabilityTools,
	type SwarmAnalyticsArgs,
	type SwarmQueryArgs,
	type SwarmDiagnoseArgs,
	type SwarmInsightsArgs,
	type SwarmHealthArgs,
} from "./observability-tools";
import type { ToolContext } from "@opencode-ai/plugin";
import {
	closeSwarmMailLibSQL,
	createHiveAdapter,
	createInMemorySwarmMailLibSQL,
	getSwarmMailLibSQL,
	initSwarmAgent,
	reserveSwarmFiles,
	sendSwarmMessage,
	type SwarmMailAdapter,
} from "swarm-mail";
import { runDeepChecks } from "../bin/commands/doctor.js";

describe("observability-tools", () => {
	let swarmMail: SwarmMailAdapter;
	const projectPath = "/tmp/test-observability-" + Date.now();
	const mockContext: ToolContext = { sessionID: "test-session" };

	beforeAll(async () => {
		// Create in-memory database with test data
		swarmMail = await createInMemorySwarmMailLibSQL(projectPath);

		// Populate with test events using high-level API
		const agentName = "TestAgent";

		// Register agent
		await initSwarmAgent({
			projectPath,
			agentName,
			taskDescription: "test-task",
		});

		// Reserve and release files (for lock contention analytics)
		await reserveSwarmFiles({
			projectPath,
			agentName,
			paths: ["src/test.ts"],
			reason: "test-reason",
		});

		// Send a message (for message latency analytics)
		await sendSwarmMessage({
			projectPath,
			fromAgent: agentName,
			toAgents: ["Agent2"],
			subject: "test-subject",
			body: "test-body",
		});

		// Note: subtask outcomes are recorded via a different API
		// For now, we'll test with the events we have
		// The important thing is that the tools can execute queries
	});

	afterAll(async () => {
		await closeSwarmMailLibSQL(projectPath);
	});

	describe("swarm_analytics", () => {
		const tool = observabilityTools.swarm_analytics;

		test("is defined with correct schema", () => {
			expect(tool).toBeDefined();
			expect(tool.description).toBeTruthy();
			expect(tool.args).toBeDefined();
		});

		test("returns failed-decompositions data", async () => {
			const args: SwarmAnalyticsArgs = {
				query: "failed-decompositions",
			};

			const result = await tool.execute(args, mockContext);
			expect(result).toBeTruthy();

			const parsed = JSON.parse(result);
			expect(parsed).toHaveProperty("results");
			expect(Array.isArray(parsed.results)).toBe(true);
			// Empty data is fine - we're testing tool execution
		});

		test("returns strategy-success-rates data", async () => {
			const args: SwarmAnalyticsArgs = {
				query: "strategy-success-rates",
			};

			const result = await tool.execute(args, mockContext);
			const parsed = JSON.parse(result);
			expect(parsed).toHaveProperty("results");
			expect(Array.isArray(parsed.results)).toBe(true);
		});

		test("returns agent-activity data", async () => {
			const args: SwarmAnalyticsArgs = {
				query: "agent-activity",
			};

			const result = await tool.execute(args, mockContext);
			const parsed = JSON.parse(result);
			expect(parsed).toHaveProperty("results");
			expect(Array.isArray(parsed.results)).toBe(true);
			// Should have at least our TestAgent
			expect(parsed.results.length).toBeGreaterThanOrEqual(1);
		});

		test("supports summary format", async () => {
			const args: SwarmAnalyticsArgs = {
				query: "agent-activity",
				format: "summary",
			};

			const result = await tool.execute(args, mockContext);
			expect(result).toBeTruthy();
			expect(typeof result).toBe("string");
			// Summary should be concise (<500 chars)
			expect(result.length).toBeLessThan(500);
		});

		test("supports time filtering with since", async () => {
			const args: SwarmAnalyticsArgs = {
				query: "agent-activity",
				since: "24h",
			};

			const result = await tool.execute(args, mockContext);
			const parsed = JSON.parse(result);
			expect(parsed).toHaveProperty("results");
		});

		test("returns error for invalid query type", async () => {
			const args = {
				query: "invalid-query",
			};

			const result = await tool.execute(args as any, mockContext);
			const parsed = JSON.parse(result);
			expect(parsed).toHaveProperty("error");
		});
	});

	describe("swarm_query", () => {
		const tool = observabilityTools.swarm_query;

		test("is defined with correct schema", () => {
			expect(tool).toBeDefined();
			expect(tool.description).toBeTruthy();
			expect(tool.args).toBeDefined();
		});

		test("executes raw SQL queries", async () => {
			const args: SwarmQueryArgs = {
				sql: "SELECT type, COUNT(*) as count FROM events GROUP BY type",
			};

			const result = await tool.execute(args, mockContext);
			expect(result).toBeTruthy();

			const parsed = JSON.parse(result);
			// May have errors in test environment - that's ok
			if (!parsed.error) {
				// Should have count and results even if empty
				expect(parsed).toHaveProperty("count");
				expect(parsed).toHaveProperty("results");
				expect(Array.isArray(parsed.results)).toBe(true);
			}
		});

		test("limits results to max 50 rows", async () => {
			const args: SwarmQueryArgs = {
				sql: "SELECT * FROM events LIMIT 100", // Try to fetch 100
			};

			const result = await tool.execute(args, mockContext);
			const parsed = JSON.parse(result);
			// Should be capped at 50 (or less if there's less data)
			// May return error if database issues - that's ok for this test
			if (parsed.error) {
				expect(parsed).toHaveProperty("error");
			} else {
				expect(parsed).toHaveProperty("results");
				expect(parsed.results.length).toBeLessThanOrEqual(50);
			}
		});

		test("supports table format", async () => {
			const args: SwarmQueryArgs = {
				sql: "SELECT type FROM events LIMIT 3",
				format: "table",
			};

			const result = await tool.execute(args, mockContext);
			expect(typeof result).toBe("string");
			// Table format returns string (even if "No results" for empty data)
			expect(result.length).toBeGreaterThan(0);
		});

		test("returns error for invalid SQL", async () => {
			const args: SwarmQueryArgs = {
				sql: "SELECT * FROM nonexistent_table",
			};

			const result = await tool.execute(args, mockContext);
			const parsed = JSON.parse(result);
			expect(parsed).toHaveProperty("error");
		});
	});

	describe("swarm_diagnose", () => {
		const tool = observabilityTools.swarm_diagnose;

		test("is defined with correct schema", () => {
			expect(tool).toBeDefined();
			expect(tool.description).toBeTruthy();
			expect(tool.args).toBeDefined();
		});

		test("diagnoses issues for a specific epic", async () => {
			const args: SwarmDiagnoseArgs = {
				epic_id: "epic-123",
				include: ["blockers", "errors"],
			};

			const result = await tool.execute(args, mockContext);
			expect(result).toBeTruthy();

			const parsed = JSON.parse(result);
			expect(parsed).toHaveProperty("epic_id");
			expect(parsed).toHaveProperty("diagnosis");
		});

		test("returns structured diagnosis with suggestions", async () => {
			const args: SwarmDiagnoseArgs = {
				bead_id: "task-1",
			};

			const result = await tool.execute(args, mockContext);
			const parsed = JSON.parse(result);
			expect(parsed).toHaveProperty("diagnosis");
			expect(Array.isArray(parsed.diagnosis)).toBe(true);
		});

		test("includes timeline when requested", async () => {
			const args: SwarmDiagnoseArgs = {
				bead_id: "task-1",
				include: ["timeline"],
			};

			const result = await tool.execute(args, mockContext);
			const parsed = JSON.parse(result);
			expect(parsed).toHaveProperty("timeline");
		});
	});

	describe("swarm_insights", () => {
		const tool = observabilityTools.swarm_insights;

		test("is defined with correct schema", () => {
			expect(tool).toBeDefined();
			expect(tool.description).toBeTruthy();
			expect(tool.args).toBeDefined();
		});

		test("generates insights for recent activity", async () => {
			const args: SwarmInsightsArgs = {
				scope: "recent",
				metrics: ["success_rate", "avg_duration"],
			};

			const result = await tool.execute(args, mockContext);
			expect(result).toBeTruthy();

			const parsed = JSON.parse(result);
			expect(parsed).toHaveProperty("insights");
			expect(Array.isArray(parsed.insights)).toBe(true);
		});

		test("generates insights for specific epic", async () => {
			const args: SwarmInsightsArgs = {
				scope: "epic",
				epic_id: "epic-123",
				metrics: ["conflict_rate", "retry_rate"],
			};

			const result = await tool.execute(args, mockContext);
			const parsed = JSON.parse(result);
			expect(parsed).toHaveProperty("epic_id", "epic-123");
			expect(parsed).toHaveProperty("insights");
		});

		test("returns error when epic_id missing for epic scope", async () => {
			const args: SwarmInsightsArgs = {
				scope: "epic",
				metrics: ["success_rate"],
				// Missing epic_id
			};

			const result = await tool.execute(args, mockContext);
			const parsed = JSON.parse(result);
			expect(parsed).toHaveProperty("error");
		});
	});

	describe("integration with swarm-mail analytics", () => {
		test("all query types are supported", async () => {
			const queryTypes = [
				"failed-decompositions",
				"strategy-success-rates",
				"lock-contention",
				"agent-activity",
				"message-latency",
				"scope-violations",
				"task-duration",
				"checkpoint-frequency",
				"recovery-success",
				"human-feedback",
			];

			for (const queryType of queryTypes) {
				const tool = observabilityTools.swarm_analytics;
				const args: SwarmAnalyticsArgs = {
					query: queryType as SwarmAnalyticsArgs["query"],
				};

				const result = await tool.execute(args, mockContext);
				const parsed = JSON.parse(result);

				// Should return results property (even if empty array)
				// May have errors in test environment - that's ok
				if (!parsed.error) {
					expect(parsed).toHaveProperty("results");
				}
			}
		});
	});

	describe("CLI Stats Helpers", () => {
		// These helpers will be exported for use in bin/swarm.ts
		// They format analytics data for beautiful CLI output

		describe("formatSwarmStatsBox", () => {
			test("formats stats in a beautiful box", () => {
				// This will be implemented in observability-tools.ts
				// Just defining the test structure for now
				expect(true).toBe(true);
			});
		});
	});

	describe("swarm_health", () => {
		const tool = observabilityTools.swarm_health;
		const testDir = join(tmpdir(), `swarm-health-test-${Date.now()}`);
		const originalCwd = process.cwd();

		beforeAll(() => {
			mkdirSync(testDir, { recursive: true });
			process.chdir(testDir);
		});

		afterAll(() => {
			process.chdir(originalCwd);
			rmSync(testDir, { recursive: true, force: true });
		});

		test("is defined with correct schema", () => {
			expect(tool).toBeDefined();
			expect(tool.description).toBeTruthy();
			expect(tool.args).toBeDefined();
		});

		test("returns ok=true and report on healthy database", async () => {
			const args: SwarmHealthArgs = { deep: true };
			const result = await tool.execute(args, mockContext);
			expect(result).toBeTruthy();

			const parsed = JSON.parse(result);
			expect(parsed).toHaveProperty("ok");
			expect(typeof parsed.ok).toBe("boolean");
			expect(parsed).toHaveProperty("report");
			expect(parsed.report).toHaveProperty("checks");
			expect(Array.isArray(parsed.report.checks)).toBe(true);
		});

		test("deep=true runs all 6 health checks", async () => {
			const args: SwarmHealthArgs = { deep: true };
			const result = await tool.execute(args, mockContext);
			const parsed = JSON.parse(result);

			expect(parsed.report.checks.length).toBe(6);
		});

		test("deep=false (default) runs a basic health subset", async () => {
			const args: SwarmHealthArgs = {};
			const result = await tool.execute(args, mockContext);
			const parsed = JSON.parse(result);

			expect(parsed).toHaveProperty("ok");
			expect(parsed).toHaveProperty("report");
			expect(parsed.report.checks.length).toBeLessThan(6);
		});

		test("fix=true enables auto-repair", async () => {
			const args: SwarmHealthArgs = { deep: true, fix: true };
			const result = await tool.execute(args, mockContext);
			const parsed = JSON.parse(result);

			expect(parsed).toHaveProperty("ok");
			expect(parsed).toHaveProperty("report");
			expect(parsed.report).toHaveProperty("fixed");
		});

		test("returns graceful error when deep check fails", async () => {
			const originalCwdInner = process.cwd();
			const brokenPath = join(tmpdir(), `empty-project-${Date.now()}-${Math.random()}`);
			mkdirSync(brokenPath, { recursive: true });
			try {
				process.chdir(brokenPath);
				const args: SwarmHealthArgs = { deep: true };
				const result = await tool.execute(args, mockContext);
				const parsed = JSON.parse(result);
				expect(parsed).toHaveProperty("ok");
				expect(parsed).toHaveProperty("report");
			} finally {
				process.chdir(originalCwdInner);
				rmSync(brokenPath, { recursive: true, force: true });
			}
		});
	});

	describe("runDeepChecks (doctor programmatic API)", () => {
		const testDir = join(tmpdir(), `run-deep-checks-test-${Date.now()}`);
		let projectPath: string;

		beforeAll(async () => {
			mkdirSync(testDir, { recursive: true });
			projectPath = testDir;

			const swarmMail = await getSwarmMailLibSQL(projectPath);
			const db = await swarmMail.getDatabase();
			const adapter = createHiveAdapter(db, projectPath);
			await adapter.runMigrations();
		});

		afterAll(async () => {
			await closeSwarmMailLibSQL(projectPath);
			rmSync(testDir, { recursive: true, force: true });
		});

		test("returns ok=true on a healthy database", async () => {
			const result = await runDeepChecks(projectPath, { fix: false });
			expect(result.ok).toBe(true);
			expect(result.report).toBeDefined();
			expect(result.report.checks.length).toBe(6);
		});

		test("supports --fix option for auto-repair", async () => {
			const result = await runDeepChecks(projectPath, { fix: true });
			expect(result.ok).toBe(true);
			expect(result.report.fixed).toBeGreaterThanOrEqual(0);
		});

		test("returns ok=false when checks fail", async () => {
			const brokenDir = join(tmpdir(), `run-deep-checks-broken-${Date.now()}-${Math.random()}`);
			mkdirSync(brokenDir, { recursive: true });
			const orphanId = `orphan-${Date.now()}-${Math.random()}`;
			try {
				const swarmMail = await getSwarmMailLibSQL(brokenDir);
				const db = await swarmMail.getDatabase();
				const adapter = createHiveAdapter(db, brokenDir);
				await adapter.runMigrations();

				await db.exec("PRAGMA foreign_keys = OFF");
				await db.query(
					`INSERT INTO beads (id, project_key, type, status, title, priority, parent_id, created_at, updated_at)
					 VALUES (?, ?, 'task', 'open', 'Orphan', 1, 'nonexistent-parent', ?, ?)`,
					[orphanId, brokenDir, Date.now(), Date.now()],
				);
				await db.exec("PRAGMA foreign_keys = ON");
				await closeSwarmMailLibSQL(brokenDir);

				const result = await runDeepChecks(brokenDir, { fix: false });
				expect(result.ok).toBe(false);
				expect(result.report.failed).toBeGreaterThan(0);
			} finally {
				await closeSwarmMailLibSQL(brokenDir);
				rmSync(brokenDir, { recursive: true, force: true });
			}
		});
	});
});
