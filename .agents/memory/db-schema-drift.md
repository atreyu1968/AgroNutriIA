---
name: Dev DB schema drift
description: What "column ... does not exist" errors in dev usually mean
---
The dev Postgres database can drift behind the drizzle schema after merges that add columns.

**Why:** integration tests and the API hit the real dev DB; drift surfaces as pg error 42703 at runtime, not at build time.

**How to apply:** on "column ... does not exist" in dev, sync the schema (drizzle push in the db package) before debugging application code.
