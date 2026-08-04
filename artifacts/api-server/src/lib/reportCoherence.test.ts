import test from "node:test";
import assert from "node:assert/strict";
import type { Analysis } from "@workspace/db";
import {
  checkAmendmentCoherence,
  mergeCoherenceIssues,
  soilPh,
} from "./reportCoherence";

function soilWith(ph: number | null): Analysis {
  return {
    id: 1,
    farmId: 1,
    sectorId: null,
    type: "soil",
    reference: "S-1",
    laboratory: null,
    description: null,
    sampleDate: "2026-01-15",
    parameters: ph == null ? [] : [{ name: "pH", value: ph, unit: null }],
    notes: null,
    createdBy: null,
    createdAt: new Date(),
  } as Analysis;
}

test("soilPh extrae el pH y descarta valores imposibles", () => {
  assert.equal(soilPh(soilWith(8.2)), 8.2);
  assert.equal(soilPh(soilWith(null)), null);
  assert.equal(soilPh(null), null);
  assert.equal(soilPh(soilWith(0)), null);
  assert.equal(soilPh(soilWith(20)), null);
});

test("detecta caliza recomendada con pH alcalino", () => {
  const issues = checkAmendmentCoherence(
    "Aplicar caliza calcítica a 3 t/ha para mejorar la estructura.",
    soilWith(8.1),
  );
  assert.equal(issues.length, 1);
  assert.match(issues[0], /calizas.*pH de suelo de 8\.1/);
});

test("detecta la contradicción «caliza para corregir la alcalinidad» aun sin pH", () => {
  const issues = checkAmendmentCoherence(
    "Se recomienda enmienda caliza para corregir la alcalinidad del suelo.",
    soilWith(null),
  );
  assert.equal(issues.length, 1);
  assert.match(issues[0], /corregir la alcalinidad/);
});

test("detecta acidificantes con suelo ya ácido", () => {
  const issues = checkAmendmentCoherence(
    "Aportar azufre elemental a 500 kg/ha para acidificar.",
    soilWith(5.4),
  );
  assert.equal(issues.length, 1);
  assert.match(issues[0], /acidificar.*5\.4/);
});

test("no marca nada en un plan coherente", () => {
  assert.deepEqual(
    checkAmendmentCoherence(
      "- Caliza dolomítica: 2 t/ha incorporada con labor.\n- Estiércol maduro: 30 t/ha.",
      soilWith(5.8),
    ),
    [],
  );
  assert.deepEqual(
    checkAmendmentCoherence(
      "- Yeso agrícola: 4 t/ha en superficie.\n- Azufre elemental: 1.500 kg/ha.",
      soilWith(8.3),
    ),
    [],
  );
});

test("detecta dosis fuera de rango (t/ha y kg/ha con separador de miles)", () => {
  const issues = checkAmendmentCoherence(
    "- Caliza calcítica: 15 t/ha de fondo.\n- Azufre elemental: 4.000 kg/ha.",
    soilWith(6.8),
  );
  assert.equal(issues.length, 2);
  assert.match(issues[0], /enmienda caliza.*15\.000 kg\/ha/);
  assert.match(issues[1], /azufre.*4\.?000 kg\/ha/);
});

test("las dosis decimales con coma se interpretan bien", () => {
  assert.deepEqual(
    checkAmendmentCoherence("- Yeso agrícola: 7,5 t/ha.", soilWith(8.0)),
    [],
  );
  const issues = checkAmendmentCoherence("- Yeso agrícola: 12,5 t/ha.", soilWith(8.0));
  assert.equal(issues.length, 1);
});

test("mergeCoherenceIssues deduplica y limita a 8", () => {
  const fixed = ["a", "b"];
  const ai = ["b", "c", "d", "e", "f", "g", "h", "i", "j"];
  const merged = mergeCoherenceIssues(fixed, ai);
  assert.equal(merged.length, 8);
  assert.deepEqual(merged.slice(0, 3), ["a", "b", "c"]);
});
