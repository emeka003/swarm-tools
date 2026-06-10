---
name: swarm-worker-guide
description: Reference guide for swarm worker agents - covers reservations, progress reporting, swarmmail, and completion protocol
---

# Swarm Worker Guide

## Reservations

Before editing files, reserve them with `swarmmail_reserve`:
- Always reserve files before modifying them
- Release reservations with `swarmmail_release` when done
- If reservation fails, notify coordinator - don't edit without reservation

## Progress Reporting

Report progress at key milestones:
- After understanding the task: 10%
- After first meaningful change: 25%
- At half completion: 50%
- When mostly done: 75%
- Use `swarm_progress` tool with status and message

## Swarmmail

Communicate with coordinator and siblings:
- Check inbox with `swarmmail_inbox` at start
- Send updates with `swarmmail_send` when blocked or completing
- Use thread IDs to group messages by task

## Completion Protocol

Before calling `swarm_complete`:
1. Run typecheck: `bun run typecheck`
2. Run tests: `bun test --timeout 10000 src/`
3. Fix any failures (up to 3 attempts)
4. Include verification results in completion summary
5. List all files touched
6. Provide self-evaluation
