import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { PDFParse } from "pdf-parse";
import type { Analysis, Farm, Recommendation, Sector } from "@workspace/db";
import { generatePdf, generateDocx, pdfSafe, type ReportData } from "./reportGen";

const now = new Date("2026-01-15T10:00:00Z");

const farm: Farm = {
  id: 1,
  ownerId: 1,
  name: "Finca La Vega",
  companyName: "Plátanos del Norte SL",
  cif: null,
  island: "Tenerife",
  municipality: "Los Silos",
  latitude: null,
  longitude: null,
  altitudeM: 120,
  surfaceHa: 3.5,
  mainCrop: "platanera",
  variety: "Pequeña Enana",
  plantCount: 6000,
  phenologicalStage: "parición",
  cropSystem: "aire libre",
  soilType: "sorriba",
  hasDrainage: true,
  foliarAllowed: true,
  hasDesalinatedWater: false,
  desalinatedWaterPct: null,
  weeklyLitresPerPlant: 80,
  maxEcDsM: 2.2,
  managementNotes: null,
  responsibleTechnician: "María Pérez",
  createdAt: now,
  updatedAt: now,
};

const sectors: Sector[] = [
  {
    id: 1,
    farmId: 1,
    name: "Sector A",
    plantCount: 3500,
    surfaceHa: 2,
    weeklyLitresPerPlant: 80,
    phenologicalStage: "parición",
    notes: null,
    createdAt: now,
  },
  {
    id: 2,
    farmId: 1,
    name: "Sector B",
    plantCount: 2500,
    surfaceHa: 1.5,
    weeklyLitresPerPlant: 75,
    phenologicalStage: null,
    notes: null,
    createdAt: now,
  },
];

function analysis(id: number, type: string, params: Analysis["parameters"]): Analysis {
  return {
    id,
    farmId: 1,
    sectorId: 1,
    type,
    reference: `REF-${id}`,
    laboratory: "Laboratorio Insular",
    description: null,
    sampleDate: "2026-01-10",
    parameters: params,
    notes: "Muestra tomada tras riego.",
    createdBy: 1,
    createdAt: now,
  };
}

const soil = analysis(10, "soil", [
  { name: "pH", value: 7.8, unit: null, refLow: 6.5, refHigh: 7.5, status: "alto" },
  { name: "Materia orgánica", value: 2.1, unit: "%", refLow: 2, refHigh: 4, status: "normal" },
  { name: "Potasio (K)", value: 0.4, unit: "meq/100g", refLow: 0.6, refHigh: 1.2, status: "bajo" },
]);
const leaf = analysis(11, "leaf", [
  { name: "N total", value: 2.4, unit: "%", refLow: 2.6, refHigh: 3.2, status: "bajo" },
  { name: "Zn", value: 14, unit: "µg/g", refLow: 18, refHigh: 50, status: "muy_bajo" },
]);
const water = analysis(12, "water", [
  { name: "CE", value: 1.1, unit: "dS/m", refLow: null, refHigh: 1.5, status: "normal" },
  { name: "Boro", value: 0.6, unit: "mg/L", refLow: null, refHigh: 0.5, status: "alto" },
]);

const recommendation: Recommendation = {
  id: 5,
  farmId: 1,
  sectorId: 1,
  title: "Programa semanal enero",
  status: "validated",
  source: "ai",
  items: [
    { fertilizerName: "Nitrato potásico", weeklyDose: 25, unit: "kg", reason: "K bajo en suelo" },
    { fertilizerName: "Sulfato de magnesio", weeklyDose: 10, unit: "kg", reason: null },
  ],
  rationale: "Se refuerza el potasio por deficiencia en suelo y foliar.",
  estimatedEcDsM: 1.8,
  estimatedWeeklyNKg: 12.5,
  warnings: ["No mezclar nitrato cálcico con sulfatos en el mismo tanque."],
  createdBy: 1,
  validatedBy: 2,
  reviewComment: null,
  createdAt: now,
  updatedAt: now,
};

const data: ReportData = {
  title: "Informe de fertirrigación — Finca La Vega",
  farm,
  sectors,
  soil,
  leaf,
  water,
  recommendation,
  authorName: "María Pérez",
  date: "15/01/2026",
};

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "reportgen-test-"));

async function extractPdf(buf: Buffer): Promise<{ text: string; pages: string[] }> {
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  const result = await parser.getText();
  return { text: result.text, pages: result.pages.map((p) => p.text) };
}

test("pdfSafe conserva la mu (µ) como micro sign de WinAnsi", () => {
  assert.equal(pdfSafe("14 \u00B5g/g"), "14 \u00B5g/g", "micro sign se conserva");
  assert.equal(pdfSafe("14 \u03BCg/g"), "14 \u00B5g/g", "mu griega se convierte a micro sign");
  assert.equal(pdfSafe("\u00B5S/cm"), "\u00B5S/cm");
});

test("pdfSafe normaliza guiones tipográficos y signo menos a guion ASCII", () => {
  assert.equal(pdfSafe("pH 6,5\u20137,5"), "pH 6,5-7,5", "en dash");
  assert.equal(pdfSafe("rango \u2014 amplio"), "rango - amplio", "em dash");
  assert.equal(pdfSafe("\u22120,5"), "-0,5", "signo menos Unicode");
  assert.equal(pdfSafe("\u2010\u2011\u2012\u2013\u2014\u2015"), "------", "toda la gama de guiones");
});

test("pdfSafe normaliza comillas tipográficas", () => {
  assert.equal(pdfSafe("\u2018foliar\u2019"), "'foliar'", "comillas simples curvas");
  assert.equal(pdfSafe("\u201Csorriba\u201D"), '"sorriba"', "comillas dobles curvas");
  assert.equal(pdfSafe("\u201Abaja\u201E"), "'baja\"", "comillas bajas");
});

test("pdfSafe convierte puntos suspensivos y espacios especiales", () => {
  assert.equal(pdfSafe("etc\u2026"), "etc...", "elipsis");
  assert.equal(pdfSafe("2,5\u00A0kg"), "2,5 kg", "espacio no separable");
  assert.equal(pdfSafe("a\u2009b\u200Ac\u200Bd"), "a b c d", "espacios finos y de ancho cero");
});

test("pdfSafe elimina caracteres fuera de Latin-1 sin romper el resto", () => {
  assert.equal(pdfSafe("K\u2082O"), "KO", "subíndice fuera de WinAnsi se elimina");
  assert.equal(pdfSafe("N \u2192 P"), "N  P", "flecha se elimina");
  assert.equal(pdfSafe("valor \u4E2D 12"), "valor  12", "CJK se elimina");
  assert.equal(pdfSafe("café con emoji \u{1F34C} ok"), "café con emoji  ok", "emoji se elimina");
});

test("pdfSafe conserva Latin-1 y las excepciones de WinAnsi (€, œ, š, ž)", () => {
  const latin = "Análisis: pH 7,8 ±0,1 — ñÑ çÇ áéíóú ºª ½ 25 kg";
  assert.equal(pdfSafe(latin), "Análisis: pH 7,8 ±0,1 - ñÑ çÇ áéíóú ºª ½ 25 kg");
  assert.equal(pdfSafe("coste 12\u20AC"), "coste 12\u20AC", "símbolo del euro se conserva");
  assert.equal(pdfSafe("\u0153uvre \u0161 \u017E \u0152 \u0160 \u0178 \u017D"), "\u0153uvre \u0161 \u017E \u0152 \u0160 \u0178 \u017D");
  assert.equal(pdfSafe(""), "", "cadena vacía");
});

test("pdfSafe con texto realista de laboratorio", () => {
  const raw = "Zn: 14 \u03BCg/g \u2013 \u201Cmuy bajo\u201D (ref. 18\u201350)\u2026";
  assert.equal(pdfSafe(raw), 'Zn: 14 \u00B5g/g - "muy bajo" (ref. 18-50)...');
});

test("generatePdf crea un PDF válido, no vacío y estructuralmente completo", async () => {
  const filePath = path.join(tmpDir, "informe.pdf");
  await generatePdf(data, filePath);
  assert.ok(fs.existsSync(filePath), "el archivo PDF debe existir");
  const buf = fs.readFileSync(filePath);
  assert.ok(buf.length > 1000, `el PDF debe tener contenido (tamaño: ${buf.length})`);
  assert.equal(buf.subarray(0, 5).toString("latin1"), "%PDF-", "cabecera PDF");
  const tail = buf.subarray(-64).toString("latin1").trimEnd();
  assert.ok(tail.endsWith("%%EOF"), "el PDF debe terminar con el marcador %%EOF");
});

test("generatePdf incluye título, secciones, tablas y pie con paginación", async () => {
  const filePath = path.join(tmpDir, "informe.pdf");
  await generatePdf(data, filePath);
  const { text, pages } = await extractPdf(fs.readFileSync(filePath));

  // Cabecera del informe
  assert.ok(text.includes("Informe de fertirrigación"), "incluye el título del informe");
  assert.ok(
    text.includes("AgroNutri AI — Informe técnico de fertirrigación"),
    "incluye el subtítulo de marca",
  );

  // Secciones y contenido de tablas
  assert.ok(text.includes("Datos de la explotación"), "incluye la sección de la finca");
  assert.ok(text.includes("Finca La Vega"), "incluye el nombre de la finca");
  assert.ok(text.includes("Analítica de agua de riego"), "incluye la sección de agua");
  assert.ok(text.includes("Analítica de suelo"), "incluye la sección de suelo");
  assert.ok(text.includes("Analítica foliar"), "incluye la sección foliar");
  assert.ok(text.includes("Materia orgánica"), "incluye filas de la tabla de suelo");
  assert.ok(
    text.includes("Programa semanal de fertirrigación recomendado"),
    "incluye la sección del programa",
  );
  assert.ok(text.includes("Nitrato potásico"), "incluye la tabla del programa");
  assert.ok(text.includes("Advertencias y compatibilidades"), "incluye las advertencias");
  assert.ok(text.includes("Seguimiento"), "incluye la sección de seguimiento");

  // Pie de página en cada página: finca, numeración y marca
  assert.ok(pages.length >= 1, "el PDF tiene al menos una página");
  pages.forEach((pageText, i) => {
    assert.ok(
      pageText.includes(`Página ${i + 1} de ${pages.length}`),
      `la página ${i + 1} incluye la numeración "Página ${i + 1} de ${pages.length}"`,
    );
    assert.ok(pageText.includes("AgroNutri AI"), `la página ${i + 1} incluye la marca en el pie`);
    assert.ok(pageText.includes("Finca La Vega"), `la página ${i + 1} incluye la finca en el pie`);
  });
});

test("generatePdf funciona con datos mínimos (sin analíticas ni recomendación)", async () => {
  const filePath = path.join(tmpDir, "informe-minimo.pdf");
  await generatePdf(
    { ...data, sectors: [], soil: null, leaf: null, water: null, recommendation: null },
    filePath,
  );
  const buf = fs.readFileSync(filePath);
  assert.ok(buf.length > 500, "el PDF mínimo debe tener contenido");
  assert.equal(buf.subarray(0, 5).toString("latin1"), "%PDF-");
  const { text } = await extractPdf(buf);
  assert.ok(text.includes("Sin analítica registrada"), "indica que no hay analíticas");
  assert.ok(text.includes("Seguimiento"), "incluye la sección de seguimiento");
});

test("generateDocx crea un DOCX válido con contenido y pie de página", async () => {
  const filePath = path.join(tmpDir, "informe.docx");
  await generateDocx(data, filePath);
  assert.ok(fs.existsSync(filePath), "el archivo DOCX debe existir");
  const buf = fs.readFileSync(filePath);
  assert.ok(buf.length > 1000, `el DOCX debe tener contenido (tamaño: ${buf.length})`);
  assert.equal(buf.subarray(0, 2).toString("latin1"), "PK", "cabecera ZIP de DOCX");

  const zip = await JSZip.loadAsync(buf);
  const docXml = await zip.file("word/document.xml")!.async("string");
  assert.ok(docXml.includes("Informe de fertirrigación"), "el documento incluye el título");
  assert.ok(docXml.includes("Nitrato potásico"), "el documento incluye la tabla del programa");
  assert.ok(docXml.includes("Analítica de suelo"), "el documento incluye las secciones de analíticas");

  const footerNames = Object.keys(zip.files).filter((f) => /^word\/footer\d+\.xml$/.test(f));
  assert.ok(footerNames.length > 0, "el DOCX debe incluir un pie de página");
  const footers = await Promise.all(footerNames.map((f) => zip.file(f)!.async("string")));
  const footerXml = footers.join("\n");
  assert.match(footerXml, /PAGE/, "el pie contiene el campo PAGE");
  assert.match(footerXml, /NUMPAGES/, "el pie contiene el campo NUMPAGES");
  assert.ok(footerXml.includes("AgroNutri AI"), 'el pie contiene la marca "AgroNutri AI"');
});
