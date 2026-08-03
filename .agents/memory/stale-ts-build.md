---
name: Stale TS project-reference builds
description: Phantom "property does not exist" errors after merges/rebases come from stale lib dist .d.ts
---

Workspace libs (e.g. the generated API client) are consumed via TS project references, so `tsc --noEmit` in an artifact reads the lib's built `dist/*.d.ts`, not `src`.

**Why:** After a rebase/merge updates a lib's generated source, the artifact typecheck can report properties "missing" that clearly exist in `src` — the dist declarations are stale.

**How to apply:** Rebuild with `pnpm exec tsc -b lib/<pkg>` from the workspace root before trusting artifact typecheck failures that point at workspace-lib types.
