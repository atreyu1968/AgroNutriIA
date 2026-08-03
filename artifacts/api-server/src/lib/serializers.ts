import type {
  User,
  Farm,
  Analysis,
  Recommendation,
  Credential,
  Conversation,
  Message,
  Report,
} from "@workspace/db";

export function serializeUser(u: User) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    company: u.company,
    phone: u.phone,
    role: u.role,
    isAdmin: u.isAdmin,
    unitsPreference: u.unitsPreference,
    reportLanguage: u.reportLanguage,
    aiMonthlyLimitEur: u.aiMonthlyLimitEur,
    aiResponseStyle: u.aiResponseStyle,
  };
}

export function serializeFarm(f: Farm, myRole: string, sectorCount?: number) {
  return {
    id: f.id,
    ownerId: f.ownerId,
    name: f.name,
    companyName: f.companyName,
    cif: f.cif,
    island: f.island,
    municipality: f.municipality,
    latitude: f.latitude,
    longitude: f.longitude,
    altitudeM: f.altitudeM,
    surfaceHa: f.surfaceHa,
    mainCrop: f.mainCrop,
    variety: f.variety,
    plantCount: f.plantCount,
    phenologicalStage: f.phenologicalStage,
    cropSystem: f.cropSystem,
    soilType: f.soilType,
    hasDrainage: f.hasDrainage,
    foliarAllowed: f.foliarAllowed,
    hasDesalinatedWater: f.hasDesalinatedWater,
    desalinatedWaterPct: f.desalinatedWaterPct,
    weeklyLitresPerPlant: f.weeklyLitresPerPlant,
    maxEcDsM: f.maxEcDsM,
    managementNotes: f.managementNotes,
    responsibleTechnician: f.responsibleTechnician,
    contactName: f.contactName,
    contactPhone: f.contactPhone,
    contactEmail: f.contactEmail,
    myRole,
    sectorCount: sectorCount ?? null,
  };
}

export function serializeAnalysis(a: Analysis) {
  return {
    id: a.id,
    farmId: a.farmId,
    sectorId: a.sectorId,
    type: a.type,
    reference: a.reference,
    laboratory: a.laboratory,
    description: a.description,
    sampleDate: a.sampleDate,
    parameters: a.parameters,
    notes: a.notes,
    createdAt: a.createdAt.toISOString(),
  };
}

export function serializeRecommendation(
  r: Recommendation,
  createdByName?: string | null,
  validatedByName?: string | null,
  updatedByName?: string | null,
) {
  return {
    id: r.id,
    farmId: r.farmId,
    sectorId: r.sectorId,
    title: r.title,
    status: r.status,
    source: r.source,
    items: r.items,
    rationale: r.rationale,
    estimatedEcDsM: r.estimatedEcDsM,
    estimatedWeeklyNKg: r.estimatedWeeklyNKg,
    warnings: r.warnings ?? [],
    createdByName: createdByName ?? null,
    validatedByName: validatedByName ?? null,
    updatedByName: updatedByName ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function serializeCredential(c: Credential) {
  return {
    id: c.id,
    provider: c.provider,
    name: c.name,
    maskedKey: c.maskedKey,
    selectedModel: c.selectedModel,
    monthlyLimitEur: c.monthlyLimitEur,
    isDefault: c.isDefault,
    isActive: c.isActive,
    lastValidatedAt: c.lastValidatedAt ? c.lastValidatedAt.toISOString() : null,
    status: c.status,
  };
}

export function serializeConversation(c: Conversation, messageCount?: number) {
  return {
    id: c.id,
    farmId: c.farmId,
    sectorId: c.sectorId,
    title: c.title,
    status: c.status,
    messageCount: messageCount ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function serializeMessage(m: Message) {
  return {
    id: m.id,
    conversationId: m.conversationId,
    role: m.role,
    content: m.content,
    attachments: m.attachments ?? [],
    toolsUsed: m.toolsUsed ?? [],
    sources: m.sources ?? [],
    estimatedCostEur: m.estimatedCostEur,
    createdAt: m.createdAt.toISOString(),
  };
}

export function serializeReport(r: Report, createdByName?: string | null) {
  return {
    id: r.id,
    farmId: r.farmId,
    title: r.title,
    reportType: r.reportType,
    format: r.format,
    status: r.status,
    warnings: r.warnings ?? null,
    downloadUrl:
      r.status === "ready" ? `/api/farms/${r.farmId}/reports/${r.id}/download` : null,
    createdByName: createdByName ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}
