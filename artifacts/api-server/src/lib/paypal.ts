import { inArray } from "drizzle-orm";
import { db, appSettingsTable } from "@workspace/db";
import { encryptSecret, decryptSecret } from "./crypto";
import { setEmailSetting as setSetting } from "./email";
import { logger } from "./logger";

/**
 * Integración con PayPal Subscriptions (REST) para la contratación online.
 *
 * Credenciales: se leen primero de app_settings (editables por el
 * administrador en Administración → Instalaciones) y, si no hay nada guardado,
 * de las variables de entorno PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET /
 * PAYPAL_MODE / PAYPAL_WEBHOOK_ID / PAYPAL_PLAN_ID.
 *
 * Modelo de cobro (según /landing y /terminos): suscripción de PayPal con la
 * cuota base de 100 €/mes; el componente variable (2,50 €/finca activa/mes)
 * se factura mensualmente y queda registrado en billing_charges.
 */

export const SETTING_PAYPAL_CLIENT_ID = "paypal_client_id";
export const SETTING_PAYPAL_CLIENT_SECRET = "paypal_client_secret"; // cifrado
export const SETTING_PAYPAL_MODE = "paypal_mode"; // "sandbox" | "live"
export const SETTING_PAYPAL_WEBHOOK_ID = "paypal_webhook_id";
export const SETTING_PAYPAL_PLAN_ID = "paypal_plan_id";

export const BASE_PRICE_EUR = "100.00";
export const BASE_PRICE_CENTS = 10000;
export const PER_FARM_CENTS = 250;

export type PaypalConfig = {
  clientId: string | null;
  clientSecret: string | null;
  mode: "sandbox" | "live";
  webhookId: string | null;
  planId: string | null;
  /** De dónde salen las credenciales activas. */
  source: "db" | "env" | "none";
  /** Valores guardados en BD (sin fallback a entorno), para la UI. */
  dbClientId: string | null;
  dbClientSecret: string | null;
  dbMode: string | null;
  dbWebhookId: string | null;
};

const ALL_KEYS = [
  SETTING_PAYPAL_CLIENT_ID,
  SETTING_PAYPAL_CLIENT_SECRET,
  SETTING_PAYPAL_MODE,
  SETTING_PAYPAL_WEBHOOK_ID,
  SETTING_PAYPAL_PLAN_ID,
];

export async function getPaypalConfig(): Promise<PaypalConfig> {
  const rows = await db
    .select()
    .from(appSettingsTable)
    .where(inArray(appSettingsTable.key, ALL_KEYS));
  const val = (k: string) => rows.find((r) => r.key === k)?.value?.trim() || null;
  const dbClientId = val(SETTING_PAYPAL_CLIENT_ID);
  let dbClientSecret: string | null = null;
  const storedSecret = val(SETTING_PAYPAL_CLIENT_SECRET);
  if (storedSecret) {
    try {
      dbClientSecret = decryptSecret(storedSecret);
    } catch (err) {
      logger.error({ err }, "No se pudo descifrar el client secret de PayPal guardado; se ignora");
    }
  }
  const dbMode = val(SETTING_PAYPAL_MODE);
  const dbWebhookId = val(SETTING_PAYPAL_WEBHOOK_ID);
  const dbPlanId = val(SETTING_PAYPAL_PLAN_ID);

  const useDb = Boolean(dbClientId && dbClientSecret);
  const envClientId = process.env.PAYPAL_CLIENT_ID?.trim() || null;
  const envClientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim() || null;

  const clientId = useDb ? dbClientId : envClientId;
  const clientSecret = useDb ? dbClientSecret : envClientSecret;
  const modeRaw = (useDb ? dbMode : process.env.PAYPAL_MODE?.trim()) ?? dbMode ?? "sandbox";
  return {
    clientId,
    clientSecret,
    mode: modeRaw === "live" ? "live" : "sandbox",
    webhookId: dbWebhookId ?? process.env.PAYPAL_WEBHOOK_ID?.trim() ?? null,
    planId: dbPlanId ?? process.env.PAYPAL_PLAN_ID?.trim() ?? null,
    source: clientId && clientSecret ? (useDb ? "db" : "env") : "none",
    dbClientId,
    dbClientSecret,
    dbMode,
    dbWebhookId,
  };
}

export async function paypalConfigured(): Promise<boolean> {
  const cfg = await getPaypalConfig();
  return Boolean(cfg.clientId && cfg.clientSecret);
}

export async function setPaypalSetting(key: string, rawValue: string | null): Promise<void> {
  const value =
    key === SETTING_PAYPAL_CLIENT_SECRET && rawValue ? encryptSecret(rawValue) : rawValue;
  await setSetting(key, value);
}

export function apiBase(mode: "sandbox" | "live"): string {
  return mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

async function paypalFetch(
  cfg: PaypalConfig,
  path: string,
  init: RequestInit & { accessToken?: string } = {},
): Promise<Response> {
  return fetch(`${apiBase(cfg.mode)}${path}`, init);
}

export async function getAccessToken(cfg: PaypalConfig): Promise<string> {
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new Error("PayPal no está configurado (faltan credenciales)");
  }
  const res = await paypalFetch(cfg, "/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PayPal auth falló (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("PayPal auth: respuesta sin access_token");
  return data.access_token;
}

/**
 * Devuelve el id del plan de suscripción (cuota base 100 €/mes), creando el
 * producto y el plan en PayPal la primera vez y guardando el id en ajustes.
 */
export async function ensureSubscriptionPlan(cfg: PaypalConfig, token: string): Promise<string> {
  if (cfg.planId) return cfg.planId;
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const productRes = await paypalFetch(cfg, "/v1/catalogs/products", {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "AgroNutri AI — Plan cooperativa / OPP",
      description: "Instalación independiente: servidor, dominio, copias y soporte.",
      type: "SERVICE",
      category: "SOFTWARE",
    }),
  });
  if (!productRes.ok) {
    throw new Error(`PayPal: no se pudo crear el producto (HTTP ${productRes.status})`);
  }
  const product = (await productRes.json()) as { id: string };
  const planRes = await paypalFetch(cfg, "/v1/billing/plans", {
    method: "POST",
    headers,
    body: JSON.stringify({
      product_id: product.id,
      name: "AgroNutri AI — cuota base instalación",
      description:
        "100 €/mes por instalación. El variable (2,50 €/finca activa/mes) se factura mensualmente aparte.",
      billing_cycles: [
        {
          frequency: { interval_unit: "MONTH", interval_count: 1 },
          tenure_type: "REGULAR",
          sequence: 1,
          total_cycles: 0,
          pricing_scheme: { fixed_price: { value: BASE_PRICE_EUR, currency_code: "EUR" } },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding: true,
        payment_failure_threshold: 2,
      },
    }),
  });
  if (!planRes.ok) {
    throw new Error(`PayPal: no se pudo crear el plan (HTTP ${planRes.status})`);
  }
  const plan = (await planRes.json()) as { id: string };
  await setSetting(SETTING_PAYPAL_PLAN_ID, plan.id);
  logger.info({ planId: plan.id }, "Plan de suscripción de PayPal creado");
  return plan.id;
}

/** Formatea céntimos como importe PayPal ("102.50"). */
export function centsToEur(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * Revisa el precio de una suscripción existente: la próxima cuota pasará a
 * cobrar el importe indicado (base + variable del mes cerrado). PayPal aplica
 * el nuevo precio a partir del siguiente ciclo de facturación.
 */
export async function reviseSubscriptionPrice(
  cfg: PaypalConfig,
  subscriptionId: string,
  totalEur: string,
): Promise<void> {
  const token = await getAccessToken(cfg);
  const planId = await ensureSubscriptionPlan(cfg, token);
  const res = await paypalFetch(
    cfg,
    `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}/revise`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        plan_id: planId,
        plan: {
          billing_cycles: [
            {
              sequence: 1,
              pricing_scheme: { fixed_price: { value: totalEur, currency_code: "EUR" } },
            },
          ],
        },
      }),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `PayPal: no se pudo revisar el precio de la suscripción (HTTP ${res.status}): ${text.slice(0, 300)}`,
    );
  }
}

export type CreatedSubscription = { id: string; approvalUrl: string };

export async function createSubscription(opts: {
  cfg: PaypalConfig;
  publicToken: string;
  coopName: string;
  contactEmail: string;
  returnUrl: string;
  cancelUrl: string;
}): Promise<CreatedSubscription> {
  const { cfg } = opts;
  const token = await getAccessToken(cfg);
  const planId = await ensureSubscriptionPlan(cfg, token);
  const res = await paypalFetch(cfg, "/v1/billing/subscriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      plan_id: planId,
      custom_id: opts.publicToken,
      subscriber: { email_address: opts.contactEmail },
      application_context: {
        brand_name: "AgroNutri AI",
        locale: "es-ES",
        user_action: "SUBSCRIBE_NOW",
        return_url: opts.returnUrl,
        cancel_url: opts.cancelUrl,
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PayPal: no se pudo crear la suscripción (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    id: string;
    links?: { rel: string; href: string }[];
  };
  const approvalUrl = data.links?.find((l) => l.rel === "approve")?.href;
  if (!approvalUrl) throw new Error("PayPal: la suscripción no incluye enlace de aprobación");
  return { id: data.id, approvalUrl };
}

export async function getSubscription(
  cfg: PaypalConfig,
  subscriptionId: string,
): Promise<{ status: string; custom_id?: string }> {
  const token = await getAccessToken(cfg);
  const res = await paypalFetch(cfg, `/v1/billing/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`PayPal: no se pudo consultar la suscripción (HTTP ${res.status})`);
  return (await res.json()) as { status: string; custom_id?: string };
}

/**
 * Verifica la firma de un webhook con la API de PayPal. Si no hay webhook id
 * configurado, solo se acepta fuera de producción (desarrollo y tests).
 */
export async function verifyWebhookSignature(
  cfg: PaypalConfig,
  headers: Record<string, string | string[] | undefined>,
  event: unknown,
): Promise<boolean> {
  if (!cfg.webhookId) {
    if (process.env.NODE_ENV === "production") {
      logger.error("Webhook de PayPal rechazado: falta paypal_webhook_id en producción");
      return false;
    }
    logger.warn("Webhook de PayPal aceptado sin verificar (sin webhook id, entorno no productivo)");
    return true;
  }
  const h = (name: string): string | undefined => {
    const v = headers[name];
    return Array.isArray(v) ? v[0] : v;
  };
  const token = await getAccessToken(cfg);
  const res = await paypalFetch(cfg, "/v1/notifications/verify-webhook-signature", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      auth_algo: h("paypal-auth-algo"),
      cert_url: h("paypal-cert-url"),
      transmission_id: h("paypal-transmission-id"),
      transmission_sig: h("paypal-transmission-sig"),
      transmission_time: h("paypal-transmission-time"),
      webhook_id: cfg.webhookId,
      webhook_event: event,
    }),
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { verification_status?: string };
  return data.verification_status === "SUCCESS";
}
