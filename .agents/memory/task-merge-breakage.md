---
name: Task-merge auto-resolution can commit broken code
description: What to do when the platform merges task-agent branches into main and the app stops building
---

Platform merges of task-agent branches can auto-resolve conflicts badly: fragments of one route spliced into another, deleted statements (e.g. a DB insert), `const` reassignments. The merge commit itself contains the breakage, so the working tree is "clean" while the build fails.

**Why:** Seen when several tasks touched the same large route file; the merged commits were mangled and the API server workflow failed at esbuild, breaking login for the user.

**How to apply:** After any task merge, restart the affected workflows and check logs before assuming health. To repair, diff against `gitsafe-backup/main` (pre-merge state) and the individual pre-merge task commits (they exist in `git log --all`) to reconstruct each side's intent, then re-apply cleanly by hand. Don't trust the merged version of conflicted regions.
