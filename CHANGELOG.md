# Changelog

All notable changes to agentpatch are documented here.

## [Unreleased]

### Added
- `--version` / `-V` flag: prints `apply_patch 0.1.0` and exits

## [0.1.0] — initial release

### Added
- Core patch grammar: `*** Begin Patch` / `*** End Patch` envelope
- `*** Update File`, `*** Add File`, `*** Delete File`, `*** Rename File` operations
- Anchor directives: `at:top`, `at:bottom`, `before:/regex/`, `after:/regex/`
- Fuzzy whitespace matching for hunks
- Idempotent apply (re-applying a patch is a no-op)
- `--allow-delete` / `--allow-rename` safety flags
- `--dry-run`: validate patch without writing files
- `--max-backups=N`: limit backup file count (0 = no backups)
- `--json`: structured JSON output for programmatic use
- `--verbose`: debug logging
- Code fence stripping (accepts patches wrapped in triple-backtick blocks)
- Windows line ending normalisation
- Atomic apply via temp-file + rename
- Nested directory creation on `Add File`
