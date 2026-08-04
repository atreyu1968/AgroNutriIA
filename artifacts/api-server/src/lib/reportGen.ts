import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import {
  Document,
  Packer,
  Paragraph,
  HeadingLevel,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ShadingType,
  Footer,
  PageNumber,
  TabStopType,
  TabStopPosition,
  ImageRun,
} from "docx";
import type { Analysis, Farm, Recommendation, Sector } from "@workspace/db";
import { STAGE_RANGES_PROVENANCE } from "./engine";

// Directorio de informes. En producción cada instancia de cooperativa define
// REPORTS_DIR en su fichero de entorno (provision-coop.sh) apuntando a un
// subdirectorio propio: todas las instancias comparten APP_DIR y, sin esta
// separación, los nombres `informe-<farmId>-<reportId>` (ids serial por base
// de datos) podrían colisionar entre cooperativas. Además permite que el
// reinicio nocturno de la demo limpie su directorio sin tocar a nadie más.
export const REPORTS_DIR = process.env.REPORTS_DIR
  ? path.resolve(process.env.REPORTS_DIR)
  : path.resolve(process.cwd(), "storage", "reports");

// Logo AgroNutri (color). El bundle esbuild vive en dist/, así que se resuelve
// por ruta absoluta desde el cwd del artefacto (igual que storage/).
const LOGO_PATH = path.resolve(process.cwd(), "assets", "logo.png");
// Original 1745x435 px (≈ 4:1)
const LOGO_RATIO = 435 / 1745;

/**
 * Comprueba si el logo existe antes de generar el informe. Si falta, el
 * informe se genera sin logo y se deja constancia en los logs en lugar de
 * fallar con un ENOENT críptico y bloquear el informe.
 */
export function resolveLogo(logoPath: string = LOGO_PATH): string | null {
  if (fs.existsSync(logoPath)) return logoPath;
  console.warn(
    `[reportGen] Falta el logo en ${logoPath}: el informe se generará sin logo.`,
  );
  return null;
}

/** Aviso que se propaga al registro del informe cuando falta el logo. */
export function missingLogoWarning(logoPath: string = LOGO_PATH): string {
  return `El informe se generó sin el logotipo porque falta el archivo en ${path.relative(process.cwd(), logoPath)}. Restaura el logo en esa ruta para que aparezca en los próximos informes.`;
}

export type ReportData = {
  title: string;
  farm: Farm;
  sectors: Sector[];
  soil: Analysis | null;
  leaf: Analysis | null;
  water: Analysis | null;
  recommendation: Recommendation | null;
  authorName: string;
  date: string;
  /** Contraste del programa con los rangos por fase (orientativos o del técnico). */
  stageComparison?: import("./engine").StageComparison | null;
  technicianNotes?: string | null;
  phytoTreatments?: {
    applicationDate: string;
    productName: string;
    sectorName: string | null;
    safetyDays: number | null;
  }[];
  /** Informe de enmiendas: sustituye al programa de fertirrigación. */
  amendment?: {
    scenarioLabel: string;
    text: string;
    /** Avisos de la verificación de coherencia agronómica (visibles en el informe). */
    coherenceWarnings?: string[];
  } | null;
};

/** Fecha a partir de la cual se puede cosechar (aplicación + plazo de seguridad). */
function harvestFromDate(applicationDate: string, safetyDays: number | null): string {
  if (safetyDays == null) return "—";
  const d = new Date(`${applicationDate}T00:00:00Z`);
  if (isNaN(d.getTime())) return "—";
  d.setUTCDate(d.getUTCDate() + safetyDays);
  return d.toISOString().slice(0, 10).split("-").reverse().join("/");
}

type Section = { heading: string; paragraphs: string[]; table?: string[][] };

function analysisTable(a: Analysis): string[][] {
  return [
    ["Parámetro", "Valor", "Unidad", "Referencia", "Estado"],
    ...a.parameters.map((p) => [
      p.name,
      String(p.value),
      p.unit ?? "",
      p.refLow != null || p.refHigh != null ? `${p.refLow ?? "-"} – ${p.refHigh ?? "-"}` : "",
      p.status ?? "",
    ]),
  ];
}

function buildSections(d: ReportData): Section[] {
  const f = d.farm;
  const sections: Section[] = [];
  sections.push({
    heading: "1. Datos de la explotación",
    paragraphs: [
      `Finca: ${f.name}${f.companyName ? ` (${f.companyName})` : ""}. ${f.municipality ?? ""} ${f.island ?? ""}`.trim(),
      `Cultivo: ${f.mainCrop ?? "platanera"}${f.variety ? `, variedad ${f.variety}` : ""}. Fase fenológica: ${f.phenologicalStage ?? "no indicada"}.`,
      `Plantas: ${f.plantCount ?? "—"}. Superficie: ${f.surfaceHa ?? "—"} ha. Riego: ${f.weeklyLitresPerPlant ?? "—"} L/planta/semana${
        f.plantCount && f.weeklyLitresPerPlant
          ? ` (≈ ${Math.round((f.plantCount * f.weeklyLitresPerPlant) / 1000)} m³/semana)`
          : ""
      }.`,
      d.sectors.length
        ? "Sectores: " + d.sectors.map((s) => `${s.name} (${s.plantCount ?? "—"} plantas)`).join("; ")
        : "Sin sectores definidos.",
    ],
  });
  let n = 2;
  for (const [label, a] of [
    ["Analítica de agua de riego", d.water],
    ["Analítica de suelo", d.soil],
    ["Analítica foliar", d.leaf],
  ] as const) {
    sections.push({
      heading: `${n}. ${label}`,
      paragraphs: a
        ? [
            `Referencia ${a.reference ?? "—"}, ${a.laboratory ?? "laboratorio no indicado"}, fecha de muestreo ${a.sampleDate}.${a.notes ? " " + a.notes : ""}`,
          ]
        : ["Sin analítica registrada."],
      table: a ? analysisTable(a) : undefined,
    });
    n++;
  }
  if (d.amendment) {
    // Render ligero: guiones como viñetas; párrafos separados por líneas en blanco.
    const paragraphs = d.amendment.text
      .split("\n")
      .map((l) => l.trimEnd())
      .filter((l, i, arr) => l.trim() !== "" || (arr[i - 1] ?? "").trim() !== "")
      .map((l) => {
        const bullet = l.match(/^\s*[-*]\s+(.*)/);
        return bullet ? `\u2022 ${bullet[1]}` : l.trim();
      })
      .filter(Boolean);
    const coherence = (d.amendment.coherenceWarnings ?? []).map(
      (w) => `¡AVISO DE COHERENCIA! ${w}`,
    );
    sections.push({
      heading: `${n}. Plan de enmiendas del terreno — ${d.amendment.scenarioLabel}`,
      paragraphs: [
        "Elaborado a partir de las analíticas más recientes registradas en la finca. Debe validarlo el técnico responsable antes de aplicar.",
        ...coherence,
        ...paragraphs,
      ],
    });
    n++;
  }
  if (d.recommendation) {
    const r = d.recommendation;
    const originLabel = r.source === "ai" ? "[IA]" : "[Técnico]";
    const originDate = new Date(r.updatedAt ?? r.createdAt).toLocaleDateString("es-ES", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    sections.push({
      heading: `${n}. Programa semanal de fertirrigación recomendado`,
      paragraphs: [
        `Origen del programa: ${originLabel} · Fecha del programa: ${originDate}.`,
        r.title ?? "",
        r.rationale ?? "",
        r.estimatedEcDsM != null ? `CE estimada de la solución: ${r.estimatedEcDsM} dS/m.` : "",
        r.estimatedWeeklyNKg != null ? `Aporte semanal de N: ${r.estimatedWeeklyNKg} kg.` : "",
      ].filter(Boolean),
      table: [
        ["Fertilizante", "Dosis semanal", "Unidad", "Motivo"],
        ...r.items.map((i) => [i.fertilizerName, String(i.weeklyDose), i.unit, i.reason ?? ""]),
      ],
    });
    n++;
    if (d.stageComparison) {
      const sc = d.stageComparison;
      const fmt = (v: number) => String(v);
      const statusText = (s: "low" | "ok" | "high") =>
        s === "ok" ? "Dentro del rango" : s === "low" ? "Por debajo del rango" : "Por encima del rango";
      const outOfRange = sc.nStatus !== "ok" || sc.k2oStatus !== "ok";
      sections.push({
        heading: `${n}. Contraste con los rangos de la fase fenológica`,
        paragraphs: [
          `Fase considerada: ${sc.stageLabel}. Rangos aplicados: ${
            sc.rangeSource === "tecnico"
              ? "modulados por el técnico responsable para esta finca."
              : "orientativos por defecto de la aplicación."
          }`,
          STAGE_RANGES_PROVENANCE,
          ...(outOfRange
            ? [
                `El programa queda fuera del rango en ${[
                  sc.nStatus !== "ok" ? "nitrógeno (N)" : null,
                  sc.k2oStatus !== "ok" ? "potasio (K2O)" : null,
                ]
                  .filter(Boolean)
                  .join(" y ")}. Motivo según la justificación técnica del programa: ${
                  d.recommendation?.rationale?.trim() ||
                  "no consta una justificación específica; debe valorarlo el técnico responsable."
                }`,
              ]
            : ["El programa se encuentra dentro de los rangos aplicados para esta fase."]),
        ],
        table: [
          ["Nutriente", "Aporte del programa (g/planta/semana)", "Rango aplicado", "Situación"],
          ["N", fmt(sc.nPerPlantG), `${fmt(sc.nMinG)} – ${fmt(sc.nMaxG)}`, statusText(sc.nStatus)],
          ["K2O", fmt(sc.k2oPerPlantG), `${fmt(sc.k2oMinG)} – ${fmt(sc.k2oMaxG)}`, statusText(sc.k2oStatus)],
        ],
      });
      n++;
    }
    if (r.warnings?.length) {
      sections.push({
        heading: `${n}. Advertencias y compatibilidades`,
        paragraphs: r.warnings,
      });
      n++;
    }
  }
  if (d.phytoTreatments?.length) {
    sections.push({
      heading: `${n}. Tratamientos fitosanitarios y plazos de seguridad`,
      paragraphs: [
        "Aplicaciones registradas en el cuaderno de tratamientos de la campaña actual, con la fecha de inicio de cada tratamiento y la fecha en la que termina su plazo de seguridad.",
      ],
      table: [
        [
          "Fecha de inicio del tratamiento",
          "Producto",
          "Sector",
          "Plazo seg. (días)",
          "Fecha de fin de plazo de seguridad",
        ],
        ...d.phytoTreatments.map((t) => [
          t.applicationDate.split("-").reverse().join("/"),
          t.productName,
          t.sectorName ?? "Toda la finca",
          t.safetyDays != null ? String(t.safetyDays) : "—",
          harvestFromDate(t.applicationDate, t.safetyDays),
        ]),
      ],
    });
    n++;
  }
  if (d.technicianNotes) {
    sections.push({
      heading: `${n}. Observaciones del técnico`,
      paragraphs: d.technicianNotes
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean),
    });
    n++;
  }
  sections.push({
    heading: `${n}. Seguimiento`,
    paragraphs: [
      "Repetir analítica foliar cada 6 meses y de suelo/agua cada 12 meses, o antes si cambian las condiciones de riego.",
      "Este informe se ha generado con AgroNutri AI a partir de los datos registrados de la finca y debe ser validado por el técnico responsable.",
    ],
  });
  return sections;
}

const MARGIN = 50;
const CELL_PAD = 5;

/**
 * PDFKit's built-in Helvetica only supports WinAnsi (Latin-1) characters.
 * Analyses imported from lab PDFs often carry Greek mu, special dashes, etc.,
 * which would render as mojibake. Normalize to safe equivalents.
 */
export function pdfSafe(text: string): string {
  return text
    .replace(/[\u03BC\u00B5]/g, "\u00B5") // Greek mu → micro sign (WinAnsi)
    .replace(/[\u2010-\u2015\u2212]/g, "-") // dashes/minus → hyphen
    .replace(/[\u2018\u2019\u201A]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/[\u00A0\u2000-\u200B]/g, " ")
    .normalize("NFC")
    // Drop anything outside Latin-1 that Helvetica cannot encode
    .replace(/[^\u0000-\u00FF\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u20AC]/g, "");
}

function statusColor(text: string): string | null {
  const t = text.toLowerCase();
  if (t === "muy_alto" || t === "muy_bajo") return "#b91c1c";
  if (t === "alto" || t === "bajo") return "#c2620a";
  if (t === "normal") return "#15803d";
  return null;
}

function drawTable(doc: PDFKit.PDFDocument, table: string[][]): void {
  const pageWidth = doc.page.width - MARGIN * 2;
  const nCols = table[0].length;
  // First column wider (parameter/fertilizer names); last column may hold longer text for 4-col tables
  const weights =
    nCols === 5 ? [1.7, 0.8, 0.8, 1.0, 0.9] : nCols === 4 ? [1.4, 0.8, 0.6, 2.2] : Array(nCols).fill(1);
  const totalW = weights.reduce((a: number, b: number) => a + b, 0);
  const colWidths = weights.map((w: number) => (w / totalW) * pageWidth);
  const bottom = doc.page.height - MARGIN;

  const rowHeight = (row: string[], bold: boolean): number => {
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9);
    let h = 0;
    row.forEach((cell, ci) => {
      const cellH = doc.heightOfString(cell || " ", { width: colWidths[ci] - CELL_PAD * 2 });
      if (cellH > h) h = cellH;
    });
    return h + CELL_PAD * 2;
  };

  const drawRow = (row: string[], ri: number, y: number, h: number): void => {
    let x = MARGIN;
    // Background
    if (ri === 0) {
      doc.rect(MARGIN, y, pageWidth, h).fill("#1e4d36");
    } else if (ri % 2 === 0) {
      doc.rect(MARGIN, y, pageWidth, h).fill("#f2f6f3");
    }
    row.forEach((cell, ci) => {
      const isStatusCol = ri > 0 && ci === row.length - 1;
      const color = ri === 0 ? "#ffffff" : (isStatusCol && statusColor(cell)) || "#1f2937";
      doc
        .font(ri === 0 ? "Helvetica-Bold" : "Helvetica")
        .fontSize(9)
        .fillColor(color)
        .text(pdfSafe(ri > 0 && isStatusCol ? cell.replace(/_/g, " ") : cell), x + CELL_PAD, y + CELL_PAD, {
          width: colWidths[ci] - CELL_PAD * 2,
          lineBreak: true,
        });
      x += colWidths[ci];
    });
    doc.fillColor("black");
    // Row separator
    doc
      .moveTo(MARGIN, y + h)
      .lineTo(MARGIN + pageWidth, y + h)
      .lineWidth(0.5)
      .strokeColor("#d1d5db")
      .stroke();
  };

  const header = table[0];
  const headerH = rowHeight(header, true);
  let y = doc.y;

  const usable = doc.page.height - MARGIN * 2;
  const ensureSpace = (needed: number): void => {
    // A row taller than a full page can never fit; draw it where we are instead of paging forever
    if (needed > usable - headerH) {
      if (y + headerH * 2 > bottom) {
        doc.addPage();
        y = MARGIN;
        drawRow(header, 0, y, headerH);
        y += headerH;
      }
      return;
    }
    if (y + needed > bottom) {
      doc.addPage();
      y = MARGIN;
      drawRow(header, 0, y, headerH);
      y += headerH;
    }
  };

  if (y + headerH + rowHeight(table[1] ?? header, false) > bottom) {
    doc.addPage();
    y = MARGIN;
  }
  drawRow(header, 0, y, headerH);
  y += headerH;

  for (let ri = 1; ri < table.length; ri++) {
    const h = rowHeight(table[ri], false);
    ensureSpace(h);
    drawRow(table[ri], ri, y, h);
    y += h;
  }
  doc.x = MARGIN;
  doc.y = y;
}

export async function generatePdf(d: ReportData, filePath: string): Promise<string[]> {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const sections = buildSections(d);
  const warnings: string[] = [];
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ margin: MARGIN, size: "A4", bufferPages: true });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    // Header band
    doc.rect(0, 0, doc.page.width, 6).fill("#1e4d36");
    doc.fillColor("black");
    doc.y = MARGIN;
    // Logo en la cabecera de la primera página (si existe; si falta, se avisa en logs)
    const logoW = 140;
    const logoPath = resolveLogo();
    if (logoPath) {
      doc.image(logoPath, MARGIN, MARGIN, { width: logoW });
      doc.y = MARGIN + logoW * LOGO_RATIO + 14;
    } else {
      warnings.push(missingLogoWarning());
      doc.y = MARGIN;
    }
    doc.x = MARGIN;
    doc.fontSize(18).font("Helvetica-Bold").fillColor("#1e4d36").text(pdfSafe(d.title));
    doc.moveDown(0.3);
    doc
      .fontSize(10)
      .font("Helvetica")
      .fillColor("#555555")
      .text(`AgroNutri AI — Informe técnico de fertirrigación · ${d.date}`);
    doc.fillColor("black").moveDown();
    for (const s of sections) {
      // Keep heading attached to the following content
      if (doc.y > doc.page.height - MARGIN - 110) doc.addPage();
      doc.moveDown(1.4);
      doc.fontSize(13).font("Helvetica-Bold").fillColor("#1e4d36").text(s.heading);
      doc.fillColor("black");
      doc.moveDown(0.4);
      doc.fontSize(10).font("Helvetica");
      for (const p of s.paragraphs) doc.text(pdfSafe(p), { lineGap: 2, paragraphGap: 4 });
      if (s.table) {
        doc.moveDown(0.3);
        drawTable(doc, s.table);
      }
    }
    // Bloque de firma: espacio amplio para firmar sobre la línea, encima del
    // nombre del técnico. Si no cabe en la página actual, pasa a la siguiente.
    const SIGNATURE_SPACE = 90; // ~3 cm libres para la firma
    const signatureBlockH = SIGNATURE_SPACE + 50;
    if (doc.y + signatureBlockH > doc.page.height - MARGIN) doc.addPage();
    doc.y += SIGNATURE_SPACE;
    const lineW = 220;
    doc
      .moveTo(MARGIN, doc.y)
      .lineTo(MARGIN + lineW, doc.y)
      .lineWidth(0.8)
      .strokeColor("#555555")
      .stroke();
    doc.y += 6;
    doc.fontSize(9).font("Helvetica").fillColor("#555555").text("Firma del técnico", MARGIN);
    doc.moveDown(0.4);
    doc
      .fontSize(10)
      .font("Helvetica")
      .fillColor("black")
      .text(pdfSafe(`Elaborado por: ${d.authorName}. Fecha: ${d.date}.`), MARGIN);
    // Footer with page numbers on every buffered page
    const range = doc.bufferedPageRange();
    const total = range.start + range.count;
    for (let i = range.start; i < total; i++) {
      doc.switchToPage(i);
      // Writing inside the bottom margin would trigger an automatic page break; disable it temporarily
      const savedBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const footerY = doc.page.height - MARGIN + 8;
      doc.fontSize(8).font("Helvetica").fillColor("#777777");
      doc.text(pdfSafe(d.farm.name), MARGIN, footerY, {
        width: doc.page.width - MARGIN * 2,
        align: "left",
        lineBreak: false,
      });
      doc.text(`Página ${i - range.start + 1} de ${range.count}`, MARGIN, footerY, {
        width: doc.page.width - MARGIN * 2,
        align: "center",
        lineBreak: false,
      });
      doc.text("AgroNutri AI", MARGIN, footerY, {
        width: doc.page.width - MARGIN * 2,
        align: "right",
        lineBreak: false,
      });
      doc.fillColor("black");
      doc.page.margins.bottom = savedBottom;
    }
    doc.end();
    stream.on("finish", () => resolve());
    stream.on("error", reject);
  });
  return warnings;
}

export type PhytoPlanData = {
  farmName: string;
  authorName: string;
  date: string;
  pests: string[];
  question: string | null;
  answer: string;
  sources: string[];
};

/**
 * PDF del plan de tratamiento fitosanitario del asesor IA. Renderiza la
 * respuesta (markdown ligero: títulos #, listas -, negritas **) con el mismo
 * estilo que los informes, más fuentes y bloque de firma.
 */
export async function generatePhytoPlanPdf(d: PhytoPlanData): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ margin: MARGIN, size: "A4", bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.rect(0, 0, doc.page.width, 6).fill("#1e4d36");
    doc.fillColor("black");
    doc.y = MARGIN;
    const logoW = 140;
    const logoPath = resolveLogo();
    if (logoPath) {
      doc.image(logoPath, MARGIN, MARGIN, { width: logoW });
      doc.y = MARGIN + logoW * LOGO_RATIO + 14;
    }
    doc.x = MARGIN;
    doc
      .fontSize(18)
      .font("Helvetica-Bold")
      .fillColor("#1e4d36")
      .text("Plan de tratamiento fitosanitario");
    doc.moveDown(0.3);
    doc
      .fontSize(10)
      .font("Helvetica")
      .fillColor("#555555")
      .text(pdfSafe(`AgroNutri AI — Finca ${d.farmName} · ${d.date}`));
    doc.fillColor("black").moveDown(1);

    if (d.pests.length) {
      doc.fontSize(10).font("Helvetica-Bold").text("Plagas o problemas consultados: ", { continued: true });
      doc.font("Helvetica").text(pdfSafe(d.pests.join(", ")));
      doc.moveDown(0.4);
    }
    if (d.question) {
      doc.fontSize(10).font("Helvetica-Bold").text("Consulta: ", { continued: true });
      doc.font("Helvetica").text(pdfSafe(d.question), { lineGap: 2 });
      doc.moveDown(0.4);
    }
    doc.moveDown(0.4);

    // Render markdown ligero línea a línea
    const stripInline = (s: string): string => s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`/g, "");
    for (const rawLine of d.answer.split("\n")) {
      const line = rawLine.trimEnd();
      if (!line.trim()) {
        doc.moveDown(0.5);
        continue;
      }
      if (doc.y > doc.page.height - MARGIN - 40) doc.addPage();
      const heading = line.match(/^(#{1,4})\s+(.*)/);
      if (heading) {
        doc.moveDown(0.6);
        doc
          .fontSize(heading[1].length <= 2 ? 13 : 11)
          .font("Helvetica-Bold")
          .fillColor("#1e4d36")
          .text(pdfSafe(stripInline(heading[2])));
        doc.fillColor("black").moveDown(0.2);
        continue;
      }
      const bullet = line.match(/^\s*[-*]\s+(.*)/);
      doc.fontSize(10).font("Helvetica");
      if (bullet) {
        doc.text(pdfSafe(`\u2022 ${stripInline(bullet[1])}`), MARGIN + 10, doc.y, {
          width: doc.page.width - MARGIN * 2 - 10,
          lineGap: 2,
        });
        doc.x = MARGIN;
      } else {
        doc.text(pdfSafe(stripInline(line)), { lineGap: 2 });
      }
    }

    if (d.sources.length) {
      doc.moveDown(1);
      if (doc.y > doc.page.height - MARGIN - 80) doc.addPage();
      doc.fontSize(12).font("Helvetica-Bold").fillColor("#1e4d36").text("Fuentes consultadas");
      doc.fillColor("black").moveDown(0.3);
      doc.fontSize(9).font("Helvetica").fillColor("#1d4ed8");
      for (const s of d.sources) doc.text(pdfSafe(s), { lineGap: 2, link: s });
      doc.fillColor("black");
    }

    doc.moveDown(1);
    if (doc.y > doc.page.height - MARGIN - 90) doc.addPage();
    doc
      .fontSize(9)
      .font("Helvetica")
      .fillColor("#555555")
      .text(
        "Contrasta siempre esta información con la etiqueta vigente del producto y el Registro de Productos Fitosanitarios del MAPA. La decisión final corresponde a un técnico autorizado en gestión integrada de plagas.",
        { lineGap: 2 },
      );
    doc.fillColor("black");
    doc.moveDown(0.6);
    doc.fontSize(10).text(pdfSafe(`Generado por: ${d.authorName}. Fecha: ${d.date}.`));

    // Pie con paginación
    const range = doc.bufferedPageRange();
    const total = range.start + range.count;
    for (let i = range.start; i < total; i++) {
      doc.switchToPage(i);
      const savedBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const footerY = doc.page.height - MARGIN + 8;
      doc.fontSize(8).font("Helvetica").fillColor("#777777");
      doc.text(pdfSafe(d.farmName), MARGIN, footerY, {
        width: doc.page.width - MARGIN * 2,
        align: "left",
        lineBreak: false,
      });
      doc.text(`Página ${i - range.start + 1} de ${range.count}`, MARGIN, footerY, {
        width: doc.page.width - MARGIN * 2,
        align: "center",
        lineBreak: false,
      });
      doc.text("AgroNutri AI", MARGIN, footerY, {
        width: doc.page.width - MARGIN * 2,
        align: "right",
        lineBreak: false,
      });
      doc.fillColor("black");
      doc.page.margins.bottom = savedBottom;
    }
    doc.end();
  });
}

export async function generateDocx(d: ReportData, filePath: string): Promise<string[]> {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const sections = buildSections(d);
  const warnings: string[] = [];
  const logoW = 140;
  const logoPath = resolveLogo();
  if (!logoPath) warnings.push(missingLogoWarning());
  const children: (Paragraph | Table)[] = [
    ...(logoPath
      ? [
          new Paragraph({
            children: [
              new ImageRun({
                type: "png",
                data: fs.readFileSync(logoPath),
                transformation: { width: logoW, height: Math.round(logoW * LOGO_RATIO) },
              }),
            ],
          }),
        ]
      : []),
    new Paragraph({ text: d.title, heading: HeadingLevel.TITLE }),
    new Paragraph({
      children: [
        new TextRun({
          text: `AgroNutri AI — Informe técnico de fertirrigación · ${d.date}`,
          italics: true,
        }),
      ],
    }),
  ];
  for (const s of sections) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 360, after: 160 },
        children: [new TextRun({ text: s.heading, color: "1e4d36" })],
      }),
    );
    for (const p of s.paragraphs)
      children.push(new Paragraph({ text: p, spacing: { after: 120 } }));
    if (s.table) {
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: s.table.map(
            (row, ri) =>
              new TableRow({
                children: row.map((cell, ci) => {
                  const isStatusCol = ri > 0 && ci === row.length - 1;
                  const sColor = isStatusCol ? statusColor(cell) : null;
                  const shade =
                    ri === 0
                      ? { type: ShadingType.CLEAR, fill: "1e4d36" }
                      : ri % 2 === 0
                        ? { type: ShadingType.CLEAR, fill: "f2f6f3" }
                        : undefined;
                  return new TableCell({
                    shading: shade,
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({
                            text: isStatusCol ? cell.replace(/_/g, " ") : cell,
                            bold: ri === 0,
                            color:
                              ri === 0
                                ? "ffffff"
                                : sColor
                                  ? sColor.replace("#", "")
                                  : undefined,
                          }),
                        ],
                      }),
                    ],
                  });
                }),
              }),
          ),
        }),
      );
    }
  }
  // Bloque de firma: espacio amplio antes de la línea y el nombre del técnico.
  children.push(
    new Paragraph({ text: "", spacing: { before: 1800 } }),
    new Paragraph({
      children: [new TextRun({ text: "_".repeat(40), color: "555555" })],
    }),
    new Paragraph({
      children: [new TextRun({ text: "Firma del técnico", size: 18, color: "555555" })],
      spacing: { after: 160 },
    }),
    new Paragraph({ text: `Elaborado por: ${d.authorName}. Fecha: ${d.date}.` }),
  );
  const footer = new Footer({
    children: [
      new Paragraph({
        tabStops: [
          { type: TabStopType.CENTER, position: TabStopPosition.MAX / 2 },
          { type: TabStopType.RIGHT, position: TabStopPosition.MAX },
        ],
        children: [
          new TextRun({ text: d.farm.name, size: 16, color: "777777" }),
          new TextRun({ text: "\tPágina ", size: 16, color: "777777" }),
          new TextRun({
            children: [PageNumber.CURRENT],
            size: 16,
            color: "777777",
          }),
          new TextRun({ text: " de ", size: 16, color: "777777" }),
          new TextRun({
            children: [PageNumber.TOTAL_PAGES],
            size: 16,
            color: "777777",
          }),
          new TextRun({ text: "\tAgroNutri AI", size: 16, color: "777777" }),
        ],
      }),
    ],
  });
  const doc = new Document({
    sections: [{ children, footers: { default: footer } }],
  });
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(filePath, buffer);
  return warnings;
}
