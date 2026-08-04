import { Router, type IRouter } from "express";
import { and, eq, ne } from "drizzle-orm";
import { db, credentialsTable } from "@workspace/db";
import {
  ListCredentialsResponse,
  CreateCredentialBody,
  CreateCredentialResponse,
  UpdateCredentialBody,
  UpdateCredentialResponse,
  TestCredentialResponse,
} from "@workspace/api-zod";
import { requireAuth, parseIntParam } from "../middlewares/auth";
import { encryptSecret, maskApiKey } from "../lib/crypto";
import { serializeCredential } from "../lib/serializers";
import { AI_PROVIDERS, clientFor, providerFor } from "../lib/openai";
import { audit } from "../lib/audit";

const router: IRouter = Router();
router.use(requireAuth);

router.get("/settings/openai", async (req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(credentialsTable)
    .where(eq(credentialsTable.userId, req.user!.id))
    .orderBy(credentialsTable.id);
  res.json(ListCredentialsResponse.parse(rows.map(serializeCredential)));
});

router.post("/settings/openai", async (req, res): Promise<void> => {
  const parsed = CreateCredentialBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { apiKey, isDefault, ...rest } = parsed.data;
  const existing = await db
    .select()
    .from(credentialsTable)
    .where(eq(credentialsTable.userId, req.user!.id));
  const makeDefault = isDefault ?? existing.length === 0;
  if (makeDefault) {
    await db
      .update(credentialsTable)
      .set({ isDefault: false })
      .where(eq(credentialsTable.userId, req.user!.id));
  }
  const provider = providerFor({ provider: rest.provider ?? "openai" });
  if (rest.selectedModel && !AI_PROVIDERS[provider].models.includes(rest.selectedModel)) {
    res.status(400).json({
      error: `El modelo «${rest.selectedModel}» no es válido para ${AI_PROVIDERS[provider].label}.`,
    });
    return;
  }
  const [cred] = await db
    .insert(credentialsTable)
    .values({
      ...rest,
      provider,
      // Sin modelo elegido, usa el modelo por defecto del proveedor (el
      // default de la columna es de OpenAI y no vale para otros proveedores).
      selectedModel: rest.selectedModel ?? AI_PROVIDERS[provider].defaultModel,
      userId: req.user!.id,
      encryptedKey: encryptSecret(apiKey),
      maskedKey: maskApiKey(apiKey),
      isDefault: makeDefault,
    })
    .returning();
  await audit({
    userId: req.user!.id,
    action: "credential_created",
    entityType: "credential",
    entityId: cred.id,
    detail: cred.name,
  });
  res.status(201).json(CreateCredentialResponse.parse(serializeCredential(cred)));
});

router.patch("/settings/openai/:credentialId", async (req, res): Promise<void> => {
  const id = parseIntParam(req.params.credentialId);
  const parsed = UpdateCredentialBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { apiKey, isDefault, ...rest } = parsed.data;
  if (rest.selectedModel) {
    const [current] = await db
      .select()
      .from(credentialsTable)
      .where(and(eq(credentialsTable.id, id), eq(credentialsTable.userId, req.user!.id)));
    if (!current) {
      res.status(404).json({ error: "Credencial no encontrada" });
      return;
    }
    const provider = providerFor(current);
    if (!AI_PROVIDERS[provider].models.includes(rest.selectedModel)) {
      res.status(400).json({
        error: `El modelo «${rest.selectedModel}» no es válido para ${AI_PROVIDERS[provider].label}.`,
      });
      return;
    }
  }
  const update: Record<string, unknown> = { ...rest };
  if (apiKey) {
    update.encryptedKey = encryptSecret(apiKey);
    update.maskedKey = maskApiKey(apiKey);
    update.status = null;
    update.lastValidatedAt = null;
  }
  if (isDefault === true) {
    await db
      .update(credentialsTable)
      .set({ isDefault: false })
      .where(and(eq(credentialsTable.userId, req.user!.id), ne(credentialsTable.id, id)));
    update.isDefault = true;
  } else if (isDefault === false) {
    update.isDefault = false;
  }
  const [cred] = await db
    .update(credentialsTable)
    .set(update)
    .where(and(eq(credentialsTable.id, id), eq(credentialsTable.userId, req.user!.id)))
    .returning();
  if (!cred) {
    res.status(404).json({ error: "Credencial no encontrada" });
    return;
  }
  res.json(UpdateCredentialResponse.parse(serializeCredential(cred)));
});

router.delete("/settings/openai/:credentialId", async (req, res): Promise<void> => {
  const id = parseIntParam(req.params.credentialId);
  const [cred] = await db
    .delete(credentialsTable)
    .where(and(eq(credentialsTable.id, id), eq(credentialsTable.userId, req.user!.id)))
    .returning();
  if (!cred) {
    res.status(404).json({ error: "Credencial no encontrada" });
    return;
  }
  await audit({
    userId: req.user!.id,
    action: "credential_deleted",
    entityType: "credential",
    entityId: id,
  });
  res.status(204).send();
});

router.post("/settings/openai/:credentialId/test", async (req, res): Promise<void> => {
  const id = parseIntParam(req.params.credentialId);
  const [cred] = await db
    .select()
    .from(credentialsTable)
    .where(and(eq(credentialsTable.id, id), eq(credentialsTable.userId, req.user!.id)));
  if (!cred) {
    res.status(404).json({ error: "Credencial no encontrada" });
    return;
  }
  try {
    const client = clientFor(cred);
    await client.models.list();
    await db
      .update(credentialsTable)
      .set({ status: "ok", lastValidatedAt: new Date() })
      .where(eq(credentialsTable.id, id));
    res.json(TestCredentialResponse.parse({ ok: true, message: "Conexión correcta: la clave es válida." }));
  } catch (err) {
    req.log.warn({ err: (err as Error).message }, "Credential test failed");
    await db
      .update(credentialsTable)
      .set({ status: "error", lastValidatedAt: new Date() })
      .where(eq(credentialsTable.id, id));
    res.json(
      TestCredentialResponse.parse({
        ok: false,
        message: "No se pudo validar la clave. Revisa que sea correcta y que tenga crédito disponible.",
      }),
    );
  }
});

export default router;
