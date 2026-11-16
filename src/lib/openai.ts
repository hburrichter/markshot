import { buildUserPrompt, SYSTEM_PROMPT } from "./prompt";
import { OpenAIRequestError } from "./errors";
import { GenerateMarkdownParams } from "./types";

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function errorCode(value: unknown): string | undefined {
  const code = asRecord(value).code;
  return typeof code === "string" ? code : undefined;
}

function extractOutputText(body: Record<string, unknown>): string {
  const textParts: string[] = [];
  if (Array.isArray(body.output)) {
    for (const value of body.output) {
      const item = asRecord(value);
      if (item.type !== "message" || item.role !== "assistant" || !Array.isArray(item.content)) continue;
      if (item.status !== "completed") {
        throw new OpenAIRequestError("OpenAI returned an incomplete message", { code: "incomplete_output" });
      }
      for (const value of item.content) {
        const part = asRecord(value);
        if (part.type === "refusal") {
          throw new OpenAIRequestError("OpenAI declined the screenshot", { code: "refusal" });
        }
        if (part.type === "output_text" && typeof part.text === "string") textParts.push(part.text);
      }
    }
  }
  return textParts.join("\n\n").trim();
}

export async function generateMarkdownFromImage({
  imageDataUrl,
  apiKey,
  model,
}: GenerateMarkdownParams): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        store: false,
        instructions: SYSTEM_PROMPT,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: buildUserPrompt() },
              { type: "input_image", image_url: imageDataUrl, detail: "high" },
            ],
          },
        ],
      }),
    });
    let body: Record<string, unknown> = {};
    try {
      body = asRecord(await response.json());
    } catch (error) {
      // Keep HTTP status handling even when a proxy returns HTML instead of JSON.
      if (!(error instanceof SyntaxError)) throw error;
    }
    if (!response.ok) {
      throw new OpenAIRequestError("OpenAI request failed", { status: response.status, code: errorCode(body.error) });
    }
    if (body.error) throw new OpenAIRequestError("OpenAI response failed", { code: errorCode(body.error) });
    if (body.status !== "completed") {
      throw new OpenAIRequestError("OpenAI returned an incomplete response", { code: "incomplete_output" });
    }
    const markdown = extractOutputText(body);
    if (!markdown) throw new OpenAIRequestError("OpenAI returned no Markdown", { code: "empty_output" });
    return markdown;
  } finally {
    clearTimeout(timeout);
  }
}
