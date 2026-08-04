import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AI_PROVIDERS,
  providerFor,
  modelFor,
  usesResponsesApi,
  estimateCostEur,
  clientFor,
} from "./openai";
import { encryptSecret } from "./crypto";
import type { Credential } from "@workspace/db";

function cred(overrides: Partial<Credential>): Credential {
  return {
    id: 1,
    userId: 1,
    provider: "openai",
    name: "test",
    encryptedKey: encryptSecret("sk-test-key-1234567890"),
    maskedKey: "sk-...890",
    selectedModel: null,
    monthlyLimitEur: null,
    isDefault: true,
    isActive: true,
    lastValidatedAt: null,
    status: null,
    createdAt: new Date(),
    ...overrides,
  } as Credential;
}

test("providerFor: credenciales antiguas o desconocidas se tratan como openai", () => {
  assert.equal(providerFor({ provider: "openai" }), "openai");
  assert.equal(providerFor({ provider: "mistral" }), "mistral");
  assert.equal(providerFor({ provider: "deepseek" }), "deepseek");
  assert.equal(providerFor({ provider: "otro-cualquiera" }), "openai");
});

test("modelFor: usa el modelo elegido o el por defecto del proveedor", () => {
  assert.equal(modelFor({ provider: "openai", selectedModel: "gpt-4o" }), "gpt-4o");
  assert.equal(modelFor({ provider: "openai", selectedModel: null }), "gpt-4o-mini");
  assert.equal(modelFor({ provider: "mistral", selectedModel: null }), "mistral-small-latest");
  assert.equal(modelFor({ provider: "deepseek", selectedModel: null }), "deepseek-chat");
});

test("usesResponsesApi: solo OpenAI", () => {
  assert.equal(usesResponsesApi({ provider: "openai" }), true);
  assert.equal(usesResponsesApi({ provider: "mistral" }), false);
  assert.equal(usesResponsesApi({ provider: "deepseek" }), false);
});

test("estimateCostEur: todos los modelos ofertados tienen precio propio", () => {
  for (const info of Object.values(AI_PROVIDERS)) {
    for (const model of info.models) {
      const cost = estimateCostEur(model, 1_000_000, 0);
      const fallback = estimateCostEur("modelo-inexistente", 1_000_000, 0);
      // Cada modelo debe tener tarifa propia (ninguna coincide con el fallback
      // salvo el propio gpt-4o-mini, que ES el fallback).
      if (model !== "gpt-4o-mini") {
        assert.notEqual(cost, fallback, `sin precio para ${model}`);
      }
      assert.ok(cost > 0);
    }
  }
});

test("maxOutputTokensParam: max_completion_tokens solo para OpenAI", async () => {
  const { maxOutputTokensParam } = await import("./openai");
  assert.deepEqual(maxOutputTokensParam({ provider: "openai" }, 100), { max_completion_tokens: 100 });
  assert.deepEqual(maxOutputTokensParam({ provider: "mistral" }, 100), { max_tokens: 100 });
  assert.deepEqual(maxOutputTokensParam({ provider: "deepseek" }, 100), { max_tokens: 100 });
});

test("capacidades por modelo: deepseek-reasoner sin tools ni JSON mode", async () => {
  const { supportsFunctionCalling, supportsJsonResponseFormat } = await import("./openai");
  assert.equal(supportsFunctionCalling({ provider: "deepseek", selectedModel: "deepseek-reasoner" }), false);
  assert.equal(supportsJsonResponseFormat({ provider: "deepseek", selectedModel: "deepseek-reasoner" }), false);
  assert.equal(supportsFunctionCalling({ provider: "deepseek", selectedModel: "deepseek-chat" }), true);
  assert.equal(supportsFunctionCalling({ provider: "mistral", selectedModel: null }), true);
  assert.equal(supportsJsonResponseFormat({ provider: "openai", selectedModel: "gpt-4o" }), true);
});

test("parseJsonLoose: JSON directo, con vallas y con texto alrededor", async () => {
  const { parseJsonLoose } = await import("./openai");
  assert.deepEqual(parseJsonLoose('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonLoose('Aquí tienes:\n{"a":{"b":2}}\nEspero que sirva.'), { a: { b: 2 } });
  assert.throws(() => parseJsonLoose("sin json"));
});

test("clientFor: apunta a la URL base del proveedor", () => {
  assert.match(String(clientFor(cred({ provider: "mistral" })).baseURL), /api\.mistral\.ai/);
  assert.match(String(clientFor(cred({ provider: "deepseek" })).baseURL), /api\.deepseek\.com/);
  assert.match(String(clientFor(cred({ provider: "openai" })).baseURL), /api\.openai\.com/);
});
