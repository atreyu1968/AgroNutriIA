---
name: Task-merge auto-resolution can commit broken code
description: Verify builds after task merges; don't trust auto-merged conflict regions
---
Automatic merges of task branches into main can auto-resolve conflicts in large shared files badly — the merge commit itself contains breakage while the tree looks clean.

**Why:** semantic auto-resolution can splice fragments of one function into another when several tasks touch the same file.

**How to apply:** after any task merge, run typecheck/build (and restart affected workflows) before assuming health. To repair, reconstruct each side's intent from the pre-merge commits in `git log --all` instead of trusting the merged version of conflicted regions.

**Rebase conflict tips:** during a task rebase, the conflict labels are swapped ("ours" = main, "theirs" = your replayed commit). For conflicts in the OpenAPI spec, hand-merge only `openapi.yaml`, then `git checkout` one side of the generated clients and run `pnpm run codegen` in the spec package — never hand-merge generated client files. Also inspect non-conflicted but auto-merged hot files (typecheck them): the platform pre-merge can mangle them even without markers; repair by taking main's version and re-applying `git diff REBASE_HEAD^ REBASE_HEAD -- <file>` with `git apply --3way`.

**No-clean-copy corollary:** sometimes the mangled fragments exist in *every* git ref (the task branch carried them too), so there is no clean version to check out. Reconstruct by diffing against the last healthy main and re-deriving each handler's intent from the task's own tests and commit message, then re-apply minimal fixes by hand.

**Rebase corollary:** if your commits carry a hand-repaired copy of a hot shared file, every rebase onto a newer main replays the old repair and can re-corrupt it. Once main's version becomes healthy again, drop your copy: adopt main's file wholesale and re-apply only your minimal deltas (e.g. missing permission checks).
