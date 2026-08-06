import { PDFParse } from "pdf-parse";
import fs from "node:fs";
const buf = fs.readFileSync(process.argv[2]);
const parser = new PDFParse({ data: new Uint8Array(buf) });
const r = await parser.getText();
console.log("=== TEXT LENGTH:", (r.text??"").length, "===");
console.log((r.text??"").slice(0, 8000));
await parser.destroy().catch(()=>{});
