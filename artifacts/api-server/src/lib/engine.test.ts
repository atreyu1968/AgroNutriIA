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
  assert.ok(out.warnings.some((w) => w.includes("agua en origen") && w.includes("2.6")));
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
