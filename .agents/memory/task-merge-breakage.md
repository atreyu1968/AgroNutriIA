---
name: Task-merge auto-resolution can commit broken code
description: Verify builds after task merges; don't trust auto-merged conflict regions
---
Automatic merges of task branches into main can auto-resolve conflicts in large shared files badly — the merge commit itself contains breakage while the tree looks clean.

**Why:** semantic auto-resolution can splice fragments of one function into another when several tasks touch the same file.

**How to apply:** after any task merge, run typecheck/build (and restart affected workflows) before assuming health. To repair, reconstruct each side's intent from the pre-merge commits in `git log --all` instead of trusting the merged version of conflicted regions.
