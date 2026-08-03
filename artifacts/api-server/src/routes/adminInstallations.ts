import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import {
  db,
  installationsTable,
  provisioningEventsTable,
  billingChargesTable,
} from "@workspace/db";
import {
  AdminListInstallationsResponse,
  AdminListInstallationEventsResponse,
  AdminProvisionInstallationResponse,
  AdminGetPaypalSettingsResponse,
  AdminUpdatePaypalSettingsBody,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { isCoopInstance } from "../lib/instance";
import { audit } from "../lib/audit";
import {
  getPaypalConfig,
  setPaypalSetting,
  SETTING_PAYPAL_CLIENT_ID,
  SETTING_PAYPAL_CLIENT_SECRET,
  SETTING_PAYPAL_MODE,
  SETTING_PAYPAL_WEBHOOK_ID,
} from "../lib/paypal";
import { provisionInBackground, currentPeriod, installationUrl } from "../lib/provisioner";

const router: IRouter = Router();
// En instancias de cooperativa la gestión de instalaciones es exclusiva de la
// central: sus rutas se deshabilitan por completo.
router.use((_req, res, next) => {
  if (isCoopInstance()) {
    res.status(404).json({ error: "No disponible en esta instalación" });
    return;
  }
  next();
});
router.use(requireAuth);
router.use((req, res, next) => {
  if (!req.user!.isAdmin) {
    res.status(403).json({ error: "Solo para administradores" });
    return;
  }
  next();
});

router.get("/admin/installations", async (_req, res): Promise<void> => {
  const installations = await db
    .select()
    .from(installationsTable)
    .orderBy(desc(installationsTable.id));
  const charges = await db.select().from(billingChargesTable);
  const period = currentPeriod();
  const result = installations.map((i) => {
    const own = charges.filter((c) => c.installationId === i.id);
    const current = own.find((c) => c.period === period) ?? null;
    return {
      id: i.id,
      name: i.name,
      contactName: i.contactName,
      contactEmail: i.contactEmail,
      phone: i.phone,
      subdomain: i.subdomain,
      url: installationUrl(i.subdomain),
      status: i.status,
      paypalSubscriptionId: i.paypalSubscriptionId,
      activeFarmCount: i.activeFarmCount,
      usageReportedAt: i.usageReportedAt?.toISOString() ?? null,
      provisionedAt: i.provisionedAt?.toISOString() ?? null,
      createdAt: i.createdAt.toISOString(),
      currentPeriod: period,
      currentMonthCents: current?.totalCents ?? null,
      totalBilledCents: own.reduce((s, c) => s + c.totalCents, 0),
      charges: own
        .sort((a, b) => (a.period < b.period ? 1 : -1))
        .map((c) => ({
          period: c.period,
          baseCents: c.baseCents,
          farmCount: c.farmCount,
          variableCents: c.variableCents,
          totalCents: c.totalCents,
          status: c.status,
        })),
    };
  });
  res.json(AdminListInstallationsResponse.parse(result));
});

router.get("/admin/installations/:id/events", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id)) {
    res.status(400).json({ error: "Identificador no válido" });
    return;
  }
  const events = await db
    .select()
    .from(provisioningEventsTable)
    .where(eq(provisioningEventsTable.installationId, id))
    .orderBy(provisioningEventsTable.id);
  res.json(
    AdminListInstallationEventsResponse.parse(
      events.map((e) => ({
        step: e.step,
        status: e.status,
        detail: e.detail,
        createdAt: e.createdAt.toISOString(),
      })),
    ),
  );
});

/** Reintenta (o fuerza) el aprovisionamiento de una instalación. */
router.post("/admin/installations/:id/provision", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id)) {
    res.status(400).json({ error: "Identificador no válido" });
    return;
  }
  const [inst] = await db.select().from(installationsTable).where(eq(installationsTable.id, id));
  if (!inst) {
    res.status(404).json({ error: "Instalación no encontrada" });
    return;
  }
  if (inst.status === "active") {
    res.status(409).json({ error: "La instalación ya está activa" });
    return;
  }
  if (inst.status === "cancelled") {
    res.status(409).json({ error: "La instalación está dada de baja" });
    return;
  }
  provisionInBackground(inst.id);
  await audit({
    userId: req.user!.id,
    action: "admin_installation_provision",
    entityType: "installation",
    entityId: inst.id,
    detail: inst.subdomain,
  });
  res.json(AdminProvisionInstallationResponse.parse({ status: "provisioning" }));
});

function maskKey(key: string): string {
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 6)}••••${key.slice(-4)}`;
}

async function paypalSettingsPayload() {
  const cfg = await getPaypalConfig();
  return {
    configured: Boolean(cfg.clientId && cfg.clientSecret),
    source: cfg.source,
    clientId: cfg.dbClientId,
    clientSecretMasked: cfg.dbClientSecret ? maskKey(cfg.dbClientSecret) : null,
    mode: cfg.mode,
    webhookId: cfg.dbWebhookId,
    planId: cfg.planId,
  };
}

router.get("/admin/settings/paypal", async (_req, res): Promise<void> => {
  res.json(AdminGetPaypalSettingsResponse.parse(await paypalSettingsPayload()));
});

router.put("/admin/settings/paypal", async (req, res): Promise<void> => {
  const parsed = AdminUpdatePaypalSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const d = parsed.data;
  if ("clientId" in d) await setPaypalSetting(SETTING_PAYPAL_CLIENT_ID, d.clientId?.trim() || null);
  if ("clientSecret" in d)
    await setPaypalSetting(SETTING_PAYPAL_CLIENT_SECRET, d.clientSecret?.trim() || null);
  if ("mode" in d) await setPaypalSetting(SETTING_PAYPAL_MODE, d.mode ?? null);
  if ("webhookId" in d)
    await setPaypalSetting(SETTING_PAYPAL_WEBHOOK_ID, d.webhookId?.trim() || null);
  await audit({
    userId: req.user!.id,
    action: "admin_paypal_settings_updated",
    entityType: "settings",
    entityId: 0,
    detail: "PayPal",
  });
  res.json(AdminGetPaypalSettingsResponse.parse(await paypalSettingsPayload()));
});

export default router;
