/**
 * Shared test fixtures for swarm plugin tests
 *
 * Provides consistent test data across all test files.
 */

export const TEST_AGENT = "test-worker";
export const TEST_EPIC_ID = "test-epic-123";
export const TEST_BEAD_ID = "test-bead-456";
export const TEST_PROJECT_PATH = "/tmp/test-project";

export function createTestCell(overrides?: Partial<{ id: string; title: string; status: string }>) {
  return {
    id: TEST_BEAD_ID,
    title: "Test Task",
    status: "open",
    ...overrides,
  };
}
