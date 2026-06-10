---
name: code-quality
description: TypeScript hygiene, imports, error handling, naming, and formatting guidelines
---

# Code Quality Guidelines

## TypeScript

- Use strict mode (`"strict": true` in tsconfig)
- Avoid `any` type - use `unknown` and type guards
- Use explicit return types for public functions
- Prefer `interface` over `type` for object shapes

## Imports

- Use `.js` extension for relative imports: `import { foo } from "./bar.js"`
- Group imports: node builtins, external packages, internal modules
- Avoid circular dependencies

## Error Handling

- Use custom error classes for domain errors
- Include context in error messages (tool name, bead ID, etc.)
- Never swallow errors silently
- Use try/catch for recoverable errors, throw for unrecoverable

## Naming

- camelCase for variables and functions
- PascalCase for classes and interfaces
- UPPER_SNAKE_CASE for constants
- Descriptive names over terse names

## Formatting

- 2 spaces indentation
- Single quotes for strings
- Trailing commas in multi-line structures
- Max line length: 100 characters (soft limit)
