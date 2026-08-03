import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  installationsTable,
  billingChargesTable,
  invoicesTable,
  type Invoice,
} from "@workspace/db";
import {
  AdminGetBillingSettingsResponse,
  AdminUpdateBillingSettingsBody,
  AdminUpdateInstallationBillingInfoBody,
  AdminListInvoicesResponse,
  AdminIssueInvoiceResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../middlewares/auth";
import { audit } from "../lib/audit";
import { setEmailSetting } from "../lib/email";
import {
  getBillingSettings,
  invoiceHash,
  INVOICE_ISSUE_LOCK_KEY,
  renderInvoicePdf,
  formatEuros,
  SETTING_BILLING_ISSUER_NAME,
  SETTING_BILLING_ISSUER_TAX_ID,
  SETTING_BILLING_ISSUER_ADDRESS,
  SETTING_BILLING_SERIES,
  SETTING_BILLING_TAX_RATE_BPS,
  SETTING_BILLING_TAX_NAME,
} from "../lib/invoiceGen";
import { sendInvoiceEmail } from "../lib/email";

const router: IRouter = Router();
router.use(requireAuth);
router.use((req, res, next) => {
  if (!req.user!.isAdmin) {
    res.status(403).json({ error: "Solo para administradores" });
    return;
  }
  next();
});

async function billingSettingsPayload() {
  const s = await getBillingSettings();
  return {
    configured: s.configured,
    issuerName: s.issuerName,
    issuerTaxId: s.issuerTaxId,
    issuerAddress: s.issuerAddress,
    series: s.series,
    taxRateBps: s.taxRateBps,
    taxName: s.taxName,
  };
}

router.get("/admin/settings/billing", async (_req, res): Promise<void> => {
  res.json(AdminGetBillingSettingsResponse.parse(await billingSettingsPayload()));
});

router.put("/admin/settings/billing", async (req, res): Promise<void> => {
  const parsed = AdminUpdateBillingSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const d = parsed.data;
  // setEmailSetting guarda pares clave/valor genéricos en app_settings
  // (solo cifra la clave de Resend), por eso se reutiliza aquí.
  if ("issuerName" in d) await setEmailSetting(SETTING_BILLING_ISSUER_NAME, d.issuerName?.trim() || null);
  if ("issuerTaxId" in d) await setEmailSetting(SETTING_BILLING_ISSUER_TAX_ID, d.issuerTaxId?.trim() || null);
  if ("issuerAddress" in d) await setEmailSetting(SETTING_BILLING_ISSUER_ADDRESS, d.issuerAddress?.trim() || null);
  if ("series" in d) await setEmailSetting(SETTING_BILLING_SERIES, d.series?.trim().toUpperCase() || null);
  if ("taxRateBps" in d) await setEmailSetting(SETTING_BILLING_TAX_RATE_BPS, d.taxRateBps == null ? null : String(d.taxRateBps));
  if ("taxName" in d) await setEmailSetting(SETTING_BILLING_TAX_NAME, d.taxName?.trim() || null);
  await audit({
    userId: req.user!.id,
    action: "admin_billing_settings_updated",
    entityType: "settings",
    entityId: 0,
    detail: "Facturación",
  });
  res.json(AdminGetBillingSettingsResponse.parse(await billingSettingsPayload()));
});

router.put("/admin/installations/:id/billing-info", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id)) {
    res.status(400).json({ error: "Identificador no válido" });
    return;
  }
  const parsed = AdminUpdateInstallationBillingInfoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [inst] = await db.select().from(installationsTable).where(eq(installationsTable.id, id));
  if (!inst) {
    res.status(404).json({ error: "Instalación no encontrada" });
    return;
  }
  const d = parsed.data;
  await db
    .update(installationsTable)
    .set({
      ...("taxId" in d ? { taxId: d.taxId?.trim() || null } : {}),
      ...("billingAddress" in d ? { billingAddress: d.billingAddress?.trim() || null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(installationsTable.id, id));
  res.json({ ok: true });
});

function invoicePayload(inv: Invoice, installationName: string) {
  return {
    id: inv.id,
    installationId: inv.installationId,
    installationName,
    customerTaxId: inv.customerTaxId,
    fullNumber: inv.fullNumber,
    issueDate: inv.issueDate.toISOString(),
    period: inv.period,
    baseCents: inv.baseCents,
    farmCount: inv.farmCount,
    variableCents: inv.variableCents,
    subtotalCents: inv.subtotalCents,
    taxRateBps: inv.taxRateBps,
    taxName: inv.taxName,
    taxCents: inv.taxCents,
    totalCents: inv.totalCents,
    status: inv.status,
    sentAt: inv.sentAt?.toISOString() ?? null,
    paidAt: inv.paidAt?.toISOString() ?? null,
    hash: inv.hash,
  };
}

router.get("/admin/invoices", async (_req, res): Promise<void> => {
  const invoices = await db.select().from(invoicesTable).orderBy(desc(invoicesTable.id));
  const installations = await db.select().from(installationsTable);
  const nameOf = new Map(installations.map((i) => [i.id, i.name]));
  res.json(
    AdminListInvoicesResponse.parse(
      invoices.map((inv) => invoicePayload(inv, nameOf.get(inv.installationId) ?? "—")),
    ),
  );
});

/** Emite la factura de un cargo mensual pendiente. */
router.post(
  "/admin/installations/:id/charges/:period/invoice",
  async (req, res): Promise<void> => {
    const id = Number(req.params.id);
    const period = String(req.params.period);
    if (!Number.isSafeInteger(id) || !/^\d{4}-\d{2}$/.test(period)) {
      res.status(400).json({ error: "Parámetros no válidos" });
      return;
    }
    const settings = await getBillingSettings();
    if (!settings.configured) {
      res.status(409).json({
        error:
          "Configura primero los datos del emisor (nombre y NIF) en Administración → Facturación.",
      });
      return;
    }
    const [inst] = await db.select().from(installationsTable).where(eq(installationsTable.id, id));
    if (!inst) {
      res.status(404).json({ error: "Instalación no encontrada" });
      return;
    }
    if (!inst.taxId) {
      res.status(409).json({
        error: "La instalación no tiene NIF. Añádelo antes de emitir la factura.",
      });
      return;
    }
    const [charge] = await db
      .select()
      .from(billingChargesTable)
      .where(
        and(eq(billingChargesTable.installationId, id), eq(billingChargesTable.period, period)),
      );
    if (!charge) {
      res.status(404).json({ error: "No hay cargo para ese periodo" });
      return;
    }
    const [existing] = await db
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.chargeId, charge.id));
    if (existing) {
      res.status(409).json({ error: `Ese cargo ya tiene la factura ${existing.fullNumber}` });
      return;
    }

    const issueDate = new Date();
    const year = issueDate.getFullYear();
    const subtotalCents = charge.totalCents;
    const taxCents = Math.round((subtotalCents * settings.taxRateBps) / 10000);
    const totalCents = subtotalCents + taxCents;

    // La numeración correlativa y el encadenado de huellas se serializan con
    // un advisory lock dentro de la misma transacción, para que dos emisiones
    // concurrentes no dupliquen números ni bifurquen la cadena.
    const inv = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${INVOICE_ISSUE_LOCK_KEY})`);
      const [maxRow] = await tx
        .select()
        .from(invoicesTable)
        .where(and(eq(invoicesTable.series, settings.series), eq(invoicesTable.year, year)))
        .orderBy(desc(invoicesTable.number))
        .limit(1);
      const number = (maxRow?.number ?? 0) + 1;
      const fullNumber = `${settings.series}-${year}-${String(number).padStart(4, "0")}`;
      const [lastInv] = await tx
        .select()
        .from(invoicesTable)
        .orderBy(desc(invoicesTable.id))
        .limit(1);
      const prevHash = lastInv?.hash ?? null;
      const record = {
        prevHash,
        fullNumber,
        issueDate,
        period,
        issuerName: settings.issuerName!,
        issuerTaxId: settings.issuerTaxId!,
        issuerAddress: settings.issuerAddress ?? "",
        customerName: inst.name,
        customerTaxId: inst.taxId!,
        customerAddress: inst.billingAddress,
        baseCents: charge.baseCents,
        farmCount: charge.farmCount,
        variableCents: charge.variableCents,
        subtotalCents,
        taxRateBps: settings.taxRateBps,
        taxName: settings.taxName,
        taxCents,
        totalCents,
      };
      const hash = invoiceHash(record);
      const [created] = await tx
        .insert(invoicesTable)
        .values({
          installationId: inst.id,
          chargeId: charge.id,
          series: settings.series,
          year,
          number,
          ...record,
          hash,
        })
        .returning();
      await tx
        .update(billingChargesTable)
        .set({ status: "invoiced", updatedAt: new Date() })
        .where(eq(billingChargesTable.id, charge.id));
      return created;
    });
    await audit({
      userId: req.user!.id,
      action: "admin_invoice_issued",
      entityType: "invoice",
      entityId: inv.id,
      detail: inv.fullNumber,
    });
    res.json(AdminIssueInvoiceResponse.parse(invoicePayload(inv, inst.name)));
  },
);

async function loadInvoice(idRaw: string) {
  const id = Number(idRaw);
  if (!Number.isSafeInteger(id)) return null;
  const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, id));
  return inv ?? null;
}

/** Descarga del PDF (fuera del contrato OpenAPI: respuesta binaria). */
router.get("/admin/invoices/:id/pdf", async (req, res): Promise<void> => {
  const inv = await loadInvoice(req.params.id);
  if (!inv) {
    res.status(404).json({ error: "Factura no encontrada" });
    return;
  }
  const pdf = await renderInvoicePdf(inv);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${inv.fullNumber}.pdf"`);
  res.send(pdf);
});

router.post("/admin/invoices/:id/send", async (req, res): Promise<void> => {
  const inv = await loadInvoice(req.params.id);
  if (!inv) {
    res.status(404).json({ error: "Factura no encontrada" });
    return;
  }
  const [inst] = await db
    .select()
    .from(installationsTable)
    .where(eq(installationsTable.id, inv.installationId));
  if (!inst) {
    res.status(404).json({ error: "Instalación no encontrada" });
    return;
  }
  const pdf = await renderInvoicePdf(inv);
  try {
    await sendInvoiceEmail({
      to: inst.contactEmail,
      contactName: inst.contactName,
      coopName: inst.name,
      fullNumber: inv.fullNumber,
      period: inv.period,
      totalEuros: formatEuros(inv.totalCents),
      pdf,
    });
  } catch (err) {
    res.status(502).json({
      error: `No se pudo enviar el email: ${err instanceof Error ? err.message : "error desconocido"}`,
    });
    return;
  }
  const [updated] = await db
    .update(invoicesTable)
    .set({
      status: inv.status === "paid" ? "paid" : "sent",
      sentAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(invoicesTable.id, inv.id))
    .returning();
  await audit({
    userId: req.user!.id,
    action: "admin_invoice_sent",
    entityType: "invoice",
    entityId: inv.id,
    detail: `${inv.fullNumber} → ${inst.contactEmail}`,
  });
  res.json(AdminIssueInvoiceResponse.parse(invoicePayload(updated, inst.name)));
});

router.post("/admin/invoices/:id/paid", async (req, res): Promise<void> => {
  const inv = await loadInvoice(req.params.id);
  if (!inv) {
    res.status(404).json({ error: "Factura no encontrada" });
    return;
  }
  if (inv.status === "paid") {
    res.status(409).json({ error: "La factura ya está marcada como pagada" });
    return;
  }
  const [updated] = await db
    .update(invoicesTable)
    .set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
    .where(eq(invoicesTable.id, inv.id))
    .returning();
  await db
    .update(billingChargesTable)
    .set({ status: "paid", updatedAt: new Date() })
    .where(eq(billingChargesTable.id, inv.chargeId));
  const [inst] = await db
    .select()
    .from(installationsTable)
    .where(eq(installationsTable.id, inv.installationId));
  await audit({
    userId: req.user!.id,
    action: "admin_invoice_paid",
    entityType: "invoice",
    entityId: inv.id,
    detail: inv.fullNumber,
  });
  res.json(AdminIssueInvoiceResponse.parse(invoicePayload(updated, inst?.name ?? "—")));
});

export default router;
