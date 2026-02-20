# agentpatch

`agentpatch` is a tiny toolkit + conventions for applying AI-generated patches safely and repeatably.

## `bin/apply_patch`

A robust patch applier that supports a simplified, explicit patch grammar:

- `*** Begin Patch` / `*** End Patch`
- `*** Update File: path`
- `*** Add File: path`
- `*** Delete File: path` (requires `--allow-delete`)
- `*** Rename File: old -> new` (requires `--allow-rename`)
- `@@ ... @@` hunks containing lines prefixed with:
  - `-` remove
  - `+` add
  - ` ` context

### Anchors

Inside the `@@ ... @@` header you can include anchor directives:

- `@@ at:top @@`
- `@@ at:bottom @@`
- `@@ before:/regex/ @@`
- `@@ after:/regex/ @@`

If a `-` block can’t be found, anchors provide a deterministic insertion location.

### Idempotence

If the `+` block already exists (exact or whitespace-insensitive match), the hunk is treated as already applied.

### Usage

bin/apply_patch --verbose <<'PATCH'
bin/apply_patch --verbose --max-backups=5 <<'PATCH'

```bash
bin/apply_patch --verbose <<'PATCH'
*** Begin Patch
*** Add File: hello.txt
+hello\n
*** End Patch
PATCH
```

### Options

- `--verbose` / `-v` — Enable debug output
- `--dry-run` — Preview changes without writing files
- `--allow-delete` — Allow `*** Delete File` operations
- `--allow-rename` — Allow `*** Rename File` operations
- `--max-backups=N` — Keep at most N timestamped backups per file (default: unlimited)

Backups are created as `<file>.bak.<timestamp>` before any modification. With `--max-backups`, old backups are pruned after each operation to maintain the limit.
## License

MIT


## Tests

Run a small gauntlet against `bin/apply_patch`:

```bash
node tests/run-tests.mjs

# or point at a different apply_patch implementation
APPLY_PATCH=/path/to/bin/apply_patch node tests/run-tests.mjs
```
