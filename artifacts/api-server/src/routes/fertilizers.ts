import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, fertilizersTable } from "@workspace/db";
import {
  ListFertilizersResponse,
  CreateFertilizerBody,
  CreateFertilizerResponse,
  UpdateFertilizerBody,
  UpdateFertilizerResponse,
} from "@workspace/api-zod";
import { requireAuth, parseIntParam } from "../middlewares/auth";
import { audit } from "../lib/audit";

const router: IRouter = Router();
router.use(requireAuth);

function serializeFertilizer(f: typeof fertilizersTable.$inferSelect) {
  return { ...f, incompatibleWith: f.incompatibleWith ?? [] };
}

router.get("/fertilizers", async (_req, res): Promise<void> => {
  const rows = await db.select().from(fertilizersTable).orderBy(fertilizersTable.name);
  res.json(ListFertilizersResponse.parse(rows.map(serializeFertilizer)));
});

router.post("/fertilizers", async (req, res): Promise<void> => {
  if (!req.user!.isAdmin) {
    res.status(403).json({ error: "Solo un administrador puede gestionar el catálogo" });
    return;
  }
  const parsed = CreateFertilizerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [fert] = await db.insert(fertilizersTable).values(parsed.data).returning();
  await audit({
    userId: req.user!.id,
    action: "fertilizer_created",
    entityType: "fertilizer",
    entityId: fert.id,
    detail: fert.name,
  });
  res.status(201).json(CreateFertilizerResponse.parse(serializeFertilizer(fert)));
});

router.patch("/fertilizers/:fertilizerId", async (req, res): Promise<void> => {
  if (!req.user!.isAdmin) {
    res.status(403).json({ error: "Solo un administrador puede gestionar el catálogo" });
    return;
  }
  const id = parseIntParam(req.params.fertilizerId);
  const parsed = UpdateFertilizerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [fert] = await db
    .update(fertilizersTable)
    .set(parsed.data)
    .where(eq(fertilizersTable.id, id))
    .returning();
  if (!fert) {
    res.status(404).json({ error: "Fertilizante no encontrado" });
    return;
  }
  res.json(UpdateFertilizerResponse.parse(serializeFertilizer(fert)));
});

router.delete("/fertilizers/:fertilizerId", async (req, res): Promise<void> => {
  if (!req.user!.isAdmin) {
    res.status(403).json({ error: "Solo un administrador puede gestionar el catálogo" });
    return;
  }
  const id = parseIntParam(req.params.fertilizerId);
  const [fert] = await db
    .delete(fertilizersTable)
    .where(eq(fertilizersTable.id, id))
    .returning();
  if (!fert) {
    res.status(404).json({ error: "Fertilizante no encontrado" });
    return;
  }
  res.status(204).send();
});

export default router;
