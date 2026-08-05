import type { Analysis, AnalysisParameter } from "@workspace/db";

/**
 * Diagnóstico determinista del equilibrio catiónico del suelo (intercambio
 * catiónico) cruzado con la analítica foliar.
 *
 * Reproduce la lógica que un técnico de campo usa cuando detecta que el calcio
 * foliar está bajo pero el calcio del suelo está disponible: el problema no es
 * de aporte, sino de ABSORCIÓN (el calcio no llega a la planta) por el
 * antagonismo de sodio y magnesio y el pH alcalino.
 *
 * Todo el cálculo vive aquí para que las reglas sean idénticas en el contexto
 * de la IA y en el aviso que ve el usuario en la web (no se duplican normas
 * entre cliente y servidor).
 */

const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

export type CationBalanceReport = {
  /** Avisos legibles para el usuario (banner web). Vacío si no hay desequilibrio. */
  warnings: string[];
  /** Bloque de texto para el contexto de la IA. Vacío si no hay datos. */
  contextBlock: string;
  /** Resumen numérico derivado (para tests/introspección). */
  summary: {
    ph?: number;
    /** Saturación de bases (%) calculada desde cationes de cambio (meq/100g). */
    saturation?: { ca: number; mg: number; k: number; na: number };
    foliarCaLow?: boolean;
    soilCaAvailable?: boolean;
  };
};

/** Normaliza un texto para comparar nombres de parámetro. */
const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function tokens(s: string): string[] {
  return norm(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Encuentra un parámetro cuyo nombre cumpla el predicado de tokens. */
function findParam(
  a: Analysis | null | undefined,
  match: (toks: string[], p: AnalysisParameter) => boolean,
): AnalysisParameter | undefined {
  if (!a) return undefined;
  for (const p of a.parameters ?? []) {
    if (match(tokens(p.name), p)) return p;
  }
  return undefined;
}

/** Token exacto (delimitado): las abreviaturas cortas «ca/mg/k/na» no deben
 *  matchear por prefijo (p. ej. «catiónico», «capacidad», «calizo»). */
const exactToken = (toks: string[], t: string) => toks.includes(t);
/** La palabra completa del elemento (calcio/magnesio/potasio/sodio). */
const wordIn = (toks: string[], w: string) => toks.some((x) => x === w);

/** Detecta un parámetro del catión de cambio. isExchange exige que el parámetro
 *  sea claramente un catión de intercambio (por nombre o unidad meq), para no
 *  mezclar con aportes totales o suelos en %. */
function exchangeableCation(
  soil: Analysis | null | undefined,
  kind: "calcio" | "magnesio" | "potasio" | "sodio",
): AnalysisParameter | undefined {
  return findParam(soil, (toks, p) => {
    const isExchange =
      toks.includes("cambio") ||
      toks.includes("intercambiable") ||
      toks.includes("intercambio") ||
      (p.unit ?? "").toLowerCase().includes("meq");
    let isKind = false;
    if (kind === "calcio") isKind = wordIn(toks, "calcio") || exactToken(toks, "ca");
    else if (kind === "magnesio") isKind = wordIn(toks, "magnesio") || exactToken(toks, "mg");
    else if (kind === "potasio") isKind = wordIn(toks, "potasio") || exactToken(toks, "k");
    else isKind = wordIn(toks, "sodio") || exactToken(toks, "na");
    return isExchange && isKind;
  });
}

const isMeqUnit = (u: string | null | undefined) =>
  (u ?? "").toLowerCase().replace(/\s/g, "").includes("meq");

/** ¿Todas las unidades son meq/100g (comparables)? Se evita mezclar saturación
 *  directa en % con meq/100g y recalcular una saturación inválida. */
function sameMeqUnits(cats: (AnalysisParameter | undefined)[]): boolean {
  return cats.every((p) => p && isMeqUnit(p.unit));
}

/** Saturación directa en % (parámetros «Saturación de Ca (%)»), sin recalcular. */
function saturationFromPercentParams(
  soil: Analysis | null | undefined,
): { ca: number; mg: number; k: number; na: number } | null {
  const val = (kind: "calcio" | "magnesio" | "potasio" | "sodio"): number | null => {
    const p = findParam(soil, (toks) => {
      const isSaturation = toks.some((x) => x.startsWith("saturac"));
      let isKind = false;
      if (kind === "calcio") isKind = wordIn(toks, "calcio") || exactToken(toks, "ca");
      else if (kind === "magnesio") isKind = wordIn(toks, "magnesio") || exactToken(toks, "mg");
      else if (kind === "potasio") isKind = wordIn(toks, "potasio") || exactToken(toks, "k");
      else isKind = wordIn(toks, "sodio") || exactToken(toks, "na");
      return isSaturation && isKind;
    });
    return p && p.value != null ? p.value : null;
  };
  const ca = val("calcio");
  const mg = val("magnesio");
  const k = val("potasio");
  const na = val("sodio");
  if (ca == null || mg == null || k == null || na == null) return null;
  return { ca, mg, k, na };
}

/**
 * Calcula la saturación de bases (%) desde los cationes de cambio en meq/100g.
 * Solo si están los cuatro cationes en la misma unidad comparable.
 */
function computeSaturation(
  soil: Analysis | null | undefined,
): { ca: number; mg: number; k: number; na: number } | null {
  // Si el laboratorio ya entrega la saturación en %, se usa directamente.
  const fromPct = saturationFromPercentParams(soil);
  if (fromPct) return fromPct;

  const ca = exchangeableCation(soil, "calcio");
  const mg = exchangeableCation(soil, "magnesio");
  const k = exchangeableCation(soil, "potasio");
  const na = exchangeableCation(soil, "sodio");
  if (!ca || !mg || !k || !na) return null;
  // Solo se recalcula si los cuatro están en meq (unidad comparable); si llegan
  // en unidades mixtas (meq y %), no se recalcula para no dar una saturación inválida.
  if (!sameMeqUnits([ca, mg, k, na])) return null;
  const sum = ca.value + mg.value + k.value + na.value;
  if (!(sum > 0)) return null;
  return {
    ca: (ca.value / sum) * 100,
    mg: (mg.value / sum) * 100,
    k: (k.value / sum) * 100,
    na: (na.value / sum) * 100,
  };
}

function soilPh(soil: Analysis | null | undefined): number | undefined {
  const p = findParam(soil, (toks) => toks.includes("ph"));
  return p?.value;
}

/** Calcio foliar (bajo / muy bajo) según status o frente a su referencia. */
function foliarCalcium(
  leaf: Analysis | null | undefined,
): { value: number; low: boolean } | undefined {
  const p = findParam(leaf, (toks) => wordIn(toks, "calcio") || exactToken(toks, "ca"));
  if (!p) return undefined;
  const low =
    p.status === "bajo" ||
    p.status === "muy_bajo" ||
    (p.refLow != null && p.value < p.refLow);
  return { value: p.value, low };
}

/** ¿El calcio del suelo está disponible (normal o alto)? */
function soilCalciumAvailable(
  soil: Analysis | null | undefined,
  saturation: { ca: number } | null,
): boolean {
  const p = exchangeableCation(soil, "calcio");
  if (!p) return false;
  const statusOk = p.status == null || p.status === "normal" || p.status === "alto" || p.status === "muy_alto";
  const aboveRef = p.refLow == null || p.value >= p.refLow;
  // Con saturación de Ca por debajo del 60 % el calcio está disponible pero en
  // intercambio escaso; aun así no es "déficit de aporte", seguimos considerándolo
  // disponible para poder avisar del problema de absorción.
  return statusOk && aboveRef;
}

export function cationBalanceReport(
  soil: Analysis | null | undefined,
  leaf: Analysis | null | undefined,
): CationBalanceReport {
  const warnings: string[] = [];
  const lines: string[] = [];
  const saturation = computeSaturation(soil);
  const ph = soilPh(soil);
  const foliarCa = foliarCalcium(leaf);
  const summary: CationBalanceReport["summary"] = {};
  if (ph != null) summary.ph = ph;
  if (saturation) summary.saturation = saturation;
  if (foliarCa) summary.foliarCaLow = foliarCa.low;
  summary.soilCaAvailable = soilCalciumAvailable(soil, saturation);

  if (saturation) {
    lines.push(
      `Equilibrio de bases del suelo (intercambio catiónico) — Ca ${round(saturation.ca)} %, Mg ${round(saturation.mg)} %, K ${round(saturation.k)} %, Na ${round(saturation.na)} %` +
        ` (referencias platanera: Ca 60–80 %, Na < 8 %, Mg moderado).`,
    );
    if (saturation.na > 8) {
      warnings.push(
        `El sodio de cambio está muy alto (${round(saturation.na)} % de la saturación; lo deseable es < 8 %). Ocupa los sitios de intercambio del suelo, dificulta la función radicular y compite indirectamente con el calcio.`,
      );
    }
    if (saturation.ca < 60) {
      warnings.push(
        `El calcio de cambio está por debajo del objetivo (${round(saturation.ca)} %; se busca 60–80 %). El calcio no ocupa suficiente sitio de intercambio.`,
      );
    }
    if (saturation.mg > 20) {
      warnings.push(
        `El magnesio de cambio está elevado (${round(saturation.mg)} %) y compite directamente con el calcio por la absorción.`,
      );
    }
  }

  if (ph != null && ph > 8) {
    warnings.push(
      `El pH del suelo es muy alcalino (${ph}; el rango óptimo de platanera está por debajo de 7,5–8). Un pH tan alcalino reduce la eficiencia de absorción de varios nutrientes, entre ellos el calcio.`,
    );
  }

  const blocked =
    !!foliarCa?.low && !!summary.soilCaAvailable;
  if (blocked) {
    warnings.push(
      `El calcio foliar está bajo (${foliarCa!.value}) pero el suelo tiene calcio disponible: el calcio NO está llegando bien a la planta (problema de absorción, no de falta de aporte).${
        saturation?.na && saturation.na > 8
          ? " Se debe sobre todo al sodio de cambio alto."
          : ""
      }${ph != null && ph > 8 ? " El pH alcalino lo agrava." : ""}`,
    );
  }

  // Traducción práctica para el programa de abonado.
  if (blocked || (saturation?.na != null && saturation.na > 8) || (ph != null && ph > 8)) {
    lines.push(
      "Consecuencia para el programa: prioriza el aporte de calcio con nitrato cálcico; NO uses sulfato amónico (compite con el calcio) ni aportes extra de magnesio; completa el potasio con sulfato potásico u otra fuente sin cloruros; acidifica el agua de riego (p. ej. con ácido nítrico) hacia pH ≈ 6–6,2 y, si el drenaje lo permite, considera riegos de lavado para arrastrar el sodio.",
    );
  }

  const contextBlock = lines.length
    ? `\nDIAGNÓSTICO DE EQUILIBRIO CATIÓNICO DEL SUELO (calculado por la aplicación):\n${lines.join("\n")}`
    : "";

  return { warnings, contextBlock, summary };
}
