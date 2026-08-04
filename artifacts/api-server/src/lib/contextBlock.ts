import type { Analysis, Farm, Recommendation, Sector } from "@workspace/db";
import { mgPerLParam, waterEcDsMFrom } from "./engine";

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * Explicit summary of what the irrigation water already provides, so the AI
 * discounts it from the program instead of dosing as if the water were pure.
 */
function waterBudgetBlock(farm: Farm, water: Analysis | null): string[] {
  if (!water) return [];
  const lines: string[] = [];
  const maxEc = farm.maxEcDsM ?? 2.5;
  const rawEc = waterEcDsMFrom(water);
  const waterEc = rawEc != null ? round(rawEc, 2) : null;
  if (waterEc != null) {
    const margin = round(maxEc - waterEc, 2);
    lines.push(
      `CE DEL AGUA EN ORIGEN: ${waterEc} dS/m. CE máxima admisible de la solución: ${maxEc} dS/m. ` +
        (margin > 0
          ? `MARGEN DE CE DISPONIBLE PARA LOS ABONOS: ${margin} dS/m — la suma de las aportaciones de CE de los fertilizantes NO debe superar ese margen; ajusta las dosis (o reparte en más riegos) para cumplirlo.`
          : `El agua por sí sola ya alcanza o supera la CE máxima: NO hay margen para abonado sin superar el límite; adviértelo expresamente y propone dosis mínimas repartidas o mejora de la calidad del agua.`),
    );
  }
  const weeklyLitres =
    farm.plantCount && farm.weeklyLitresPerPlant ? farm.plantCount * farm.weeklyLitresPerPlant : null;
  if (weeklyLitres && weeklyLitres > 0) {
    const contrib: string[] = [];
    const add = (label: string, names: string[], factor: number) => {
      const v = mgPerLParam(water, names);
      if (v != null && v > 0) contrib.push(`${label} ≈ ${round((v * factor * weeklyLitres) / 1e6, 2)} kg/semana`);
    };
    add("N (de nitratos)", ["nitrato", "no3"], 0.226);
    add("K2O", ["potasio", "k"], 1.205);
    add("CaO", ["calcio", "ca"], 1.399);
    add("MgO", ["magnesio", "mg"], 1.658);
    add("SO3 (de sulfatos)", ["sulfato", "so4"], 0.833);
    if (contrib.length) {
      lines.push(
        `APORTES SEMANALES DEL AGUA DE RIEGO (ya entran con el riego, DESCUÉNTALOS de las necesidades antes de dosificar fertilizantes): ${contrib.join("; ")}.`,
      );
    }
  }
  return lines;
}

function analysisBlock(label: string, a: Analysis | null): string {
  if (!a) return `${label}: sin datos.`;
  const params = a.parameters
    .map((p) => {
      const ref =
        p.refLow != null || p.refHigh != null
          ? ` (ref ${p.refLow ?? "-"}–${p.refHigh ?? "-"})`
          : "";
      const status = p.status ? ` [${p.status}]` : "";
      return `  - ${p.name}: ${p.value}${p.unit ? " " + p.unit : ""}${ref}${status}`;
    })
    .join("\n");
  return `${label} (${a.sampleDate}${a.laboratory ? ", " + a.laboratory : ""}${a.reference ? ", ref " + a.reference : ""}):\n${params}${a.notes ? "\n  Notas: " + a.notes : ""}`;
}

export function buildFarmContext(input: {
  farm: Farm;
  sectors: Sector[];
  soil: Analysis | null;
  leaf: Analysis | null;
  water: Analysis | null;
  active: Recommendation | null;
}): string {
  const f = input.farm;
  const lines: string[] = [];
  lines.push(
    `Finca: ${f.name}${f.companyName ? " (" + f.companyName + ")" : ""}, ${f.municipality ?? ""} ${f.island ?? ""}`.trim(),
  );
  lines.push(
    `Cultivo: ${f.mainCrop ?? "platanera"}${f.variety ? ", variedad " + f.variety : ""}. Fase fenológica: ${f.phenologicalStage ?? "no indicada"}.`,
  );
  lines.push(
    `Plantas: ${f.plantCount ?? "?"}. Superficie: ${f.surfaceHa ?? "?"} ha. Riego: ${f.weeklyLitresPerPlant ?? "?"} L/planta/semana${
      f.plantCount && f.weeklyLitresPerPlant
        ? ` (≈ ${Math.round((f.plantCount * f.weeklyLitresPerPlant) / 1000)} m³/semana)`
        : ""
    }.`,
  );
  if (f.hasDesalinatedWater) {
    lines.push(`Agua: mezcla con ${f.desalinatedWaterPct ?? "?"} % de agua desalada.`);
  }
  if (f.maxEcDsM != null) lines.push(`CE máxima admisible de la solución: ${f.maxEcDsM} dS/m.`);
  if (f.soilType) lines.push(`Suelo: ${f.soilType}.`);
  if (f.managementNotes) lines.push(`Notas de manejo: ${f.managementNotes}`);
  if (input.sectors.length) {
    lines.push(
      "Sectores: " +
        input.sectors
          .map((s) => `${s.name} (${s.plantCount ?? "?"} plantas${s.phenologicalStage ? ", " + s.phenologicalStage : ""})`)
          .join("; "),
    );
  }
  lines.push("");
  lines.push(analysisBlock("ANALÍTICA DE AGUA", input.water));
  for (const l of waterBudgetBlock(f, input.water)) lines.push(l);
  lines.push("");
  lines.push(analysisBlock("ANALÍTICA DE SUELO", input.soil));
  lines.push("");
  lines.push(analysisBlock("ANALÍTICA FOLIAR", input.leaf));
  lines.push("");
  if (input.active) {
    lines.push(
      `PROGRAMA DE ABONADO VIGENTE (estado ${input.active.status}): ` +
        input.active.items
          .map((i) => `${i.fertilizerName} ${i.weeklyDose} ${i.unit}/semana`)
          .join("; "),
    );
    if (input.active.rationale) lines.push(`Justificación: ${input.active.rationale}`);
  } else {
    lines.push("PROGRAMA DE ABONADO VIGENTE: ninguno validado actualmente.");
  }
  return lines.join("\n");
}

export function contextSources(input: {
  soil: Analysis | null;
  leaf: Analysis | null;
  water: Analysis | null;
  active: Recommendation | null;
}): string[] {
  const sources: string[] = [];
  if (input.water) sources.push(`Analítica de agua ${input.water.reference ?? ""} (${input.water.sampleDate})`.trim());
  if (input.soil) sources.push(`Analítica de suelo ${input.soil.reference ?? ""} (${input.soil.sampleDate})`.trim());
  if (input.leaf) sources.push(`Analítica foliar ${input.leaf.reference ?? ""} (${input.leaf.sampleDate})`.trim());
  if (input.active) sources.push(`Recomendación vigente «${input.active.title ?? "programa semanal"}»`);
  return sources;
}
