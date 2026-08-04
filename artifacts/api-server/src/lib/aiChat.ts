import OpenAI from "openai";
import type { Credential } from "@workspace/db";
import { clientFor, modelFor, supportsFunctionCalling, usesResponsesApi } from "./openai";

/**
 * Sesión de chat con herramientas independiente del proveedor.
 *
 * Con OpenAI usa la Responses API (soporta web_search y citas de URL);
 * con proveedores compatibles (Mistral, DeepSeek) usa Chat Completions con
 * function calling. La búsqueda web solo existe en OpenAI: pedirla en otro
 * proveedor lanza WebSearchUnsupportedError y el llamante decide si continúa
 * sin ella o devuelve un error al usuario.
 */

export type FunctionToolDef = {
  type: "function";
  name: string;
  strict?: boolean;
  description: string;
  parameters: Record<string, unknown>;
};

export class WebSearchUnsupportedError extends Error {
  constructor(message = "El proveedor de IA configurado no soporta búsqueda web") {
    super(message);
    this.name = "WebSearchUnsupportedError";
  }
}

export type AiToolCall = { callId: string; name: string; arguments: string };

export type AiTurn = {
  text: string | null;
  toolCalls: AiToolCall[];
  /** URLs citadas por la búsqueda web (solo OpenAI). */
  urls: string[];
  webSearchUsed: boolean;
  inputTokens: number;
  outputTokens: number;
};

export interface AiChatSession {
  send(opts: { tools: FunctionToolDef[]; webSearch: boolean; maxOutputTokens: number }): Promise<AiTurn>;
  /** Registra el resultado de una herramienta antes del siguiente send(). */
  addToolResult(call: AiToolCall, output: string): void;
}

type HistoryMsg = { role: "user" | "assistant"; content: string };

class ResponsesSession implements AiChatSession {
  private input: OpenAI.Responses.ResponseInput;
  constructor(
    private client: OpenAI,
    private model: string,
    private instructions: string,
    history: HistoryMsg[],
  ) {
    this.input = history.map((m) => ({ role: m.role, content: m.content }));
  }

  async send(opts: { tools: FunctionToolDef[]; webSearch: boolean; maxOutputTokens: number }): Promise<AiTurn> {
    const tools: OpenAI.Responses.Tool[] = opts.webSearch
      ? [{ type: "web_search" }, ...(opts.tools as OpenAI.Responses.Tool[])]
      : (opts.tools as OpenAI.Responses.Tool[]);
    let response: OpenAI.Responses.Response;
    try {
      response = await this.client.responses.create({
        model: this.model,
        instructions: this.instructions,
        input: this.input,
        tools,
        max_output_tokens: opts.maxOutputTokens,
      });
    } catch (err) {
      if (opts.webSearch && /web_search/i.test((err as Error).message)) {
        throw new WebSearchUnsupportedError((err as Error).message);
      }
      throw err;
    }
    this.input = this.input.concat(response.output as OpenAI.Responses.ResponseInputItem[]);
    const urls: string[] = [];
    for (const item of response.output) {
      if (item.type === "message") {
        for (const part of item.content) {
          if (part.type === "output_text") {
            for (const ann of part.annotations ?? []) {
              if (ann.type === "url_citation" && ann.url) urls.push(ann.url);
            }
          }
        }
      }
    }
    return {
      text: response.output_text?.trim() || null,
      toolCalls: response.output
        .filter((o): o is OpenAI.Responses.ResponseFunctionToolCall => o.type === "function_call")
        .map((c) => ({ callId: c.call_id, name: c.name, arguments: c.arguments })),
      urls,
      webSearchUsed: response.output.some((o) => o.type === "web_search_call"),
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    };
  }

  addToolResult(call: AiToolCall, output: string): void {
    this.input.push({ type: "function_call_output", call_id: call.callId, output });
  }
}

class CompletionsSession implements AiChatSession {
  private messages: OpenAI.Chat.ChatCompletionMessageParam[];
  constructor(
    private client: OpenAI,
    private model: string,
    instructions: string,
    history: HistoryMsg[],
    /** deepseek-reasoner no soporta function calling: se omiten las tools. */
    private allowTools: boolean,
  ) {
    this.messages = [{ role: "system", content: instructions }, ...history];
  }

  async send(opts: { tools: FunctionToolDef[]; webSearch: boolean; maxOutputTokens: number }): Promise<AiTurn> {
    if (opts.webSearch) throw new WebSearchUnsupportedError();
    const toolDefs = this.allowTools ? opts.tools : [];
    const tools: OpenAI.Chat.ChatCompletionTool[] = toolDefs.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages: this.messages,
      ...(tools.length ? { tools } : {}),
      // Los proveedores compatibles esperan max_tokens, no max_completion_tokens.
      max_tokens: opts.maxOutputTokens,
    });
    const msg = completion.choices[0]?.message;
    if (msg) this.messages.push(msg);
    const toolCalls: AiToolCall[] = (msg?.tool_calls ?? [])
      .filter((c): c is OpenAI.Chat.ChatCompletionMessageFunctionToolCall => c.type === "function")
      .map((c) => ({ callId: c.id, name: c.function.name, arguments: c.function.arguments }));
    return {
      text: msg?.content?.trim() || null,
      toolCalls,
      urls: [],
      webSearchUsed: false,
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
    };
  }

  addToolResult(call: AiToolCall, output: string): void {
    this.messages.push({ role: "tool", tool_call_id: call.callId, content: output });
  }
}

export function createAiChatSession(opts: {
  credential: Credential;
  instructions: string;
  history: HistoryMsg[];
}): AiChatSession {
  const client = clientFor(opts.credential);
  const model = modelFor(opts.credential);
  return usesResponsesApi(opts.credential)
    ? new ResponsesSession(client, model, opts.instructions, opts.history)
    : new CompletionsSession(
        client,
        model,
        opts.instructions,
        opts.history,
        supportsFunctionCalling(opts.credential),
      );
}
