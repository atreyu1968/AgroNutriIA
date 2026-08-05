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

test("agua con SAR alto (meq/L) → problema de sodicidad", () => {
  const water = a("water", [
    P({ name: "Calcio (Ca)", value: 1.0, unit: "meq/L" }),
    P({ name: "Magnesio (Mg)", value: 1.0, unit: "meq/L" }),
    P({ name: "Sodio (Na)", value: 14, unit: "meq/L" }),
  ]);
  const r = runProblems({ soil: null, leaf: null, water, farm });
  const p = r.problems.find((x) => x.id === "water_sar_high");
  assert.ok(p, "debe detectar SAR alto");
  assert.equal(p!.severity, "critical"); // SAR = 14/√1 = 14 > 12
  assert.ok(p!.message.includes("SAR"));
  assert.ok(p!.advice.toLowerCase().includes("yeso"));
});

test("agua con SAR moderado desde mg/L → warning", () => {
  // Na 184 mg/L = 8 meq/L; Ca 40.08 mg/L = 2 meq/L; Mg 0 → SAR = 8/√1 = 8
  const water = a("water", [
    P({ name: "Calcio", value: 40.08, unit: "mg/L" }),
    P({ name: "Magnesio", value: 0, unit: "mg/L" }),
    P({ name: "Sodio", value: 184, unit: "mg/L" }),
  ]);
  const r = runProblems({ soil: null, leaf: null, water, farm });
  const p = r.problems.find((x) => x.id === "water_sar_high");
  assert.ok(p, "debe detectar SAR elevado desde mg/L");
  assert.equal(p!.severity, "warning");
});

test("agua con alcalinidad residual (CSR) alta → crítico", () => {
  const water = a("water", [
    P({ name: "Calcio (Ca)", value: 1.0, unit: "meq/L" }),
    P({ name: "Magnesio (Mg)", value: 0.5, unit: "meq/L" }),
    P({ name: "Sodio (Na)", value: 3.0, unit: "meq/L" }),
    P({ name: "Bicarbonatos (HCO3)", value: 4.5, unit: "meq/L" }),
    P({ name: "Carbonatos (CO3)", value: 0.5, unit: "meq/L" }),
  ]);
  const r = runProblems({ soil: null, leaf: null, water, farm });
  const p = r.problems.find((x) => x.id === "water_rsc_high");
  assert.ok(p, "debe detectar el carbonato sódico residual"); // RSC = 5 − 1.5 = 3.5
  assert.equal(p!.severity, "critical");
  assert.ok(p!.advice.toLowerCase().includes("acidifica"));
});

test("agua con CSR marginal → warning, y sin riesgo no avisa", () => {
  const marginal = a("water", [
    P({ name: "Calcio", value: 2.0, unit: "meq/L" }),
    P({ name: "Magnesio", value: 1.0, unit: "meq/L" }),
    P({ name: "Sodio", value: 2.0, unit: "meq/L" }),
    P({ name: "Bicarbonatos", value: 4.5, unit: "meq/L" }), // RSC = 1.5
  ]);
  const r1 = runProblems({ soil: null, leaf: null, water: marginal, farm });
  assert.equal(r1.problems.find((x) => x.id === "water_rsc_high")?.severity, "warning");

  const good = a("water", [
    P({ name: "Calcio", value: 4.0, unit: "meq/L" }),
    P({ name: "Magnesio", value: 2.0, unit: "meq/L" }),
    P({ name: "Sodio", value: 2.0, unit: "meq/L" }),
    P({ name: "Bicarbonatos", value: 3.0, unit: "meq/L" }),
  ]);
  const r2 = runProblems({ soil: null, leaf: null, water: good, farm });
  assert.ok(!r2.problems.some((x) => x.id === "water_rsc_high" || x.id === "water_sar_high"));
});

test("la alcalinidad residual se detecta aunque la analítica no traiga sodio", () => {
  const water = a("water", [
    P({ name: "Calcio", value: 1.0, unit: "meq/L" }),
    P({ name: "Magnesio", value: 0.5, unit: "meq/L" }),
    P({ name: "Bicarbonatos (HCO3)", value: 4.5, unit: "meq/L" }), // RSC = 3.0
  ]);
  const r = runProblems({ soil: null, leaf: null, water, farm });
  const p = r.problems.find((x) => x.id === "water_rsc_high");
  assert.ok(p, "el CSR no requiere el parámetro de sodio");
  assert.equal(p!.severity, "critical");
});

test("alcalinidad total expresada como CaCO3 (mg/L) también dispara el CSR", () => {
  // 380 mg/L CaCO3 ÷ 50.04 ≈ 7.59 meq/L; Ca+Mg = 2.5 → RSC ≈ 5.1 (crítico)
  const water = a("water", [
    P({ name: "Calcio", value: 2.0, unit: "meq/L" }),
    P({ name: "Magnesio", value: 0.5, unit: "meq/L" }),
    P({ name: "Alcalinidad total (CaCO3)", value: 380, unit: "mg/L" }),
  ]);
  const r = runProblems({ soil: null, leaf: null, water, farm });
  const p = r.problems.find((x) => x.id === "water_rsc_high");
  assert.ok(p, "la alcalinidad CaCO3 debe convertirse a meq/L para el CSR");
  assert.equal(p!.severity, "critical");
});

test("la alcalinidad CaCO3 no se suma si ya hay HCO3/CO3 explícitos", () => {
  const water = a("water", [
    P({ name: "Calcio", value: 4.0, unit: "meq/L" }),
    P({ name: "Magnesio", value: 2.0, unit: "meq/L" }),
    P({ name: "Bicarbonatos (HCO3)", value: 3.0, unit: "meq/L" }), // RSC = -3 (sin riesgo)
    P({ name: "Alcalinidad total (CaCO3)", value: 380, unit: "mg/L" }), // no debe duplicar
  ]);
  const r = runProblems({ soil: null, leaf: null, water, farm });
  assert.ok(!r.problems.some((x) => x.id === "water_rsc_high"));
});

test("unidades no normalizables (mmol/L) no producen SAR", () => {
  const water = a("water", [
    P({ name: "Calcio", value: 1.0, unit: "mmol/L" }),
    P({ name: "Magnesio", value: 1.0, unit: "meq/L" }),
    P({ name: "Sodio", value: 20, unit: "meq/L" }),
  ]);
  const r = runProblems({ soil: null, leaf: null, water, farm });
  assert.ok(!r.problems.some((x) => x.id === "water_sar_high"));
});

test("los warnings del reporte son planos y legibles", () => {
  const r = runProblems({ soil: soilAlkalineHighNa, leaf: leafCalciumLow, water: null, farm });
  assert.ok(r.warnings.length > 0);
  assert.ok(r.warnings[0].length > 10);
});
