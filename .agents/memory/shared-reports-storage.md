---
name: Shared reports storage across coop instances
description: storage/reports is one directory shared by every coop instance on a server; cleanup must be DB-scoped, never a directory sweep.
---

All cooperative instances provisioned on a server share the same APP_DIR and
systemd WorkingDirectory, so the api-server's `storage/reports` directory is
shared by every instance. Report filenames (`informe-<farmId>-<reportId>.<ext>`)
use per-database serial ids and can collide across instances.

**Why:** a directory sweep of "files not referenced by this instance's DB"
would destroy other cooperatives' reports, and even shared pathnames can be
referenced by two instances at once.

**How to apply:** each instance must get its own reports directory via the
`REPORTS_DIR` env var (the provisioner writes it per instance); filesystem
cleanups may only sweep an instance-exclusive directory, must skip with a
warning when the instance still uses the shared directory, and must abort
without deleting anything if the DB reference query fails.
