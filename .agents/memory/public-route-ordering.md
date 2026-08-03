---
name: Public route ordering in Express routers
description: Root-level auth middleware in one sub-router leaks onto later routers
---

Rule: routers exposing public (no-session) endpoints must be registered before any sub-router
that applies auth middleware at its root with `router.use(requireAuth)`.

**Why:** sub-routers mounted without a path run their root-level middleware for every request
that reaches them — including requests destined for routes in later routers — so a public
endpoint registered afterwards returns 401/403 despite having no auth middleware of its own.

**How to apply:** register public routers immediately after the auth router; keep authenticated
routers below them.
