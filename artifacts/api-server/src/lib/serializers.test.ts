import { test } from "node:test";
import assert from "node:assert/strict";
import { serializeRecommendation } from "./serializers";
import type { Recommendation } from "@workspace/db";

const now = new Date("2026-08-03T10:00:00Z");

const base: Recommendation = {
  id: 7,
  farmId: 1,
  sectorId: null,
  title: "Programa propuesto por IA",
  status: "draft",
  source: "ai",
  items: [{ fertilizerName: "Nitrato potásico", weeklyDose: 20, unit: "kg", reason: null }],
  rationale: null,
  estimatedEcDsM: 1.2,
  estimatedWeeklyNKg: 8,
  warnings: [],
  createdBy: 1,
  validatedBy: null,
  updatedBy: 2,
  reviewComment: null,
  createdAt: now,
  updatedAt: now,
};

test("serializeRecommendation expone quién ajustó el borrador (updatedByName)", () => {
  const out = serializeRecommendation(base, "Técnico Virtual", null, "María Pérez");
  assert.equal(out.id, 7);
  assert.equal(out.source, "ai");
  assert.equal(out.createdByName, "Técnico Virtual");
  assert.equal(out.updatedByName, "María Pérez");
});

test("serializeRecommendation devuelve null cuando nadie ha ajustado el borrador", () => {
  const out = serializeRecommendation({ ...base, updatedBy: null }, "Técnico Virtual", null, null);
  assert.equal(out.updatedByName, null);
});
