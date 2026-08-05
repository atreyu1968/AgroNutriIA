import { test } from "node:test";
import assert from "node:assert/strict";
import { cationBalanceReport } from "./cationBalance";
import type { Analysis } from "@workspace/db";

function analysis(type: "soil" | "leaf", parameters: Analysis["parameters"]): Analysis {
  return { type, parameters } as unknown as Analysis;
}

// Datos equivalentes a los del seed de AgroSabina (finca de demostración).
const soilAlkalineHighNa = analysis("soil", [
  { name: "pH", value: 8.72, unit: "", refLow: 6.0, refHigh: 7.5, status: "muy_alto" },
  { name: "Calcio de cambio", value: 21.9, unit: "meq/100g", refLow: 8, refHigh: 25, status: "normal" },
  { name: "Magnesio de cambio", value: 14.2, unit: "meq/100g", refLow: 2, refHigh: 8, status: "muy_alto" },
  { name: "Potasio de cambio", value: 5.82, unit: "meq/100g", refLow: 0.5, refHigh: 2.5, status: "muy_alto" },
  { name: "Sodio de cambio", value: 8.64, unit: "meq/100g", refLow: 0, refHigh: 2, status: "muy_alto" },
]);

const leafCalciumLow = analysis("leaf", [
  { name: "Calcio (Ca)", value: 0.88, unit: "%", refLow: 1.0, refHigh: 1.5, status: "bajo" },
]);

const soilBalanced = analysis("soil", [
  { name: "pH", value: 7.0, unit: "", refLow: 6.0, refHigh: 7.5, status: "normal" },
  { name: "Calcio de cambio", value: 24, unit: "meq/100g", status: "normal" },
  { name: "Magnesio de cambio", value: 3, unit: "meq/100g", status: "normal" },
  { name: "Potasio de cambio", value: 2, unit: "meq/100g", status: "normal" },
  { name: "Sodio de cambio", value: 0.5, unit: "meq/100g", status: "normal" },
]);

const leafCalciumOk = analysis("leaf", [
  { name: "Calcio (Ca)", value: 1.2, unit: "%", refLow: 1.0, refHigh: 1.5, status: "normal" },
]);

test("detecta sodio de cambio alto y calcula la saturación de bases", () => {
  const r = cationBalanceReport(soilAlkalineHighNa, leafCalciumLow);
  assert.ok(r.summary.saturation, "debe calcular la saturación");
  const sat = r.summary.saturation!;
  // Esperado a partir de los meq/100g del seed.
  assert.ok(Math.abs(sat.ca - 43.3) < 0.2, `Ca ${sat.ca}`);
  assert.ok(Math.abs(sat.mg - 28.1) < 0.2, `Mg ${sat.mg}`);
  assert.ok(Math.abs(sat.na - 17.1) < 0.2, `Na ${sat.na}`);
  assert.ok(r.warnings.some((w) => w.includes("sodio")), "avisa del sodio alto");
  assert.ok(r.warnings.some((w) => w.includes("alcalino")), "avisa del pH alcalino");
});

test("cruza foliar bajo con suelo disponible y avisa de calcio bloqueado", () => {
  const r = cationBalanceReport(soilAlkalineHighNa, leafCalciumLow);
  assert.equal(r.summary.foliarCaLow, true);
  assert.equal(r.summary.soilCaAvailable, true);
  assert.ok(
    r.warnings.some((w) => w.includes("calcio") && w.includes("NO está llegando")),
    "debe diagnosticar calcio bloqueado",
  );
});

test("incluye recomendación práctica del programa en el contexto de la IA", () => {
  const r = cationBalanceReport(soilAlkalineHighNa, leafCalciumLow);
  assert.ok(r.contextBlock.includes("DIAGNÓSTICO DE EQUILIBRIO CATIÓNICO"));
  assert.ok(r.contextBlock.includes("nitrato cálcico"));
  assert.ok(r.contextBlock.includes("sulfato amónico"));
});

test("suelo equilibrado sin foliar da pocos avisos y sin bloqueo", () => {
  const r = cationBalanceReport(soilBalanced, leafCalciumOk);
  assert.equal(r.warnings.length, 0);
  // La saturación equilibrada se informa al contexto (sin consecuencias ni avisos).
  assert.ok(r.contextBlock.includes("DIAGNÓSTICO DE EQUILIBRIO CATIÓNICO"));
  assert.ok(!r.contextBlock.includes("nitrato cálcico"), "no debe recomendar nitrato cálcico");
  assert.equal(r.summary.soilCaAvailable, true);
  assert.equal(r.summary.foliarCaLow ?? false, false);
});

test("sin analíticas no genera contextBlock ni avisos", () => {
  const r = cationBalanceReport(null, null);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.contextBlock, "");
  assert.equal(r.summary.soilCaAvailable, false);
});

test("saturación entregada directamente en % se usa sin recalcular", () => {
  const soil = analysis("soil", [
    { name: "Saturación de bases - Ca (%)", value: 62, unit: "%", status: "normal" },
    { name: "Saturación de bases - Mg (%)", value: 22, unit: "%", status: "muy_alto" },
    { name: "Saturación de bases - K (%)", value: 8, unit: "%", status: "normal" },
    { name: "Saturación de bases - Na (%)", value: 8, unit: "%", status: "alto" },
  ]);
  const r = cationBalanceReport(soil, leafCalciumLow);
  assert.ok(r.summary.saturation, "debe leer la saturación en %");
  assert.equal(r.summary.saturation!.ca, 62);
  assert.equal(r.summary.saturation!.na, 8);
});

test("unidades mixtas (meq y %) no recalculan una saturación inválida", () => {
  const soil = analysis("soil", [
    { name: "Calcio de cambio", value: 21.9, unit: "meq/100g", status: "normal" },
    { name: "Magnesio de cambio", value: 25, unit: "%", status: "muy_alto" },
    { name: "Potasio de cambio", value: 5.82, unit: "meq/100g", status: "muy_alto" },
    { name: "Sodio de cambio", value: 8.64, unit: "meq/100g", status: "muy_alto" },
  ]);
  const r = cationBalanceReport(soil, leafCalciumLow);
  assert.equal(r.summary.saturation ?? null, null, "no debe recalcular con unidades mixtas");
});

test("«capacidad»/«catiónico» no producen falsos positivos de calcio/sodio", () => {
  const soil = analysis("soil", [
    { name: "Capacidad de intercambio (CIC)", value: 45, unit: "meq/100g", status: "normal" },
    { name: "Relación catiónica", value: 3, unit: "", status: "normal" },
    { name: "N (nitrógeno)", value: 0.3, unit: "%", status: "normal" },
  ]);
  const r = cationBalanceReport(soil, analysis("leaf", []));
  // Sin cationes de cambio reconocidos: sin saturación ni avisos de sodio.
  assert.equal(r.summary.saturation ?? null, null);
  assert.equal(r.warnings.length, 0);
});

test("tercio: cationes en meq con sodio alto pero Ca foliar bajo → aviso de absorción", () => {
  const r = cationBalanceReport(soilAlkalineHighNa, leafCalciumLow);
  assert.equal(r.summary.soilCaAvailable, true);
  assert.equal(r.summary.foliarCaLow, true);
  assert.ok(
    r.warnings.some((w) => w.includes("absorción") && w.includes("calcio")),
    "diagnostica calcio bloqueado (problema de absorción)",
  );
});
