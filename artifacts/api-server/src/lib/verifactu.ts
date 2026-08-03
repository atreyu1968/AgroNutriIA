import { request as httpsRequest } from "node:https";
import { asc, eq, inArray } from "drizzle-orm";
import {
  db,
  appSettingsTable,
  invoicesTable,
  verifactuSubmissionsTable,
  type Invoice,
  type VerifactuSubmission,
} from "@workspace/db";
import { encryptSecret, decryptSecret } from "./crypto";
import { logger } from "./logger";

/**
 * VeriFactu: envío de los registros de facturación a la AEAT.
 *
 * - El emisor se identifica con su certificado digital (mutual TLS).
 * - Cada envío incluye el bloque `SistemaInformatico` (alta/declaración del
 *   sistema de emisión ante la AEAT, exigida por el RD 1007/2023).
 * - El registro de alta reutiliza la huella SHA-256 encadenada que ya
 *   calculamos al emitir la factura.
 * - El PDF lleva el QR de "factura verificable" que apunta al servicio de
 *   cotejo de la AEAT.
 */

// ---------------------------------------------------------------------------
// Configuración (app_settings)
// ---------------------------------------------------------------------------

export const SETTING_VERIFACTU_ENABLED = "verifactu_enabled";
/** Entorno AEAT: sandbox (pruebas) | production. */
export const SETTING_VERIFACTU_ENV = "verifactu_env";
/** Certificado del emisor en PEM, cifrado en reposo. */
export const SETTING_VERIFACTU_CERT_PEM = "verifactu_cert_pem";
/** Clave privada del certificado en PEM, cifrada en reposo. */
export const SETTING_VERIFACTU_KEY_PEM = "verifactu_key_pem";

const VERIFACTU_SETTING_KEYS = [
  SETTING_VERIFACTU_ENABLED,
  SETTING_VERIFACTU_ENV,
  SETTING_VERIFACTU_CERT_PEM,
  SETTING_VERIFACTU_KEY_PEM,
];

/** Datos del sistema informático de facturación declarados a la AEAT. */
export const SIF_INFO = {
  /** Nombre y razón social del productor del software. */
  proveedorNombre: "AgroNutri AI",
  /** Nombre dado al sistema informático de facturación. */
  nombre: "AgroNutri Facturación",
  /** Identificador del SIF asignado por el productor (2 caracteres). */
  id: "AF",
  version: "1.0",
  /** Número de instalación del SIF en el obligado a expedir. */
  numeroInstalacion: "1",
} as const;

export type VerifactuEnv = "sandbox" | "production";

export type VerifactuSettings = {
  enabled: boolean;
  environment: VerifactuEnv;
  certConfigured: boolean;
  keyConfigured: boolean;
  /** true si hay certificado y clave y el envío está activado. */
  ready: boolean;
};

export async function getVerifactuSettings(): Promise<
  VerifactuSettings & { certPem: string | null; keyPem: string | null }
> {
  const rows = await db
    .select()
    .from(appSettingsTable)
    .where(inArray(appSettingsTable.key, VERIFACTU_SETTING_KEYS));
  const get = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  const enabled = get(SETTING_VERIFACTU_ENABLED) === "true";
  const envRaw = get(SETTING_VERIFACTU_ENV);
  const environment: VerifactuEnv = envRaw === "production" ? "production" : "sandbox";
  const certEnc = get(SETTING_VERIFACTU_CERT_PEM);
  const keyEnc = get(SETTING_VERIFACTU_KEY_PEM);
  const certPem = certEnc ? decryptSecret(certEnc) : null;
  const keyPem = keyEnc ? decryptSecret(keyEnc) : null;
  return {
    enabled,
    environment,
    certConfigured: Boolean(certPem),
    keyConfigured: Boolean(keyPem),
    ready: enabled && Boolean(certPem && keyPem),
    certPem,
    keyPem,
  };
}

export async function setVerifactuSetting(key: string, rawValue: string | null): Promise<void> {
  if (rawValue == null) {
    await db.delete(appSettingsTable).where(eq(appSettingsTable.key, key));
    return;
  }
  // El certificado y su clave privada se guardan cifrados en reposo.
  const secret = key === SETTING_VERIFACTU_CERT_PEM || key === SETTING_VERIFACTU_KEY_PEM;
  const value = secret ? encryptSecret(rawValue) : rawValue;
  await db
    .insert(appSettingsTable)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettingsTable.key, set: { value, updatedAt: new Date() } });
}

/** Comprobación mínima de que un texto parece un PEM del tipo esperado. */
export function looksLikePem(text: string, kind: "cert" | "key"): boolean {
  const t = text.trim();
  if (kind === "cert") return /-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/.test(t);
  return /-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----[\s\S]+-----END (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----/.test(
    t,
  );
}

// ---------------------------------------------------------------------------
// Endpoints AEAT
// ---------------------------------------------------------------------------

/** Servicio SOAP de recepción de registros VeriFactu. */
export const AEAT_ENDPOINTS: Record<VerifactuEnv, string> = {
  production:
    "https://www1.agenciatributaria.gob.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
  sandbox: "https://prewww1.aeat.es/wlpl/TIKE-CONT/ws/SistemaFacturacion/VerifactuSOAP",
};

/** Servicio de cotejo del QR de "factura verificable". */
export const AEAT_QR_BASE: Record<VerifactuEnv, string> = {
  production: "https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR",
  sandbox: "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR",
};

// ---------------------------------------------------------------------------
// Registro de alta (XML) y QR
// ---------------------------------------------------------------------------

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function euros(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Código de impuesto AEAT (L1) derivado del impuesto configurado en la
 * factura: 01 IVA, 02 IPSI, 03 IGIC, 05 otros.
 */
export function aeatImpuestoCode(taxName: string): "01" | "02" | "03" | "05" {
  const t = taxName.trim().toUpperCase();
  if (t.includes("IVA")) return "01";
  if (t.includes("IPSI")) return "02";
  if (t.includes("IGIC")) return "03";
  return "05";
}

/** dd-mm-aaaa, formato exigido por la AEAT. */
export function aeatDate(d: Date): string {
  const iso = d.toISOString().slice(0, 10);
  const [y, m, day] = iso.split("-");
  return `${day}-${m}-${y}`;
}

/**
 * URL del QR de "factura verificable" según la especificación del servicio
 * de cotejo de la AEAT (nif, numserie, fecha, importe).
 */
export function verifactuQrUrl(inv: Invoice, environment: VerifactuEnv): string {
  const params = new URLSearchParams({
    nif: inv.issuerTaxId,
    numserie: inv.fullNumber,
    fecha: aeatDate(inv.issueDate),
    importe: euros(inv.totalCents),
  });
  return `${AEAT_QR_BASE[environment]}?${params.toString()}`;
}

/**
 * Construye el envelope SOAP `RegFactuSistemaFacturacion` con el registro de
 * alta de la factura, incluida la declaración del sistema informático
 * (SistemaInformatico) y la huella encadenada ya calculada al emitir.
 */
export function buildRegistroAltaXml(inv: Invoice): string {
  const fecha = aeatDate(inv.issueDate);
  const prev =
    inv.prevHash == null
      ? `<sf:PrimerRegistro>S</sf:PrimerRegistro>`
      : `<sf:RegistroAnterior><sf:Huella>${xmlEscape(inv.prevHash)}</sf:Huella></sf:RegistroAnterior>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
    xmlns:sfLR="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroLR.xsd"
    xmlns:sf="https://www2.agenciatributaria.gob.es/static_files/common/internet/dep/aplicaciones/es/aeat/tike/cont/ws/SuministroInformacion.xsd">
  <soapenv:Header/>
  <soapenv:Body>
    <sfLR:RegFactuSistemaFacturacion>
      <sf:Cabecera>
        <sf:ObligadoEmision>
          <sf:NombreRazon>${xmlEscape(inv.issuerName)}</sf:NombreRazon>
          <sf:NIF>${xmlEscape(inv.issuerTaxId)}</sf:NIF>
        </sf:ObligadoEmision>
      </sf:Cabecera>
      <sfLR:RegistroFactura>
        <sf:RegistroAlta>
          <sf:IDVersion>1.0</sf:IDVersion>
          <sf:IDFactura>
            <sf:IDEmisorFactura>${xmlEscape(inv.issuerTaxId)}</sf:IDEmisorFactura>
            <sf:NumSerieFactura>${xmlEscape(inv.fullNumber)}</sf:NumSerieFactura>
            <sf:FechaExpedicionFactura>${fecha}</sf:FechaExpedicionFactura>
          </sf:IDFactura>
          <sf:NombreRazonEmisor>${xmlEscape(inv.issuerName)}</sf:NombreRazonEmisor>
          <sf:TipoFactura>F1</sf:TipoFactura>
          <sf:DescripcionOperacion>${xmlEscape(`Servicios AgroNutri AI — periodo ${inv.period}`)}</sf:DescripcionOperacion>
          <sf:Destinatarios>
            <sf:IDDestinatario>
              <sf:NombreRazon>${xmlEscape(inv.customerName)}</sf:NombreRazon>
              <sf:NIF>${xmlEscape(inv.customerTaxId)}</sf:NIF>
            </sf:IDDestinatario>
          </sf:Destinatarios>
          <sf:Desglose>
            <sf:DetalleDesglose>
              <sf:Impuesto>${aeatImpuestoCode(inv.taxName)}</sf:Impuesto>
              <sf:ClaveRegimen>01</sf:ClaveRegimen>
              <sf:CalificacionOperacion>S1</sf:CalificacionOperacion>
              <sf:TipoImpositivo>${(inv.taxRateBps / 100).toFixed(2)}</sf:TipoImpositivo>
              <sf:BaseImponibleOimporteNoSujeto>${euros(inv.subtotalCents)}</sf:BaseImponibleOimporteNoSujeto>
              <sf:CuotaRepercutida>${euros(inv.taxCents)}</sf:CuotaRepercutida>
            </sf:DetalleDesglose>
          </sf:Desglose>
          <sf:CuotaTotal>${euros(inv.taxCents)}</sf:CuotaTotal>
          <sf:ImporteTotal>${euros(inv.totalCents)}</sf:ImporteTotal>
          <sf:Encadenamiento>${prev}</sf:Encadenamiento>
          <sf:SistemaInformatico>
            <sf:NombreRazon>${xmlEscape(SIF_INFO.proveedorNombre)}</sf:NombreRazon>
            <sf:NombreSistemaInformatico>${xmlEscape(SIF_INFO.nombre)}</sf:NombreSistemaInformatico>
            <sf:IdSistemaInformatico>${SIF_INFO.id}</sf:IdSistemaInformatico>
            <sf:Version>${SIF_INFO.version}</sf:Version>
            <sf:NumeroInstalacion>${SIF_INFO.numeroInstalacion}</sf:NumeroInstalacion>
            <sf:TipoUsoPosibleSoloVerifactu>S</sf:TipoUsoPosibleSoloVerifactu>
            <sf:TipoUsoPosibleMultiOT>S</sf:TipoUsoPosibleMultiOT>
            <sf:IndicadorMultiplesOT>S</sf:IndicadorMultiplesOT>
          </sf:SistemaInformatico>
          <sf:FechaHoraHusoGenRegistro>${inv.createdAt.toISOString()}</sf:FechaHoraHusoGenRegistro>
          <sf:TipoHuella>01</sf:TipoHuella>
          <sf:Huella>${xmlEscape(inv.hash)}</sf:Huella>
        </sf:RegistroAlta>
      </sfLR:RegistroFactura>
    </sfLR:RegFactuSistemaFacturacion>
  </soapenv:Body>
</soapenv:Envelope>`;
}

// ---------------------------------------------------------------------------
// Envío a la AEAT (mutual TLS con el certificado del emisor)
// ---------------------------------------------------------------------------

export type AeatResponse = {
  /** Correcto | ParcialmenteCorrecto | Incorrecto */
  estadoEnvio: string | null;
  /** Correcto | AceptadoConErrores | Incorrecto */
  estadoRegistro: string | null;
  csv: string | null;
  errorCode: string | null;
  errorDescription: string | null;
  raw: string;
};

function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<(?:[\\w.-]+:)?${name}[^>]*>([^<]*)</(?:[\\w.-]+:)?${name}>`));
  return m ? m[1].trim() : null;
}

export function parseAeatResponse(xml: string): AeatResponse {
  return {
    estadoEnvio: tag(xml, "EstadoEnvio"),
    estadoRegistro: tag(xml, "EstadoRegistro"),
    csv: tag(xml, "CSV"),
    errorCode: tag(xml, "CodigoErrorRegistro") ?? tag(xml, "faultcode"),
    errorDescription: tag(xml, "DescripcionErrorRegistro") ?? tag(xml, "faultstring"),
    raw: xml,
  };
}

export type AeatTransport = (opts: {
  url: string;
  body: string;
  certPem: string;
  keyPem: string;
}) => Promise<{ status: number; body: string }>;

/** Transporte real: POST SOAP con certificado de cliente (mutual TLS). */
export const httpsAeatTransport: AeatTransport = ({ url, body, certPem, keyPem }) =>
  new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = httpsRequest(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: "POST",
        cert: certPem,
        key: keyPem,
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          "Content-Length": Buffer.byteLength(body),
          SOAPAction: "",
        },
        timeout: 30_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.on("timeout", () => req.destroy(new Error("La AEAT no respondió en 30 s")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });

/** Encola el envío VeriFactu de una factura (si no estaba ya encolado). */
export async function enqueueVerifactuSubmission(invoiceId: number): Promise<void> {
  await db
    .insert(verifactuSubmissionsTable)
    .values({ invoiceId })
    .onConflictDoNothing({ target: verifactuSubmissionsTable.invoiceId });
}

/** Estados finales que no se reintentan automáticamente. */
const FINAL_STATUSES = ["accepted", "accepted_with_errors"];

/**
 * Envía a la AEAT el registro de una factura y actualiza su fila de envío.
 * Devuelve la fila actualizada. Lanza solo ante errores de programación;
 * los fallos de red/AEAT quedan registrados en la fila (status error/rejected).
 */
export async function submitInvoiceToAeat(
  invoiceId: number,
  transport: AeatTransport = httpsAeatTransport,
): Promise<VerifactuSubmission> {
  const settings = await getVerifactuSettings();
  if (!settings.ready) {
    throw new Error(
      "VeriFactu no está listo: activa el envío y sube el certificado digital del emisor.",
    );
  }
  const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
  if (!inv) throw new Error(`Factura ${invoiceId} no encontrada`);
  await enqueueVerifactuSubmission(invoiceId);
  const [sub] = await db
    .select()
    .from(verifactuSubmissionsTable)
    .where(eq(verifactuSubmissionsTable.invoiceId, invoiceId));
  if (FINAL_STATUSES.includes(sub.status)) return sub;

  const requestXml = buildRegistroAltaXml(inv);
  const update = async (fields: Partial<typeof verifactuSubmissionsTable.$inferInsert>) => {
    const [row] = await db
      .update(verifactuSubmissionsTable)
      .set({
        ...fields,
        attempts: sub.attempts + 1,
        environment: settings.environment,
        requestXml,
        updatedAt: new Date(),
      })
      .where(eq(verifactuSubmissionsTable.id, sub.id))
      .returning();
    return row;
  };

  let res: { status: number; body: string };
  try {
    res = await transport({
      url: AEAT_ENDPOINTS[settings.environment],
      body: requestXml,
      certPem: settings.certPem!,
      keyPem: settings.keyPem!,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ invoiceId, err: msg }, "Fallo de red al enviar el registro VeriFactu a la AEAT");
    return await update({ status: "error", lastError: msg });
  }

  const parsed = parseAeatResponse(res.body);
  if (res.status !== 200) {
    return await update({
      status: "error",
      lastError: `La AEAT respondió HTTP ${res.status}: ${(parsed.errorDescription ?? res.body).slice(0, 300)}`,
      responseXml: res.body,
    });
  }
  const registro = parsed.estadoRegistro ?? parsed.estadoEnvio;
  if (registro === "Correcto") {
    logger.info({ invoiceId, csv: parsed.csv }, "Registro VeriFactu aceptado por la AEAT");
    return await update({
      status: "accepted",
      aeatCsv: parsed.csv,
      aeatErrorCode: null,
      lastError: null,
      responseXml: res.body,
      sentAt: new Date(),
    });
  }
  if (registro === "AceptadoConErrores") {
    return await update({
      status: "accepted_with_errors",
      aeatCsv: parsed.csv,
      aeatErrorCode: parsed.errorCode,
      lastError: parsed.errorDescription,
      responseXml: res.body,
      sentAt: new Date(),
    });
  }
  return await update({
    status: "rejected",
    aeatErrorCode: parsed.errorCode,
    lastError: parsed.errorDescription ?? "La AEAT rechazó el registro",
    responseXml: res.body,
  });
}

// ---------------------------------------------------------------------------
// Job de envío en segundo plano
// ---------------------------------------------------------------------------

/** La AEAT exige respetar un flujo con espera entre envíos; 60 s es seguro. */
const SUBMIT_INTERVAL_MS = 60_000;
/** Los rechazos requieren intervención (subsanación); solo se reintentan errores. */
const RETRYABLE_STATUSES = ["pending", "error"];
const MAX_AUTO_ATTEMPTS = 10;

export async function processPendingSubmissions(
  transport: AeatTransport = httpsAeatTransport,
): Promise<number> {
  const settings = await getVerifactuSettings();
  if (!settings.ready) return 0;
  const rows = await db
    .select()
    .from(verifactuSubmissionsTable)
    .where(inArray(verifactuSubmissionsTable.status, RETRYABLE_STATUSES))
    .orderBy(asc(verifactuSubmissionsTable.invoiceId));
  let processed = 0;
  for (const row of rows) {
    if (row.attempts >= MAX_AUTO_ATTEMPTS) continue;
    try {
      await submitInvoiceToAeat(row.invoiceId, transport);
      processed++;
    } catch (err) {
      logger.error(
        { invoiceId: row.invoiceId, err: err instanceof Error ? err.message : String(err) },
        "Error inesperado procesando el envío VeriFactu",
      );
    }
  }
  return processed;
}

/** Arranca el job periódico que envía los registros pendientes a la AEAT. */
export function startVerifactuSubmitter(): void {
  const run = () =>
    processPendingSubmissions().catch((err: Error) =>
      logger.error({ err: err.message }, "El job de envío VeriFactu falló inesperadamente"),
    );
  void run();
  const timer = setInterval(run, SUBMIT_INTERVAL_MS);
  timer.unref();
  logger.info("Job de envío VeriFactu a la AEAT activado");
}

/** Estado de envío VeriFactu de un conjunto de facturas, para la API admin. */
export async function submissionsByInvoiceId(
  invoiceIds: number[],
): Promise<Map<number, VerifactuSubmission>> {
  if (invoiceIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(verifactuSubmissionsTable)
    .where(inArray(verifactuSubmissionsTable.invoiceId, invoiceIds));
  return new Map(rows.map((r) => [r.invoiceId, r]));
}
