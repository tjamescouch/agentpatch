# agentpatch

Safe, idempotent patch application for AI-generated code changes.

## purpose

- Apply structured patches to files deterministically — add, update, delete, rename
- Provide a grammar that LLMs can emit reliably (simpler than unified diff)
- Be idempotent: re-applying a patch that's already applied is a no-op
- Fail loudly on ambiguity rather than silently producing wrong output

## components

- **parser**: Reads `*** Begin Patch` / `*** End Patch` blocks, extracts ops (add/update/delete/rename) and hunks
- **applier**: Matches `-` lines in the working file, replaces with `+` lines. Falls back to anchors (`at:top`, `at:bottom`, `before:/regex/`, `after:/regex/`) when exact match fails
- **idempotence checker**: Detects when `+` lines already exist (exact or whitespace-insensitive) and skips
- **CLI**: Reads patch from stdin, writes to filesystem. Flags: `--allow-delete`, `--allow-rename`, `--verbose`, `--dry-run`

## non-goals

- Not a general-purpose diff/patch tool — purpose-built for AI agents
- No merge conflict resolution — patches either apply cleanly or fail
- No interactive mode — stdin in, filesystem out
