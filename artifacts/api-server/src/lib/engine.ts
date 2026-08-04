import type { Fertilizer, Analysis, Farm, Sector, RecommendationItem } from "@workspace/db";

export type CalculationInput = {
  farm: Farm;
  sector?: Sector | null;
  waterAnalysis?: Analysis | null;
  fertilizers: Fertilizer[];
  items: RecommendationItem[];
  weeklyLitresPerPlant?: number | null;
  plantCount?: number | null;
};

export type CalculationOutput = {
  weeklyWaterLitres: number;
  weeklyWaterM3: number;
  nutrients: Record<string, number>;
  estimatedEcDsM: number | null;
  waterContribution: Record<string, number>;
  sar: number | null;
  warnings: string[];
  compatibilityIssues: string[];
};

function param(a: Analysis | null | undefined, names: string[]): number | null {
  if (!a) return null;
  const lower = names.map((n) => n.toLowerCase());
  for (const p of a.parameters) {
    const pn = p.name.toLowerCase();
    // Split into word tokens so short symbols like "ca" don't match inside
    // unrelated words (e.g. "eléctrica", "alcalinidad").
    const tokens = pn.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (lower.some((n) => (n.length <= 3 ? tokens.includes(n) : pn.includes(n)))) {
      return p.value;
    }
  }
  return null;
}

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * Deterministic fertigation engine for platanera.
 * All doses are weekly; solids in kg, liquids in L.
 */
export function runEngine(input: CalculationInput): CalculationOutput {
  const warnings: string[] = [];
  const compatibilityIssues: string[] = [];

  const plantCount =
    input.plantCount ?? input.sector?.plantCount ?? input.farm.plantCount ?? 0;
  const lppw =
    input.weeklyLitresPerPlant ??
    input.sector?.weeklyLitresPerPlant ??
    input.farm.weeklyLitresPerPlant ??
    0;
  const weeklyWaterLitres = plantCount * lppw;
  if (weeklyWaterLitres <= 0) {
    warnings.push(
      "No se ha podido calcular el volumen de agua semanal: faltan plantas o litros por planta y semana.",
    );
  }

  const byId = new Map(input.fertilizers.map((f) => [f.id, f]));
  const byName = new Map(input.fertilizers.map((f) => [f.name.toLowerCase(), f]));

  const nutrients: Record<string, number> = {
    n: 0,
    nNitric: 0,
    nAmmoniacal: 0,
    nUreic: 0,
    p2o5: 0,
    k2o: 0,
    cao: 0,
    mgo: 0,
    so3: 0,
    b: 0,
  };

  let totalSaltGrams = 0;
  const resolved: { fert: Fertilizer | null; item: RecommendationItem; kg: number }[] = [];

  for (const item of input.items) {
    const fert =
      (item.fertilizerId != null ? byId.get(item.fertilizerId) : undefined) ??
      byName.get(item.fertilizerName.toLowerCase()) ??
      null;
    let kg = item.weeklyDose;
    if (item.unit.toLowerCase().startsWith("l")) {
      const density = fert?.densityKgL ?? 1.2;
      kg = item.weeklyDose * density;
    }
    if (!fert) {
      warnings.push(
        `Fertilizante «${item.fertilizerName}» no encontrado en el catálogo: no se computan sus aportes.`,
      );
    } else {
      nutrients.n += (kg * (fert.nPct ?? 0)) / 100;
      nutrients.nNitric += (kg * (fert.nNitricPct ?? 0)) / 100;
      nutrients.nAmmoniacal += (kg * (fert.nAmmoniacalPct ?? 0)) / 100;
      nutrients.nUreic += (kg * (fert.nUreicPct ?? 0)) / 100;
      nutrients.p2o5 += (kg * (fert.p2o5Pct ?? 0)) / 100;
      nutrients.k2o += (kg * (fert.k2oPct ?? 0)) / 100;
      nutrients.cao += (kg * (fert.caoPct ?? 0)) / 100;
      nutrients.mgo += (kg * (fert.mgoPct ?? 0)) / 100;
      nutrients.so3 += (kg * (fert.so3Pct ?? 0)) / 100;
      nutrients.b += (kg * (fert.boronPct ?? 0)) / 100;
      totalSaltGrams += kg * 1000;
    }
    resolved.push({ fert, item, kg });
  }
  for (const k of Object.keys(nutrients)) nutrients[k] = round(nutrients[k], 3);

  // Compatibility: pairwise check via incompatibleWith lists (name or group keywords).
  for (let i = 0; i < resolved.length; i++) {
    for (let j = i + 1; j < resolved.length; j++) {
      const a = resolved[i].fert;
      const b = resolved[j].fert;
      if (!a || !b) continue;
      const aIncompat = (a.incompatibleWith ?? []).map((s) => s.toLowerCase());
      const bIncompat = (b.incompatibleWith ?? []).map((s) => s.toLowerCase());
      const bTokens = [b.name.toLowerCase(), ...(bIncompatGroupTokens(b) ?? [])];
      const aTokens = [a.name.toLowerCase(), ...(bIncompatGroupTokens(a) ?? [])];
      const hit =
        aIncompat.some((x) => bTokens.some((t) => t.includes(x) || x.includes(t))) ||
        bIncompat.some((x) => aTokens.some((t) => t.includes(x) || x.includes(t)));
      if (hit) {
        compatibilityIssues.push(
          `No mezclar «${a.name}» con «${b.name}» en el mismo tanque: riesgo de precipitados. Aplicar en tanques o días separados.`,
        );
      }
    }
  }

  // Water contribution (from latest water analysis, mg/L * L / 1e6 = kg).
  const waterContribution: Record<string, number> = {};
  const wa = input.waterAnalysis;
  let sar: number | null = null;
  if (wa && weeklyWaterLitres > 0) {
    const map: Record<string, string[]> = {
      na: ["sodio", "na"],
      ca: ["calcio", "ca"],
      mg: ["magnesio", "mg"],
      k: ["potasio", "k"],
      b: ["boro", "b"],
      alkalinity: ["alcalinidad", "bicarbonato", "hco3"],
    };
    for (const [key, names] of Object.entries(map)) {
      const v = param(wa, names);
      if (v != null) waterContribution[key] = round((v * weeklyWaterLitres) / 1e6, 2);
    }
    const na = param(wa, ["sodio"]);
    const ca = param(wa, ["calcio"]);
    const mg = param(wa, ["magnesio"]);
    if (na != null && ca != null && mg != null) {
      const naMeq = na / 23;
      const caMeq = ca / 20;
      const mgMeq = mg / 12.15;
      sar = round(naMeq / Math.sqrt((caMeq + mgMeq) / 2), 2);
      if (sar >= 6) {
        warnings.push(
          `SAR del agua elevado (${sar}): riesgo de sodificación del suelo. Valorar aportes de calcio (yeso agrícola en invierno) y mejorar el lavado de sales.`,
        );
      }
    }
    const alk = param(wa, ["alcalinidad", "bicarbonato"]);
    if (alk != null && alk > 200) {
      warnings.push(
        `Alcalinidad del agua alta (${alk} mg/L CaCO3): mantener acidificación del agua (ácido nítrico, fosfórico o sulfúrico según necesidades) para evitar bloqueos de Ca/Fe y obstrucción de goteros.`,
      );
    }
  } else if (!wa) {
    warnings.push("Sin analítica de agua registrada: CE, SAR y aportes del riego no incluyen el agua.");
  }

  // Estimated EC of the fertigation solution.
  let estimatedEcDsM: number | null = null;
  if (weeklyWaterLitres > 0) {
    let ecFert = 0;
    for (const r of resolved) {
      if (!r.fert) continue;
      const gPerL = (r.kg * 1000) / weeklyWaterLitres;
      ecFert += gPerL * (r.fert.ecContribution ?? 1.4);
    }
    const waterEc = param(wa, ["conductividad", "ce"]);
    const waterEcDsM = waterEc != null ? (waterEc > 20 ? waterEc / 1000 : waterEc) : 0;
    estimatedEcDsM = round(ecFert + waterEcDsM, 2);
    const maxEc = input.farm.maxEcDsM ?? 2.5;
    if (estimatedEcDsM > maxEc) {
      warnings.push(
        `CE estimada de la solución (${estimatedEcDsM} dS/m) supera el máximo configurado (${maxEc} dS/m): repartir dosis en más riegos o reducir concentración.`,
      );
    }
  }

  if (nutrients.n > 0 && weeklyWaterLitres > 0) {
    const nPerPlantG = (nutrients.n * 1000) / Math.max(plantCount, 1);
    if (nPerPlantG > 25) {
      warnings.push(
        `Aporte de N elevado (${round(nPerPlantG, 1)} g/planta/semana): revisar frente a la fase fenológica.`,
      );
    }
  }

  return {
    weeklyWaterLitres: round(weeklyWaterLitres, 0),
    weeklyWaterM3: round(weeklyWaterLitres / 1000, 1),
    nutrients,
    estimatedEcDsM,
    waterContribution,
    sar,
    warnings,
    compatibilityIssues,
  };
}

/** Chemical group tokens for incompatibility matching. */
function bIncompatGroupTokens(f: Fertilizer): string[] {
  const n = f.name.toLowerCase();
  const tokens: string[] = [];
  if (n.includes("sulfato")) tokens.push("sulfatos", "sulfato");
  if (n.includes("fosfato") || n.includes("map") || n.includes("dap"))
    tokens.push("fosfatos", "fosfato");
  if (n.includes("nitrato de calcio") || n.includes("nitrato cálcico"))
    tokens.push("calcio", "nitrato de calcio");
  if (n.includes("ácido") || n.includes("acido")) tokens.push("acidos", "ácidos");
  return tokens;
}
