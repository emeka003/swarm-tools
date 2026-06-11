import { describe, test, expect } from "bun:test";
import { assessTaskRisk } from "./risk-assessment";

describe("assessTaskRisk", () => {
  test("returns low risk for simple documentation task", () => {
    const result = assessTaskRisk({
      title: "Update README",
      description: "Add new section to docs",
      files: ["README.md", "CONTRIBUTING.md"],
    });

    expect(result.risk_level).toBe("low");
    expect(result.risk_score).toBeLessThan(20);
    expect(result.recommended_model).toBe("lite");
  });

  test("returns high risk for security-critical file changes", () => {
    const result = assessTaskRisk({
      title: "Fix auth middleware",
      description: "Update token validation logic",
      files: ["src/auth/login.ts", "src/middleware.ts"],
    });

    expect(result.risk_level).toBe("high");
    expect(result.risk_score).toBeGreaterThanOrEqual(30);
    expect(result.recommended_model).toBe("strong");
    expect(result.factors.some((f) => f.includes("Security-critical"))).toBe(true);
  });

  test("returns critical risk when historical failure rate is high", () => {
    const result = assessTaskRisk({
      title: "Critical security fix for auth token",
      description: "Fix vulnerability in token migration",
      files: ["src/db/index.ts", "src/db/queries.ts", "src/auth.ts", "src/security.ts", "src/token.ts", "src/crypto.ts"],
      dependencies: ["auth-service", "user-service", "payment-service", "notification-service"],
      history: { success_count: 5, failure_count: 15 },
    });

    expect(result.risk_level).toBe("critical");
    expect(result.risk_score).toBeGreaterThanOrEqual(70);
    expect(result.recommended_model).toBe("strong");
    expect(result.factors.some((f) => f.includes("failure rate"))).toBe(true);
  });

  test("factors are correctly accumulated", () => {
    const result = assessTaskRisk({
      title: "Critical security fix for auth token",
      description: "Fix vulnerability in token validation",
      files: ["src/auth/token.ts", "src/security/crypto.ts", "src/auth/middleware.ts", "src/auth/session.ts", "src/auth/oauth.ts"],
      dependencies: ["dep1", "dep2", "dep3", "dep4"],
      history: { success_count: 10, failure_count: 5 },
    });

    expect(result.factors.length).toBeGreaterThanOrEqual(3);
    expect(result.risk_score).toBeGreaterThanOrEqual(50);
  });

  test("recommended model matches risk level", () => {
    const lowRisk = assessTaskRisk({
      title: "Update changelog",
      description: "Add entry for v2.0",
      files: ["CHANGELOG.md"],
    });
    expect(lowRisk.recommended_model).toBe("lite");

    const highRisk = assessTaskRisk({
      title: "Fix security vulnerability in auth",
      description: "Patch critical bug",
      files: ["src/auth.ts", "src/security.ts", "src/crypto.ts"],
    });
    expect(highRisk.recommended_model).toBe("strong");
  });

  test("handles empty files array", () => {
    const result = assessTaskRisk({
      title: "Research task",
      description: "Investigate options",
      files: [],
    });

    expect(result.risk_level).toBe("low");
    expect(result.risk_score).toBe(0);
  });

  test("handles missing optional parameters", () => {
    const result = assessTaskRisk({
      title: "Simple task",
      description: "Do something",
      files: ["src/simple.ts"],
    });

    expect(result).toHaveProperty("risk_score");
    expect(result).toHaveProperty("risk_level");
    expect(result).toHaveProperty("factors");
    expect(result).toHaveProperty("recommended_model");
  });

  test("file count over 5 increases risk", () => {
    const fewFiles = assessTaskRisk({
      title: "Update feature",
      description: "Modify feature",
      files: ["a.ts", "b.ts", "c.ts"],
    });

    const manyFiles = assessTaskRisk({
      title: "Update feature",
      description: "Modify feature",
      files: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"],
    });

    expect(manyFiles.risk_score).toBeGreaterThan(fewFiles.risk_score);
  });

  test("risk keywords increase score", () => {
    const withKeywords = assessTaskRisk({
      title: "Fix critical security vulnerability",
      description: "Bug fix for urgent migration",
      files: ["src/app.ts"],
    });

    const withoutKeywords = assessTaskRisk({
      title: "Add new feature",
      description: "Implement user story",
      files: ["src/app.ts"],
    });

    expect(withKeywords.risk_score).toBeGreaterThan(withoutKeywords.risk_score);
  });
});
