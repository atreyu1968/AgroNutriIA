---
name: Reports must use persisted snapshots
description: PDF/DOCX reports should render data snapshotted on the program, not recompute from current farm state.
---

Rule: when a recommendation/program persists a computed snapshot (e.g. `stage_comparison` jsonb on `recommendations`), report generation must render that snapshot instead of re-running the engine against the current farm/fertilizer state.

**Why:** re-running the engine at report time shows different ranges/provenance if the technician later changes the farm's phase or modulated ranges, and loses sector-specific phases. Old rows without a snapshot simply omit the section. Also: every path that computes such a snapshot (manual create, PATCH, AI draft) must pass the program's sector to the engine — sector phenological stage overrides the farm's.

**How to apply:** any new derived field shown in reports should be persisted with the program at create/update time (computeEstimates in the recommendations routes) and read back verbatim in reports.ts; add a regression test that mutates the farm after creation and checks the PDF keeps the snapshot.
