import OpenAI from "openai";
import { and, eq, gte } from "drizzle-orm";
import {
  db,
  aiUsageTable,
  type Credential,
  type Farm,
  type User,
} from "@workspace/db";
import { decryptSecret } from "./crypto";

/** €/1M tokens (approximate, for cost tracking only). */
const PRICES: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4.1": { input: 2, output: 8 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-5": { input: 1.25, output: 10 },
  "gpt-5-mini": { input: 0.25, output: 2 },
};

export function estimateCostEur(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICES[model] ?? PRICES["gpt-4o-mini"];
  return Math.round(((inputTokens * p.input + outputTokens * p.output) / 1e6) * 1e4) / 1e4;
}

export function clientFor(credential: Credential): OpenAI {
  return new OpenAI({ apiKey: decryptSecret(credential.encryptedKey) });
}

export async function monthlySpendEur(userId: number): Promise<number> {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const rows = await db
    .select({ cost: aiUsageTable.estimatedCostEur })
    .from(aiUsageTable)
    .where(and(eq(aiUsageTable.userId, userId), gte(aiUsageTable.createdAt, start)));
  return rows.reduce((s, r) => s + (r.cost ?? 0), 0);
}

export async function checkMonthlyLimit(user: User, credential: Credential): Promise<string | null> {
  const limit = credential.monthlyLimitEur ?? user.aiMonthlyLimitEur;
  if (limit == null) return null;
  const spent = await monthlySpendEur(user.id);
  if (spent >= limit) {
    return `Se ha alcanzado el límite mensual de gasto en IA (${limit.toFixed(2)} €). Ajusta el límite en Ajustes para seguir usando el asistente.`;
  }
  return null;
}

export async function recordUsage(entry: {
  userId: number;
  farmId?: number | null;
  model: string;
  operation: string;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostEur?: number;
  durationMs?: number;
  result: string;
}): Promise<void> {
  await db.insert(aiUsageTable).values(entry);
}

export function agronomistSystemPrompt(farm: Farm, contextBlock: string): string {
  return `Eres el Técnico Agrícola Virtual de AgroNutri AI, un ingeniero agrónomo experto en fertirrigación de platanera en Canarias.

Reglas:
- Responde SIEMPRE en español, con tono profesional y práctico de técnico de campo.
- Fundamenta tus respuestas en los datos reales de la finca que se incluyen a continuación (analíticas de suelo, foliar y agua, programa de abonado vigente). Cita de dónde sale cada dato.
- Cuando propongas dosis, usa kg o L por semana para el total de la finca y indica también g/planta cuando ayude.
- Ten en cuenta los antagonismos K/Ca/Mg y Na/Ca típicos de platanera, la alcalinidad del agua y la CE máxima admisible.
- Advierte de incompatibilidades de mezcla (nitrato cálcico con sulfatos o fosfatos).
- Si faltan datos, dilo claramente y pide la analítica correspondiente; no inventes valores.
- No des ninguna recomendación como definitiva: recuerda que debe validarla el técnico responsable.

DATOS DE LA FINCA «${farm.name}»:
${contextBlock}`;
}
