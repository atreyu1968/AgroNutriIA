---
name: Pre-push data migrations
description: How to migrate data safely when deploys use drizzle push-force with no migration files
---
Deploys apply schema via `drizzle push-force` (no migration files). Data migrations run as SQL in deploy/update.sh and install.sh *before* the push.
**Why:** push drops removed columns immediately; on an old production DB the *new* destination table may not exist yet, so the migration SQL must `CREATE TABLE IF NOT EXISTS` (matching the drizzle schema exactly) before copying, or the data is lost. Guard everything on the old column's existence so it is idempotent.
**How to apply:** put the SQL in deploy/*.sql, invoke it in both update.sh and install.sh right before push-force, and add an api-server upgrade test that re-adds the legacy columns, runs the SQL file, and asserts the migrated rows (drop the columns again in `after`).
