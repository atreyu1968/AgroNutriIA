import { Router, type IRouter } from "express";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  installationsTable,
  provisioningEventsTable,
} from "@workspace/db";
import {
  CheckSubdomainResponse,
  SignupBody,
  SignupResponse,
  GetSignupStatusResponse,
} from "@workspace/api-zod";
import {
  getPaypalConfig,
  createSubscription,
  getSubscription,
  verifyWebhookSignature,
} from "../lib/paypal";
import {
  provisionInBackground,
  suspendInstallation,
  reactivateInstallation,
  cancelInstallation,
  upsertMonthlyCharge,
  installationUrl,
} from "../lib/provisioner";
import { markInvoicedChargesPaid } from "../lib/billingSweeper";
import { logger } from "../lib/logger";

const router: IRouter = Router();

export const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/;
export const RESERVED_SUBDOMAINS = new Set([
  "www", "api", "mail", "smtp", "imap", "ftp", "admin", "administracion",
  "app", "web", "ns1", "ns2", "test", "demo", "staging", "panel", "status",
]);

export function subdomainProblem(subdomain: string): string | null {
  if (!SUBDOMAIN_RE.test(subdomain)) {
    return "Solo minúsculas, números y guiones (3–40 caracteres, sin empezar ni terminar por guion)";
  }
  if (RESERVED_SUBDOMAINS.has(subdomain)) return "Ese subdominio está reservado";
  return null;
}

router.get("/signup/subdomain", async (req, res): Promise<void> => {
  const subdomain = String(req.query.subdomain ?? "").trim().toLowerCase();
  const problem = subdomainProblem(subdomain);
  if (problem) {
    res.json(CheckSubdomainResponse.parse({ available: false, reason: problem }));
    return;
  }
  const [existing] = await db
    .select({ id: installationsTable.id })
    .from(installationsTable)
    .where(eq(installationsTable.subdomain, subdomain));
  res.json(
    CheckSubdomainResponse.parse(
      existing
        ? { available: false, reason: "Ese subdominio ya está contratado" }
        : { available: true, reason: null },
    ),
  );
});

router.post("/signup", async (req, res): Promise<void> => {
  const parsed = SignupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Revisa los datos del formulario" });
    return;
  }
  const data = parsed.data;
  // Estos textos acaban en el script de aprovisionamiento (systemd/SQL): se
  // rechaza cualquier carácter de control, salto de línea o comilla peligrosa.
  const UNSAFE = /[\x00-\x1f\x7f'"`\\$]/;
  for (const [field, value] of [
    ["nombre", data.name],
    ["persona de contacto", data.contactName],
    ["teléfono", data.phone ?? ""],
  ] as const) {
    if (UNSAFE.test(value)) {
      res.status(400).json({
        error: `El campo «${field}» contiene caracteres no permitidos (comillas o caracteres de control)`,
      });
      return;
    }
  }
  if (!data.acceptTerms) {
    res.status(400).json({ error: "Debes aceptar los términos y condiciones" });
    return;
  }
  const subdomain = data.subdomain.trim().toLowerCase();
  const problem = subdomainProblem(subdomain);
  if (problem) {
    res.status(400).json({ error: `Subdominio no válido: ${problem}` });
    return;
  }
  // Las URLs de retorno vienen del navegador; solo se aceptan URLs http(s).
  let returnUrl: URL;
  let cancelUrl: URL;
  try {
    returnUrl = new URL(data.returnUrl);
    cancelUrl = new URL(data.cancelUrl);
    if (!/^https?:$/.test(returnUrl.protocol) || !/^https?:$/.test(cancelUrl.protocol)) {
      throw new Error("bad protocol");
    }
  } catch {
    res.status(400).json({ error: "URL de retorno no válida" });
    return;
  }

  const cfg = await getPaypalConfig();
  if (!cfg.clientId || !cfg.clientSecret) {
    res.status(503).json({
      error:
        "El pago online no está disponible en este momento (PayPal sin configurar). Escríbenos y tramitamos el alta manualmente.",
    });
    return;
  }

  const publicToken = randomBytes(24).toString("base64url");
  const apiToken = randomBytes(32).toString("base64url");
  let installation;
  try {
    [installation] = await db
      .insert(installationsTable)
      .values({
        name: data.name.trim(),
        contactName: data.contactName.trim(),
        contactEmail: data.contactEmail.trim().toLowerCase(),
        phone: data.phone?.trim() || null,
        subdomain,
        publicToken,
        apiToken,
        termsAcceptedAt: new Date(),
      })
      .returning();
  } catch (err) {
    if ((err as { code?: string })?.code === "23505") {
      res.status(409).json({ error: "Ese subdominio ya está contratado" });
      return;
    }
    throw err;
  }

  returnUrl.searchParams.set("token", publicToken);
  cancelUrl.searchParams.set("token", publicToken);
  try {
    const sub = await createSubscription({
      cfg,
      publicToken,
      coopName: installation.name,
      contactEmail: installation.contactEmail,
      returnUrl: returnUrl.toString(),
      cancelUrl: cancelUrl.toString(),
    });
    await db
      .update(installationsTable)
      .set({ paypalSubscriptionId: sub.id, updatedAt: new Date() })
      .where(eq(installationsTable.id, installation.id));
    res
      .status(201)
      .json(SignupResponse.parse({ publicToken, approvalUrl: sub.approvalUrl }));
  } catch (err) {
    // Sin suscripción no hay contratación: se elimina el registro para liberar el subdominio.
    await db.delete(installationsTable).where(eq(installationsTable.id, installation.id));
    logger.error({ err }, "No se pudo crear la suscripción de PayPal");
    res.status(502).json({
      error: "No se pudo iniciar el pago con PayPal. Inténtalo de nuevo en unos minutos.",
    });
  }
});

async function statusPayload(inst: typeof installationsTable.$inferSelect) {
  const events = await db
    .select()
    .from(provisioningEventsTable)
    .where(eq(provisioningEventsTable.installationId, inst.id))
    .orderBy(provisioningEventsTable.id);
  return {
    status: inst.status,
    name: inst.name,
    subdomain: inst.subdomain,
    url: inst.status === "active" ? installationUrl(inst.subdomain) : null,
    events: events.map((e) => ({
      step: e.step,
      status: e.status,
      detail: e.detail,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

router.get("/signup/status/:publicToken", async (req, res): Promise<void> => {
  const [inst] = await db
    .select()
    .from(installationsTable)
    .where(eq(installationsTable.publicToken, req.params.publicToken));
  if (!inst) {
    res.status(404).json({ error: "Contratación no encontrada" });
    return;
  }
  res.json(GetSignupStatusResponse.parse(await statusPayload(inst)));
});

/**
 * Confirmación al volver de PayPal: comprueba el estado real de la
 * suscripción y, si está activa/aprobada, lanza el aprovisionamiento.
 * Idempotente; el webhook hace lo mismo de forma asíncrona.
 */
router.post("/signup/confirm/:publicToken", async (req, res): Promise<void> => {
  const [inst] = await db
    .select()
    .from(installationsTable)
    .where(eq(installationsTable.publicToken, req.params.publicToken));
  if (!inst) {
    res.status(404).json({ error: "Contratación no encontrada" });
    return;
  }
  if (inst.status === "pending_payment" && inst.paypalSubscriptionId) {
    try {
      const cfg = await getPaypalConfig();
      const sub = await getSubscription(cfg, inst.paypalSubscriptionId);
      if (sub.status === "ACTIVE" || sub.status === "APPROVED") {
        provisionInBackground(inst.id);
      }
    } catch (err) {
      logger.warn({ err }, "No se pudo confirmar la suscripción al volver de PayPal");
    }
  }
  const [fresh] = await db
    .select()
    .from(installationsTable)
    .where(eq(installationsTable.id, inst.id));
  res.json(GetSignupStatusResponse.parse(await statusPayload(fresh ?? inst)));
});

/** Webhook de PayPal: alta, suspensión por impago, reactivación y baja. */
router.post("/paypal/webhook", async (req, res): Promise<void> => {
  const event = req.body as {
    event_type?: string;
    resource?: {
      id?: string;
      custom_id?: string;
      billing_agreement_id?: string;
      create_time?: string;
    };
  };
  if (!event?.event_type) {
    res.status(400).json({ error: "Evento no válido" });
    return;
  }
  const cfg = await getPaypalConfig();
  const verified = await verifyWebhookSignature(cfg, req.headers, event).catch(() => false);
  if (!verified) {
    res.status(400).json({ error: "Firma del webhook no verificada" });
    return;
  }
  const subscriptionId = event.resource?.billing_agreement_id ?? event.resource?.id ?? null;
  const customId = event.resource?.custom_id ?? null;
  let inst = null;
  if (subscriptionId) {
    [inst] = await db
      .select()
      .from(installationsTable)
      .where(eq(installationsTable.paypalSubscriptionId, subscriptionId));
  }
  if (!inst && customId) {
    [inst] = await db
      .select()
      .from(installationsTable)
      .where(eq(installationsTable.publicToken, customId));
  }
  if (!inst) {
    // Se responde 200 para que PayPal no reintente indefinidamente.
    logger.warn({ subscriptionId, type: event.event_type }, "Webhook de PayPal sin instalación asociada");
    res.json({ received: true });
    return;
  }
  logger.info({ installationId: inst.id, type: event.event_type }, "Webhook de PayPal recibido");
  switch (event.event_type) {
    case "BILLING.SUBSCRIPTION.ACTIVATED":
      if (inst.status === "suspended") await reactivateInstallation(inst);
      else if (inst.status === "pending_payment" || inst.status === "error") {
        provisionInBackground(inst.id);
      }
      break;
    case "BILLING.SUBSCRIPTION.SUSPENDED":
    case "BILLING.SUBSCRIPTION.PAYMENT.FAILED":
      await suspendInstallation(inst, `PayPal: ${event.event_type}`);
      break;
    case "PAYMENT.SALE.COMPLETED": {
      // Cobro del ciclo: los cargos ya incluidos en la cuota pasan a pagados.
      // El id del cobro y su fecha protegen frente a eventos repetidos o
      // llegados fuera de orden (solo liquida cargos revisados antes del pago).
      const createTime = event.resource?.create_time ? new Date(event.resource.create_time) : null;
      await markInvoicedChargesPaid(inst.id, {
        saleId: event.resource?.id ?? null,
        paidAt: createTime && !Number.isNaN(createTime.getTime()) ? createTime : null,
      });
      break;
    }
    case "BILLING.SUBSCRIPTION.CANCELLED":
    case "BILLING.SUBSCRIPTION.EXPIRED":
      await cancelInstallation(inst, `PayPal: ${event.event_type}`);
      break;
    default:
      break;
  }
  res.json({ received: true });
});

const UsageBody = z.object({ activeFarms: z.number().int().min(0).max(100000) });

/**
 * Reporte de uso desde cada instalación (fincas activas), autenticado con el
 * token secreto de la instalación. Actualiza el cargo variable del mes.
 */
router.post("/billing/usage", async (req, res): Promise<void> => {
  const token = req.headers["x-install-token"];
  const value = Array.isArray(token) ? token[0] : token;
  if (!value) {
    res.status(401).json({ error: "Falta el token de instalación" });
    return;
  }
  const [inst] = await db
    .select()
    .from(installationsTable)
    .where(eq(installationsTable.apiToken, value));
  if (!inst) {
    res.status(401).json({ error: "Token de instalación no válido" });
    return;
  }
  const parsed = UsageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Datos de uso no válidos" });
    return;
  }
  await db
    .update(installationsTable)
    .set({
      activeFarmCount: parsed.data.activeFarms,
      usageReportedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(installationsTable.id, inst.id));
  await upsertMonthlyCharge(inst.id);
  res.json({ ok: true });
});

export default router;
