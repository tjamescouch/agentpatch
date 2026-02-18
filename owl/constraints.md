# constraints

## correctness

- A patch must either apply completely or fail entirely — no partial application
- Idempotence: applying the same patch twice produces the same result as applying it once
- Delete and rename ops are opt-in (require explicit flags) to prevent accidental damage

## compatibility

- Must work as both a CLI tool (stdin pipe) and as an imported module (gro embeds it as a tool)
- Node.js 18+ required
- No runtime dependencies — stdlib only

## grammar

- The patch format is intentionally simpler than unified diff
- Context lines (` ` prefix) are optional but improve matching reliability
- Anchors are a fallback, not a primary mechanism — exact match is always tried first
