---
name: testing-patterns
description: How to discover test commands, run targeted tests, handle mocks, and cover edge cases
---

# Testing Patterns

## Discovering Test Commands

Check package.json for test scripts:
- `bun test` - Run all tests
- `bun test src/specific.test.ts` - Run specific test file
- `bun test --timeout 10000 src/` - Run with timeout

## Running Targeted Tests

After modifying a file, run tests for that file:
- `cd packages/opencode-swarm-plugin && bun test --timeout 10000 src/{modified-file}.test.ts`
- `cd packages/swarm-mail && bun test --timeout 60000 src/{modified-file}.test.ts`

## Test Structure

Use `describe` blocks for grouping:
```typescript
describe("feature name", () => {
  test("does specific thing", async () => {
    // Arrange
    // Act
    // Assert
  });
});
```

## Edge Cases to Cover

- Empty inputs
- Null/undefined values
- Error paths (try/catch)
- Boundary values
- Concurrent access (if applicable)

## Mocking

Use `bun:test` mock utilities:
- `mock()` for function mocks
- `spyOn()` for spying on calls
- Restore mocks in `afterEach`
