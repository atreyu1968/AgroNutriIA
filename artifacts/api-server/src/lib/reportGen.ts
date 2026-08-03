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
} from "docx";
import type { Analysis, Farm, Recommendation, Sector } from "@workspace/db";

export const REPORTS_DIR = path.resolve(process.cwd(), "storage", "reports");

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
};

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
    if (r.warnings?.length) {
      sections.push({
        heading: `${n}. Advertencias y compatibilidades`,
        paragraphs: r.warnings,
      });
      n++;
    }
  }
  sections.push({
    heading: `${n}. Seguimiento`,
    paragraphs: [
      "Repetir analítica foliar cada 6 meses y de suelo/agua cada 12 meses, o antes si cambian las condiciones de riego.",
      "Este informe se ha generado con AgroNutri AI a partir de los datos registrados de la finca y debe ser validado por el técnico responsable.",
      `Elaborado por: ${d.authorName}. Fecha: ${d.date}.`,
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

export async function generatePdf(d: ReportData, filePath: string): Promise<void> {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const sections = buildSections(d);
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ margin: MARGIN, size: "A4", bufferPages: true });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    // Header band
    doc.rect(0, 0, doc.page.width, 6).fill("#1e4d36");
    doc.fillColor("black");
    doc.y = MARGIN;
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
      if (doc.y > doc.page.height - MARGIN - 90) doc.addPage();
      doc.moveDown(0.6);
      doc.fontSize(13).font("Helvetica-Bold").fillColor("#1e4d36").text(s.heading);
      doc.fillColor("black");
      doc.moveDown(0.3);
      doc.fontSize(10).font("Helvetica");
      for (const p of s.paragraphs) doc.text(pdfSafe(p), { lineGap: 2 });
      if (s.table) {
        doc.moveDown(0.3);
        drawTable(doc, s.table);
      }
    }
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
}

export async function generateDocx(d: ReportData, filePath: string): Promise<void> {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const sections = buildSections(d);
  const children: (Paragraph | Table)[] = [
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
        children: [new TextRun({ text: s.heading, color: "1e4d36" })],
      }),
    );
    for (const p of s.paragraphs) children.push(new Paragraph({ text: p }));
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
}
