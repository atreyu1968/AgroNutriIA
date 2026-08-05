import { test } from "node:test";
import assert from "node:assert/strict";
import { runProblems } from "./problems";
import type { Analysis, AnalysisParameter, Farm } from "@workspace/db";

function a(type: "soil" | "leaf" | "water", parameters: AnalysisParameter[]): Analysis {
  return { type, parameters } as unknown as Analysis;
}

const P = (p: Partial<AnalysisParameter> & { name: string; value: number }): AnalysisParameter =>
  ({ unit: null, refLow: null, refHigh: null, status: null, ...p }) as AnalysisParameter;

const farm = { maxEcDsM: 2.5 } as Partial<Farm> & Farm;

const soilAlkalineHighNa = a("soil", [
  P({ name: "pH", value: 8.72, status: "muy_alto" }),
  P({ name: "Calcio de cambio", value: 21.9, unit: "meq/100g", status: "normal" }),
  P({ name: "Magnesio de cambio", value: 14.2, unit: "meq/100g", status: "muy_alto" }),
  P({ name: "Potasio de cambio", value: 5.82, unit: "meq/100g", status: "muy_alto" }),
  P({ name: "Sodio de cambio", value: 8.64, unit: "meq/100g", status: "muy_alto" }),
]);

const leafCalciumLow = a("leaf", [
  P({ name: "Calcio (Ca)", value: 0.88, unit: "%", refLow: 1.0, refHigh: 1.5, status: "bajo" }),
]);

const waterSaline = a("water", [
  P({ name: "Conductividad eléctrica", value: 2.8, unit: "dS/m" }),
  P({ name: "Sodio", value: 120, unit: "mg/L" }),
]);

test("cruza suelo+foliar y detecta calcio bloqueado (absorción) como crítico", () => {
  const r = runProblems({ soil: soilAlkalineHighNa, leaf: leafCalciumLow, water: null, farm });
  const ca = r.problems.find((p) => p.id === "calcium_absorption");
  assert.ok(ca, "debe aparecer el problema de absorción de calcio");
  assert.equal(ca!.severity, "critical");
  assert.ok(ca!.advice.includes("nitrato cálcico"));
  assert.ok(ca!.advice.includes("sulfato amónico"));
  assert.ok(r.contextBlock.includes("PROBLEMAS DETECTADOS"));
});

test("detecta sodio de cambio, pH alcalino y magnesio alto por separado", () => {
  const r = runProblems({ soil: soilAlkalineHighNa, leaf: leafCalciumLow, water: null, farm });
  const ids = r.problems.map((p) => p.id);
  assert.ok(ids.includes("soil_sodium"));
  assert.ok(ids.includes("soil_ph_alkaline"));
  assert.ok(ids.includes("soil_mg_high_saturation"));
});

test("agua salina que supera la CE máxima → problema crítico", () => {
  const r = runProblems({ soil: null, leaf: null, water: waterSaline, farm });
  const p = r.problems.find((x) => x.id === "water_salinity_limit");
  assert.ok(p, "el agua salina debe marcar problema crítico");
  assert.equal(p!.severity, "critical");
});

test("sin analíticas no genera problemas ni bloque", () => {
  const r = runProblems({ soil: null, leaf: null, water: null, farm });
  assert.deepEqual(r.problems, []);
  assert.equal(r.contextBlock, "");
  assert.deepEqual(r.warnings, []);
});

test("deficiencia foliar de potasio por status bajo se detecta", () => {
  const leaf = a("leaf", [
    P({ name: "Potasio (K)", value: 0.9, unit: "%", refLow: 2.5, refHigh: 3.5, status: "bajo" }),
  ]);
  const r = runProblems({ soil: null, leaf, water: null, farm });
  assert.ok(r.problems.some((p) => p.id === "leaf_potasio"));
});

test("los warnings del reporte son planos y legibles", () => {
  const r = runProblems({ soil: soilAlkalineHighNa, leaf: leafCalciumLow, water: null, farm });
  assert.ok(r.warnings.length > 0);
  assert.ok(r.warnings[0].length > 10);
});
