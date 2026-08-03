import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  appSettingsTable,
  installationsTable,
  billingChargesTable,
  invoicesTable,
  verifactuSubmissionsTable,
  usersTable,
  sessionsTable,
  type Invoice,
} from "@workspace/db";
import app from "../app";
import { invoiceHash } from "./invoiceGen";
import {
  aeatDate,
  aeatImpuestoCode,
  verifactuQrUrl,
  buildRegistroAltaXml,
  parseAeatResponse,
  getVerifactuSettings,
  setVerifactuSetting,
  looksLikePem,
  submitInvoiceToAeat,
  processPendingSubmissions,
  enqueueVerifactuSubmission,
  AEAT_ENDPOINTS,
  SETTING_VERIFACTU_ENABLED,
  SETTING_VERIFACTU_ENV,
  SETTING_VERIFACTU_CERT_PEM,
  SETTING_VERIFACTU_KEY_PEM,
  type AeatTransport,
} from "./verifactu";

// VeriFactu: QR de factura verificable, registro de alta XML, parseo de la
// respuesta de la AEAT y flujo de envío con transporte simulado. Este fichero
// muta app_settings globales (verifactu_*), por eso concentra todos esos tests.

const suffix = randomUUID().slice(0, 8);
const FAKE_CERT = `-----BEGIN CERTIFICATE-----\nMIIBfake${suffix}\n-----END CERTIFICATE-----`;
const FAKE_KEY = `-----BEGIN PRIVATE KEY-----\nMIIBfake${suffix}\n-----END PRIVATE KEY-----`;

let installationId: number;
let chargeId: number;
let invoice: Invoice;
let server: Server;
let baseUrl: string;
let adminId: number;
let adminToken: string;

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${adminToken}`,
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

before(async () => {
  const [admin] = await db
    .insert(usersTable)
    .values({
      email: `vf-admin-${suffix}@test.local`,
      passwordHash: "x",
      name: "Admin VeriFactu",
      isAdmin: true,
    })
    .returning();
  adminId = admin.id;
  adminToken = randomUUID();
  await db.insert(sessionsTable).values({
    id: adminToken,
    userId: adminId,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const [inst] = await db
    .insert(installationsTable)
    .values({
      name: `Coop VeriFactu ${suffix}`,
      contactName: "Test",
      contactEmail: `vf-${suffix}@example.com`,
      subdomain: `vf-${suffix}`,
      publicToken: `pub-${suffix}`,
      apiToken: `api-${suffix}`,
      taxId: "F12345678",
      termsAcceptedAt: new Date(),
    })
    .returning();
  installationId = inst.id;
  const [charge] = await db
    .insert(billingChargesTable)
    .values({
      installationId,
      period: "2099-01",
      baseCents: 10000,
      farmCount: 4,
      variableCents: 1000,
      totalCents: 11000,
    })
    .returning();
  chargeId = charge.id;
  const record = {
    prevHash: null,
    fullNumber: `VFT-2099-${suffix.slice(0, 4).toUpperCase()}`,
    issueDate: new Date("2099-01-15T10:00:00Z"),
    period: "2099-01",
    issuerName: "AgroNutri AI S.L.",
    issuerTaxId: "B00000000",
    issuerAddress: "C/ Test 1",
    customerName: inst.name,
    customerTaxId: "F12345678",
    customerAddress: null,
    baseCents: 10000,
    farmCount: 4,
    variableCents: 1000,
    subtotalCents: 11000,
    taxRateBps: 700,
    taxName: "IGIC",
    taxCents: 770,
    totalCents: 11770,
  };
  const [inv] = await db
    .insert(invoicesTable)
    .values({
      installationId,
      chargeId,
      series: "VFT",
      year: 2099,
      number: 1,
      ...record,
      hash: invoiceHash(record),
    })
    .returning();
  invoice = inv;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
  const invIds = (
    await db
      .select({ id: invoicesTable.id })
      .from(invoicesTable)
      .where(eq(invoicesTable.installationId, installationId))
  ).map((r) => r.id);
  if (invIds.length) {
    await db
      .delete(verifactuSubmissionsTable)
      .where(inArray(verifactuSubmissionsTable.invoiceId, invIds));
    await db.delete(invoicesTable).where(inArray(invoicesTable.id, invIds));
  }
  await db
    .delete(billingChargesTable)
    .where(eq(billingChargesTable.installationId, installationId));
  await db.delete(installationsTable).where(eq(installationsTable.id, installationId));
  await db.delete(sessionsTable).where(eq(sessionsTable.id, adminToken));
  await db.delete(usersTable).where(eq(usersTable.id, adminId));
  await db.delete(appSettingsTable).where(
    inArray(appSettingsTable.key, [
      SETTING_VERIFACTU_ENABLED,
      SETTING_VERIFACTU_ENV,
      SETTING_VERIFACTU_CERT_PEM,
      SETTING_VERIFACTU_KEY_PEM,
    ]),
  );
  await pool.end();
});

test("aeatDate usa el formato dd-mm-aaaa", () => {
  assert.equal(aeatDate(new Date("2099-01-15T10:00:00Z")), "15-01-2099");
});

test("el QR apunta al servicio de cotejo con nif, numserie, fecha e importe", () => {
  const url = verifactuQrUrl(invoice, "sandbox");
  const u = new URL(url);
  assert.ok(u.href.startsWith("https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR"));
  assert.equal(u.searchParams.get("nif"), "B00000000");
  assert.equal(u.searchParams.get("numserie"), invoice.fullNumber);
  assert.equal(u.searchParams.get("fecha"), "15-01-2099");
  assert.equal(u.searchParams.get("importe"), "117.70");
  const prod = verifactuQrUrl(invoice, "production");
  assert.ok(prod.startsWith("https://www2.agenciatributaria.gob.es/"));
});

test("el registro de alta incluye emisor, factura, importes, sistema y huella", () => {
  const xml = buildRegistroAltaXml(invoice);
  assert.match(xml, /<sf:NIF>B00000000<\/sf:NIF>/);
  assert.match(xml, new RegExp(`<sf:NumSerieFactura>${invoice.fullNumber}</sf:NumSerieFactura>`));
  assert.match(xml, /<sf:FechaExpedicionFactura>15-01-2099<\/sf:FechaExpedicionFactura>/);
  assert.match(xml, /<sf:TipoFactura>F1<\/sf:TipoFactura>/);
  assert.match(xml, /<sf:BaseImponibleOimporteNoSujeto>110.00<\/sf:BaseImponibleOimporteNoSujeto>/);
  assert.match(xml, /<sf:CuotaRepercutida>7.70<\/sf:CuotaRepercutida>/);
  assert.match(xml, /<sf:ImporteTotal>117.70<\/sf:ImporteTotal>/);
  // Primera factura de la cadena → PrimerRegistro
  assert.match(xml, /<sf:PrimerRegistro>S<\/sf:PrimerRegistro>/);
  assert.match(xml, new RegExp(`<sf:Huella>${invoice.hash}</sf:Huella>`));
  // Declaración del sistema informático (alta como sistema de emisión)
  assert.match(xml, /<sf:NombreSistemaInformatico>AgroNutri Facturación<\/sf:NombreSistemaInformatico>/);
  assert.match(xml, /<sf:IdSistemaInformatico>AF<\/sf:IdSistemaInformatico>/);
  assert.match(xml, /<sf:TipoHuella>01<\/sf:TipoHuella>/);
});

test("el encadenamiento referencia la huella anterior cuando existe", () => {
  const xml = buildRegistroAltaXml({ ...invoice, prevHash: "ABC123" });
  assert.match(xml, /<sf:RegistroAnterior><sf:Huella>ABC123<\/sf:Huella><\/sf:RegistroAnterior>/);
});

test("parseAeatResponse extrae estado, CSV y errores", () => {
  const ok = parseAeatResponse(
    `<env:Envelope><tikR:EstadoEnvio>Correcto</tikR:EstadoEnvio><tikR:CSV>CSV123</tikR:CSV><tik:EstadoRegistro>Correcto</tik:EstadoRegistro></env:Envelope>`,
  );
  assert.equal(ok.estadoEnvio, "Correcto");
  assert.equal(ok.estadoRegistro, "Correcto");
  assert.equal(ok.csv, "CSV123");
  const bad = parseAeatResponse(
    `<x><EstadoRegistro>Incorrecto</EstadoRegistro><CodigoErrorRegistro>1105</CodigoErrorRegistro><DescripcionErrorRegistro>NIF incorrecto</DescripcionErrorRegistro></x>`,
  );
  assert.equal(bad.estadoRegistro, "Incorrecto");
  assert.equal(bad.errorCode, "1105");
  assert.equal(bad.errorDescription, "NIF incorrecto");
});

test("looksLikePem valida certificados y claves", () => {
  assert.ok(looksLikePem(FAKE_CERT, "cert"));
  assert.ok(looksLikePem(FAKE_KEY, "key"));
  assert.ok(!looksLikePem("hola", "cert"));
  assert.ok(!looksLikePem(FAKE_CERT, "key"));
});

test("la configuración guarda cert/clave cifrados y calcula ready", async () => {
  await setVerifactuSetting(SETTING_VERIFACTU_CERT_PEM, FAKE_CERT);
  await setVerifactuSetting(SETTING_VERIFACTU_KEY_PEM, FAKE_KEY);
  await setVerifactuSetting(SETTING_VERIFACTU_ENV, "sandbox");
  await setVerifactuSetting(SETTING_VERIFACTU_ENABLED, "true");
  const s = await getVerifactuSettings();
  assert.equal(s.enabled, true);
  assert.equal(s.environment, "sandbox");
  assert.equal(s.ready, true);
  assert.equal(s.certPem, FAKE_CERT);
  // En reposo no se guarda el PEM en claro
  const [row] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, SETTING_VERIFACTU_CERT_PEM));
  assert.ok(row.value && !row.value.includes("BEGIN CERTIFICATE"));
});

test("submitInvoiceToAeat envía el XML con mTLS y registra la aceptación", async () => {
  const seenCalls: { url: string; certPem: string; keyPem: string; body: string }[] = [];
  const transport: AeatTransport = async (opts) => {
    seenCalls.push(opts);
    return {
      status: 200,
      body: `<r><EstadoEnvio>Correcto</EstadoEnvio><EstadoRegistro>Correcto</EstadoRegistro><CSV>CSVOK1</CSV></r>`,
    };
  };
  const sub = await submitInvoiceToAeat(invoice.id, transport);
  assert.equal(seenCalls.length, 1);
  const seen = seenCalls[0];
  assert.equal(seen.url, AEAT_ENDPOINTS.sandbox);
  assert.equal(seen.certPem, FAKE_CERT);
  assert.equal(seen.keyPem, FAKE_KEY);
  assert.match(seen.body, /<sf:RegistroAlta>/);
  assert.equal(sub.status, "accepted");
  assert.equal(sub.aeatCsv, "CSVOK1");
  assert.equal(sub.environment, "sandbox");
  assert.ok(sub.sentAt);
});

test("una factura ya aceptada no se reenvía", async () => {
  let calls = 0;
  const transport: AeatTransport = async () => {
    calls++;
    return { status: 200, body: "<r><EstadoRegistro>Correcto</EstadoRegistro></r>" };
  };
  const sub = await submitInvoiceToAeat(invoice.id, transport);
  assert.equal(calls, 0);
  assert.equal(sub.status, "accepted");
});

test("los fallos de red quedan como error y se reintentan en el job", async () => {
  // Reinicia la fila para simular una factura pendiente
  await db
    .update(verifactuSubmissionsTable)
    .set({ status: "pending", aeatCsv: null, sentAt: null, attempts: 0 })
    .where(eq(verifactuSubmissionsTable.invoiceId, invoice.id));
  const failing: AeatTransport = async () => {
    throw new Error("ECONNREFUSED");
  };
  const sub = await submitInvoiceToAeat(invoice.id, failing);
  assert.equal(sub.status, "error");
  assert.match(sub.lastError ?? "", /ECONNREFUSED/);

  const okTransport: AeatTransport = async () => ({
    status: 200,
    body: "<r><EstadoRegistro>Correcto</EstadoRegistro><CSV>CSVOK2</CSV></r>",
  });
  const processed = await processPendingSubmissions(okTransport);
  assert.ok(processed >= 1);
  const [row] = await db
    .select()
    .from(verifactuSubmissionsTable)
    .where(eq(verifactuSubmissionsTable.invoiceId, invoice.id));
  assert.equal(row.status, "accepted");
  assert.equal(row.aeatCsv, "CSVOK2");
  assert.equal(row.attempts, 2);
});

test("un rechazo de la AEAT no se reintenta automáticamente", async () => {
  await db
    .update(verifactuSubmissionsTable)
    .set({ status: "pending", aeatCsv: null, sentAt: null, attempts: 0 })
    .where(eq(verifactuSubmissionsTable.invoiceId, invoice.id));
  const rejecting: AeatTransport = async () => ({
    status: 200,
    body: "<r><EstadoRegistro>Incorrecto</EstadoRegistro><CodigoErrorRegistro>1105</CodigoErrorRegistro><DescripcionErrorRegistro>NIF incorrecto</DescripcionErrorRegistro></r>",
  });
  const sub = await submitInvoiceToAeat(invoice.id, rejecting);
  assert.equal(sub.status, "rejected");
  assert.equal(sub.aeatErrorCode, "1105");
  let calls = 0;
  const counting: AeatTransport = async () => {
    calls++;
    return { status: 200, body: "<r><EstadoRegistro>Correcto</EstadoRegistro></r>" };
  };
  await processPendingSubmissions(counting);
  assert.equal(calls, 0);
});

test("enqueueVerifactuSubmission es idempotente", async () => {
  await enqueueVerifactuSubmission(invoice.id);
  await enqueueVerifactuSubmission(invoice.id);
  const rows = await db
    .select()
    .from(verifactuSubmissionsTable)
    .where(eq(verifactuSubmissionsTable.invoiceId, invoice.id));
  assert.equal(rows.length, 1);
});

test("sin certificado, el envío no está listo y submit falla claro", async () => {
  await setVerifactuSetting(SETTING_VERIFACTU_CERT_PEM, null);
  const s = await getVerifactuSettings();
  assert.equal(s.ready, false);
  await assert.rejects(() => submitInvoiceToAeat(invoice.id), /certificado/);
  await setVerifactuSetting(SETTING_VERIFACTU_CERT_PEM, FAKE_CERT);
});

test("aeatImpuestoCode deriva el código L1 del impuesto configurado", () => {
  assert.equal(aeatImpuestoCode("IVA"), "01");
  assert.equal(aeatImpuestoCode("ipsi"), "02");
  assert.equal(aeatImpuestoCode("IGIC"), "03");
  assert.equal(aeatImpuestoCode("Otro"), "05");
});

test("el XML usa el código de impuesto de la factura (IVA → 01)", () => {
  const xml = buildRegistroAltaXml({ ...invoice, taxName: "IVA" });
  assert.match(xml, /<sf:Impuesto>01<\/sf:Impuesto>/);
});

// --- Integración de rutas admin con VeriFactu activado -------------------

test("GET/PUT /admin/settings/verifactu gestionan la configuración", async () => {
  const got = await api("GET", "/admin/settings/verifactu");
  assert.equal(got.status, 200);
  const s = got.raw as { enabled: boolean; ready: boolean; system: { systemId: string } };
  assert.equal(s.enabled, true);
  assert.equal(s.ready, true);
  assert.equal(s.system.systemId, "AF");

  const bad = await api("PUT", "/admin/settings/verifactu", { certPem: "no-es-pem" });
  assert.equal(bad.status, 400);
});

test("con VeriFactu activado, emitir una factura la deja en cola y el listado muestra su estado AEAT", async () => {
  // Configura el emisor de facturas (necesario para emitir)
  const billingKeys = [
    ["billing_issuer_name", "AgroNutri AI S.L."],
    ["billing_issuer_tax_id", "B00000000"],
  ] as const;
  for (const [key, value] of billingKeys) {
    await db
      .insert(appSettingsTable)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: appSettingsTable.key, set: { value, updatedAt: new Date() } });
  }
  const [charge] = await db
    .insert(billingChargesTable)
    .values({
      installationId,
      period: "2099-02",
      baseCents: 10000,
      farmCount: 2,
      variableCents: 500,
      totalCents: 10500,
    })
    .returning();

  const issued = await api(
    "POST",
    `/admin/installations/${installationId}/charges/2099-02/invoice`,
  );
  assert.equal(issued.status, 200, JSON.stringify(issued.raw));
  const inv = issued.raw as { id: number; verifactu: { status: string } | null };
  assert.ok(inv.verifactu);
  assert.equal(inv.verifactu!.status, "pending");

  const list = await api("GET", "/admin/invoices");
  assert.equal(list.status, 200);
  const rows = list.raw as { id: number; verifactu: { status: string } | null }[];
  const mine = rows.find((r) => r.id === inv.id);
  assert.ok(mine);
  assert.equal(mine!.verifactu?.status, "pending");
  // La factura de prueba original (insertada a mano, sin encolar por ruta)
  // puede o no tener envío; la emitida por la ruta debe tenerlo siempre.
  assert.ok(charge.id);
});
