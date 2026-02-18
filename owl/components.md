# Components

## apply_patch.ts (~390 LOC)

Single-file implementation. All logic in one module, no internal abstractions beyond types.

### Types

- **Op**: Union type — `add | update | delete | rename`. Each carries the file path and operation-specific data
- **Hunk**: `{ minus: string[], plus: string[], anchor: Anchor }` — one edit within an update op
- **Anchor**: Positioning directive — `top | bottom | before(pattern) | after(pattern) | none`

### Phases

1. **Stdin read** — Consumes entire patch from stdin as a string
2. **Parse** (`parseOps`) — Splits patch text into Op array. Handles:
   - `*** Begin/End Patch` envelope stripping
   - Code fence removal (for patches wrapped in markdown)
   - `+` prefix detection on Add File content (heuristic: >60% lines start with `+`)
3. **Apply** — Per-op dispatch:
   - **Add**: Write file, creating directories as needed
   - **Update**: For each hunk, find `-` block → replace with `+` block. Fallback chain: exact → fuzzy → anchor → abort
   - **Delete**: Remove file (requires `--allow-delete`)
   - **Rename**: Move file (requires `--allow-rename`)
4. **Write** — Commit to filesystem. Backups created as `.bak` before overwriting.

### Key functions

| Function | Purpose |
|----------|---------|
| `findExact` | Sliding window exact match of `-` lines in file |
| `findFuzzy` | Same but whitespace-normalized (`norm()`) |
| `containsBlock` | Idempotence check — are `+` lines already present? |
| `findAnchorIndex` | Resolve anchor directive to line number |
| `insertTopStrategy` | Smart top-of-file insertion (skips shebangs, pragmas) |
| `backup` | Create `.bak` copy before modifying |

## CLI (bin/apply_patch)

Thin wrapper — compiled `dist/apply_patch.js` invoked via `node`. Flags parsed in `main()`.

## Test harness (tests/run-tests.mjs)

Node.js script creating temp directories, writing fixtures, piping patches through the CLI, and asserting results. Coverage:
- All four op types
- Anchor directives (all four kinds)
- Idempotence (double-apply)
- Error cases (missing files, disallowed delete/rename)
- Fuzzy matching
