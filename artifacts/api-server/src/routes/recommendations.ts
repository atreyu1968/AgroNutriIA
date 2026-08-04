import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  reportsTable,
  recommendationsTable,
  fertilizersTable,
  sectorsTable,
  waterSourcesTable,
  analysesTable,
  type RecommendationItem,
} from "@workspace/db";
import {
  ListRecommendationsResponse,
  CreateRecommendationBody,
  CreateRecommendationResponse,
  GenerateAiDraftRecommendationBody,
  GenerateAiDraftRecommendationResponse,
  GetRecommendationResponse,
  UpdateRecommendationBody,
  UpdateRecommendationResponse,
  ChangeRecommendationStatusBody,
  ChangeRecommendationStatusResponse,
  RunCalculationBody,
  RunCalculationResponse,
} from "@workspace/api-zod";
import {
  requireAuth,
  farmAccess,
  canEdit,
  canApply,
  parseIntParam,
} from "../middlewares/auth";
import { serializeRecommendation } from "../lib/serializers";
import {
  latestAnalysis,
  latestAnalysisScoped,
  blendedWaterAnalysis,
  activeRecommendation,
  activeRecommendationScoped,
  resolveCredential,
  userName,
} from "../lib/farmContext";
import { runEngine } from "../lib/engine";
import { audit } from "../lib/audit";
import { buildFarmContext } from "../lib/contextBlock";
import {
  clientFor,
  agronomistSystemPrompt,
  estimateCostEur,
  maxOutputTokensParam,
  modelFor,
  parseJsonLoose,
  recordUsage,
  supportsJsonResponseFormat,
  checkMonthlyLimit,
  usesResponsesApi,
} from "../lib/openai";

const router: IRouter = Router();
router.use(requireAuth);

async function fullSerialize(r: typeof recommendationsTable.$inferSelect) {
  return serializeRecommendation(
    r,
    await userName(r.createdBy),
    await userName(r.validatedBy),
    await userName(r.updatedBy),
  );
}

router.get("/farms/:farmId/recommendations", async (req, res): Promise<void> => {
  const farmId = parseIntParam(req.params.farmId);
  const access = await farmAccess(req.user!, farmId);
  if (!access) {
    res.status(404).json({ error: "Finca no encontrada" });
    return;
  }
  const rows = await db
    .select()
    .from(recommendationsTable)
    .where(eq(recommendationsTable.farmId, farmId))
    .orderBy(desc(recommendationsTable.createdAt));
  const result = [];
  for (const r of rows) result.push(await fullSerialize(r));
  res.json(ListRecommendationsResponse.parse(result));
});

async function computeEstimates(farmId: number, farm: import("@workspace/db").Farm, items: import("@workspace/db").RecommendationItem[]) {
  const fertilizers = await db.select().from(fertilizersTable);
  const blended = await blendedWaterAnalysis(farmId);
  const out = runEngine({ farm, waterAnalysis: blended.analysis, fertilizers, items });
  return {
    estimatedEcDsM: out.estimatedEcDsM,
    estimatedWeeklyNKg: out.nutrients.n ?? null,
    warnings: [...blended.notes, ...out.warnings, ...out.compatibilityIssues],
  };
}

router.post("/farms/:farmId/recommendations", async (req, res): Promise<void> => {
  const farmId = parseIntParam(req.params.farmId);
  const access = await farmAccess(req.user!, farmId);
  if (!access) {
    res.status(404).json({ error: "Finca no encontrada" });
    return;
  }
  if (!canEdit(access.role)) {
    res.status(403).json({ error: "Sin permisos" });
    return;
  }
  const parsed = CreateRecommendationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!parsed.data.rationale || parsed.data.rationale.trim().length < 10) {
    res.status(422).json({
      error:
        "Todo programa de abonado debe incluir una justificación técnica de su motivación (elaborada por el técnico o por la IA). Añádela antes de guardar.",
    });
    return;
  }
  const est = await computeEstimates(farmId, access.farm, parsed.data.items);
  const [rec] = await db
    .insert(recommendationsTable)
    .values({
      farmId,
      sectorId: parsed.data.sectorId,
      title: parsed.data.title ?? "Programa semanal de fertirrigación",
      items: parsed.data.items,
      rationale: parsed.data.rationale,
      status: "draft",
      source: "manual",
      createdBy: req.user!.id,
      ...est,
    })
    .returning();
  await audit({
    userId: req.user!.id,
    farmId,
    action: "recommendation_created",
    entityType: "recommendation",
    entityId: rec.id,
    detail: rec.title,
  });
  res.status(201).json(CreateRecommendationResponse.parse(await fullSerialize(rec)));
});

const aiProgramSchema = {
  name: "programa_fertirrigacion",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["title", "rationale", "items"],
    properties: {
      title: { type: "string" },
      rationale: {
        type: "string",
        description: "Justificación agronómica breve basada en las analíticas",
      },
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["fertilizerName", "weeklyDose", "unit", "reason"],
          properties: {
            fertilizerName: { type: "string" },
            weeklyDose: { type: "number", description: "Dosis semanal total de la finca" },
            unit: { type: "string", enum: ["kg", "L"] },
            reason: { type: ["string", "null"] },
          },
        },
      },
    },
  },
} as const;

router.post("/farms/:farmId/recommendations/ai-draft", async (req, res): Promise<void> => {
  const farmId = parseIntParam(req.params.farmId);
  const access = await farmAccess(req.user!, farmId);
  if (!access) {
    res.status(404).json({ error: "Finca no encontrada" });
    return;
  }
  if (!canEdit(access.role)) {
    res.status(403).json({ error: "Sin permisos para crear programas" });
    return;
  }
  // Optional body: { sectorId } → sector-specific program; absent/null → farm-wide.
  const parsedBody = GenerateAiDraftRecommendationBody.safeParse(req.body ?? {});
  if (!parsedBody.success) {
    res.status(400).json({ error: "Sector no válido" });
    return;
  }
  const requestedSectorId = parsedBody.data.sectorId ?? null;
  const useAcid = parsedBody.data.useAcid === true;
  const targetPh = useAcid && parsedBody.data.targetPh != null ? parsedBody.data.targetPh : null;
  const acidType = useAcid ? (parsedBody.data.acidType ?? null) : null;
  let sector: typeof sectorsTable.$inferSelect | null = null;
  if (requestedSectorId != null) {
    const [s] = await db
      .select()
      .from(sectorsTable)
      .where(and(eq(sectorsTable.id, requestedSectorId), eq(sectorsTable.farmId, farmId)));
    if (!s) {
      res.status(404).json({ error: "El sector indicado no existe en esta finca" });
      return;
    }
    sector = s;
  }
  const credential = await resolveCredential(access.farm, req.user!);
  if (!credential) {
    res.status(409).json({
      error:
        "No hay ninguna clave de OpenAI configurada. Añade tu clave en Ajustes para usar el técnico virtual.",
    });
    return;
  }
  const limitMsg = await checkMonthlyLimit(req.user!, credential);
  if (limitMsg) {
    res.status(429).json({ error: limitMsg });
    return;
  }

  const sectorScope = sector?.id ?? null;
  const [soil, leaf, blendedWater, sectors, active, fertilizers] = await Promise.all([
    latestAnalysisScoped(farmId, "soil", sectorScope),
    latestAnalysisScoped(farmId, "leaf", sectorScope),
    blendedWaterAnalysis(farmId, { sectorId: sectorScope }),
    db.select().from(sectorsTable).where(eq(sectorsTable.farmId, farmId)),
    activeRecommendationScoped(farmId, sectorScope),
    db.select().from(fertilizersTable),
  ]);
  const water = blendedWater.analysis;
  if (!soil && !leaf && !water) {
    res.status(422).json({
      error: sector
        ? `Ni el sector «${sector.name}» ni la finca tienen analíticas registradas. Sube al menos una analítica (agua, suelo o foliar) para generar un programa con IA.`
        : "La finca no tiene ninguna analítica registrada. Sube al menos una analítica (agua, suelo o foliar) para generar un programa con IA.",
    });
    return;
  }
  // Para el cálculo de ácido se usan los datos DISPONIBLES: se busca el pH y los
  // bicarbonatos en la mezcla actual y, si faltan, en cualquier analítica de agua
  // de la finca (la más reciente que los tenga). Lo que no exista se estima y se
  // advierte en la justificación; ya no se bloquea la petición.
  let acidDataBlock = "";
  if (useAcid) {
    const norm = (s: string) =>
      s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const isPh = (n: string) => {
      const x = norm(n);
      return x === "ph" || x.startsWith("ph ") || x.includes("ph agua") || /\bph\b/.test(x);
    };
    const isBicarb = (n: string) => {
      const x = norm(n);
      return x.includes("bicarbonat") || x.includes("hco3") || x.includes("alcalinid") || x.includes("carbonat");
    };
    const allWater = await db
      .select()
      .from(analysesTable)
      .where(and(eq(analysesTable.farmId, farmId), eq(analysesTable.type, "water")))
      .orderBy(desc(analysesTable.sampleDate), desc(analysesTable.id));
    const findParam = (match: (n: string) => boolean) => {
      const inBlend = (water?.parameters ?? []).find((p) => match(p.name) && p.value != null);
      if (inBlend) return { p: inBlend, date: null as string | null };
      for (const a of allWater) {
        const hit = (a.parameters ?? []).find((p) => match(p.name) && p.value != null);
        if (hit) return { p: hit, date: a.sampleDate };
      }
      return null;
    };
    const ph = findParam(isPh);
    const bicarb = findParam(isBicarb);
    const weeklyLitres = sector?.weeklyLitresPerPlant ?? access.farm.weeklyLitresPerPlant;
    const plants = sector?.plantCount ?? access.farm.plantCount;
    const hasVolume = weeklyLitres != null && weeklyLitres > 0 && plants != null && plants > 0;
    const lines: string[] = [];
    lines.push(
      ph
        ? `- pH del agua disponible: ${ph.p.value}${ph.date ? ` (analítica del ${ph.date})` : " (mezcla actual)"}.`
        : "- No consta el pH en ninguna analítica de agua: estima con un valor típico de aguas de Canarias (pH ≈ 7,8) y ADVIÉRTELO expresamente en la justificación.",
    );
    lines.push(
      bicarb
        ? `- Bicarbonatos/alcalinidad disponibles: ${bicarb.p.value} ${bicarb.p.unit ?? "mg/L"}${bicarb.date ? ` (analítica del ${bicarb.date})` : " (mezcla actual)"}.`
        : "- No constan bicarbonatos ni alcalinidad en ninguna analítica: estima con un valor típico (HCO3 ≈ 250 mg/L) y ADVIÉRTELO expresamente en la justificación.",
    );
    if (!hasVolume) {
      lines.push(
        "- No consta el volumen semanal de riego: NO incluyas el ácido como producto del programa; indica solo en la justificación la dosis orientativa en mL por m³ de agua de riego y de qué ácido, y advierte que falta configurar el riego semanal para calcular litros.",
      );
    }
    acidDataBlock = `\nDATOS DISPONIBLES PARA EL CÁLCULO DE ÁCIDO (usa estos, no pidas más):\n${lines.join("\n")}`;
  }
  const contextBlock = buildFarmContext({ farm: access.farm, sectors, soil, leaf, water, active });
  const catalog = fertilizers
    .filter((f) => f.isActive !== false && (f.usage ?? "fertirrigacion") === "fertirrigacion")
    .map((f) => `- ${f.name} (${f.formulaType ?? "?"})`)
    .join("\n");

  const ACID_LABEL: Record<string, string> = {
    nitrico: "ácido nítrico",
    fosforico: "ácido fosfórico",
    sulfurico: "ácido sulfúrico",
  };
  const acidBlock = useAcid
    ? `

IMPORTANTE — ACIDIFICACIÓN DEL AGUA: el agricultor ha decidido usar ácido para bajar el pH del agua de riego. Tenlo en cuenta al diseñar el programa:
- Calcula los LITROS de ácido necesarios POR SEMANA a partir del pH y los bicarbonatos del análisis de agua y del volumen semanal de riego, para llevar el agua a ${targetPh != null ? `un pH objetivo de ${targetPh}` : "un pH objetivo de 5,5–6,0"}.
${
  acidType
    ? `- El agricultor prefiere usar ${ACID_LABEL[acidType]}: usa ESE ácido en el cálculo (si el catálogo tiene ese ácido, inclúyelo como producto; si no, indícalo solo en la justificación). Si por los datos de las analíticas ese ácido fuese claramente desaconsejable, dilo en la justificación y explica por qué, pero respeta su elección en el programa.`
    : `- Elige el ácido MÁS ADECUADO según las analíticas (no uses ácido nítrico por defecto): valora el fosfórico si falta fósforo, el sulfúrico si conviene azufre o hay exceso de nitrógeno, y el nítrico si el cultivo demanda nitrógeno. JUSTIFICA expresamente en la justificación por qué eliges ese ácido y no los otros.`
}
- Descuenta SIEMPRE del resto del abonado el nitrógeno, fósforo o azufre que aporte el ácido elegido.
- Si el catálogo incluye el ácido elegido, inclúyelo como un producto más del programa con su dosis semanal en L y el motivo "corrección de pH del agua". Si no está en el catálogo, NO lo inventes como producto: indica en la justificación los litros semanales estimados y de qué ácido, y ajusta el programa asumiendo el agua ya acidificada.
- Evita recomendar productos alcalinizantes o bicarbonatados que contrarresten la acidificación.${acidDataBlock}`
    : `

IMPORTANTE — SIN ACIDIFICACIÓN: el agricultor NO va a usar ácido para corregir el pH del agua de riego.
- NO incluyas ningún ácido con el objetivo de corregir el pH del agua.
- Sí PUEDES incluir un ácido del catálogo únicamente como FUENTE DE NUTRIENTES (p. ej. ácido fosfórico como fuente de fósforo, ácido nítrico como fuente de nitrógeno) cuando sea agronómicamente aconsejable; en ese caso el motivo del producto debe indicar claramente el nutriente que aporta, no la corrección de pH.
- Diseña el programa asumiendo el agua tal cual es: si el pH o los bicarbonatos del análisis de agua son altos, compénsalo eligiendo fertilizantes de reacción ácida o quelatados y ajustando las dosis (p. ej. micronutrientes quelatados frente a sales simples que se bloquearían).
- Si el agua tiene pH o bicarbonatos altos, adviértelo en la justificación y explica cómo el programa lo compensa y qué limitaciones tendrá frente a un agua acidificada.`;

  const model = modelFor(credential);
  const start = Date.now();
  let extracted: {
    title: string;
    rationale: string;
    items: { fertilizerName: string; weeklyDose: number; unit: string; reason?: string | null }[];
  };
  try {
    const client = clientFor(credential);
    const completion = await client.chat.completions.create({
      model,
      ...maxOutputTokensParam(credential, 4000),
      // Algunos proveedores compatibles no soportan json_schema estricto:
      // se usa json_object (o solo el prompt si el modelo no tiene JSON mode)
      // y la estructura se describe en el prompt.
      ...(usesResponsesApi(credential)
        ? { response_format: { type: "json_schema" as const, json_schema: aiProgramSchema } }
        : supportsJsonResponseFormat(credential)
          ? { response_format: { type: "json_object" as const } }
          : {}),
      messages: [
        {
          role: "system",
          content:
            agronomistSystemPrompt(access.farm, contextBlock) +
            (usesResponsesApi(credential)
              ? ""
              : `\n\nResponde SOLO con un objeto JSON válido con esta estructura exacta: ${JSON.stringify(aiProgramSchema.schema)}`),
        },
        {
          role: "user",
          content: sector
            ? `Diseña el programa semanal de fertirrigación más adecuado para el sector «${sector.name}» de esta finca a partir de las últimas analíticas disponibles (las analíticas mostradas son las del propio sector cuando existen; si no, las globales de la finca).
Datos del sector: ${sector.plantCount ?? "?"} plantas, ${sector.surfaceHa ?? "?"} ha, riego ${sector.weeklyLitresPerPlant ?? access.farm.weeklyLitresPerPlant ?? "?"} L/planta/semana${sector.phenologicalStage ? `, fase fenológica ${sector.phenologicalStage}` : ""}.
Usa EXCLUSIVAMENTE fertilizantes de este catálogo (productos de fertirrigación):
${catalog}

Devuelve dosis semanales TOTALES para ese sector (no para toda la finca) en kg o L por fertilizante, con un motivo breve por producto, y una justificación agronómica general basada en los datos de las analíticas.${acidBlock}`
            : `Diseña el programa semanal de fertirrigación más adecuado para esta finca a partir de las últimas analíticas disponibles.
Usa EXCLUSIVAMENTE fertilizantes de este catálogo (productos de fertirrigación):
${catalog}

Devuelve dosis semanales TOTALES para la finca en kg o L por fertilizante, con un motivo breve por producto, y una justificación agronómica general basada en los datos de las analíticas.${acidBlock}`,
        },
      ],
    });
    const raw = completion.choices[0]?.message?.content ?? "";
    extracted = parseJsonLoose(raw);
    const inputTokens = completion.usage?.prompt_tokens ?? 0;
    const outputTokens = completion.usage?.completion_tokens ?? 0;
    await recordUsage({
      userId: req.user!.id,
      farmId,
      model,
      operation: "ai_draft_program",
      inputTokens,
      outputTokens,
      estimatedCostEur: estimateCostEur(model, inputTokens, outputTokens),
      durationMs: Date.now() - start,
      result: "ok",
    });
  } catch (err) {
    req.log.error({ err: (err as Error).message }, "OpenAI ai-draft program failed");
    await recordUsage({
      userId: req.user!.id,
      farmId,
      model,
      operation: "ai_draft_program",
      durationMs: Date.now() - start,
      result: "error",
    });
    res.status(502).json({
      error: "No se ha podido generar el programa con IA. Inténtalo de nuevo en unos momentos.",
    });
    return;
  }

  if (!Array.isArray(extracted.items) || extracted.items.length === 0) {
    res.status(422).json({
      error: "La IA no ha propuesto ningún fertilizante. Revisa que las analíticas tengan datos y vuelve a intentarlo.",
    });
    return;
  }

  const byName = new Map(fertilizers.map((f) => [f.name.toLowerCase(), f]));
  // Salvaguarda: si el agricultor NO marcó el uso de ácido, un ácido solo puede
  // llegar al programa como fuente de nutrientes (su motivo debe indicarlo y no
  // mencionar la corrección de pH); si el motivo habla de pH/acidificación, se descarta.
  const isAcidProduct = (name: string) => {
    const n = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return /\bacido\b/.test(n) || /\b(nitric|fosforic|sulfuric)o?\b/.test(n);
  };
  const isPhCorrectionReason = (reason: string | null | undefined) => {
    if (!reason || !reason.trim()) return true; // sin motivo claro, no se admite el ácido
    const r = reason.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return /\bph\b/.test(r) || r.includes("acidif") || r.includes("correccion") || r.includes("alcalinid") || r.includes("bicarbonat");
  };
  const items: RecommendationItem[] = [];
  const discarded: string[] = [];
  const acidsAsNutrient: string[] = [];
  for (const i of extracted.items) {
    const fert = byName.get(i.fertilizerName.toLowerCase());
    const doseOk = Number.isFinite(i.weeklyDose) && i.weeklyDose > 0 && i.weeklyDose <= 10000;
    if (!fert || fert.isActive === false || !doseOk) {
      discarded.push(i.fertilizerName);
      continue;
    }
    if (!useAcid && isAcidProduct(fert.name)) {
      if (isPhCorrectionReason(i.reason)) {
        discarded.push(i.fertilizerName);
        continue;
      }
      acidsAsNutrient.push(fert.name);
    }
    items.push({
      fertilizerId: fert.id,
      fertilizerName: fert.name,
      weeklyDose: i.weeklyDose,
      unit: i.unit === "L" ? "L" : "kg",
      reason: i.reason ?? null,
    });
  }
  if (items.length === 0) {
    res.status(422).json({
      error:
        "La IA ha propuesto productos o dosis no válidos y se ha descartado la propuesta. Vuelve a intentarlo.",
    });
    return;
  }
  const out = runEngine({ farm: access.farm, sector, waterAnalysis: water, fertilizers, items });

  const [rec] = await db
    .insert(recommendationsTable)
    .values({
      farmId,
      sectorId: sector?.id ?? null,
      title: extracted.title || "Programa propuesto por el técnico virtual",
      items,
      rationale: extracted.rationale || null,
      status: "draft",
      source: "ai",
      createdBy: req.user!.id,
      estimatedEcDsM: out.estimatedEcDsM,
      estimatedWeeklyNKg: out.nutrients.n ?? null,
      warnings: [
        ...blendedWater.notes,
        ...out.warnings,
        ...out.compatibilityIssues,
        ...(discarded.length
          ? [`Se descartaron productos propuestos por la IA fuera del catálogo o con dosis no válidas: ${discarded.join(", ")}`]
          : []),
        ...(acidsAsNutrient.length
          ? [
              `Atención: ${acidsAsNutrient.join(", ")} se incluye únicamente como fuente de nutrientes (no se marcó la acidificación del agua). Verificar al validar que su uso no busca corregir el pH.`,
            ]
          : []),
      ],
    })
    .returning();
  await audit({
    userId: req.user!.id,
    farmId,
    action: "recommendation_created",
    entityType: "recommendation",
    entityId: rec.id,
    detail: `${rec.title} (borrador IA desde analíticas)`,
  });
  res.status(201).json(GenerateAiDraftRecommendationResponse.parse(await fullSerialize(rec)));
});

router.get("/farms/:farmId/recommendations/:recommendationId", async (req, res): Promise<void> => {
  const farmId = parseIntParam(req.params.farmId);
  const recId = parseIntParam(req.params.recommendationId);
  const access = await farmAccess(req.user!, farmId);
  if (!access) {
    res.status(404).json({ error: "Finca no encontrada" });
    return;
  }
  const [rec] = await db
    .select()
    .from(recommendationsTable)
    .where(and(eq(recommendationsTable.id, recId), eq(recommendationsTable.farmId, farmId)));
  if (!rec) {
    res.status(404).json({ error: "Recomendación no encontrada" });
    return;
  }
  res.json(GetRecommendationResponse.parse(await fullSerialize(rec)));
});

router.patch("/farms/:farmId/recommendations/:recommendationId", async (req, res): Promise<void> => {
  const farmId = parseIntParam(req.params.farmId);
  const recId = parseIntParam(req.params.recommendationId);
  const access = await farmAccess(req.user!, farmId);
  if (!access) {
    res.status(404).json({ error: "Finca no encontrada" });
    return;
  }
  if (!canEdit(access.role)) {
    res.status(403).json({ error: "Sin permisos" });
    return;
  }
  const parsed = UpdateRecommendationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [existing] = await db
    .select()
    .from(recommendationsTable)
    .where(and(eq(recommendationsTable.id, recId), eq(recommendationsTable.farmId, farmId)));
  if (!existing) {
    res.status(404).json({ error: "Recomendación no encontrada" });
    return;
  }
  if (existing.status !== "draft" && existing.status !== "pending_review") {
    res.status(409).json({ error: "Solo se pueden editar recomendaciones en borrador o pendientes de revisión" });
    return;
  }
  const update: Record<string, unknown> = { ...parsed.data, updatedBy: req.user!.id };
  if (parsed.data.items) {
    Object.assign(update, await computeEstimates(farmId, access.farm, parsed.data.items));
  }
  const [rec] = await db
    .update(recommendationsTable)
    .set(update)
    .where(eq(recommendationsTable.id, recId))
    .returning();
  await audit({
    userId: req.user!.id,
    farmId,
    action: "recommendation_updated",
    entityType: "recommendation",
    entityId: rec.id,
    detail: rec.title,
  });
  res.json(UpdateRecommendationResponse.parse(await fullSerialize(rec)));
});

router.delete("/farms/:farmId/recommendations/:recommendationId", async (req, res): Promise<void> => {
  const farmId = parseIntParam(req.params.farmId);
  const recId = parseIntParam(req.params.recommendationId);
  const access = await farmAccess(req.user!, farmId);
  if (!access) {
    res.status(404).json({ error: "Finca no encontrada" });
    return;
  }
  if (!canEdit(access.role)) {
    res.status(403).json({ error: "Sin permisos" });
    return;
  }
  const [existing] = await db
    .select()
    .from(recommendationsTable)
    .where(and(eq(recommendationsTable.id, recId), eq(recommendationsTable.farmId, farmId)));
  if (!existing) {
    res.status(404).json({ error: "Recomendación no encontrada" });
    return;
  }
  const deletable = ["draft", "pending_review", "rejected"];
  if (!deletable.includes(existing.status)) {
    res.status(409).json({
      error:
        "Este programa ya fue validado por el técnico (o está en aplicación/finalizado) y no se puede eliminar.",
    });
    return;
  }
  await db.transaction(async (tx) => {
    // Los informes generados a partir de este programa se conservan como histórico,
    // pero dejan de apuntar a un programa inexistente.
    await tx
      .update(reportsTable)
      .set({ recommendationId: null })
      .where(eq(reportsTable.recommendationId, recId));
    await tx.delete(recommendationsTable).where(eq(recommendationsTable.id, recId));
  });
  await audit({
    userId: req.user!.id,
    farmId,
    action: "recommendation_deleted",
    entityType: "recommendation",
    entityId: recId,
    detail: existing.title,
  });
  res.status(204).end();
});

const TRANSITIONS: Record<string, { from: string[]; to: string; requiresApprover: boolean }> = {
  submit: { from: ["draft", "rejected"], to: "pending_review", requiresApprover: false },
  approve: { from: ["pending_review"], to: "validated", requiresApprover: true },
  reject: { from: ["pending_review"], to: "rejected", requiresApprover: true },
  start_application: { from: ["validated"], to: "applying", requiresApprover: false },
  finish: { from: ["applying"], to: "finished", requiresApprover: false },
};

router.post(
  "/farms/:farmId/recommendations/:recommendationId/status",
  async (req, res): Promise<void> => {
    const farmId = parseIntParam(req.params.farmId);
    const recId = parseIntParam(req.params.recommendationId);
    const access = await farmAccess(req.user!, farmId);
    if (!access) {
      res.status(404).json({ error: "Finca no encontrada" });
      return;
    }
    const parsed = ChangeRecommendationStatusBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const t = TRANSITIONS[parsed.data.action];
    if (t.requiresApprover && !canEdit(access.role)) {
      res.status(403).json({ error: "Solo el propietario o el técnico pueden validar o rechazar" });
      return;
    }
    if (!t.requiresApprover && !canApply(access.role)) {
      res.status(403).json({ error: "Sin permisos" });
      return;
    }
    const [existing] = await db
      .select()
      .from(recommendationsTable)
      .where(and(eq(recommendationsTable.id, recId), eq(recommendationsTable.farmId, farmId)));
    if (!existing) {
      res.status(404).json({ error: "Recomendación no encontrada" });
      return;
    }
    if (!t.from.includes(existing.status)) {
      res.status(409).json({
        error: `No se puede pasar de «${existing.status}» con la acción «${parsed.data.action}»`,
      });
      return;
    }
    const update: Record<string, unknown> = { status: t.to };
    if (parsed.data.action === "approve" || parsed.data.action === "reject") {
      update.validatedBy = req.user!.id;
      update.reviewComment = parsed.data.comment ?? null;
    }
    const [rec] = await db
      .update(recommendationsTable)
      .set(update)
      .where(eq(recommendationsTable.id, recId))
      .returning();
    await audit({
      userId: req.user!.id,
      farmId,
      action: `recommendation_${parsed.data.action}`,
      entityType: "recommendation",
      entityId: recId,
      detail: parsed.data.comment ?? null,
    });
    res.json(ChangeRecommendationStatusResponse.parse(await fullSerialize(rec)));
  },
);

router.post("/farms/:farmId/calculations", async (req, res): Promise<void> => {
  const farmId = parseIntParam(req.params.farmId);
  const access = await farmAccess(req.user!, farmId);
  if (!access) {
    res.status(404).json({ error: "Finca no encontrada" });
    return;
  }
  const parsed = RunCalculationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  let sector = null;
  if (parsed.data.sectorId != null) {
    const [s] = await db
      .select()
      .from(sectorsTable)
      .where(and(eq(sectorsTable.id, parsed.data.sectorId), eq(sectorsTable.farmId, farmId)));
    sector = s ?? null;
  }
  const fertilizers = await db.select().from(fertilizersTable);
  let overrides: { waterSourceId: number; sharePct: number }[] | undefined;
  if (parsed.data.waterMix && parsed.data.waterMix.length > 0) {
    const farmSources = await db
      .select()
      .from(waterSourcesTable)
      .where(eq(waterSourcesTable.farmId, farmId));
    const farmIds = new Set(farmSources.map((s) => s.id));
    const seen = new Set<number>();
    for (const m of parsed.data.waterMix) {
      if (!farmIds.has(m.waterSourceId) || seen.has(m.waterSourceId)) {
        res.status(422).json({ error: "El reparto de agua incluye fuentes repetidas o que no pertenecen a la finca." });
        return;
      }
      seen.add(m.waterSourceId);
    }
    if (seen.size !== farmIds.size) {
      res.status(422).json({ error: "El reparto de agua debe incluir todas las fuentes de la finca." });
      return;
    }
    const total = parsed.data.waterMix.reduce((a, m) => a + m.sharePct, 0);
    if (Math.abs(total - 100) > 0.5) {
      res.status(422).json({ error: `El reparto de agua debe sumar 100 % (actualmente ${Math.round(total * 10) / 10} %).` });
      return;
    }
    overrides = parsed.data.waterMix.map((m) => ({ waterSourceId: m.waterSourceId, sharePct: m.sharePct }));
  }
  const blended = await blendedWaterAnalysis(farmId, { overrides });
  const out = runEngine({
    farm: access.farm,
    sector,
    waterAnalysis: blended.analysis,
    fertilizers,
    items: parsed.data.items,
    weeklyLitresPerPlant: parsed.data.weeklyLitresPerPlant,
    plantCount: parsed.data.plantCount,
    stageOverride: parsed.data.phenologicalStage ?? null,
    maxEcOverride: parsed.data.maxEcDsM ?? null,
  });
  res.json(RunCalculationResponse.parse({ ...out, warnings: [...blended.notes, ...out.warnings] }));
});

export default router;
