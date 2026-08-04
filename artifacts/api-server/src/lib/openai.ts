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

/** Proveedores de IA compatibles con la API de OpenAI. */
export type AiProvider = "openai" | "mistral" | "deepseek";

export const AI_PROVIDERS: Record<
  AiProvider,
  { label: string; baseURL?: string; defaultModel: string; models: string[]; vision: boolean }
> = {
  openai: {
    label: "OpenAI",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-5", "gpt-5-mini"],
    vision: true,
  },
  mistral: {
    label: "Mistral",
    baseURL: "https://api.mistral.ai/v1",
    defaultModel: "mistral-small-latest",
    models: ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest"],
    vision: true,
  },
  deepseek: {
    label: "DeepSeek",
    baseURL: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
    vision: false,
  },
};

/** Credenciales antiguas o valores desconocidos se tratan como OpenAI. */
export function providerFor(credential: Pick<Credential, "provider">): AiProvider {
  const p = (credential.provider ?? "openai") as AiProvider;
  return AI_PROVIDERS[p] ? p : "openai";
}

/** Modelo efectivo de una credencial (con el modelo por defecto del proveedor). */
export function modelFor(credential: Pick<Credential, "provider" | "selectedModel">): string {
  return credential.selectedModel ?? AI_PROVIDERS[providerFor(credential)].defaultModel;
}

/** Solo OpenAI soporta la Responses API (web_search, input_image...). */
export function usesResponsesApi(credential: Pick<Credential, "provider">): boolean {
  return providerFor(credential) === "openai";
}

/**
 * Parámetro de límite de salida para Chat Completions según proveedor:
 * OpenAI usa max_completion_tokens; Mistral/DeepSeek esperan max_tokens.
 */
export function maxOutputTokensParam(
  credential: Pick<Credential, "provider">,
  n: number,
): { max_completion_tokens: number } | { max_tokens: number } {
  return usesResponsesApi(credential) ? { max_completion_tokens: n } : { max_tokens: n };
}

/**
 * Parámetro de temperatura baja para tareas de cálculo (programas de abonado):
 * reduce la aleatoriedad para que los mismos datos den propuestas parecidas.
 * Los modelos razonadores (gpt-5*, o1/o3, deepseek-reasoner) no admiten
 * temperatura distinta de la por defecto, así que se omite.
 */
export function lowTemperatureParam(
  credential: Pick<Credential, "provider" | "selectedModel">,
): { temperature: number } | Record<string, never> {
  const model = modelFor(credential).toLowerCase();
  if (/^(gpt-5|o1|o3|o4)/.test(model) || model.includes("reasoner")) return {};
  return { temperature: 0.2 };
}

/** Si el proveedor admite análisis de imágenes (visión). */
export function supportsVision(credential: Pick<Credential, "provider">): boolean {
  return AI_PROVIDERS[providerFor(credential)].vision;
}

/**
 * deepseek-reasoner no soporta function calling ni response_format JSON;
 * el resto de modelos ofertados sí.
 */
export function supportsFunctionCalling(
  credential: Pick<Credential, "provider" | "selectedModel">,
): boolean {
  return modelFor(credential) !== "deepseek-reasoner";
}

/** Si el modelo admite response_format de tipo JSON (json_object/json_schema). */
export function supportsJsonResponseFormat(
  credential: Pick<Credential, "provider" | "selectedModel">,
): boolean {
  return modelFor(credential) !== "deepseek-reasoner";
}

/**
 * Parsea JSON tolerando envoltorios habituales de modelos sin JSON mode:
 * vallas ```json ... ``` o texto alrededor del primer objeto {...}.
 */
export function parseJsonLoose<T = unknown>(raw: string): T {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      try {
        return JSON.parse(fenced[1].trim()) as T;
      } catch {
        /* sigue con el siguiente intento */
      }
    }
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as T;
    }
    throw new Error("La respuesta del modelo no contiene un JSON válido");
  }
}

/** €/1M tokens (approximate, for cost tracking only). */
const PRICES: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4.1": { input: 2, output: 8 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-5": { input: 1.25, output: 10 },
  "gpt-5-mini": { input: 0.25, output: 2 },
  "mistral-large-latest": { input: 1.8, output: 5.5 },
  "mistral-medium-latest": { input: 0.4, output: 2 },
  "mistral-small-latest": { input: 0.1, output: 0.3 },
  "deepseek-chat": { input: 0.25, output: 1.05 },
  "deepseek-reasoner": { input: 0.5, output: 2 },
};

export function estimateCostEur(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICES[model] ?? PRICES["gpt-4o-mini"];
  return Math.round(((inputTokens * p.input + outputTokens * p.output) / 1e6) * 1e4) / 1e4;
}

export function clientFor(credential: Credential): OpenAI {
  const { baseURL } = AI_PROVIDERS[providerFor(credential)];
  return new OpenAI({ apiKey: decryptSecret(credential.encryptedKey), ...(baseURL ? { baseURL } : {}) });
}

/**
 * Genera texto (con imágenes opcionales) de forma independiente del
 * proveedor: usa la Responses API con OpenAI y Chat Completions con el resto.
 */
export async function generateText(opts: {
  credential: Credential;
  instructions: string;
  input: string;
  /** Data URLs de imágenes adjuntas (visión). */
  images?: string[];
  maxOutputTokens: number;
}): Promise<{ text: string | null; inputTokens: number; outputTokens: number }> {
  const { credential, instructions, input, images = [], maxOutputTokens } = opts;
  const client = clientFor(credential);
  const model = modelFor(credential);
  if (usesResponsesApi(credential)) {
    const response = await client.responses.create({
      model,
      instructions,
      input: images.length
        ? [
            {
              role: "user",
              content: [
                { type: "input_text", text: input },
                ...images.map((dataUrl) => ({
                  type: "input_image" as const,
                  image_url: dataUrl,
                  detail: "auto" as const,
                })),
              ],
            },
          ]
        : input,
      max_output_tokens: maxOutputTokens,
    });
    return {
      text: response.output_text?.trim() || null,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    };
  }
  // Los proveedores compatibles (Mistral, DeepSeek) esperan max_tokens,
  // no el max_completion_tokens moderno de OpenAI.
  const completion = await client.chat.completions.create({
    model,
    max_tokens: maxOutputTokens,
    messages: [
      { role: "system", content: instructions },
      images.length
        ? {
            role: "user",
            content: [
              { type: "text", text: input },
              ...images.map((dataUrl) => ({ type: "image_url" as const, image_url: { url: dataUrl } })),
            ],
          }
        : { role: "user", content: input },
    ],
  });
  return {
    text: completion.choices[0]?.message?.content?.trim() || null,
    inputTokens: completion.usage?.prompt_tokens ?? 0,
    outputTokens: completion.usage?.completion_tokens ?? 0,
  };
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
- El agua de riego NO es agua pura: DESCUENTA SIEMPRE de las necesidades los nutrientes que ya aporta el agua según su analítica (nitratos, potasio, calcio, magnesio, sulfatos) antes de proponer dosis.
- La CE del agua en origen consume parte de la CE máxima admisible de la finca: la suma de CE que añadan los fertilizantes debe caber en el margen (CE máxima − CE del agua). Si no cabe, reduce dosis o reparte en más riegos y adviértelo.
- Advierte de incompatibilidades de mezcla (nitrato cálcico con sulfatos o fosfatos).
- Sé conservador y consistente: propón dosis dentro de los rangos habituales de fertirrigación de platanera (la concentración total de fertilizantes disueltos no debe superar ~1,5-2 g/L de agua de riego). Ante la duda, la dosis más baja.
- Usa los nombres de producto EXACTAMENTE como aparecen en el catálogo, sin inventar productos ni variantes.
- Si faltan datos, dilo claramente y pide la analítica correspondiente; no inventes valores.
- No des ninguna recomendación como definitiva: recuerda que debe validarla el técnico responsable.

DATOS DE LA FINCA «${farm.name}»:
${contextBlock}`;
}
