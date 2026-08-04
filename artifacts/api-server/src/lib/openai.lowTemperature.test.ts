import { test } from "node:test";
import assert from "node:assert/strict";
import { lowTemperatureParam } from "./openai";

// lowTemperatureParam: temperatura 0.2 para modelos "normales" (los borradores
// de programas deben ser estables), omitida para modelos razonadores que no
// admiten temperatura distinta de la por defecto.

type Cred = { provider: string; selectedModel: string | null };
const cred = (provider: string, selectedModel: string | null): Cred => ({
  provider,
  selectedModel,
});

test("modelos estándar reciben temperature 0.2", () => {
  assert.deepEqual(lowTemperatureParam(cred("openai", "gpt-4o")), { temperature: 0.2 });
  assert.deepEqual(lowTemperatureParam(cred("openai", "gpt-4o-mini")), { temperature: 0.2 });
  assert.deepEqual(lowTemperatureParam(cred("openai", "gpt-4.1")), { temperature: 0.2 });
  assert.deepEqual(lowTemperatureParam(cred("mistral", "mistral-large-latest")), {
    temperature: 0.2,
  });
  assert.deepEqual(lowTemperatureParam(cred("mistral", "mistral-small-latest")), {
    temperature: 0.2,
  });
  assert.deepEqual(lowTemperatureParam(cred("deepseek", "deepseek-chat")), { temperature: 0.2 });
});

test("sin modelo seleccionado se usa el modelo por defecto del proveedor (no razonador) → 0.2", () => {
  assert.deepEqual(lowTemperatureParam(cred("openai", null)), { temperature: 0.2 });
  assert.deepEqual(lowTemperatureParam(cred("mistral", null)), { temperature: 0.2 });
  assert.deepEqual(lowTemperatureParam(cred("deepseek", null)), { temperature: 0.2 });
});

test("modelos razonadores omiten la temperatura", () => {
  assert.deepEqual(lowTemperatureParam(cred("openai", "gpt-5")), {});
  assert.deepEqual(lowTemperatureParam(cred("openai", "gpt-5-mini")), {});
  assert.deepEqual(lowTemperatureParam(cred("openai", "o1")), {});
  assert.deepEqual(lowTemperatureParam(cred("openai", "o1-mini")), {});
  assert.deepEqual(lowTemperatureParam(cred("openai", "o3")), {});
  assert.deepEqual(lowTemperatureParam(cred("openai", "o3-mini")), {});
  assert.deepEqual(lowTemperatureParam(cred("openai", "o4-mini")), {});
  assert.deepEqual(lowTemperatureParam(cred("deepseek", "deepseek-reasoner")), {});
});

test("alias con mayúsculas también se detectan como razonadores", () => {
  assert.deepEqual(lowTemperatureParam(cred("openai", "GPT-5")), {});
  assert.deepEqual(lowTemperatureParam(cred("openai", "O1-Preview")), {});
  assert.deepEqual(lowTemperatureParam(cred("openai", "O3-Mini")), {});
  assert.deepEqual(lowTemperatureParam(cred("deepseek", "DeepSeek-Reasoner")), {});
  // Y los estándar en mayúsculas siguen recibiendo 0.2.
  assert.deepEqual(lowTemperatureParam(cred("openai", "GPT-4O")), { temperature: 0.2 });
});
