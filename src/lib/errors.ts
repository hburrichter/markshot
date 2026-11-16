import { NormalizedError } from "./types";

export class CaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CaptureError";
  }
}

export class CodexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexError";
  }
}

export class OpenAIRequestError extends Error {
  status?: number;
  code?: string;

  constructor(message: string, options?: { status?: number; code?: string }) {
    super(message);
    this.name = "OpenAIRequestError";
    this.status = options?.status;
    this.code = options?.code;
  }
}

export function normalizeError(error: unknown): NormalizedError {
  if (error instanceof CaptureError || error instanceof CodexError) {
    return {
      kind: "capture",
      userMessage: error.message,
    };
  }

  if (error instanceof OpenAIRequestError) {
    if (error.status === 401 || error.status === 403 || error.code === "invalid_api_key") {
      return {
        kind: "auth",
        userMessage: "OpenAI API key is invalid or missing permissions",
      };
    }

    if (error.status === 404 || error.code === "model_not_found" || error.code === "invalid_model") {
      return {
        kind: "model",
        userMessage: "Model unavailable. Update the model in extension preferences",
      };
    }

    if (error.status === 429) {
      return {
        kind: "network",
        userMessage:
          error.code === "insufficient_quota"
            ? "OpenAI quota exhausted. Check your API billing"
            : "Rate limited by OpenAI. Try again in a moment",
      };
    }

    if (error.status !== undefined && error.status >= 500) {
      return {
        kind: "network",
        userMessage: "OpenAI service is temporarily unavailable. Try again",
      };
    }

    const outputMessages: Record<string, string> = {
      incomplete_output: "OpenAI did not finish the transcription. Try a smaller screen area",
      empty_output: "OpenAI returned no Markdown. Try another screen area",
      refusal: "OpenAI declined to transcribe this screenshot",
    };
    return {
      kind: "unknown",
      userMessage: outputMessages[error.code ?? ""] ?? "Failed to generate Markdown. Check your model and try again",
    };
  }

  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return {
      kind: "network",
      userMessage: "Request timed out while contacting OpenAI",
    };
  }

  if (error instanceof Error && error.message.toLowerCase().includes("fetch")) {
    return {
      kind: "network",
      userMessage: "Network error while contacting OpenAI",
    };
  }

  return {
    kind: "unknown",
    userMessage: "Unexpected error while generating markdown",
  };
}
