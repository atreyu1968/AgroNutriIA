---
name: Demo-mode limit tests
description: How to test DEMO_MODE limits against the shared dev DB
---
The demo limits (one farm, one report per type) count rows **globally**, by design (the demo instance has its own clean DB).

**Why:** tests run against the shared dev DB, which contains seeded "ready" fertirrigación reports — a naive test of "error reports don't count" gets 403 from seed data.

**How to apply:** put demo tests in their own test file (node --test runs each file in its own process, so `process.env.DEMO_MODE = "true"` at the top is isolated). Temporarily mark pre-existing non-error reports of the tested type as "error" in `before()` and restore their statuses in `after()`.
