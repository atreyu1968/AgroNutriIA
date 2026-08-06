import { test } from "node:test";
import assert from "node:assert/strict";
import { runEngine } from "./engine";
import type { Analysis, Farm, Fertilizer, RecommendationItem } from "@workspace/db";

const farm = {
  plantCount: 1000,
  weeklyLitresPerPlant: 100,
  maxEcDsM: 2.5,
} as Farm;

const nitratoPotasico = {
  id: 1,
  name: "Nitrato potásico",
  nPct: 13,
  k2oPct: 46,
  ecContribution: 1.3,
} as Fertilizer;

const items: RecommendationItem[] = [
  { fertilizerId: 1, fertilizerName: "Nitrato potásico", weeklyDose: 50, unit: "kg" } as RecommendationItem,
];

function waterAnalysis(params: { name: string; value: number; unit?: string }[]): Analysis {
  return { type: "water", parameters: params } as unknown as Analysis;
}

test("water EC at source is included in estimated EC and reported separately", () => {
  const out = runEngine({
    farm,
    fertilizers: [nitratoPotasico],
    items,
    waterAnalysis: waterAnalysis([{ name: "Conductividad eléctrica", value: 1.8, unit: "dS/m" }]),
  });
  assert.equal(out.waterEcDsM, 1.8);
  assert.ok(out.fertilizersEcDsM != null && out.fertilizersEcDsM > 0);
  assert.equal(out.estimatedEcDsM, Math.round((1.8 + out.fertilizersEcDsM!) * 100) / 100);
});

test("water EC in µS/cm is normalised to dS/m", () => {
  const out = runEngine({
    farm,
    fertilizers: [nitratoPotasico],
    items,
    waterAnalysis: waterAnalysis([{ name: "Conductividad", value: 1800, unit: "µS/cm" }]),
  });
  assert.equal(out.waterEcDsM, 1.8);
});

test("warns when water EC alone reaches the farm max EC", () => {
  const out = runEngine({
    farm,
    fertilizers: [nitratoPotasico],
    items,
    waterAnalysis: waterAnalysis([{ name: "Conductividad", value: 2.6 }]),
  });
  assert.ok(out.warnings.some((w) => w.includes("agua en origen") && w.includes("2600 µS/cm")));
});

test("warns with water/fertilizer EC breakdown when total exceeds max", () => {
  const out = runEngine({
    farm,
    fertilizers: [nitratoPotasico],
    items: [{ ...items[0], weeklyDose: 200 } as RecommendationItem],
    waterAnalysis: waterAnalysis([{ name: "Conductividad", value: 1.5 }]),
  });
  assert.ok(out.estimatedEcDsM! > 2.5);
  assert.ok(out.warnings.some((w) => w.includes("del agua") && w.includes("Margen disponible")));
});

test("explicit µS/cm label wins over the magnitude heuristic", () => {
  const out = runEngine({
    farm,
    fertilizers: [nitratoPotasico],
    items,
    waterAnalysis: waterAnalysis([{ name: "Conductividad", value: 20, unit: "µS/cm" }]),
  });
  assert.equal(out.waterEcDsM, 0.02);
});

test("reports measured water pH when present in the analysis", () => {
  const out = runEngine({
    farm,
    fertilizers: [nitratoPotasico],
    items,
    waterAnalysis: waterAnalysis([{ name: "pH", value: 8.1 }]),
  });
  assert.equal(out.waterPh, 8.1);
});

test("does not fabricate an estimated pH when alkalinity/bicarbonates are missing", () => {
  const out = runEngine({
    farm,
    fertilizers: [nitratoPotasico],
    items,
    waterAnalysis: waterAnalysis([
      { name: "pH", value: 8.1 },
      { name: "Cloro", value: 1, unit: "mg/L" },
    ]),
  });
  assert.equal(out.waterPh, 8.1);
  assert.equal(out.estimatedWaterPh, null);
  assert.ok(out.warnings.some((w) => w.includes("alcalinidad")));
});

test("does not estimate pH when the water analysis has no pH", () => {
  const out = runEngine({
    farm,
    fertilizers: [nitratoPotasico],
    items,
    waterAnalysis: waterAnalysis([{ name: "Conductividad", value: 1.5 }]),
  });
  assert.equal(out.waterPh, null);
  assert.equal(out.estimatedWaterPh, null);
  assert.ok(out.warnings.some((w) => w.includes("pH")));
});

test("estimates the solution pH from an acidifying program against a buffered water", () => {
  const sulfAm = {
    id: 2,
    name: "Sulfato amónico",
    nPct: 21,
    nAmmoniacalPct: 21,
  } as Fertilizer;
  const out = runEngine({
    farm: { ...farm, plantCount: 1000, weeklyLitresPerPlant: 150 },
    fertilizers: [sulfAm],
    items: [{ fertilizerId: 2, fertilizerName: "Sulfato amónico", weeklyDose: 100, unit: "kg" } as RecommendationItem],
    waterAnalysis: waterAnalysis([
      { name: "pH", value: 8.2 },
      { name: "Alcalinidad", value: 300, unit: "mg/L" },
    ]),
  });
  assert.equal(out.waterPh, 8.2);
  assert.ok(out.estimatedWaterPh != null);
  assert.ok(out.estimatedWaterPh <= out.waterPh);
  // El desplazamiento no puede ser extremo con agua tamponada a 6 meq/L.
  assert.ok(out.estimatedWaterPh >= 6.5);
});

test("independent acid (nítrico) lowers the estimated pH and adds its CE", () => {
  const out = runEngine({
    farm: { ...farm, plantCount: 1000, weeklyLitresPerPlant: 150 },
    fertilizers: [nitratoPotasico],
    items,
    waterAnalysis: waterAnalysis([
      { name: "pH", value: 8.2 },
      { name: "Alcalinidad", value: 300, unit: "mg/L" },
    ]),
    acid: { type: "nitrico", targetPh: 6.0 },
  });
  assert.ok(out.acid != null);
  assert.equal(out.acid.type, "nitrico");
  assert.ok(out.acid.litersPerWeek != null && out.acid.litersPerWeek > 0);
  assert.ok(out.acid.ecDsM > 0);
  assert.ok(out.estimatedWaterPh != null);
  assert.ok(out.estimatedWaterPh < 8.2);
});

test("acid requested above the water pH is ignored with a warning", () => {
  const out = runEngine({
    farm: { ...farm, plantCount: 1000, weeklyLitresPerPlant: 100 },
    fertilizers: [nitratoPotasico],
    items,
    waterAnalysis: waterAnalysis([
      { name: "pH", value: 7.0 },
      { name: "Alcalinidad", value: 200, unit: "mg/L" },
    ]),
    acid: { type: "sulfurico", targetPh: 8.0 },
  });
  assert.ok(out.acid != null);
  assert.equal(out.acid.targetPh, null);
  assert.ok(out.warnings.some((w) => w.includes("pH objetivo")));
});

test("groups fertilizers into NPK and Calcio blocks by compatibility", () => {
  const nitroCalcico = {
    id: 3,
    name: "Nitrato cálcico",
    nPct: 15,
    caoPct: 27,
  } as Fertilizer;
  const out = runEngine({
    farm,
    fertilizers: [nitratoPotasico, nitroCalcico],
    items: [
      { fertilizerId: 1, fertilizerName: "Nitrato potásico", weeklyDose: 50, unit: "kg" } as RecommendationItem,
      { fertilizerId: 3, fertilizerName: "Nitrato cálcico", weeklyDose: 40, unit: "kg" } as RecommendationItem,
    ],
    waterAnalysis: waterAnalysis([]),
  });
  const keys = out.blocks.map((b) => b.key);
  assert.ok(keys.includes("npk"));
  assert.ok(keys.includes("calcio"));
  const calcio = out.blocks.find((b) => b.key === "calcio")!;
  assert.ok(calcio.items.some((i) => i.name === "Nitrato cálcico"));
  const npk = out.blocks.find((b) => b.key === "npk")!;
  assert.ok(npk.items.some((i) => i.name === "Nitrato potásico"));
  // El calcio nunca comparte tanque con el NPK (bloques separados).
  assert.ok(!keys.includes("npk") || calcio.items.every((i) => i.name !== "Nitrato potásico"));
});

test("independent acid appears as its own separado block", () => {
  const out = runEngine({
    farm: { ...farm, plantCount: 1000, weeklyLitresPerPlant: 100 },
    fertilizers: [nitratoPotasico],
    items,
    waterAnalysis: waterAnalysis([
      { name: "pH", value: 8.0 },
      { name: "Alcalinidad", value: 250, unit: "mg/L" },
    ]),
    acid: { type: "nitrico", targetPh: 6.5 },
  });
  const acidBlock = out.blocks.find((b) => b.key === "acido");
  assert.ok(acidBlock != null);
  assert.ok(acidBlock.note?.includes("independiente"));
});

test("nutrients in non-mg/L units are skipped with a warning instead of misread", () => {
  const out = runEngine({
    farm,
    fertilizers: [nitratoPotasico],
    items,
    waterAnalysis: waterAnalysis([{ name: "Nitratos", value: 2, unit: "mmol/L" }]),
  });
  assert.equal(out.waterContribution.no3, undefined);
  assert.ok(out.warnings.some((w) => w.includes("unidad distinta de mg/L")));
});

test("water nitrates and sulfates are reported as weekly contributions", () => {
  const out = runEngine({
    farm,
    fertilizers: [nitratoPotasico],
    items,
    waterAnalysis: waterAnalysis([
      { name: "Nitratos", value: 40, unit: "mg/L" },
      { name: "Sulfatos", value: 120, unit: "mg/L" },
    ]),
  });
  // 100000 L/week: 40 mg/L -> 4 kg NO3; 120 mg/L -> 12 kg SO4
  assert.equal(out.waterContribution.no3, 4);
  assert.equal(out.waterContribution.so4, 12);
});

test("compara el programa con la fase fenológica (parón invernal: N alto)", () => {
  const out = runEngine({
    farm: { ...farm, phenologicalStage: "parón invernal" } as Farm,
    fertilizers: [nitratoPotasico],
    items,
    waterAnalysis: null,
  });
  // 50 kg * 13% N = 6.5 kg / 1000 plantas = 6.5 g/planta (rango 3-8 => ok)
  assert.ok(out.stageComparison);
  assert.equal(out.stageComparison!.nStatus, "ok");
  // K2O: 50*46% = 23 kg -> 23 g/planta (rango 5-15 => high)
  assert.equal(out.stageComparison!.k2oStatus, "high");
  assert.ok(out.warnings.some((w) => w.includes("K2O") && w.includes("parón invernal")));
});

test("la fase del sector tiene prioridad sobre la de la finca", () => {
  const out = runEngine({
    farm: { ...farm, phenologicalStage: "engorde" } as Farm,
    sector: { phenologicalStage: "pre-floración", plantCount: 1000, weeklyLitresPerPlant: 100 } as never,
    fertilizers: [nitratoPotasico],
    items,
    waterAnalysis: null,
  });
  assert.equal(out.stageComparison?.stageLabel, "pre-floración / parición");
});

test("sin fase fenológica se mantiene el aviso genérico", () => {
  const out = runEngine({
    farm,
    fertilizers: [nitratoPotasico],
    items: [{ ...items[0], weeklyDose: 250 } as RecommendationItem],
    waterAnalysis: null,
  });
  assert.equal(out.stageComparison, null);
  assert.ok(out.warnings.some((w) => w.includes("fase fenológica")));
});

// --- Rangos por fase modulados por el técnico ---

// Con nitrato potásico 13/46 a 50 kg/semana y 1000 plantas:
// N = 6,5 g/planta/semana, K2O = 23 g/planta/semana.
const engordeFarm = (stageNutrientRanges: Farm["stageNutrientRanges"]) =>
  ({
    plantCount: 1000,
    weeklyLitresPerPlant: 100,
    maxEcDsM: 2.5,
    phenologicalStage: "engorde del racimo",
    stageNutrientRanges,
  }) as Farm;

const ENGORDE_DEFAULT_N: [number, number] = [10, 18];
const ENGORDE_DEFAULT_K2O: [number, number] = [30, 50];

test("el motor aplica los rangos del técnico cuando N y K2O son ambos válidos", () => {
  const out = runEngine({
    farm: engordeFarm({ engorde: { n: [5, 10], k2o: [20, 30] } }),
    fertilizers: [nitratoPotasico],
    items,
  });
  const sc = out.stageComparison!;
  assert.ok(sc, "debe haber contraste de fase");
  assert.equal(sc.rangeSource, "tecnico");
  assert.deepEqual([sc.nMinG, sc.nMaxG], [5, 10]);
  assert.deepEqual([sc.k2oMinG, sc.k2oMaxG], [20, 30]);
  assert.equal(sc.nStatus, "ok");
  assert.equal(sc.k2oStatus, "ok");
});

test("el motor ignora la modulación si el rango de K2O tiene mínimo mayor que máximo", () => {
  const out = runEngine({
    farm: engordeFarm({ engorde: { n: [5, 10], k2o: [30, 20] } }),
    fertilizers: [nitratoPotasico],
    items,
  });
  const sc = out.stageComparison!;
  assert.equal(sc.rangeSource, "orientativo", "no se mezclan rangos propios y orientativos");
  assert.deepEqual([sc.nMinG, sc.nMaxG], ENGORDE_DEFAULT_N);
  assert.deepEqual([sc.k2oMinG, sc.k2oMaxG], ENGORDE_DEFAULT_K2O);
});

test("el motor ignora la modulación si N contiene valores no finitos", () => {
  const out = runEngine({
    farm: engordeFarm({
      engorde: { n: [Number.NaN, 10] as [number, number], k2o: [20, 30] },
    }),
    fertilizers: [nitratoPotasico],
    items,
  });
  const sc = out.stageComparison!;
  assert.equal(sc.rangeSource, "orientativo");
  assert.deepEqual([sc.nMinG, sc.nMaxG], ENGORDE_DEFAULT_N);
});

test("el motor ignora la modulación si falta uno de los dos rangos", () => {
  const out = runEngine({
    farm: engordeFarm({
      engorde: { n: [5, 10] } as unknown as NonNullable<Farm["stageNutrientRanges"]>[string],
    } as Farm["stageNutrientRanges"]),
    fertilizers: [nitratoPotasico],
    items,
  });
  const sc = out.stageComparison!;
  assert.equal(sc.rangeSource, "orientativo");
  assert.deepEqual([sc.k2oMinG, sc.k2oMaxG], ENGORDE_DEFAULT_K2O);
});

test("la modulación de otra fase no afecta a la fase activa", () => {
  const out = runEngine({
    farm: engordeFarm({ paron: { n: [1, 2], k2o: [3, 4] } }),
    fertilizers: [nitratoPotasico],
    items,
  });
  const sc = out.stageComparison!;
  assert.equal(sc.rangeSource, "orientativo");
  assert.deepEqual([sc.nMinG, sc.nMaxG], ENGORDE_DEFAULT_N);
});

test("fuera del rango del técnico se genera aviso que lo atribuye al técnico", () => {
  const out = runEngine({
    farm: engordeFarm({ engorde: { n: [10, 12], k2o: [30, 40] } }),
    fertilizers: [nitratoPotasico],
    items,
  });
  const sc = out.stageComparison!;
  assert.equal(sc.rangeSource, "tecnico");
  assert.equal(sc.nStatus, "low");
  assert.equal(sc.k2oStatus, "low");
  assert.ok(
    out.warnings.some((w) => w.includes("rango fijado por el técnico")),
    `avisos: ${JSON.stringify(out.warnings)}`,
  );
});

test("micronutrients from fertilizers are added per percentage", () => {
  const fert = {
    id: 7,
    name: "Quelato polimicronutrientes",
    nPct: 0,
    ironPct: 6,
    manganesePct: 2.5,
    zincPct: 3,
    copperPct: 0.5,
    molybdenumPct: 0.1,
    boronPct: 1,
  } as Fertilizer;
  const out = runEngine({
    farm,
    fertilizers: [fert],
    items: [{ fertilizerId: 7, fertilizerName: "Quelato polimicronutrientes", weeklyDose: 4, unit: "kg" } as RecommendationItem],
    waterAnalysis: null,
  });
  assert.equal(out.nutrients.fe, round2(4 * 6 / 100));
  assert.equal(out.nutrients.mn, round2(4 * 2.5 / 100));
  assert.equal(out.nutrients.zn, round2(4 * 3 / 100));
  assert.equal(out.nutrients.cu, round2(4 * 0.5 / 100));
  assert.equal(out.nutrients.mo, round2(4 * 0.1 / 100));
  assert.equal(out.nutrients.b, round2(4 * 1 / 100));
});

test("micronutrients carried by the irrigation water are reported as weekly contribution", () => {
  const out = runEngine({
    farm: { ...farm, plantCount: 1000, weeklyLitresPerPlant: 100 },
    fertilizers: [nitratoPotasico],
    items,
    waterAnalysis: waterAnalysis([
      { name: "Hierro", value: 0.5, unit: "mg/L" },
      { name: "Manganeso", value: 0.3, unit: "mg/L" },
      { name: "Zinc", value: 0.2, unit: "mg/L" },
      { name: "Cobre", value: 0.1, unit: "mg/L" },
      { name: "Molibdeno", value: 0.02, unit: "mg/L" },
    ]),
  });
  const litres = 1000 * 100;
  assert.equal(out.waterContribution.fe, round2(0.5 * litres / 1e6));
  assert.equal(out.waterContribution.mn, round2(0.3 * litres / 1e6));
  assert.equal(out.waterContribution.zn, round2(0.2 * litres / 1e6));
  assert.equal(out.waterContribution.cu, round2(0.1 * litres / 1e6));
  assert.equal(out.waterContribution.mo, round2(0.02 * litres / 1e6));
});

test("water micronutrients in non-mg/L units are skipped with a warning", () => {
  const out = runEngine({
    farm,
    fertilizers: [nitratoPotasico],
    items,
    waterAnalysis: waterAnalysis([
      { name: "Hierro", value: 0.5, unit: "mmol/L" },
    ]),
  });
  assert.equal(out.waterContribution.fe, undefined);
  assert.ok(out.warnings.some((w) => w.includes("Hierro") || w.includes("hierro")));
});

function round2(v: number) {
  return Math.round(v * 1000) / 1000;
}
