import type { Fertilizer, Analysis, Farm, Sector, RecommendationItem } from "@workspace/db";

export type AcidType = "nitrico" | "sulfurico";

/**
 * Ácido para acidificar el agua de riego, en inyección INDEPENDIENTE del tanque
 * de abonado (nunca se mezcla en el mismo bidón que la abonada). Se aporta a
 * parte y su efecto sobre el pH final y la CE se computa por separado.
 * - nitrico: aporta nitrógeno (N nítrico) y acidifica con fuerza.
 * - sulfurico: acidificación fuerte sin aporte de N.
 * No se usa cítrico en ningún concepto (preferencia del técnico).
 */
export type AcidInput = {
  type: AcidType;
  /** pH objetivo orientativo (debe ser < pH del agua). Null → sin meta. */
  targetPh?: number | null;
};

export type FertilizerBlock = {
  key: "npk" | "calcio" | "acido";
  label: string;
  note?: string;
  items: { name: string; weeklyDose: number; unit: string }[];
};

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
  /**
   * Acidificación independiente del agua (inyección separada del tanque de
   * abonado). Se tiene en cuenta para el pH final y para la CE de la solución.
   */
  acid?: AcidInput | null;
};

export type CalculationOutput = {
  weeklyWaterLitres: number;
  weeklyWaterM3: number;
  nutrients: Record<string, number>;
  estimatedEcDsM: number | null;
  waterEcDsM: number | null;
  fertilizersEcDsM: number | null;
  /** pH medido del agua de riego (analítica; parámetro sin unidad). Null si no hay. */
  waterPh: number | null;
  /**
   * pH estimado del agua de riego tras aplicar esta abonada, estimado de forma
   * determinista a partir del balance ácido/base neto del programa frente a la
   * capacidad tampón del agua (alcalinidad/bicarbonatos). Solo se devuelve
   * cuando hay pH de agua Y alcalinidad/bicarbonatos en mg/L; en otro caso es
   * null (dato incompleto) y se avisa en `warnings`.
   */
  estimatedWaterPh: number | null;
  /**
   * Acidificación independiente del agua (inyección separada del tanque de
   * abonado). null cuando no se usa ácido.
   */
  acid: {
    type: AcidType;
    targetPh: number | null;
    /** Litros de producto por semana de riego. null si no se puede estimar. */
    litersPerWeek: number | null;
    /** Aporte a la CE de la solución (dS/m) del ácido añadido. */
    ecDsM: number;
  } | null;
  /** Bloques de mezcla por compatibilidad (nunca se mezclan NPK y calcio). */
  blocks: FertilizerBlock[];
  waterContribution: Record<string, number>;
  sar: number | null;
  warnings: string[];
  compatibilityIssues: string[];
  stageComparison: StageComparison | null;
};

export type StageComparison = {
  stageLabel: string;
  /** "tecnico" si los rangos fueron modulados por el técnico de la finca. */
  rangeSource: "orientativo" | "tecnico";
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
export const STAGE_PROFILES: {
  key: string;
  label: string;
  match: RegExp;
  n: [number, number];
  k2o: [number, number];
}[] = [
  {
    key: "prefloracion",
    label: "pre-floración / parición",
    match: /(pre.?flor|paric|belote|pre.?paric)/i,
    n: [15, 25],
    k2o: [25, 40],
  },
  {
    key: "engorde",
    label: "engorde / llenado del racimo",
    match: /(engord|llenad|racimo|cuaj)/i,
    n: [10, 18],
    k2o: [30, 50],
  },
  {
    key: "paron",
    label: "parón invernal",
    match: /(paron|parón|invern|invierno)/i,
    n: [3, 8],
    k2o: [5, 15],
  },
  {
    key: "postcosecha",
    label: "postcosecha / arranque vegetativo",
    match: /(post.?cosech|corte|arranque|vegetativ)/i,
    n: [12, 20],
    k2o: [15, 30],
  },
];

/** Rango [min, max] de números finitos no negativos con min <= max. */
export function validStageRange(r: unknown): r is [number, number] {
  return (
    Array.isArray(r) &&
    r.length === 2 &&
    r.every((x) => typeof x === "number" && Number.isFinite(x) && x >= 0) &&
    r[0] <= r[1]
  );
}

/** Texto estándar sobre el origen de los rangos por fase, para informes y UI. */
export const STAGE_RANGES_PROVENANCE =
  "Los rangos por fase son orientativos: derivan de referencias generales de fertirrigación de platanera en Canarias " +
  "(≈350–500 kg N/ha·año y ≈700–1000 kg K2O/ha·año con 1800–2400 plantas/ha, modulados estacionalmente) y no de una tabla oficial. " +
  "El técnico responsable puede modularlos para cada finca; deben interpretarse según densidad, variedad, riego y suelo.";

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
/**
 * Normaliza la CE máxima configurada: la app trabaja en dS/m (0,1–10), pero
 * hay fincas con el valor guardado en µS/cm (p. ej. 1400). Valores entre 10 y
 * 10000 se interpretan como µS/cm y se convierten; fuera de rango → null.
 */
export function normalizeMaxEc(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  if (value <= 10) return value;
  if (value <= 10000) return Math.round(value) / 1000 >= 0.1 ? value / 1000 : null;
  return null;
}

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
    fe: 0,
    mn: 0,
    zn: 0,
    cu: 0,
    mo: 0,
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
      // Microelementos: hierro, manganeso, zinc, cobre y molibdeno (% del abono).
      nutrients.fe += (kg * (fert.ironPct ?? 0)) / 100;
      nutrients.mn += (kg * (fert.manganesePct ?? 0)) / 100;
      nutrients.zn += (kg * (fert.zincPct ?? 0)) / 100;
      nutrients.cu += (kg * (fert.copperPct ?? 0)) / 100;
      nutrients.mo += (kg * (fert.molybdenumPct ?? 0)) / 100;
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
      fe: ["hierro", "fe"],
      mn: ["manganeso", "mn"],
      zn: ["zinc", "zn"],
      cu: ["cobre", "cu"],
      mo: ["molibdeno", "mo"],
    };
    for (const [key, names] of Object.entries(map)) {
      const v = mgPerLParam(wa, names);
      if (v != null) waterContribution[key] = round((v * weeklyWaterLitres) / 1e6, 3);
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
    const maxEc = normalizeMaxEc(input.maxEcOverride ?? input.farm.maxEcDsM) ?? 2.5;
    const ecMargin = round(maxEc - (waterEcDsM ?? 0), 2);
    if (waterEcDsM != null && waterEcDsM >= maxEc) {
      warnings.push(
        `La CE del agua en origen (${Math.round(waterEcDsM * 1000)} µS/cm) ya alcanza o supera la CE máxima de la finca (${Math.round(maxEc * 1000)} µS/cm): no hay margen para abonado sin superar el límite. Valorar mezcla con agua de mejor calidad o revisar el límite con el técnico.`,
      );
    } else if (estimatedEcDsM > maxEc) {
      warnings.push(
        `CE estimada de la solución (${Math.round(estimatedEcDsM * 1000)} µS/cm = ${Math.round((waterEcDsM ?? 0) * 1000)} del agua + ${Math.round(fertilizersEcDsM * 1000)} de los abonos) supera el máximo configurado (${Math.round(maxEc * 1000)} µS/cm). Margen disponible para abonos: ${Math.round(ecMargin * 1000)} µS/cm. Repartir dosis en más riegos o reducir concentración.`,
      );
    }
  }

  // pH del agua de riego y pH estimado de la solución con esta abonada.
  // - waterPh: el pH medido de la analítica de agua (parámetro sin unidad).
  // - estimatedWaterPh: estimación determinista y ORIENTATIVA del pH de la
  //   solución tras añadir el programa, a partir del balance ácido/base de los
  //   fertilizantes frente a la capacidad tampón del agua (alcalinidad /
  //   bicarbonatos). Solo se calcula cuando hay pH de agua Y alcalinidad en
  //   mg/L; si falta algún dato se devuelve null y se avisa (nunca se inventa
  //   un número sin soporte de datos).
  const waterPh = param(wa, ["ph"]);
  let estimatedWaterPh: number | null = null;

  // Ácido en inyección independiente (nunca se mezcla con el tanque de abonado).
  // - nitrico: fuerte, aporta N (N nítrico) y acidifica.
  // - sulfurico: acidificación fuerte sin aporte de N.
  // No se usa ácido cítrico (preferencia del técnico).
  // Fuerza ácida orientativa en meq H+/L de producto comercial (±50%): nítrico
  // 60% ≈ 13 N, sulfúrico 96% ≈ 36 N. Se usan valores orientativos.
  const ACID_STRENGTH_MEQ_PER_L: Record<AcidType, number> = { nitrico: 13000, sulfurico: 36000 };
  // Aporte orientativo a la CE por meq H+/L en la solución (dS/m): el ácido
  // aporta iones (H+ y anión) que suben la conductividad.
  const ACID_EC_PER_MEQ = 0.1;
  let acidOut: CalculationOutput["acid"] = null;
  if (input.acid) {
    const targetPh =
      input.acid.targetPh != null && Number.isFinite(input.acid.targetPh)
        ? Math.max(4.0, Math.min(9.5, input.acid.targetPh))
        : null;
    acidOut = { type: input.acid.type, targetPh, litersPerWeek: null, ecDsM: 0 };
    if (waterPh != null && targetPh != null) {
      if (targetPh >= waterPh) {
        acidOut.targetPh = null;
        warnings.push(
          "El pH objetivo del ácido no es inferior al pH del agua: no tiene sentido acidificar hacia un pH más alto; se ignora la acidificación.",
        );
      }
    }
  }

  if (waterPh != null && weeklyWaterLitres > 0) {
    // Capacidad tampón del agua en meq/L (alcalinidad o bicarbonatos).
    let bufferMeqPerL: number | null = null;
    const bicarb = mgPerLParam(wa, ["bicarbonato", "hco3"]);
    const alkalinity = mgPerLParam(wa, ["alcalinidad", "alkalinity"]);
    if (bicarb != null) bufferMeqPerL = bicarb / 61.0; // HCO3- (g/mol) → meq/L
    else if (alkalinity != null) bufferMeqPerL = alkalinity / 50.0; // CaCO3 → meq/L
    if (bufferMeqPerL != null && bufferMeqPerL > 0) {
      // Ácido neto aportado por la abonada, en meq H+/L: el N amoniacal y el
      // uréico acidifican (nitrificación: 1 mol N-NH4 → ~2 mol H+). Se usa un
      // factor orientativo reducido para una ventana corta de fertirrigación
      // (0,5 meq H+ por meq de N amoniacal+uréico) y se neutraliza con el
      // tampón del agua. Es una heurística documentada, no una medida.
      const ammoniacalNkg = nutrients.nAmmoniacal + nutrients.nUreic;
      const fertAcidMeqPerL =
        (ammoniacalNkg * (1000 / 14) * 0.5) / weeklyWaterLitres;
      // La acidificación independiente suma H+ a parte (inyección separada).
      let acidOutMeqPerL = 0;
      if (acidOut && acidOut.targetPh != null) {
        // H+ necesarios (meq/L) para bajar de waterPh a targetPh frente al
        // tampón: desplazamiento ΔpH ≈ 0.9·log10(1 + meqH+/buffer) salvo que no
        // haya tampón (entonces cada meq baja ~0.9 unidades de pH de golpe).
        const delta = waterPh - acidOut.targetPh;
        const needed = Math.max(0, Math.pow(10, delta / 0.9) - 1) * bufferMeqPerL;
        const strengthMeqPerL = ACID_STRENGTH_MEQ_PER_L[acidOut.type]; // meq H+/L de producto
        if (needed > 0 && strengthMeqPerL > 0) {
          acidOutMeqPerL = needed;
          acidOut.litersPerWeek = round((needed * weeklyWaterLitres) / strengthMeqPerL, 1);
        }
      }
      // Aporte del ácido a la CE de la solución (dS/m) = H+ en meq/L × factor por meq.
      if (acidOut) acidOut.ecDsM = round(acidOutMeqPerL * ACID_EC_PER_MEQ, 2);
      const coverage = (fertAcidMeqPerL + acidOutMeqPerL) / bufferMeqPerL;
      // Desplazamiento logarítmico orientativo, acotado para no sobrepasar nunca
      // un rango sensato de pH (4,5–9).
      let shift = coverage > 0 ? Math.min(1.3, Math.log10(1 + coverage) * 0.9) : 0;
      let ph = waterPh - shift;
      // El tampón se agota del todo: abajo no puede bajar más el agua sin ácido
      // mineral añadido explícitamente (los fertilizantes tamponan).
      if (coverage > 2) ph = Math.max(ph, 4.0);
      if (acidOutMeqPerL > 0 && acidOut!.targetPh != null) {
        // Con acidificación explícita se persigue el objetivo, acotado a un rango
        // realista (el ácido débil/gran tampón limita la bajada).
        ph = Math.max(acidOut!.targetPh, Math.min(ph, waterPh - 0.2));
      }
      estimatedWaterPh = round(Math.min(9.5, Math.max(4.0, ph)), 1);
    } else if (wa) {
      if (acidOut && acidOut.targetPh != null) {
        // Sin tampón no se puede modelar el desplazamiento exacto de la abonada,
        // pero la corrección de ácido con objetivo permite orientar el pH final
        // de la solución hacia ese objetivo (acotado a un rango realista).
        estimatedWaterPh = round(Math.min(waterPh, Math.max(4.5, acidOut.targetPh)), 1);
        warnings.push(
          "Sin alcalinidad (bicarbonatos) en la analítica de agua: el pH final se orienta al objetivo del ácido, sin poder estimar el desplazamiento exacto de la abonada ni el litrado exacto de acidificación.",
        );
      } else {
        warnings.push(
          "Sin alcalinidad (bicarbonatos) en la analítica de agua: no se puede estimar el pH final de la solución con esta abonada; solo se muestra el pH del agua sin ajustar.",
        );
      }
    }
  } else if (wa) {
    warnings.push(
      "Sin pH en la analítica de agua: no se muestra el pH del agua de riego ni se puede estimar el efecto de esta abonada sobre él.",
    );
  }

  // La acidificación independiente suma su CE a la estimada (inyección separada,
  // fuera del tanque de abonado). Se recalcula el aviso de CE máxima incluyéndola.
  if (acidOut && acidOut.ecDsM > 0 && estimatedEcDsM != null) {
    estimatedEcDsM = round(estimatedEcDsM + acidOut.ecDsM, 2);
    const maxEc = normalizeMaxEc(input.maxEcOverride ?? input.farm.maxEcDsM) ?? 2.5;
    if (estimatedEcDsM > maxEc) {
      warnings.push(
        `La CE estimada con la acidificación (${Math.round(estimatedEcDsM * 1000)} µS/cm) supera el máximo configurado (${Math.round(maxEc * 1000)} µS/cm) ${acidOut.ecDsM > 0 ? `(el ácido aporta ${Math.round(acidOut.ecDsM * 1000)} µS/cm) ` : ""}Prever un riego pre-acidificación para diluir o revisar dosis.`,
      );
    }
  }

  // Bloques de mezcla por compatibilidad de tanques:
  // - NPK (tanque principal): abonos sin calcio (N, P, K, Mg, S, B, quelatos…).
  // - Calcio (tanque separado): abonos con calcio, nunca en el mismo bidón que
  //   fosfatos/sulfatos para evitar precipitados.
  // - Ácido: inyección independiente del tanque de abonado.
  // Si un producto tuviera calcio Y fósforo/sulfato se manda a "calcio" y se
  // avisa, porque no debe mezclarse con el resto que lleve P/S.
  // El ácido nítrico como PRODUCTO del programa (aporte de nitrógeno) va
  // siempre junto al calcio: es la práctica del técnico (el N nítrico se aplica
  // con la línea de calcio). La inyección de acidificación independiente queda
  // en su propio bloque "acido", fuera del tanque.
  const blocks: FertilizerBlock[] = [];
  const npkItems: { name: string; weeklyDose: number; unit: string }[] = [];
  const calcioItems: { name: string; weeklyDose: number; unit: string }[] = [];
  for (const r of resolved) {
    if (!r.fert) continue;
    const isCalcio = (r.fert.caoPct ?? 0) > 0;
    const normalizedName = r.fert.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const isNitricAcidProduct = normalizedName.includes("acido") && normalizedName.includes("nitrico");
    const isPOrS = (r.fert.p2o5Pct ?? 0) > 0 || (r.fert.so3Pct ?? 0) > 0;
    const item = { name: r.item.fertilizerName, weeklyDose: round(r.kg, 2), unit: r.item.unit };
    if (isCalcio || isNitricAcidProduct) {
      calcioItems.push(item);
      if (isPOrS) {
        compatibilityIssues.push(
          `«${r.item.fertilizerName}» aporta calcio y también fósforo/sulfato: no mezclarlo con otros fosfatos/sulfatos en el mismo tanque (riesgo de precipitados).`,
        );
      }
    } else {
      npkItems.push(item);
    }
  }
  if (npkItems.length > 0)
    blocks.push({
      key: "npk",
      label: "NPK",
      note: "Tanque principal. No mezclar con el calcio.",
      items: npkItems,
    });
  if (calcioItems.length > 0)
    blocks.push({
      key: "calcio",
      label: "Calcio",
      note: "Tanque separado: nunca en el mismo bidón que fosfatos/sulfatos (precipitados).",
      items: calcioItems,
    });
  if (acidOut && (acidOut.litersPerWeek ?? 0) > 0)
    blocks.push({
      key: "acido",
      label: acidOut.type === "nitrico" ? "Ácido nítrico" : "Ácido sulfúrico",
      note: "Inyección independiente, fuera del tanque de abonado.",
      items: [
        {
          name: acidOut.type === "nitrico" ? "Ácido nítrico" : "Ácido sulfúrico",
          weeklyDose: acidOut.litersPerWeek!,
          unit: "L",
        },
      ],
    });

  // Phenological stage comparison (orientative platanera targets).
  let stageComparison: StageComparison | null = null;
  const stageText =
    input.stageOverride ?? input.sector?.phenologicalStage ?? input.farm.phenologicalStage ?? "";
  const profile = stageText ? STAGE_PROFILES.find((p) => p.match.test(stageText)) : undefined;
  if (profile && plantCount > 0) {
    // El técnico puede modular los rangos por finca; si no, se usan los orientativos.
    const custom = input.farm.stageNutrientRanges?.[profile.key];
    // Solo se aplica la modulación del técnico si AMBOS rangos son válidos;
    // así nunca se mezclan rangos propios con orientativos bajo la misma etiqueta.
    const useCustom = !!custom && validStageRange(custom.n) && validStageRange(custom.k2o);
    const nRange: [number, number] = useCustom ? (custom!.n as [number, number]) : profile.n;
    const k2oRange: [number, number] = useCustom ? (custom!.k2o as [number, number]) : profile.k2o;
    const rangeSource: "orientativo" | "tecnico" = useCustom ? "tecnico" : "orientativo";
    const nPerPlantG = round((nutrients.n * 1000) / plantCount, 1);
    const k2oPerPlantG = round((nutrients.k2o * 1000) / plantCount, 1);
    const statusOf = (v: number, [lo, hi]: [number, number]) =>
      v < lo ? ("low" as const) : v > hi ? ("high" as const) : ("ok" as const);
    stageComparison = {
      stageLabel: profile.label,
      rangeSource,
      nPerPlantG,
      k2oPerPlantG,
      nMinG: nRange[0],
      nMaxG: nRange[1],
      k2oMinG: k2oRange[0],
      k2oMaxG: k2oRange[1],
      nStatus: statusOf(nPerPlantG, nRange),
      k2oStatus: statusOf(k2oPerPlantG, k2oRange),
    };
    const rangeWord = rangeSource === "tecnico" ? "rango fijado por el técnico" : "rango orientativo";
    const describe = (label: string, v: number, [lo, hi]: [number, number], status: "low" | "ok" | "high") =>
      status === "ok"
        ? null
        : `${label} ${status === "high" ? "por encima" : "por debajo"} del ${rangeWord} para ${profile.label} (${v} g/planta/semana frente a ${lo}–${hi}): revisar con el técnico.`;
    for (const w of [
      describe("Aporte de N", stageComparison.nPerPlantG, nRange, stageComparison.nStatus),
      describe("Aporte de K2O", stageComparison.k2oPerPlantG, k2oRange, stageComparison.k2oStatus),
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
    waterPh,
    estimatedWaterPh,
    acid: acidOut,
    blocks,
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
