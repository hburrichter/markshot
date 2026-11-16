import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { loadModule } from "./load-module";

type CodexModule = {
  resolveCodexPath(path?: string): Promise<string>;
  generateMarkdownWithCodex(params: {
    imagePath: string;
    executable: string;
    model?: string;
    reasoningEffort?: "low" | "medium";
  }): Promise<string>;
};
const params = { imagePath: "/private/test/capture.png", executable: "/test/codex" };

function harness(scenario: string) {
  const signals: string[] = [];
  const child = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: (signal: string) => {
      signals.push(signal);
      if (scenario === "timeout-kill-throws") throw new Error("unsupported host signal");
      if (scenario !== "timeout-no-close" && (scenario !== "timeout-force" || signal === "SIGKILL"))
        queueMicrotask(() => child.emit("close", null));
      return true;
    },
  });
  const codex = loadModule<CodexModule>(
    "src/lib/codex.ts",
    {
      "node:fs/promises": {
        stat: async () => {
          if (scenario === "missing-output") throw new Error("missing");
          return { size: scenario === "oversize-file" ? 1024 * 1024 + 1 : 20 };
        },
        readFile: async () => (scenario === "empty" ? "  \n" : "# Transcribed"),
      },
      "node:child_process": {
        spawn: (executable: string, args: string[], options: { env: NodeJS.ProcessEnv; cwd: string }) => {
          assert.equal(executable, params.executable);
          assert.equal(options.cwd, "/private/test");
          assert.ok(
            args.includes("--ephemeral") && args.includes("--ignore-user-config") && args.includes("--strict-config"),
          );
          assert.equal(args[args.indexOf("--sandbox") + 1], "read-only");
          assert.equal(args[args.indexOf("--image") + 1], params.imagePath);
          assert.equal(args[args.indexOf("--output-last-message") + 1], "/private/test/transcription.md");
          assert.equal(
            args[args.indexOf("--model") + 1],
            scenario.startsWith("defaults") ? "gpt-6-luna" : "test-model",
          );
          assert.ok(args.includes(`model_reasoning_effort="${scenario === "medium" ? "medium" : "low"}"`));
          assert.ok(args.includes('service_tier="fast"') && args.includes("features.fast_mode=true"));
          assert.ok(args.indexOf("--") > args.indexOf("--image"));
          for (const key of [
            "code_mode",
            "code_mode_host",
            "shell_tool",
            "unified_exec",
            "hooks",
            "plugins",
            "apps",
            "view_image",
            "multi_agent",
            "multi_agent_v2",
          ])
            assert.ok(args.includes(`features.${key}=false`));
          assert.deepEqual(Object.keys(options.env).sort(), ["CODEX_HOME", "HOME", "LANG", "PATH"]);
          assert.equal(options.env.CODEX_HOME, "/test/profile");
          queueMicrotask(() => {
            if (scenario.startsWith("timeout")) return;
            if (scenario === "spawn") {
              child.emit("error", new Error("sensitive spawn detail"));
              return;
            }
            const errors: Record<string, string> = {
              auth: "authentication required: private-data",
              unsupported: "unexpected argument --ignore-user-config",
              quota: "usage limit reached private-data",
              exit: "private-data",
            };
            if (errors[scenario]) {
              child.stderr.emit("data", Buffer.from(errors[scenario]));
              child.emit("close", 1);
              return;
            }
            if (scenario.startsWith("warning")) {
              const phase =
                scenario === "warning-started"
                  ? "item.started"
                  : scenario === "warning-updated"
                    ? "item.updated"
                    : "item.completed";
              child.stdout.emit(
                "data",
                Buffer.from(
                  JSON.stringify({ type: "thread.started" }) +
                    "\n" +
                    JSON.stringify({ type: phase, item: { type: "error", message: "private provider warning" } }) +
                    "\n" +
                    JSON.stringify({ type: "turn.started" }) +
                    "\n",
                ),
              );
            }
            if (scenario === "tool" || scenario.startsWith("tool:") || scenario === "warning-tool") {
              const type = scenario.startsWith("tool:") ? scenario.slice(5) : "command_execution";
              child.stdout.emit("data", Buffer.from(JSON.stringify({ type: "item.started", item: { type } }) + "\n"));
              return;
            }
            if (scenario === "warning-failed") {
              child.stdout.emit(
                "data",
                Buffer.from('{"type":"turn.failed","error":{"message":"private provider error"}}\n'),
              );
              child.emit("close", 1);
              return;
            }
            if (scenario === "non-json") {
              child.stdout.emit("data", Buffer.from("unexpected provider output\n"));
              return;
            }
            if (scenario === "oversize-events") {
              child.stdout.emit("data", Buffer.alloc(4 * 1024 * 1024 + 1));
              return;
            }
            if (scenario === "recovered")
              child.stdout.emit("data", Buffer.from('{"type":"error","message":"temporary retry"}\n'));
            if (scenario !== "partial" && scenario !== "warning-partial") {
              // Events may be split between chunks and end without a newline.
              child.stdout.emit("data", Buffer.from('{"type":"turn.com'));
              child.stdout.emit("data", Buffer.from('pleted"}'));
            }
            child.emit("close", scenario === "signal" ? null : scenario === "warning-exit" ? 1 : 0);
          });
          return child;
        },
      },
    },
    {
      process: {
        env: {
          CODEX_HOME: "/test/profile",
          OPENAI_API_KEY: "fake-do-not-inherit",
          OPENAI_BASE_URL: "https://not-used.invalid",
        },
      },
    },
  );
  return { codex, signals };
}

for (const [scenario, message] of [
  ["success", ""],
  ["defaults", ""],
  ["defaults-blank", ""],
  ["medium", ""],
  ["recovered", ""],
  ["warning", ""],
  ["warning-started", "unsupported event"],
  ["warning-updated", "unsupported event"],
  ["warning-failed", "could not transcribe"],
  ["warning-exit", "could not transcribe"],
  ["warning-partial", "could not transcribe"],
  ["warning-tool", "tool action"],
  ["tool:mcp_tool_call", "tool action"],
  ["tool:file_change", "tool action"],
  ["tool:web_search", "tool action"],
  ["tool:collab_tool_call", "tool action"],
  ["tool:todo_list", "tool action"],
  ["tool:future_item", "unsupported event"],
  ["empty", "no Markdown"],
  ["missing-output", "no Markdown"],
  ["oversize-file", "too large"],
  ["auth", "sign in"],
  ["unsupported", "unsupported"],
  ["quota", "usage limit"],
  ["exit", "could not transcribe"],
  ["partial", "could not transcribe"],
  ["signal", "could not transcribe"],
  ["spawn", "Unable to start"],
  ["tool", "tool action"],
  ["non-json", "unreadable"],
  ["oversize-events", "too large"],
] as const) {
  test(`Codex ${scenario}: validates output and never exposes raw provider errors`, async () => {
    const { codex } = harness(scenario);
    const result = codex.generateMarkdownWithCodex({
      ...params,
      model: scenario === "defaults" ? undefined : scenario === "defaults-blank" ? " " : " test-model ",
      reasoningEffort: scenario === "medium" ? "medium" : undefined,
    });
    if (
      scenario === "success" ||
      scenario === "recovered" ||
      scenario === "warning" ||
      scenario.startsWith("defaults") ||
      scenario === "medium"
    )
      assert.equal(await result, "# Transcribed");
    else
      await assert.rejects(result, (error: unknown) => {
        const text = (error as Error).message;
        assert.ok(text.includes(message), text);
        assert.ok(
          !text.includes("private-data") &&
            !text.includes("sensitive spawn detail") &&
            !text.includes("private provider"),
        );
        return true;
      });
  });
}

for (const scenario of ["timeout", "timeout-force", "timeout-no-close", "timeout-kill-throws"]) {
  test(`Codex ${scenario}: deadline stops the child and bounds a missing close event`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const { codex, signals } = harness(scenario);
    const pending = assert.rejects(codex.generateMarkdownWithCodex({ ...params, model: "test-model" }), /timed out/);
    t.mock.timers.tick(120_000);
    if (scenario !== "timeout") t.mock.timers.tick(2_000);
    if (scenario === "timeout-no-close" || scenario === "timeout-kill-throws") t.mock.timers.tick(3_000);
    await pending;
    assert.deepEqual(signals, scenario === "timeout" ? ["SIGTERM"] : ["SIGTERM", "SIGKILL"]);
  });
}

test("Codex locator ignores relative PATH entries and never falls back from an explicit missing path", async () => {
  const attempted: string[] = [];
  const codex = loadModule<CodexModule>(
    "src/lib/codex.ts",
    {
      "node:fs/promises": {
        access: async (path: string) => {
          attempted.push(path);
          if (path !== "/test/bin/codex") throw new Error("missing");
        },
        stat: async () => ({ isFile: () => true }),
      },
    },
    { process: { env: { PATH: ".:/test/bin::relative" } } },
  );
  assert.equal(await codex.resolveCodexPath(), "/test/bin/codex");
  assert.ok(attempted.every((path) => path.startsWith("/")));
  attempted.length = 0;
  await assert.rejects(codex.resolveCodexPath("/missing/codex"), /configured path/);
  assert.deepEqual(attempted, ["/missing/codex"]);
  await assert.rejects(codex.resolveCodexPath("relative/codex"), /absolute/);
});

test("rejects an invalid reasoning preference before launching Codex", async () => {
  let spawned = false;
  const codex = loadModule<CodexModule>("src/lib/codex.ts", {
    "node:child_process": {
      spawn: () => {
        spawned = true;
        throw new Error("must not launch");
      },
    },
  });
  await assert.rejects(
    codex.generateMarkdownWithCodex({ ...params, reasoningEffort: "unexpected" as "low" }),
    /Low or Medium/,
  );
  assert.equal(spawned, false);
});
