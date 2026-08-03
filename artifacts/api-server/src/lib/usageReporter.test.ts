import { test, after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import {
  countActiveFarms,
  reportUsageOnce,
  sendUsageReport,
  usageReporterConfig,
} from "./usageReporter";

// Reporte automático de uso a la central: configuración por variables de
// entorno, recuento de fincas, cabeceras/cuerpo de la petición y reintentos
// cuando la central no responde.

after(async () => {
  await pool.end();
});

const cfg = { centralUrl: "https://central.example", token: "tok-secreto" };

function fakeFetch(responses: Array<{ ok: boolean; status?: number } | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift() ?? { ok: true };
    if (next instanceof Error) throw next;
    return {
      ok: next.ok,
      status: next.status ?? (next.ok ? 200 : 500),
      text: async () => "detalle del error",
    } as Response;
  }) as typeof fetch;
  return { fn, calls };
}

test("usageReporterConfig requiere CENTRAL_URL e INSTALL_TOKEN y normaliza la URL", () => {
  delete process.env.CENTRAL_URL;
  delete process.env.INSTALL_TOKEN;
  assert.equal(usageReporterConfig(), null);
  process.env.CENTRAL_URL = "https://central.example///";
  assert.equal(usageReporterConfig(), null);
  process.env.INSTALL_TOKEN = "tok";
  assert.deepEqual(usageReporterConfig(), { centralUrl: "https://central.example", token: "tok" });
  delete process.env.CENTRAL_URL;
  delete process.env.INSTALL_TOKEN;
});

test("sendUsageReport envía el token y el número de fincas al endpoint de la central", async () => {
  const { fn, calls } = fakeFetch([{ ok: true }]);
  await sendUsageReport(cfg, 7, fn);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://central.example/api/billing/usage");
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers["x-install-token"], "tok-secreto");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { activeFarms: 7 });
});

test("sendUsageReport lanza con detalle si la central devuelve error", async () => {
  const { fn } = fakeFetch([{ ok: false, status: 401 }]);
  await assert.rejects(() => sendUsageReport(cfg, 1, fn), /401/);
});

test("reportUsageOnce reintenta y acaba reportando", async () => {
  const { fn, calls } = fakeFetch([new Error("ECONNREFUSED"), { ok: false, status: 500 }, { ok: true }]);
  const ok = await reportUsageOnce(cfg, fn, [0, 0, 0]);
  assert.equal(ok, true);
  assert.equal(calls.length, 3);
});

test("reportUsageOnce devuelve false al agotar los reintentos", async () => {
  const { fn, calls } = fakeFetch([new Error("timeout"), new Error("timeout")]);
  const ok = await reportUsageOnce(cfg, fn, [0]);
  assert.equal(ok, false);
  assert.equal(calls.length, 2);
});

test("countActiveFarms devuelve un entero no negativo", async () => {
  const n = await countActiveFarms();
  assert.equal(Number.isInteger(n), true);
  assert.ok(n >= 0);
});
