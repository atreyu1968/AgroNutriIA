import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import app from "../app";
import { SESSION_COOKIE } from "./auth";

// Protección CSRF: las mutaciones autenticadas por cookie solo se aceptan
// si el Origin/Referer es del propio dominio (o de la lista de confianza).

let server: Server;
let base: string;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("rechaza mutación con cookie y Origin de otro dominio", async () => {
  const res = await fetch(`${base}/api/auth/logout`, {
    method: "POST",
    headers: {
      cookie: `${SESSION_COOKIE}=fake-token`,
      origin: "https://evil.example.com",
    },
  });
  assert.equal(res.status, 403);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /origen/i);
});

test("rechaza mutación con cookie y Referer de otro dominio", async () => {
  const res = await fetch(`${base}/api/auth/logout`, {
    method: "POST",
    headers: {
      cookie: `${SESSION_COOKIE}=fake-token`,
      referer: "https://evil.example.com/ataque.html",
    },
  });
  assert.equal(res.status, 403);
});

test("permite mutación con cookie y Origin del propio host", async () => {
  const res = await fetch(`${base}/api/auth/logout`, {
    method: "POST",
    headers: {
      cookie: `${SESSION_COOKIE}=fake-token`,
      origin: base,
    },
  });
  assert.notEqual(res.status, 403);
});

test("permite mutación sin Origin/Referer (móvil, scripts)", async () => {
  const res = await fetch(`${base}/api/auth/logout`, {
    method: "POST",
    headers: { cookie: `${SESSION_COOKIE}=fake-token` },
  });
  assert.notEqual(res.status, 403);
});

test("permite mutación con Bearer aunque el Origin sea externo", async () => {
  const res = await fetch(`${base}/api/auth/logout`, {
    method: "POST",
    headers: {
      authorization: "Bearer fake-token",
      origin: "https://evil.example.com",
    },
  });
  assert.notEqual(res.status, 403);
});

test("no concede CORS con credenciales a orígenes desconocidos", async () => {
  const res = await fetch(`${base}/api/auth/config`, {
    headers: { origin: "https://evil.example.com" },
  });
  assert.equal(res.headers.get("access-control-allow-origin"), null);
  assert.equal(res.headers.get("access-control-allow-credentials"), null);
});
