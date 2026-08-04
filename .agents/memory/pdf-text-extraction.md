---
name: PDF text extraction quirks
description: Testing PDF content generated with pdfkit and extracted with pdf-parse
---

- pdf-parse can return the micro sign as Greek μ (U+03BC) even when the PDF was written with µ (U+00B5). Tests asserting "µS/cm" in extracted text must match both: `/[\u00B5\u03BC]S\/cm/`.
- **Why:** Helvetica/WinAnsi round-trips glyphs, not codepoints; the extractor picks the Greek letter.
- **How to apply:** any assertion on extracted PDF text containing µ, and by extension other typographic characters normalized by pdfSafe.
