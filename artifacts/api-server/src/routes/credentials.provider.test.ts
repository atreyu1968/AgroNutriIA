import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { inArray } from "drizzle-orm";
import { db, pool, usersTable, sessionsTable, credentialsTable } from "@workspace/db";
import { UpdateCredentialResponse } from "@workspace/api-zod";
import app from "../app";

// Cambio de proveedor de una credencial de IA ya guardada (PATCH
// /settings/openai/:id): el proveedor se puede cambiar, el modelo indicado
// debe pertenecer al proveedor efectivo y, si no se indica modelo al cambiar
// de proveedor, se reajusta al modelo por defecto del nuevo proveedor.

let server: Server;
let baseUrl: string;
let token: string;
const suffix = randomUUID();
const createdEmails: string[] = [];

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let raw: unknown = null;
  try {
    raw = text ? JSON.parse(text) : null;
  } catch {
    raw = text;
  }
  return { status: res.status, raw };
}

async function createCredential(body: Record<string, unknown>): Promise<number> {
  const { status, raw } = await api("POST", "/settings/openai", {
    name: `Cred ${randomUUID().slice(0, 8)}`,
    apiKey: "sk-test-key-1234567890",
    ...body,
  });
  assert.equal(status, 201);
  return (raw as { id: number }).id;
}

before(async () => {
  const [u] = await db
    .insert(usersTable)
    .values({
      email: `cred-provider-${suffix}@test.local`,
      passwordHash: "x",
      name: "Usuario credenciales",
    })
    .returning();
  createdEmails.push(u.email);
  token = randomUUID();
  await db.insert(sessionsTable).values({
    id: token,
    userId: u.id,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await db.delete(usersTable).where(inArray(usersTable.email, createdEmails));
  await pool.end();
});

test("cambiar de proveedor sin indicar modelo reajusta al modelo por defecto del nuevo proveedor", async () => {
  const id = await createCredential({ provider: "openai", selectedModel: "gpt-4o" });
  const { status, raw } = await api("PATCH", `/settings/openai/${id}`, { provider: "mistral" });
  assert.equal(status, 200);
  const body = UpdateCredentialResponse.parse(raw);
  assert.equal(body.provider, "mistral");
  assert.equal(body.selectedModel, "mistral-small-latest");
});

test("cambiar de proveedor con un modelo válido del nuevo proveedor lo respeta", async () => {
  const id = await createCredential({ provider: "openai" });
  const { status, raw } = await api("PATCH", `/settings/openai/${id}`, {
    provider: "deepseek",
    selectedModel: "deepseek-reasoner",
  });
  assert.equal(status, 200);
  const body = UpdateCredentialResponse.parse(raw);
  assert.equal(body.provider, "deepseek");
  assert.equal(body.selectedModel, "deepseek-reasoner");
});

test("rechaza un modelo que no pertenece al nuevo proveedor y no cambia nada", async () => {
  const id = await createCredential({ provider: "openai", selectedModel: "gpt-4o-mini" });
  const { status } = await api("PATCH", `/settings/openai/${id}`, {
    provider: "mistral",
    selectedModel: "gpt-4o",
  });
  assert.equal(status, 400);
  const list = await api("GET", "/settings/openai");
  const body = (list.raw as Array<{ id: number; provider: string; selectedModel: string }>).find(
    (c) => c.id === id,
  );
  assert.equal(body?.provider, "openai");
  assert.equal(body?.selectedModel, "gpt-4o-mini");
});

test("rechaza un proveedor desconocido con 400", async () => {
  const id = await createCredential({});
  const { status } = await api("PATCH", `/settings/openai/${id}`, { provider: "anthropic" });
  assert.equal(status, 400);
});

test("actualizar el modelo sin cambiar el proveedor sigue validando contra el proveedor actual", async () => {
  const id = await createCredential({ provider: "mistral" });
  const bad = await api("PATCH", `/settings/openai/${id}`, { selectedModel: "gpt-4o" });
  assert.equal(bad.status, 400);
  const ok = await api("PATCH", `/settings/openai/${id}`, {
    selectedModel: "mistral-large-latest",
  });
  assert.equal(ok.status, 200);
  const body = UpdateCredentialResponse.parse(ok.raw);
  assert.equal(body.provider, "mistral");
  assert.equal(body.selectedModel, "mistral-large-latest");
});

test("mismo proveedor explícito sin modelo no toca el modelo guardado", async () => {
  const id = await createCredential({ provider: "openai", selectedModel: "gpt-5" });
  const { status, raw } = await api("PATCH", `/settings/openai/${id}`, {
    provider: "openai",
    name: "Renombrada",
  });
  assert.equal(status, 200);
  const body = UpdateCredentialResponse.parse(raw);
  assert.equal(body.selectedModel, "gpt-5");
  assert.equal(body.name, "Renombrada");
});
