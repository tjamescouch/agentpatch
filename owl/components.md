# components

## patch grammar

The patch format uses explicit markers rather than line-number-based hunks:

```
*** Begin Patch
*** Update File: path/to/file.ts
@@ ... @@
- old line
+ new line
  context line
*** Add File: path/to/new.ts
+content
*** Delete File: path/to/old.ts
*** Rename File: old.ts -> new.ts
*** End Patch
```

Anchor directives in `@@ @@` headers:
- `@@ at:top @@` — insert at file start
- `@@ at:bottom @@` — insert at file end
- `@@ before:/pattern/ @@` — insert before matching line
- `@@ after:/pattern/ @@` — insert after matching line

## apply_patch (src/apply_patch.ts)

Single-file implementation (~390 lines TypeScript). Phases:

1. **Parse**: Split input into ops. Each op is one of: add, update, delete, rename
2. **Validate**: Check file existence, flag requirements (--allow-delete, --allow-rename)
3. **Apply**: For each hunk in an update op:
   - Find the `-` block in the file (sliding window match)
   - If found, replace with `+` block
   - If not found, try anchor fallback
   - If `+` block already present, skip (idempotent)
4. **Write**: Commit changes to filesystem (unless --dry-run)

## test harness (tests/run-tests.mjs)

Shell-based test runner. Creates temp dirs, writes fixture files, applies patches, asserts results. Covers:
- Add/update/delete/rename ops
- Anchor directives
- Idempotence detection
- Error cases (missing files, disallowed ops)
