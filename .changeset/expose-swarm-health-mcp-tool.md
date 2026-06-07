---
"opencode-swarm-plugin": minor
---

## Expose `swarm_health` MCP Tool

Agents can now check swarm system health without shelling out to `swarm doctor --deep`. The new `swarm_health` tool wraps the existing doctor command and returns structured `{ ok, report }` data.

**What changed:**

- New `swarm_health` tool in `observability-tools.ts` with `deep` and `fix` args
- New `runDeepChecks(projectPath, options)` exported from `bin/commands/doctor.ts` — programmatic entry point that connects to the swarm DB, ensures hive schema, and returns the doctor report
- `doctorDeep` (CLI) refactored to use `runDeepChecks` so CLI and MCP share one code path
- 31 new tests covering happy path, deep vs basic modes, `--fix` auto-repair, graceful errors, and the `runDeepChecks` API

**Usage:**

```typescript
// From an agent
await swarm_health({ deep: true });           // runs all 6 checks
await swarm_health({ deep: true, fix: true }); // auto-repair fixable issues
await swarm_health({});                       // fast: db integrity + ghost workers
```

**Returns:**

```json
{
  "ok": true,
  "report": {
    "checks": [/* 6 CheckResult objects */],
    "passed": 6,
    "failed": 0,
    "warned": 0,
    "fixed": 0,
    "timestamp": "2026-06-07T..."
  }
}
```

**Backward compatible:** the `swarm doctor --deep` CLI command keeps working exactly as before.
