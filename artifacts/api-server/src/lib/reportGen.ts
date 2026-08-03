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
    sections.push({
      heading: `${n}. Programa semanal de fertirrigación recomendado`,
      paragraphs: [
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

export async function generatePdf(d: ReportData, filePath: string): Promise<void> {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const sections = buildSections(d);
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    doc.fontSize(18).font("Helvetica-Bold").text(d.title);
    doc.moveDown(0.3);
    doc
      .fontSize(10)
      .font("Helvetica")
      .fillColor("#555555")
      .text(`AgroNutri AI — Informe técnico de fertirrigación · ${d.date}`);
    doc.fillColor("black").moveDown();
    for (const s of sections) {
      doc.moveDown(0.6);
      doc.fontSize(13).font("Helvetica-Bold").text(s.heading);
      doc.moveDown(0.3);
      doc.fontSize(10).font("Helvetica");
      for (const p of s.paragraphs) doc.text(p, { lineGap: 2 });
      if (s.table) {
        doc.moveDown(0.3);
        const colWidth = (doc.page.width - 100) / s.table[0].length;
        for (let ri = 0; ri < s.table.length; ri++) {
          const row = s.table[ri];
          const y = doc.y;
          if (y > doc.page.height - 80) doc.addPage();
          row.forEach((cell, ci) => {
            doc
              .font(ri === 0 ? "Helvetica-Bold" : "Helvetica")
              .fontSize(9)
              .text(cell, 50 + ci * colWidth, doc.y === y ? y : doc.y - doc.currentLineHeight(), {
                width: colWidth - 6,
                continued: false,
              });
            doc.y = y;
          });
          doc.y = y + 14;
        }
        doc.x = 50;
      }
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
    children.push(new Paragraph({ text: s.heading, heading: HeadingLevel.HEADING_1 }));
    for (const p of s.paragraphs) children.push(new Paragraph({ text: p }));
    if (s.table) {
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: s.table.map(
            (row, ri) =>
              new TableRow({
                children: row.map(
                  (cell) =>
                    new TableCell({
                      children: [
                        new Paragraph({
                          children: [new TextRun({ text: cell, bold: ri === 0 })],
                        }),
                      ],
                    }),
                ),
              }),
          ),
        }),
      );
    }
  }
  const doc = new Document({ sections: [{ children }] });
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(filePath, buffer);
}
