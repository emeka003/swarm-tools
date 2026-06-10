# Environment Variables

All environment variables follow the `SWARM_*` naming convention for consistency with the swarm-tools ecosystem.

**Migration note:** For backward compatibility, all variables fall back to their previous `OPENCODE_*` names during a transition period. Set the new `SWARM_*` versions and remove the old ones at your convenience.

---

## Rate Limiter (`src/rate-limiter.ts`)

| Variable | Default | Description |
|----------|---------|-------------|
| `SWARM_RATE_LIMIT_REDIS_URL` | `redis://localhost:6379` | Redis URL for distributed rate limiting |
| `SWARM_RATE_LIMIT_SQLITE_PATH` | `~/.config/opencode/rate-limits.db` | SQLite database path for local rate limiting |
| `SWARM_RATE_LIMIT_{ENDPOINT}_PER_MIN` | varies per endpoint | Per-minute rate limit override for a specific endpoint (e.g. `SWARM_RATE_LIMIT_SEND_PER_MIN`) |
| `SWARM_RATE_LIMIT_{ENDPOINT}_PER_HOUR` | varies per endpoint | Per-hour rate limit override for a specific endpoint (e.g. `SWARM_RATE_LIMIT_SEND_PER_HOUR`) |
| `SWARM_RATE_LIMIT_DISABLED` | `false` | Set to `"true"` to disable rate limiting entirely |

**Endpoints:** `send`, `reserve`, `release`, `ack`, `inbox`, `read_message`, `summarize_thread`, `search`

---

## Agent Mail (`src/agent-mail.ts`)

| Variable | Default | Description |
|----------|---------|-------------|
| `SWARM_AGENT_MAIL_MAX_RETRIES` | `3` | Max retry attempts for MCP calls |
| `SWARM_AGENT_MAIL_BASE_DELAY_MS` | `100` | Base delay (ms) for exponential backoff |
| `SWARM_AGENT_MAIL_MAX_DELAY_MS` | `5000` | Max delay (ms) cap for backoff |
| `SWARM_AGENT_MAIL_TIMEOUT_MS` | `10000` | Per-request timeout (ms) |
| `SWARM_AGENT_MAIL_AUTO_RESTART` | `"true"` | Set to `"false"` to disable auto-restart of Agent Mail server |

---

## Queue Tools (`src/queue-tools.ts`)

| Variable | Default | Description |
|----------|---------|-------------|
| `SWARM_REDIS_HOST` | `localhost` | Redis host for BullMQ job queue |
| `SWARM_REDIS_PORT` | `6379` | Redis port for BullMQ job queue |

---

## Logger (`src/logger.ts`)

| Variable | Default | Description |
|----------|---------|-------------|
| `SWARM_LOG_LEVEL` | `"info"` | Log level for Pino logger (`trace`, `debug`, `info`, `warn`, `error`, `fatal`) |
| `SWARM_LOG_FILE` | — | Set to `"1"` to write logs to `~/.config/swarm-tools/logs/swarm.log` |
| `SWARM_LOG_PRETTY` | — | Set to `"1"` for pretty-printed console output |

---

## Debug Logging (`src/error-enrichment.ts`, `src/hooks/*.ts`)

| Variable | Default | Description |
|----------|---------|-------------|
| `SWARM_DEBUG` | — | Comma-separated namespaces to enable debug logging (e.g. `swarm:*,swarm:coordinator`) |

Supported patterns:
- `swarm:*` — All swarm debug output
- `swarm:coordinator` — Coordinator decisions (spawn, review, approve/reject)
- `swarm:worker` — Worker progress, reservations, completions
- `swarm:hooks` — Hook dispatch logging
- `swarm:mail` — Inter-agent messaging

---

## General Swarm (`src/agent-mail.ts`)

| Variable | Default | Description |
|----------|---------|-------------|
| `SWARM_STATE_DIR` | `os.tmpdir()/swarm-sessions` | Directory for persisting session state across CLI invocations |

---

## Legacy Variables (deprecated, still supported)

| Legacy Variable | Replacement |
|-----------------|-------------|
| `OPENCODE_RATE_LIMIT_REDIS_URL` | `SWARM_RATE_LIMIT_REDIS_URL` |
| `OPENCODE_RATE_LIMIT_SQLITE_PATH` | `SWARM_RATE_LIMIT_SQLITE_PATH` |
| `OPENCODE_RATE_LIMIT_DISABLED` | `SWARM_RATE_LIMIT_DISABLED` |
| `OPENCODE_AGENT_MAIL_MAX_RETRIES` | `SWARM_AGENT_MAIL_MAX_RETRIES` |
| `OPENCODE_AGENT_MAIL_BASE_DELAY_MS` | `SWARM_AGENT_MAIL_BASE_DELAY_MS` |
| `OPENCODE_AGENT_MAIL_MAX_DELAY_MS` | `SWARM_AGENT_MAIL_MAX_DELAY_MS` |
| `OPENCODE_AGENT_MAIL_TIMEOUT_MS` | `SWARM_AGENT_MAIL_TIMEOUT_MS` |
| `OPENCODE_AGENT_MAIL_AUTO_RESTART` | `SWARM_AGENT_MAIL_AUTO_RESTART` |
| `REDIS_HOST` | `SWARM_REDIS_HOST` |
| `REDIS_PORT` | `SWARM_REDIS_PORT` |
| `LOG_LEVEL` | `SWARM_LOG_LEVEL` |
| `DEBUG` | `SWARM_DEBUG` |

---

## Migration Guide

1. Set the new `SWARM_*` variables alongside your existing ones
2. Test that everything works with the new names
3. Remove the old `OPENCODE_*` / `REDIS_*` / `LOG_LEVEL` / `DEBUG` variables
