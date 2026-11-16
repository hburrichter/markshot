import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { generateMarkdownFromImage } from "../src/lib/openai";
import { normalizeError, OpenAIRequestError } from "../src/lib/errors";

const params = { imageDataUrl: "data:image/png;base64,ZmFrZQ==", apiKey: "test-placeholder", model: "test-model" };
const message = (text: string) => ({
  type: "message",
  role: "assistant",
  status: "completed",
  content: [{ type: "output_text", text }],
});

function mockResponse(t: TestContext, body: unknown, status = 200) {
  return t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(body), { status }));
}

test("preserves Markdown and reads only completed assistant output", async (t) => {
  const markdown = "# Heading\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n- [x] Done\n\n```ts\nconst x = 1;\n```";
  const fetchMock = mockResponse(t, {
    status: "completed",
    output: [null, { type: "reasoning", content: [{ text: "private reasoning" }] }, message(markdown)],
  });
  assert.equal(await generateMarkdownFromImage(params), markdown);
  const request = fetchMock.mock.calls[0].arguments as unknown as [string, RequestInit];
  assert.equal(request[0], "https://api.openai.com/v1/responses");
  const payload = JSON.parse(request[1].body as string);
  assert.equal(payload.store, false);
  assert.equal(payload.input[0].content[1].detail, "high");
  assert.equal(payload.input[0].content[1].image_url, params.imageDataUrl);
});

for (const [name, body] of [
  ["partial response", { status: "incomplete", output: [message("truncated")] }],
  ["partial message", { status: "completed", output: [{ ...message("truncated"), status: "incomplete" }] }],
  [
    "refusal",
    { status: "completed", output: [{ ...message(""), content: [{ type: "refusal", refusal: "sensitive content" }] }] },
  ],
  ["empty output", { status: "completed", output: [] }],
  ["malformed output", { status: "completed", output: [null, 2, { type: "message", content: "bad" }] }],
  ["failed response", { status: "failed", error: { code: "server_error" }, output: [message("partial")] }],
  ["invalid body", null],
] as const) {
  test(`rejects ${name} instead of copying misleading Markdown`, async (t) => {
    mockResponse(t, body);
    await assert.rejects(generateMarkdownFromImage(params), OpenAIRequestError);
  });
}

for (const [status, code, expected] of [
  [401, "invalid_api_key", "API key"],
  [404, "model_not_found", "Model unavailable"],
  [429, "insufficient_quota", "quota exhausted"],
  [429, "rate_limit_exceeded", "Rate limited"],
  [503, "server_error", "temporarily unavailable"],
  [400, "invalid_request", "Failed to generate"],
] as const) {
  test(`maps HTTP ${status}/${code} without exposing provider text`, async (t) => {
    mockResponse(t, { error: { code, message: "sensitive-provider-message" } }, status);
    await assert.rejects(generateMarkdownFromImage(params), (error: unknown) => {
      assert.ok(error instanceof OpenAIRequestError);
      const text = normalizeError(error).userMessage;
      assert.ok(text.includes(expected));
      assert.ok(!JSON.stringify(error).includes("sensitive-provider-message"));
      return true;
    });
  });
}

test("handles non-JSON service errors by HTTP status", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("<html>Bad gateway</html>", { status: 502 }));
  await assert.rejects(generateMarkdownFromImage(params), (error: unknown) => normalizeError(error).kind === "network");
});

test("handles network failures with a fixed message", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("fetch failed: sensitive details");
  });
  await assert.rejects(generateMarkdownFromImage(params), (error: unknown) => {
    assert.equal(normalizeError(error).userMessage, "Network error while contacting OpenAI");
    return true;
  });
});

test("aborts a stalled request after 90 seconds and reports a timeout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  });
  const pending = assert.rejects(generateMarkdownFromImage(params), (error: unknown) => {
    assert.equal(normalizeError(error).userMessage, "Request timed out while contacting OpenAI");
    return true;
  });
  t.mock.timers.tick(90_000);
  await pending;
});

test("preserves a timeout while reading an HTTP 200 response body", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let readingBody = false;
  t.mock.method(globalThis, "fetch", async (_input: unknown, init?: RequestInit) => {
    return new Response(
      new ReadableStream({
        start(controller) {
          readingBody = true;
          init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
        },
      }),
    );
  });
  const pending = assert.rejects(generateMarkdownFromImage(params), (error: unknown) => {
    assert.equal(normalizeError(error).userMessage, "Request timed out while contacting OpenAI");
    return true;
  });
  await Promise.resolve();
  assert.ok(readingBody);
  t.mock.timers.tick(90_000);
  await pending;
});
