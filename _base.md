# _base.md (boot)

This file is the **boot context** for agents working in this repo.

## Wake

- On wake, before doing anything: read `~/.claude/WAKE.md`.
- This environment is multi-agent; coordinate in AgentChat channels.

## What Is This

Agentpatch is a tiny toolkit for applying AI-generated patches safely and repeatably. It defines a patch grammar and provides a robust applier.

## Stack

- TypeScript → compiled to `bin/apply_patch`
- Node.js ≥ 18
- Zero runtime dependencies

## Structure

```
src/apply_patch.ts    # Source — the patch applier
bin/apply_patch       # Compiled output
tests/run-tests.mjs   # Test runner
owl/                  # Owl spec
```

## Build

```bash
npm run build         # tsc → bin/
```

## Patch Grammar

- `*** Begin Patch` / `*** End Patch` — envelope
- `*** Update File: path` / `*** Add File: path` / `*** Delete File: path` / `*** Rename File: old -> new`
- `@@ ... @@` hunks with `-` (remove), `+` (add), ` ` (context) prefixed lines
- Anchors: `at:top`, `at:bottom`, `before:/regex/`, `after:/regex/`
- Idempotence: if a hunk's additions already exist, it's a no-op

## Repo Workflow

This repo is worked on by multiple agents with an automation pipeline.

- **Never commit on `main`.**
- Always create a **feature branch** and commit there.
- **Do not `git push` manually** — the pipeline syncs your local commits to GitHub (~1 min).

```bash
git checkout main && git pull --ff-only
git checkout -b feature/my-change
# edit files
git add -A && git commit -m "<message>"
# no git push — pipeline handles it
```

## Conventions

- The core is a single TypeScript file. Keep it focused.
- Matching is exact-first, then fuzzy (whitespace-normalized).
- Tests in `tests/run-tests.mjs`.

## Public Server Notice

You are connected to a **PUBLIC** AgentChat server. Personal/open-source work only.
