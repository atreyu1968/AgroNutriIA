---
name: pdfkit footers in bottom margin
description: How to add per-page footers with pdfkit without spawning blank pages
---
Rule: when writing footer text inside the bottom margin during a `bufferedPageRange()` loop, temporarily set `doc.page.margins.bottom = 0` (and restore after), even with `lineBreak: false`.

**Why:** pdfkit auto-adds a page whenever text is placed below `page.maxY()`; each footer text call otherwise silently appends a blank page (a 4-page report became 16 pages).

**How to apply:** any pdfkit footer/header overlay drawn after content, e.g. the PDF report footer in the API server's report generator.
