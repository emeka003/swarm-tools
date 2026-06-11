export interface RiskAssessment {
  risk_score: number;
  risk_level: "low" | "medium" | "high" | "critical";
  factors: string[];
  recommended_model: "lite" | "primary" | "strong";
}

export function assessTaskRisk(params: {
  title: string;
  description: string;
  files: string[];
  dependencies?: string[];
  history?: { success_count: number; failure_count: number };
}): RiskAssessment {
  const factors: string[] = [];
  let score = 0;

  const securityFiles = params.files.filter((f) =>
    f.includes("auth") || f.includes("security") || f.includes("crypto") ||
    f.includes("token") || f.includes("password") || f.includes("key"),
  );
  if (securityFiles.length > 0) {
    score += 30;
    factors.push(`Security-critical files: ${securityFiles.join(", ")}`);
  }

  const riskKeywords = [
    "fix",
    "bug",
    "security",
    "vulnerability",
    "critical",
    "urgent",
    "migration",
    "breaking",
  ];
  const matchedKeywords = riskKeywords.filter((kw) =>
    params.title.toLowerCase().includes(kw) ||
    params.description.toLowerCase().includes(kw),
  );
  if (matchedKeywords.length > 0) {
    score += 20;
    factors.push(`Risk keywords: ${matchedKeywords.join(", ")}`);
  }

  const depCount = params.dependencies?.length ?? 0;
  if (depCount > 3) {
    score += 15;
    factors.push(`${depCount} dependencies (high coupling)`);
  }

  if (params.history && params.history.failure_count > 0) {
    const failRate =
      params.history.failure_count /
      (params.history.success_count + params.history.failure_count);
    if (failRate > 0.3) {
      score += 25;
      factors.push(`High failure rate: ${(failRate * 100).toFixed(0)}%`);
    }
  }

  if (params.files.length > 5) {
    score += 10;
    factors.push(`${params.files.length} files affected`);
  }

  let risk_level: RiskAssessment["risk_level"];
  let recommended_model: RiskAssessment["recommended_model"];

  if (score >= 70) {
    risk_level = "critical";
    recommended_model = "strong";
  } else if (score >= 40) {
    risk_level = "high";
    recommended_model = "strong";
  } else if (score >= 20) {
    risk_level = "medium";
    recommended_model = "primary";
  } else {
    risk_level = "low";
    recommended_model = "lite";
  }

  return { risk_score: score, risk_level, factors, recommended_model };
}
