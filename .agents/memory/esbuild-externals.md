---
name: esbuild externals for pdfkit
description: pdfkit/fontkit break when bundled by esbuild in the api-server build
---
Bundling pdfkit pulls in fontkit → brotli, which requires `@swc/helpers/cjs/_define_property.cjs` at runtime and fails with MODULE_NOT_FOUND. **How to apply:** add `"pdfkit", "fontkit"` to the `external` array in `artifacts/api-server/build.mjs` (they load fine from node_modules at runtime).

Also applies to `pdf-parse` v2 (bundles pdfjs-dist which needs DOMMatrix/@napi-rs/canvas at runtime): keep `"pdf-parse", "@napi-rs/canvas"` in the `external` array too.
