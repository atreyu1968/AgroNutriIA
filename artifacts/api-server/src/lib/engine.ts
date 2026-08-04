import type { Fertilizer, Analysis, Farm, Sector, RecommendationItem } from "@workspace/db";

export type CalculationInput = {
  farm: Farm;
  sector?: Sector | null;
  waterAnalysis?: Analysis | null;
  fertilizers: Fertilizer[];
  items: RecommendationItem[];
  weeklyLitresPerPlant?: number | null;
  plantCount?: number | null;
  maxEcOverride?: number | null;
  /** Overrides the farm/sector phenological stage (e.g. from the calculator). */
  stageOverride?: string | null;
};

export type CalculationOutput = {
  weeklyWaterLitres: number;
  weeklyWaterM3: number;
  nutrients: Record<string, number>;
  estimatedEcDsM: number | null;
  waterEcDsM: number | null;
  fertilizersEcDsM: number | null;
  waterContribution: Record<string, number>;
  sar: number | null;
  warnings: string[];
  compatibilityIssues: string[];
  stageComparison: StageComparison | null;
};

export type StageComparison = {
  stageLabel: string;
  nPerPlantG: number;
  k2oPerPlantG: number;
  nMinG: number;
  nMaxG: number;
  k2oMinG: number;
  k2oMaxG: number;
  nStatus: "low" | "ok" | "high";
  k2oStatus: "low" | "ok" | "high";
};

/**
 * Orientative weekly targets for platanera by phenological stage,
 * in grams per plant per week. Matched against the free-text stage.
 */
const STAGE_PROFILES: {
  label: string;
  match: RegExp;
  n: [number, number];
  k2o: [number, number];
}[] = [
  {
    label: "pre-floración / parición",
    match: /(pre.?flor|paric|belote|pre.?paric)/i,
    n: [15, 25],
    k2o: [25, 40],
  },
  {
    label: "engorde / llenado del racimo",
    match: /(engord|llenad|racimo|cuaj)/i,
    n: [10, 18],
    k2o: [30, 50],
  },
  {
    label: "parón invernal",
    match: /(paron|parón|invern|invierno)/i,
    n: [3, 8],
    k2o: [5, 15],
  },
  {
    label: "postcosecha / arranque vegetativo",
    match: /(post.?cosech|corte|arranque|vegetativ)/i,
    n: [12, 20],
    k2o: [15, 30],
  },
];

export function param(a: Analysis | null | undefined, names: string[]): number | null {
  return paramEntry(a, names)?.value ?? null;
}

export function paramEntry(
  a: Analysis | null | undefined,
  names: string[],
): { value: number; unit: string | null } | null {
  if (!a) return null;
  const lower = names.map((n) => n.toLowerCase());
  for (const p of a.parameters) {
    const pn = p.name.toLowerCase();
    // Split into word tokens so short symbols like "ca" don't match inside
    // unrelated words (e.g. "eléctrica", "alcalinidad").
    const tokens = pn.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (lower.some((n) => (n.length <= 3 ? tokens.includes(n) : pn.includes(n)))) {
      return { value: p.value, unit: p.unit ?? null };
    }
  }
  return null;
}

/**
 * Concentration in mg/L only when the declared unit is mg/L, ppm or absent.
 * Returns null for mmol/L, meq/L, etc. so we never misread lab units.
 */
export function mgPerLParam(a: Analysis | null | undefined, names: string[]): number | null {
  const e = paramEntry(a, names);
  if (!e) return null;
  const u = (e.unit ?? "").toLowerCase().replace(/\s/g, "");
  if (u === "" || u.includes("mg/l") || u.includes("ppm")) return e.value;
  return null;
}

/** Water EC normalised to dS/m using the declared unit when available. */
export function waterEcDsMFrom(a: Analysis | null | undefined): number | null {
  const e = paramEntry(a, ["conductividad", "ce"]);
  if (!e) return null;
  const u = (e.unit ?? "").toLowerCase().replace(/\s/g, "");
  if (u.includes("µs") || u.includes("us/cm") || u.includes("micros")) return e.value / 1000;
  if (u.includes("ms/cm") || u.includes("ds/m")) return e.value;
  // Unit missing or unrecognised: heuristic (µS/cm readings are typically > 20).
  return e.value > 20 ? e.value / 1000 : e.value;
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
      no3: ["nitrato", "no3"],
      so4: ["sulfato", "so4"],
      alkalinity: ["alcalinidad", "bicarbonato", "hco3"],
    };
    for (const [key, names] of Object.entries(map)) {
      const v = mgPerLParam(wa, names);
      if (v != null) waterContribution[key] = round((v * weeklyWaterLitres) / 1e6, 2);
      else if (paramEntry(wa, names)) {
        warnings.push(
          `El parámetro del agua «${names[0]}» viene en una unidad distinta de mg/L: no se computa su aporte con el riego (revisar la analítica).`,
        );
      }
    }
    const na = mgPerLParam(wa, ["sodio", "na"]);
    const ca = mgPerLParam(wa, ["calcio", "ca"]);
    const mg = mgPerLParam(wa, ["magnesio", "mg"]);
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
    const alk = mgPerLParam(wa, ["alcalinidad", "bicarbonato", "hco3"]);
    if (alk != null && alk > 200) {
      warnings.push(
        `Alcalinidad del agua alta (${alk} mg/L CaCO3): mantener acidificación del agua (ácido nítrico, fosfórico o sulfúrico según necesidades) para evitar bloqueos de Ca/Fe y obstrucción de goteros.`,
      );
    }
  } else if (!wa) {
    warnings.push("Sin analítica de agua registrada: CE, SAR y aportes del riego no incluyen el agua.");
  }

  // Estimated EC of the fertigation solution (water EC at source + fertilizer salts).
  let estimatedEcDsM: number | null = null;
  let waterEcDsM: number | null = null;
  let fertilizersEcDsM: number | null = null;
  if (weeklyWaterLitres > 0) {
    let ecFert = 0;
    for (const r of resolved) {
      if (!r.fert) continue;
      const gPerL = (r.kg * 1000) / weeklyWaterLitres;
      ecFert += gPerL * (r.fert.ecContribution ?? 1.4);
    }
    const waterEc = waterEcDsMFrom(wa);
    waterEcDsM = waterEc != null ? round(waterEc, 2) : null;
    fertilizersEcDsM = round(ecFert, 2);
    estimatedEcDsM = round(ecFert + (waterEcDsM ?? 0), 2);
    const maxEc = input.maxEcOverride ?? input.farm.maxEcDsM ?? 2.5;
    const ecMargin = round(maxEc - (waterEcDsM ?? 0), 2);
    if (waterEcDsM != null && waterEcDsM >= maxEc) {
      warnings.push(
        `La CE del agua en origen (${waterEcDsM} dS/m) ya alcanza o supera la CE máxima de la finca (${maxEc} dS/m): no hay margen para abonado sin superar el límite. Valorar mezcla con agua de mejor calidad o revisar el límite con el técnico.`,
      );
    } else if (estimatedEcDsM > maxEc) {
      warnings.push(
        `CE estimada de la solución (${estimatedEcDsM} dS/m = ${waterEcDsM ?? 0} del agua + ${fertilizersEcDsM} de los abonos) supera el máximo configurado (${maxEc} dS/m). Margen disponible para abonos: ${ecMargin} dS/m. Repartir dosis en más riegos o reducir concentración.`,
      );
    }
  }

  // Phenological stage comparison (orientative platanera targets).
  let stageComparison: StageComparison | null = null;
  const stageText =
    input.stageOverride ?? input.sector?.phenologicalStage ?? input.farm.phenologicalStage ?? "";
  const profile = stageText ? STAGE_PROFILES.find((p) => p.match.test(stageText)) : undefined;
  if (profile && plantCount > 0) {
    const nPerPlantG = round((nutrients.n * 1000) / plantCount, 1);
    const k2oPerPlantG = round((nutrients.k2o * 1000) / plantCount, 1);
    const statusOf = (v: number, [lo, hi]: [number, number]) =>
      v < lo ? ("low" as const) : v > hi ? ("high" as const) : ("ok" as const);
    stageComparison = {
      stageLabel: profile.label,
      nPerPlantG,
      k2oPerPlantG,
      nMinG: profile.n[0],
      nMaxG: profile.n[1],
      k2oMinG: profile.k2o[0],
      k2oMaxG: profile.k2o[1],
      nStatus: statusOf(nPerPlantG, profile.n),
      k2oStatus: statusOf(k2oPerPlantG, profile.k2o),
    };
    const describe = (label: string, v: number, [lo, hi]: [number, number], status: "low" | "ok" | "high") =>
      status === "ok"
        ? null
        : `${label} ${status === "high" ? "por encima" : "por debajo"} del rango orientativo para ${profile.label} (${v} g/planta/semana frente a ${lo}–${hi}): revisar con el técnico.`;
    for (const w of [
      describe("Aporte de N", stageComparison.nPerPlantG, profile.n, stageComparison.nStatus),
      describe("Aporte de K2O", stageComparison.k2oPerPlantG, profile.k2o, stageComparison.k2oStatus),
    ]) {
      if (w) warnings.push(w);
    }
  } else if (nutrients.n > 0 && weeklyWaterLitres > 0) {
    const nPerPlantG = (nutrients.n * 1000) / Math.max(plantCount, 1);
    if (nPerPlantG > 25) {
      warnings.push(
        `Aporte de N elevado (${round(nPerPlantG, 1)} g/planta/semana): revisar frente a la fase fenológica.`,
      );
    }
    if (!stageText) {
      warnings.push(
        "Sin fase fenológica indicada en la finca o el sector: no se puede contrastar el programa con los rangos orientativos por fase.",
      );
    }
  }

  return {
    weeklyWaterLitres: round(weeklyWaterLitres, 0),
    weeklyWaterM3: round(weeklyWaterLitres / 1000, 1),
    nutrients,
    estimatedEcDsM,
    waterEcDsM,
    fertilizersEcDsM,
    waterContribution,
    sar,
    warnings,
    compatibilityIssues,
    stageComparison,
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
