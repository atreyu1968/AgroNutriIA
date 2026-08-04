import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  analysesTable,
  waterSourcesTable,
  type WaterSource,
  recommendationsTable,
  farmApiConfigTable,
  credentialsTable,
  usersTable,
  type Farm,
  type Analysis,
  type Recommendation,
  type Credential,
  type User,
} from "@workspace/db";

export async function latestAnalysis(farmId: number, type: string): Promise<Analysis | null> {
  const [a] = await db
    .select()
    .from(analysesTable)
    .where(and(eq(analysesTable.farmId, farmId), eq(analysesTable.type, type)))
    .orderBy(desc(analysesTable.sampleDate), desc(analysesTable.id))
    .limit(1);
  return a ?? null;
}

/**
 * Latest analysis of a type, aware of sector scope:
 * - With a sectorId: prefer the sector's own analyses, falling back to the
 *   farm-global ones (sectorId null).
 * - Without sectorId (global program): prefer farm-global analyses, falling
 *   back to the latest one of any sector so farms that only tag analyses by
 *   sector keep working.
 */
export async function latestAnalysisScoped(
  farmId: number,
  type: string,
  sectorId: number | null,
): Promise<Analysis | null> {
  const base = and(eq(analysesTable.farmId, farmId), eq(analysesTable.type, type));
  const pick = async (extra?: ReturnType<typeof eq> | ReturnType<typeof isNull>) => {
    const [a] = await db
      .select()
      .from(analysesTable)
      .where(extra ? and(base, extra) : base)
      .orderBy(desc(analysesTable.sampleDate), desc(analysesTable.id))
      .limit(1);
    return a ?? null;
  };
  if (sectorId != null) {
    return (
      (await pick(eq(analysesTable.sectorId, sectorId))) ??
      (await pick(isNull(analysesTable.sectorId)))
    );
  }
  return (await pick(isNull(analysesTable.sectorId))) ?? (await pick());
}

export type WaterMixOverride = { waterSourceId: number; sharePct: number }[];

export type BlendedWater = {
  analysis: Analysis | null;
  /** Mix actually used: source name + normalized pct (null when a single plain analysis was used). */
  mix: { name: string; sharePct: number }[] | null;
  notes: string[];
};

/**
 * Effective water analysis for a farm.
 * - Without configured water sources (or none with share > 0 and an analysis):
 *   falls back to the latest water analysis of the farm.
 * - With sources: weighted average (by share) of each source's latest water
 *   analysis. Parameters are matched by name (case-insensitive); a parameter
 *   whose unit differs between sources is skipped with a note. Missing
 *   parameters in a source are treated as not contributing (weighted over the
 *   sources that do have the parameter).
 * - `overrides` (e.g. from the calculator) replaces the stored shares.
 */
export async function blendedWaterAnalysis(
  farmId: number,
  opts: { sectorId?: number | null; overrides?: WaterMixOverride } = {},
): Promise<BlendedWater> {
  const notes: string[] = [];
  const sources = await db
    .select()
    .from(waterSourcesTable)
    .where(eq(waterSourcesTable.farmId, farmId))
    .orderBy(waterSourcesTable.id);

  const shareOf = (s: WaterSource) => {
    const o = opts.overrides?.find((x) => x.waterSourceId === s.id);
    return o ? o.sharePct : s.sharePct;
  };

  const active = sources.filter((s) => shareOf(s) > 0);
  if (active.length === 0) {
    const analysis =
      opts.sectorId !== undefined
        ? await latestAnalysisScoped(farmId, "water", opts.sectorId)
        : await latestAnalysis(farmId, "water");
    return { analysis, mix: null, notes };
  }

  // Latest water analysis per active source.
  const withAnalysis: { source: WaterSource; share: number; analysis: Analysis }[] = [];
  for (const s of active) {
    const [a] = await db
      .select()
      .from(analysesTable)
      .where(
        and(
          eq(analysesTable.farmId, farmId),
          eq(analysesTable.type, "water"),
          eq(analysesTable.waterSourceId, s.id),
        ),
      )
      .orderBy(desc(analysesTable.sampleDate), desc(analysesTable.id))
      .limit(1);
    if (a) withAnalysis.push({ source: s, share: shareOf(s), analysis: a });
    else notes.push(`La fuente «${s.name}» no tiene analítica de agua: se reparte su ${round1(shareOf(s))} % entre las demás.`);
  }

  if (withAnalysis.length === 0) {
    notes.push("Ninguna fuente de agua tiene analítica: se usa la analítica de agua más reciente de la finca.");
    const analysis =
      opts.sectorId !== undefined
        ? await latestAnalysisScoped(farmId, "water", opts.sectorId)
        : await latestAnalysis(farmId, "water");
    return { analysis, mix: null, notes };
  }

  const totalShare = withAnalysis.reduce((acc, w) => acc + w.share, 0);
  const mix = withAnalysis.map((w) => ({
    name: w.source.name,
    sharePct: round1((w.share / totalShare) * 100),
  }));
  if (withAnalysis.length === 1) {
    return { analysis: withAnalysis[0].analysis, mix, notes };
  }

  // Weighted average by parameter name; units must agree.
  type Acc = { name: string; unit: string | null; weighted: number; weight: number; skip: boolean };
  const acc = new Map<string, Acc>();
  const keyOf = (name: string) => name.trim().toLowerCase();
  const normUnit = (u?: string | null) => (u ?? "").trim().toLowerCase() || null;
  for (const w of withAnalysis) {
    const weight = w.share / totalShare;
    for (const p of w.analysis.parameters ?? []) {
      const k = keyOf(p.name);
      const existing = acc.get(k);
      if (!existing) {
        acc.set(k, { name: p.name, unit: normUnit(p.unit) === null ? null : (p.unit ?? null), weighted: p.value * weight, weight, skip: false });
      } else if (normUnit(existing.unit) !== normUnit(p.unit)) {
        if (!existing.skip) {
          existing.skip = true;
          notes.push(`El parámetro «${p.name}» tiene unidades distintas entre fuentes y se ha omitido de la mezcla.`);
        }
      } else {
        existing.weighted += p.value * weight;
        existing.weight += weight;
      }
    }
  }
  const parameters = [...acc.values()]
    .filter((a) => !a.skip)
    .map((a) => ({
      name: a.name,
      value: Math.round((a.weighted / a.weight) * 1000) / 1000,
      unit: a.unit,
    }));

  const base = withAnalysis[0].analysis;
  const oldestSample = withAnalysis
    .map((w) => w.analysis.sampleDate)
    .sort()[0];
  const blended: Analysis = {
    ...base,
    id: 0,
    waterSourceId: null,
    reference: null,
    laboratory: null,
    sampleDate: oldestSample,
    description: `Mezcla de agua: ${mix.map((m) => `${m.name} ${m.sharePct}%`).join(" + ")}`,
    parameters,
    notes: null,
  };
  return { analysis: blended, mix, notes };
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

export async function activeRecommendation(farmId: number): Promise<Recommendation | null> {
  const [r] = await db
    .select()
    .from(recommendationsTable)
    .where(
      and(
        eq(recommendationsTable.farmId, farmId),
        inArray(recommendationsTable.status, ["validated", "applying"]),
      ),
    )
    .orderBy(desc(recommendationsTable.updatedAt))
    .limit(1);
  return r ?? null;
}

/**
 * Active recommendation restricted to a scope: with a sectorId, prefer that
 * sector's active program and fall back to the farm-global one; without it,
 * only the farm-global active program counts.
 */
export async function activeRecommendationScoped(
  farmId: number,
  sectorId: number | null,
): Promise<Recommendation | null> {
  const base = and(
    eq(recommendationsTable.farmId, farmId),
    inArray(recommendationsTable.status, ["validated", "applying"]),
  );
  const pick = async (scope: ReturnType<typeof eq> | ReturnType<typeof isNull>) => {
    const [r] = await db
      .select()
      .from(recommendationsTable)
      .where(and(base, scope))
      .orderBy(desc(recommendationsTable.updatedAt))
      .limit(1);
    return r ?? null;
  };
  if (sectorId != null) {
    return (
      (await pick(eq(recommendationsTable.sectorId, sectorId))) ??
      (await pick(isNull(recommendationsTable.sectorId)))
    );
  }
  return pick(isNull(recommendationsTable.sectorId));
}

/**
 * Resolve the OpenAI credential to use for a farm + user:
 * farm-level override first, else the user's default active credential.
 */
export async function resolveCredential(
  farm: Farm,
  user: User,
): Promise<Credential | null> {
  const [cfg] = await db
    .select()
    .from(farmApiConfigTable)
    .where(eq(farmApiConfigTable.farmId, farm.id));
  if (cfg?.credentialId) {
    const [cred] = await db
      .select()
      .from(credentialsTable)
      .where(eq(credentialsTable.id, cfg.credentialId));
    // Only honor the farm-level credential if it belongs to the farm owner or to the
    // requesting user; otherwise a stale/foreign credential id could spend another
    // user's OpenAI quota.
    if (cred && cred.isActive && (cred.userId === farm.ownerId || cred.userId === user.id)) {
      return cred;
    }
  }
  const creds = await db
    .select()
    .from(credentialsTable)
    .where(and(eq(credentialsTable.userId, user.id), eq(credentialsTable.isActive, true)));
  return creds.find((c) => c.isDefault) ?? creds[0] ?? null;
}

/** Resolve the user's default active OpenAI credential, independent of any farm. */
export async function resolveUserCredential(user: User): Promise<Credential | null> {
  const creds = await db
    .select()
    .from(credentialsTable)
    .where(and(eq(credentialsTable.userId, user.id), eq(credentialsTable.isActive, true)));
  return creds.find((c) => c.isDefault) ?? creds[0] ?? null;
}

export function farmAlerts(input: {
  farm: Farm;
  soil: Analysis | null;
  leaf: Analysis | null;
  water: Analysis | null;
  active: Recommendation | null;
}): string[] {
  const alerts: string[] = [];
  const now = Date.now();
  const monthsOld = (d: string | null | undefined) =>
    d ? (now - new Date(d).getTime()) / (1000 * 60 * 60 * 24 * 30) : null;

  for (const [a, label, limit] of [
    [input.soil, "suelo", 12],
    [input.leaf, "foliar", 6],
    [input.water, "agua", 12],
  ] as const) {
    if (!a) {
      alerts.push(`Sin analítica de ${label} registrada.`);
    } else {
      const m = monthsOld(a.sampleDate);
      if (m != null && m > limit) {
        alerts.push(`La analítica de ${label} tiene más de ${limit} meses: conviene renovarla.`);
      }
    }
  }
  if (!input.active) alerts.push("No hay ninguna recomendación validada en vigor.");

  const soilNa = input.soil?.parameters.find((p) => p.name.toLowerCase().includes("sodio"));
  if (soilNa && (soilNa.status === "alto" || soilNa.status === "muy_alto")) {
    alerts.push("Sodio del suelo elevado: vigilar SAR del agua y valorar enmiendas cálcicas.");
  }
  return alerts;
}

export async function userName(userId: number | null | undefined): Promise<string | null> {
  if (userId == null) return null;
  const [u] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  return u?.name ?? null;
}
