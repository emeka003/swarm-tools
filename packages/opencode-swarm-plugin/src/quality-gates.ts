import { readFile } from "node:fs/promises";

export interface QualityGateResult {
  passed: boolean;
  checks: Array<{
    name: string;
    passed: boolean;
    message?: string;
    severity: "error" | "warning";
  }>;
}

export interface QualityGateConfig {
  enableBugScanner: boolean;
  maxWarnings: number;
}

const DEFAULT_CONFIG: QualityGateConfig = {
  enableBugScanner: false,
  maxWarnings: 10,
};

const TODO_FIXME_HACK_PATTERN = /\b(TODO|FIXME|HACK)\b/;
const CONSOLE_LOG_PATTERN = /\bconsole\.log\s*\(/;
const HARDCODED_SECRET_PATTERNS = [
  /password\s*[=:]\s*["'][^"']+["']/i,
  /secret\s*[=:]\s*["'][^"']+["']/i,
  /api[_-]?key\s*[=:]\s*["'][^"']+["']/i,
  /token\s*[=:]\s*["'][^"']+["']/i,
];
const EMPTY_CATCH_PATTERN = /catch\s*\([^)]*\)\s*\{\s*\}/s;
const EMPTY_CATCH_WITH_COMMENTS = /catch\s*\([^)]*\)\s*\{[\s\/\*]*\}/s;

async function scanFile(filePath: string): Promise<string> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

function detectTodoComments(content: string): string[] {
  const matches: string[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (TODO_FIXME_HACK_PATTERN.test(line)) {
      matches.push(`Line ${i + 1}: ${line.trim()}`);
    }
  }
  return matches;
}

function detectConsoleLog(content: string): string[] {
  const matches: string[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (CONSOLE_LOG_PATTERN.test(line)) {
      matches.push(`Line ${i + 1}: ${line.trim()}`);
    }
  }
  return matches;
}

function detectHardcodedSecrets(content: string): string[] {
  const matches: string[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of HARDCODED_SECRET_PATTERNS) {
      if (pattern.test(line)) {
        matches.push(`Line ${i + 1}: ${line.trim()}`);
        break;
      }
    }
  }
  return matches;
}

function detectEmptyCatchBlocks(content: string): string[] {
  const matches: string[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (EMPTY_CATCH_PATTERN.test(line) || EMPTY_CATCH_WITH_COMMENTS.test(line)) {
      matches.push(`Line ${i + 1}: ${line.trim()}`);
    }
  }
  return matches;
}

export async function runQualityGates(params: {
  files: string[];
  config?: Partial<QualityGateConfig>;
}): Promise<QualityGateResult> {
  const config = { ...DEFAULT_CONFIG, ...params.config };
  const checks: QualityGateResult["checks"] = [];

  if (!config.enableBugScanner) {
    return { passed: true, checks: [] };
  }

  const allContent = await Promise.all(
    params.files.map(async (file) => ({
      file,
      content: await scanFile(file),
    }))
  );

  const todoMatches: string[] = [];
  const consoleMatches: string[] = [];
  const secretMatches: string[] = [];
  const catchMatches: string[] = [];

  for (const { content } of allContent) {
    if (!content) continue;
    todoMatches.push(...detectTodoComments(content));
    consoleMatches.push(...detectConsoleLog(content));
    secretMatches.push(...detectHardcodedSecrets(content));
    catchMatches.push(...detectEmptyCatchBlocks(content));
  }

  checks.push({
    name: "no-todo-fixme-hack",
    passed: todoMatches.length === 0,
    message: todoMatches.length > 0 ? `Found ${todoMatches.length} TODO/FIXME/HACK:\n${todoMatches.slice(0, 5).join("\n")}` : undefined,
    severity: "warning",
  });

  checks.push({
    name: "no-console-log",
    passed: consoleMatches.length === 0,
    message: consoleMatches.length > 0 ? `Found ${consoleMatches.length} console.log:\n${consoleMatches.slice(0, 5).join("\n")}` : undefined,
    severity: "warning",
  });

  checks.push({
    name: "no-hardcoded-secrets",
    passed: secretMatches.length === 0,
    message: secretMatches.length > 0 ? `Found ${secretMatches.length} hardcoded secrets:\n${secretMatches.slice(0, 5).join("\n")}` : undefined,
    severity: "error",
  });

  checks.push({
    name: "error-handling-present",
    passed: catchMatches.length === 0,
    message: catchMatches.length > 0 ? `Found ${catchMatches.length} empty catch blocks:\n${catchMatches.slice(0, 5).join("\n")}` : undefined,
    severity: "error",
  });

  let totalWarnings = 0;
  for (const check of checks) {
    if (!check.passed && check.severity === "warning" && check.message) {
      const match = check.message.match(/^Found (\d+)/);
      if (match) {
        totalWarnings += parseInt(match[1], 10);
      }
    }
  }

  const hasError = checks.some((c) => !c.passed && c.severity === "error");

  return {
    passed: !hasError && totalWarnings <= config.maxWarnings,
    checks,
  };
}
