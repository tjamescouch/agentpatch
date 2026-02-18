# agentpatch

Safe, idempotent patch application for AI-generated code changes.

## Purpose

Apply structured patches to files deterministically. The patch grammar is purpose-built for LLM output — simpler than unified diff, explicit about intent, and designed to fail loudly rather than silently produce wrong results.

## Core properties

- **Deterministic**: Same patch + same file state = same result, always
- **Idempotent**: Re-applying a patch that's already applied is a no-op
- **Fail-safe**: Delete and rename require explicit opt-in flags. Ambiguous matches abort rather than guess
- **Dependency-free**: Node.js stdlib only, no runtime dependencies

## Patch grammar

```
*** Begin Patch
*** Update File: path/to/file.ts
@@ [anchor] @@
- old line
+ new line
  context line
*** Add File: path/to/new.ts
+content lines
*** Delete File: path/to/old.ts
*** Rename File: old.ts -> new.ts
*** End Patch
```

### Anchors (fallback positioning)

When `-` lines can't be found via exact or fuzzy match, anchors provide deterministic insertion:

- `@@ at:top @@` — insert at file start (after any shebang/pragma)
- `@@ at:bottom @@` — insert at file end
- `@@ before:/regex/ @@` — insert before first line matching pattern
- `@@ after:/regex/ @@` — insert after first line matching pattern

### Matching strategy

1. Try exact match of `-` block against file contents
2. Try fuzzy match (whitespace-normalized)
3. Fall back to anchor directive
4. If all fail, abort the entire patch

## Usage

CLI tool reading from stdin:

```bash
cat patch.txt | bin/apply_patch [--dry-run] [--verbose] [--allow-delete] [--allow-rename]
```

Also embedded as a tool in the gro agent runtime (`apply_patch` tool).

## Non-goals

- Not a general-purpose diff tool
- No merge conflict resolution — patches apply cleanly or fail
- No interactive mode
- No network, no config files, no state between runs
