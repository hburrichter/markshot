import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { access, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { buildSync } from "esbuild";

for (const scenario of [
  "codex-default",
  "codex-medium",
  "codex-failure",
  "codex-failure-toast-hide",
  "toast-show-failure",
  "toast-hide-failure",
  "hud-failure",
  "codex-missing",
  "codex-invalid-reasoning",
  "api-success",
  "api-failure",
  "cancel",
  "missing-preferences",
] as const) {
  test(`real pipeline ${scenario}: only the chosen provider runs and complete Markdown reaches the clipboard`, async () => {
    const image = Buffer.from("fake PNG fixture");
    const markdown = "# Example\n\n- [x] Copied";
    const copied: string[] = [];
    const feedback: string[] = [];
    const api = scenario.startsWith("api-") || scenario === "missing-preferences";
    let capturePath = "";
    let requests = 0;
    let codexCalls = 0;
    const modules: Record<string, unknown> = {
      "@raycast/api": {
        getPreferenceValues: () => ({
          ...(api ? { provider: "openai-api" } : {}),
          codexReasoningEffort:
            scenario === "codex-invalid-reasoning" ? "unexpected" : scenario === "codex-medium" ? "medium" : undefined,
          codexPath: scenario === "codex-missing" ? "/not-installed/codex" : "/usr/bin/true",
          openaiApiKey: scenario === "missing-preferences" ? " " : "test-placeholder",
          openaiModel: "test-model",
        }),
        closeMainWindow: async () => {},
        Clipboard: {
          copy: async (text: string) => {
            copied.push(text);
          },
        },
        Toast: { Style: { Animated: "animated" } },
        showToast: async () => {
          if (scenario === "toast-show-failure") throw new Error("notification unavailable");
          return {
            hide: async () => {
              if (scenario === "toast-hide-failure" || scenario === "codex-failure-toast-hide")
                throw new Error("notification unavailable");
            },
          };
        },
        showHUD: async (text: string) => {
          feedback.push(text);
          if (scenario === "hud-failure") throw new Error("notification unavailable");
        },
      },
      "node:child_process": {
        spawn: (command: string, args: string[], options: { env?: NodeJS.ProcessEnv }) => {
          const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
          queueMicrotask(async () => {
            if (command === "/usr/sbin/screencapture") {
              capturePath = args.at(-1)!;
              if (scenario !== "cancel") await writeFile(capturePath, image);
              child.emit("close", scenario === "cancel" ? 1 : 0);
            } else {
              codexCalls += 1;
              assert.equal(command, "/usr/bin/true");
              assert.equal(args[args.indexOf("--model") + 1], "gpt-6-luna");
              assert.ok(args.includes(`model_reasoning_effort="${scenario === "codex-medium" ? "medium" : "low"}"`));
              assert.equal(args[args.indexOf("--image") + 1], capturePath);
              assert.deepEqual(await readFile(capturePath), image);
              assert.ok(args.includes("--ignore-user-config"));
              assert.ok(args.includes("features.shell_tool=false"));
              assert.ok(args.includes("features.view_image=false"));
              assert.ok(!("OPENAI_API_KEY" in options.env!));
              if (scenario.startsWith("codex-failure")) {
                child.stderr.emit("data", Buffer.from("private provider details"));
                child.emit("close", 1);
                return;
              }
              await writeFile(args[args.indexOf("--output-last-message") + 1], markdown);
              child.stdout.emit("data", Buffer.from('{"type":"turn.completed"}\n'));
              child.emit("close", 0);
            }
          });
          return child;
        },
      },
    };
    const nativeRequire = createRequire(resolve("package.json"));
    const module = { exports: {} as { default(): Promise<void> } };
    const bundle = buildSync({
      entryPoints: ["src/capture-markdown.ts"],
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "es2022",
      external: ["@raycast/api"],
      write: false,
    });
    runInNewContext(bundle.outputFiles[0].text, {
      module,
      exports: module.exports,
      Buffer,
      SyntaxError,
      AbortController,
      setTimeout,
      clearTimeout,
      process,
      require: (name: string) => modules[name] ?? nativeRequire(name),
      fetch: async (_url: string, init: RequestInit) => {
        requests += 1;
        await assert.rejects(access(capturePath), { code: "ENOENT" });
        const body = JSON.parse(init.body as string);
        assert.equal(body.input[0].content[1].image_url, `data:image/png;base64,${image.toString("base64")}`);
        if (scenario === "api-failure") return new Response("service unavailable", { status: 503 });
        return new Response(
          JSON.stringify({
            status: "completed",
            output: [
              {
                type: "message",
                role: "assistant",
                status: "completed",
                content: [{ type: "output_text", text: markdown }],
              },
            ],
          }),
        );
      },
    });
    await module.exports.default();
    const successful = [
      "codex-default",
      "codex-medium",
      "api-success",
      "toast-show-failure",
      "toast-hide-failure",
      "hud-failure",
    ].includes(scenario);
    if (successful) {
      assert.deepEqual(copied, [markdown]);
      assert.equal(feedback.at(-1), "Copied Markdown to clipboard");
    } else assert.deepEqual(copied, []);
    assert.equal(requests, scenario === "api-success" || scenario === "api-failure" ? 1 : 0);
    assert.equal(codexCalls, (successful && !api) || scenario.startsWith("codex-failure") ? 1 : 0);
    if (capturePath) await assert.rejects(access(dirname(capturePath)), { code: "ENOENT" });
    if (scenario === "cancel") assert.equal(feedback.at(-1), "Capture canceled");
    if (scenario === "missing-preferences" || scenario === "codex-missing" || scenario === "codex-invalid-reasoning")
      assert.ok(!capturePath);
    if (scenario === "codex-invalid-reasoning")
      assert.equal(feedback.at(-1), "Select Low or Medium reasoning in extension preferences");
    if (scenario === "codex-failure-toast-hide")
      assert.equal(feedback.at(-1), "Codex could not transcribe the screenshot. Check its login and model in Terminal");
    assert.ok(!feedback.join().includes("private provider details"));
  });
}
