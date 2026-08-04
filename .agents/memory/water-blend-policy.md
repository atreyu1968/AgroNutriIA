---
name: Water blend safety policy
description: How the blended water analysis must treat missing parameters/analyses
---

Rule: in the water-source blend, never renormalize a parameter over the subset of sources that report it — a parameter missing in any source has an unknown blended value and must be omitted with a note. A source with share > 0 but no analysis makes the blend incomplete: blend the remaining sources but emit an explicit "mezcla incompleta / valores orientativos" warning that propagates into calculations, AI context, and reports.

**Why:** Per-parameter renormalization overstates nutrients (60% source at 100 mg/L + 40% source without the parameter would report 100 instead of unknown). Code review rejected the renormalizing version as scientifically wrong/unsafe.

**How to apply:** Any change to `blendedWaterAnalysis` (api-server farmContext) or new consumers of the blend must keep the omit-with-note behavior and surface `notes` as warnings.
