import type { Analysis, AnalysisParameter, Farm } from "@workspace/db";
import { normalizeMaxEc, param, waterEcDsMFrom } from "./engine";
import { cationBalanceReport } from "./cationBalance";

/**
 * Motor de problemas del cultivo.
 *
 * Cruza las analíticas de suelo, foliar y agua para DETECTAR desequilibrios y
 * acoplar a cada uno su recomendación práctica de abonado. Todo vive aquí para
 * que las reglas sean idénticas en el contexto de la IA y en el aviso web
 * (no se duplican normas entre cliente y servidor).
 *
 * Arquitectura extensible: cada problema es un detector que recibe el contexto
 * (suelo/foliar/agua/finca) y devuelve 0..n problemas. Añadir un problema nuevo
 * es escribir otro detector y registrarlo en DETECTORS; el resto (contexto IA,
 * endpoint, aviso web) lo genera el motor automáticamente.
 *
 * Alcance por sectores: el motor en sí es agnóstico (recibe analíticas ya
 * resueltas). Quien lo invoca decide el alcance: el endpoint
 * GET /farms/:farmId/analyses/problems acepta `?sectorId=` opcional y resuelve
 * cada analítica con latestAnalysisScoped (las del sector primero, con
 * fallback a las globales de la finca); sin sectorId opera a nivel finca con
 * las analíticas globales y, si falta alguna, con UN único sector de respaldo.
 * Nunca se mezclan analíticas de sectores distintos en un mismo diagnóstico.
 */

export type ProblemSeverity = "info" | "warning" | "critical";

export type FertilityProblem = {
  id: string;
  severity: ProblemSeverity;
  title: string;
  /** Qué ocurre según los datos (para el usuario y la IA). */
  message: string;
  /** Qué hacer en el programa para resolverlo. */
  advice: string;
  /** Analíticas que evidencian el problema. */
  sources: ("soil" | "leaf" | "water")[];
};

export type ProblemsInput = {
  soil: Analysis | null;
  leaf: Analysis | null;
  water: Analysis | null;
  /** Necesaria para límites como la CE máxima de la finca. */
  farm?: Farm | null;
};

export type ProblemsReport = {
  problems: FertilityProblem[];
  /** Contexto legible para la IA (vacío si no hay problemas). */
  contextBlock: string;
  /** Avisos planos para el banner web (vacío si no hay problemas). */
  warnings: string[];
};

const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/** Divide un nombre de parámetro en tokens para matchear símbolos cortos sin falso positivo dentro de palabras. */
function tokens(s: string): string[] {
  return norm(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

const wordIn = (toks: string[], w: string) => toks.includes(w);
const sym = (toks: string[], s: string) => toks.includes(s);

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

const NUTRIENT_GROUPS: Record<
  string,
  { full: string[]; sym: string[]; labels: string[] }
> = {
  nitrogeno: { full: ["nitrogeno", "nitrato", "amoniacal"], sym: ["n"], labels: ["nitrógeno", "N"] },
  fosforo: { full: ["fosforo", "fosforico"], sym: ["p"], labels: ["fósforo", "P"] },
  potasio: { full: ["potasio"], sym: ["k"], labels: ["potasio", "K"] },
  calcio: { full: ["calcio"], sym: ["ca"], labels: ["calcio", "Ca"] },
  magnesio: { full: ["magnesio"], sym: ["mg"], labels: ["magnesio", "Mg"] },
  hierro: { full: ["hierro"], sym: ["fe"], labels: ["hierro", "Fe"] },
  zinc: { full: ["zinc"], sym: ["zn"], labels: ["zinc", "Zn"] },
  manganeso: { full: ["manganeso"], sym: ["mn"], labels: ["manganeso", "Mn"] },
  boro: { full: ["boro"], sym: ["b"], labels: ["boro", "B"] },
};

function leafParam(
  leaf: Analysis | null | undefined,
  group: (typeof NUTRIENT_GROUPS)[string],
): AnalysisParameter | undefined {
  return findParam(leaf, (toks) =>
    group.full.some((w) => wordIn(toks, w) || toks.some((t) => t.startsWith(w))) ||
    group.sym.some((s) => sym(toks, s)),
  );
}

function isLow(p: AnalysisParameter): boolean {
  return (
    p.status === "bajo" ||
    p.status === "muy_bajo" ||
    (p.refLow != null && p.value < p.refLow && p.status == null)
  );
}

// ---------------------------------------------------------------------------
// Detectores
// ---------------------------------------------------------------------------

/** Calcio foliar bajo con calcio de suelo disponible ⇒ problema de absorción. */
function detectCalciumAbsorption(input: ProblemsInput): FertilityProblem[] {
  const { soil, leaf, water } = input;
  const cation = cationBalanceReport(soil, leaf);
  const s = cation.summary;
  const foliarCa = leafParam(leaf, NUTRIENT_GROUPS.calcio);
  if (!s.foliarCaLow || !s.soilCaAvailable || !foliarCa) return [];

  const causes: string[] = [];
  if (s.saturation?.na != null && s.saturation.na > 8)
    causes.push(`el sodio de cambio está muy alto (${round(s.saturation.na)} %, busca < 8 %)`);
  if (s.saturation?.mg != null && s.saturation.mg > 20)
    causes.push(`el magnesio compite con el calcio (${round(s.saturation.mg)} %)`);
  if (s.ph != null && s.ph > 8) causes.push(`el pH es demasiado alcalino (${s.ph})`);
  // El agua también puede aportar sodio/alcalinidad que agrava el bloqueo.
  if (water) {
    const na = param(water, ["sodio", "na"]);
    if (na != null && na > 0) causes.push(`el agua de riego aporta sodio (${round(na)} ${NA_UNIT(water)})`);
  }
  const causaTxt = causes.length
    ? ` Se debe a: ${causes.join("; ")}.`
    : " Suele deberse a un exceso de sodio o magnesio en el complejo de cambio y/o a un pH alcalino.";

  return [
    {
      id: "calcium_absorption",
      severity: "critical",
      title: "Calcio bloqueado (problema de absorción)",
      message:
        `El calcio foliar está bajo (${round(foliarCa.value)} ${foliarCa.unit ?? "%"}) pero el suelo tiene calcio disponible:` +
        ` el calcio NO está llegando bien a la planta; no es falta de aporte, sino de absorción.${causaTxt}`,
      advice:
        "Prioriza el aporte de calcio con nitrato cálcico; NO uses sulfato amónico (compite con el calcio) ni aportes extra de magnesio; completa el potasio con sulfato potásico u otra fuente sin cloruros; acidifica el agua de riego (p. ej. con ácido nítrico) hacia pH ≈ 6–6,2 y, si el drenaje lo permite, considera riegos de lavado para arrastrar el sodio.",
      sources: soil && leaf ? ["soil", "leaf"] : water ? ["soil", "leaf", "water"] : ["soil", "leaf"],
    },
  ];
}

function NA_UNIT(w: Analysis): string {
  const e = param(w, ["sodio", "na"]);
  void e;
  return "mg/L";
}

/** Exceso de sodio en el suelo (saturación de sodio alta). */
function detectSoilSodium(input: ProblemsInput): FertilityProblem[] {
  const s = cationBalanceReport(input.soil, input.leaf).summary;
  if (s.saturation?.na == null || s.saturation.na <= 8) return [];
  return [
    {
      id: "soil_sodium",
      severity: "warning",
      title: "Exceso de sodio en el suelo",
      message: `La saturación de sodio es del ${round(s.saturation.na)} % (lo deseable es < 8 %). El sodio ocupa los sitios de intercambio, degrada la estructura del suelo y dificulta la absorción de calcio y potasio.`,
      advice:
        "No añadas más sodio: evita fertilizantes y aguas ricas en sodio o cloruros. Aporta enmiendas cálcicas (p. ej. yeso) para desplazar el sodio y, si el drenaje lo permite, aplica riegos de lavado. Vigila el SAR del agua de riego.",
      sources: input.soil ? ["soil"] : [],
    },
  ];
}

/** Salinidad del agua de riego respecto a la CE máxima de la finca. */
function detectWaterSalinity(input: ProblemsInput): FertilityProblem[] {
  const waterEc = waterEcDsMFrom(input.water);
  if (waterEc == null) return [];
  const maxEc = normalizeMaxEc(input.farm?.maxEcDsM) ?? null;
  let out: FertilityProblem[] = [];
  if (maxEc != null && waterEc >= maxEc) {
    out.push({
      id: "water_salinity_limit",
      severity: "critical",
      title: "El agua de riego ya supera la CE máxima",
      message: `La conductividad del agua en origen es ${round(waterEc, 2)} dS/m y la CE máxima admisible de la finca es ${maxEc} dS/m: el agua por sí sola ya alcanza o supera el límite y no hay margen para abonado sin superarlo.`,
      advice:
        "Propón dosis mínimas repartidas en más riegos, prioriza el riego de lavado y revisa la calidad/captación del agua (desalar, mezclar con agua de mejor calidad o corregir el aporte de sales en el abonado). No añadas fertilizantes que eleven más la CE.",
      sources: ["water"],
    });
  } else if (maxEc != null && waterEc >= 0.7 * maxEc) {
    out.push({
      id: "water_salinity_tight",
      severity: "warning",
      title: "Margen de CE del agua muy ajustado",
      message: `El agua en origen tiene ${round(waterEc, 2)} dS/m y la CE máxima admisible es ${maxEc} dS/m (margen ${round(maxEc - waterEc, 2)} dS/m). Cualquier abonado que sume CE puede superar el límite.`,
      advice:
        "Mantén la suma de aportaciones de CE de los fertilizantes por debajo del margen disponible y reparte las dosis en más riegos para no saturar la solución.",
      sources: ["water"],
    });
  } else if (waterEc >= 1.1 && maxEc == null) {
    out.push({
      id: "water_salinity_high_nolimit",
      severity: "info",
      title: "Conductividad del agua a vigilar",
      message: `El agua de riego tiene ${round(waterEc, 2)} dS/m, un valor considerable para platanera.`,
      advice: "Revisa la calidad del agua y, si es posible, define una CE máxima admisible en la ficha de la finca.",
      sources: ["water"],
    });
  }
  return out;
}

/** pH del suelo alcalino: reduce la disponibilidad de micros y de calcio. */
function detectSoilPh(input: ProblemsInput): FertilityProblem[] {
  const ph = cationBalanceReport(input.soil, input.leaf).summary.ph;
  if (ph == null || ph <= 8) return [];
  return [
    {
      id: "soil_ph_alkaline",
      severity: "warning",
      title: "pH del suelo demasiado alcalino",
      message: `El pH del suelo es ${ph} (el rango óptimo de platanera está por debajo de 7,5–8). Un pH tan alcalino reduce la eficiencia de absorción de varios nutrientes, principalmente el calcio y los micronutrientes (hierro, zinc, manganeso, boro).`,
      advice:
        "Acidifica el agua de riego (p. ej. con ácido nítrico) hacia pH ≈ 6–6,2, prioriza fuentes acidificantes y, para micros bloqueados por el pH, considera la aplicación foliar o formas quelatadas.",
      sources: input.soil ? ["soil"] : [],
    },
  ];
}

/**
 * Deficiencias foliares de macro/micronutrientes (excepto calcio, que se trata
 * en detectCalciumAbsorption) detectadas por status/referencia. El arsenal del
 * diagnóstico debe diferenciar "falta de aporte" de "no llega a la planta".
 */
function detectLeafDeficiencies(input: ProblemsInput): FertilityProblem[] {
  const out: FertilityProblem[] = [];
  for (const [key, group] of Object.entries(NUTRIENT_GROUPS)) {
    if (key === "calcio") continue; // la absorción de calcio se trata aparte
    const p = leafParam(input.leaf, group);
    if (!p || !isLow(p)) continue;
    const label = group.labels[0];
    out.push({
      id: `leaf_${key}`,
      severity: p.status === "muy_bajo" ? "warning" : "info",
      title: `${label} foliar bajo`,
      message:
        `${label} en hoja: ${round(p.value)} ${p.unit ?? ""} (ref ${p.refLow ?? "-"}–${p.refHigh ?? "-"})${p.status ? ` [${p.status}]` : ""}.` +
        ` Antes de subir dosis, hay que distinguir si es falta de aporte o un problema de absorción: compruébalo contra la disponibilidad en el suelo y el pH.`,
      advice:
        "Si el suelo tiene el nutriente disponible y el pH/la saturación de Na-Mg son anómalos, corrige primero la absorción (ver avisos de calcio/sodio/pH). Si el problema es de aporte, prioriza la fuente que corrija el/la " + label + " sin sobrecargar el equilibrio del suelo.",
      sources: input.leaf ? ["leaf"] : [],
    });
  }
  return out;
}

/** Detector combinado cuando aun sin foliar, los cationes de suelo muestran desequilibrio Ca/Mg/K. */
function detectSoilCationBalance(input: ProblemsInput): FertilityProblem[] {
  const s = cationBalanceReport(input.soil, input.leaf).summary;
  if (!s.saturation) return [];
  const out: FertilityProblem[] = [];
  if (s.saturation.ca < 60) {
    out.push({
      id: "soil_ca_low_saturation",
      severity: "warning",
      title: "Calcio de cambio por debajo del objetivo",
      message: `El calcio ocupa el ${round(s.saturation.ca)} % del complejo de cambio (se busca 60–80 %). Un calcio de cambio bajo deja el suelo más vulnerable al sodio y al magnesio y reduce la nutrición cálcica.`,
      advice:
        "Refuerza el calcio con enmiendas o abonos cálcicos de baja salinidad (p. ej. nitrato cálcico o yeso) y reduce la competencia de sodio/magnesio antes de saturar el aporte.",
      sources: input.soil ? ["soil"] : [],
    });
  }
  if (s.saturation.mg > 20) {
    out.push({
      id: "soil_mg_high_saturation",
      severity: "warning",
      title: "Magnesio de cambio elevado",
      message: `El magnesio ocupa el ${round(s.saturation.mg)} % del complejo de cambio y compite directamente con el calcio por la absorción.`,
      advice: "Evita aportes extra de magnesio mientras el calcio esté en riesgo y equilibra la relación Ca/Mg.",
      sources: input.soil ? ["soil"] : [],
    });
  }
  return out;
}

const DETECTORS: ((input: ProblemsInput) => FertilityProblem[])[] = [
  detectCalciumAbsorption,
  detectSoilSodium,
  detectWaterSalinity,
  detectSoilPh,
  detectLeafDeficiencies,
  detectSoilCationBalance,
];

const SEVERITY_ORDER: Record<ProblemSeverity, number> = { critical: 0, warning: 1, info: 2 };

export function runProblems(input: ProblemsInput): ProblemsReport {
  const problems: FertilityProblem[] = [];
  const seen = new Set<string>();
  for (const detect of DETECTORS) {
    for (const p of detect(input)) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        problems.push(p);
      }
    }
  }
  problems.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const contextBlock = problems.length
    ? `\nPROBLEMAS DETECTADOS EN LAS ANALÍTICAS (calculado por la aplicación, cruza suelo+foliar+agua):\n` +
      problems
        .map(
          (p) =>
            `- ${p.severity.toUpperCase()}: ${p.title}. ${p.message}\n  Recomendación: ${p.advice}`,
        )
        .join("\n")
    : "";

  const warnings = problems.map((p) =>
    p.severity === "critical" ? `[CRÍTICO] ${p.title}: ${p.message}` : `${p.title}: ${p.message}`,
  );

  return { problems, contextBlock, warnings };
}
