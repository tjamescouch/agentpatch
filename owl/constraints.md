# Constraints

## Correctness

- **Atomic**: A patch either applies completely or fails entirely — no partial writes on update failure
- **Idempotent**: `apply(apply(file, patch), patch) === apply(file, patch)` — checked via `containsBlock` before each hunk
- **Exact-first matching**: Fuzzy match (whitespace normalization) is only tried after exact match fails. Anchors are last resort
- **Loud failure**: Unmatched hunks with no anchor write to stderr and exit non-zero. Silent corruption is the worst outcome

## Safety

- **Delete/rename gated**: Require explicit `--allow-delete` / `--allow-rename` flags. Default behavior refuses these ops
- **Backup before write**: Every modified file gets a `.bak` copy before changes are committed
- **No recursive operations**: Each op targets exactly one file path. No globs, no directory operations
- **Dry-run support**: `--dry-run` validates and reports without touching the filesystem

## Environment

- **Node.js 18+** required (ES modules, node:fs, node:path)
- **Zero dependencies**: Only Node.js stdlib. No npm packages at runtime
- **Stdin-only input**: No file arguments, no network, no config. Patch comes in through stdin pipe
- **Deterministic output**: Same input + same filesystem state = same result. No randomness, no timestamps, no ambient state

## Grammar

- Patch format is intentionally simpler than unified diff — no line numbers, no `---`/`+++` headers
- Context lines (` ` prefix) are optional but improve match reliability
- The `+` prefix on Add File content is auto-detected by heuristic (>60% threshold), so both prefixed and raw content work
- Code fences are stripped automatically — patches can be wrapped in markdown without breaking
