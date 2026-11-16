import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { CodexError } from "./errors";
import { buildUserPrompt, SYSTEM_PROMPT } from "./prompt";

const MAX_OUTPUT_BYTES = 1024 * 1024;
const TIMEOUT_MS = 120_000;
const DEFAULT_MODEL = "gpt-6-luna";
const DISABLED_FEATURES = [
  "code_mode",
  "code_mode_host",
  "apps",
  "plugins",
  "remote_plugin",
  "plugin_sharing",
  "shell_tool",
  "unified_exec",
  "browser_use",
  "in_app_browser",
  "computer_use",
  "image_generation",
  "multi_agent",
  "multi_agent_v2",
  "hooks",
  "workspace_dependencies",
  "view_image",
  "skill_search",
  "skill_mcp_dependency_install",
];

export async function resolveCodexPath(configuredPath?: string): Promise<string> {
  const configured = configuredPath?.trim();
  const path = configured?.startsWith("~/") ? join(homedir(), configured.slice(2)) : configured;
  if (path && !isAbsolute(path)) throw new CodexError("Use an absolute or ~/ path for the Codex command");
  const candidates = path
    ? [path]
    : [
        join(homedir(), ".local/bin/codex"),
        "/opt/homebrew/bin/codex",
        "/usr/local/bin/codex",
        ...(process.env.PATH ?? "")
          .split(":")
          .filter(isAbsolute)
          .map((directory) => join(directory, "codex")),
      ];
  for (const candidate of new Set(candidates)) {
    try {
      await access(candidate, constants.X_OK);
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      /* Try the next installation without exposing filesystem errors. */
    }
  }
  throw new CodexError(
    path ? "Codex was not found at the configured path" : "Install Codex CLI and run codex login in Terminal",
  );
}

function failureMessage(stderr: string): string {
  if (
    /unexpected argument|unrecognized (?:argument|option|configuration)|unknown.*(?:config|field|key)|invalid config/i.test(
      stderr,
    )
  ) {
    return "This Codex CLI version is unsupported. Update Markshot or select OpenAI API";
  }
  if (/not (?:logged|signed) in|please.*(?:log ?in|sign ?in)|401|authentication|token.*expired/i.test(stderr)) {
    return "Codex needs you to sign in. Run codex login in Terminal";
  }
  if (/usage limit|quota|rate.?limit/i.test(stderr))
    return "Codex usage limit reached. Try again later or select OpenAI API";
  return "Codex could not transcribe the screenshot. Check its login and model in Terminal";
}

export async function generateMarkdownWithCodex({
  imagePath,
  executable,
  model,
  reasoningEffort = "low",
}: {
  imagePath: string;
  executable: string;
  model?: string;
  reasoningEffort?: "low" | "medium";
}): Promise<string> {
  if (reasoningEffort !== "low" && reasoningEffort !== "medium") {
    throw new CodexError("Select Low or Medium reasoning in extension preferences");
  }
  const directory = dirname(imagePath);
  const outputPath = join(directory, "transcription.md");
  const instructions = `${SYSTEM_PROMPT}\n\nYou only transcribe the attached image. Never use tools, read other files, run commands, or access external resources.`;
  // Process-local overrides isolate transcription from coding tools, hooks, plugins and personal MCP configuration.
  const config = [
    "check_for_update_on_startup=false",
    'web_search="disabled"',
    "project_doc_max_bytes=0",
    "memories.use_memories=false",
    'service_tier="fast"',
    "features.fast_mode=true",
    `model_reasoning_effort="${reasoningEffort}"`,
    `developer_instructions=${JSON.stringify(instructions)}`,
    ...DISABLED_FEATURES.map((feature) => `features.${feature}=false`),
  ];
  const args = [
    "--no-daemon",
    "exec",
    "--ignore-user-config",
    "--strict-config",
    "--ephemeral",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "-c",
    'approval_policy="never"',
    "--color",
    "never",
    "--json",
    ...config.flatMap((value) => ["-c", value]),
    "--model",
    model?.trim() || DEFAULT_MODEL,
    "--image",
    imagePath,
    "--output-last-message",
    outputPath,
    "--",
    buildUserPrompt(),
  ];
  const env: NodeJS.ProcessEnv = {
    HOME: homedir(),
    PATH: [dirname(executable), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(
      ":",
    ),
    LANG: process.env.LANG || "en_US.UTF-8",
    ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
    ...(process.env.CODEX_HOME ? { CODEX_HOME: process.env.CODEX_HOME } : {}),
  };

  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { cwd: directory, env, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let pending = "";
    let receivedBytes = 0;
    let completed = false;
    let closed = false;
    let failed = false;
    let failure: string | undefined;
    let forceKill: ReturnType<typeof setTimeout> | undefined;
    let abandon: ReturnType<typeof setTimeout> | undefined;
    const stop = (message: string) => {
      if (failure) return;
      failure = message;
      if (closed) return;
      forceKill = setTimeout(() => {
        abandon = setTimeout(() => {
          closed = true;
          finish();
          reject(new CodexError(message));
        }, 3_000);
        try {
          child.kill("SIGKILL");
        } catch {
          /* The bounded fallback still releases the caller. */
        }
      }, 2_000);
      try {
        child.kill("SIGTERM");
      } catch {
        /* Continue to forced termination and the bounded fallback. */
      }
    };
    const timeout = setTimeout(() => stop("Codex timed out while transcribing. Try a smaller screen area"), TIMEOUT_MS);
    const finish = () => {
      clearTimeout(timeout);
      clearTimeout(forceKill);
      clearTimeout(abandon);
    };
    const readEvent = (line: string) => {
      if (!line.trim() || failure) return;
      try {
        const event = JSON.parse(line) as { type?: string; item?: { type?: string } };
        if (event.type === "turn.completed") completed = true;
        if (event.type === "turn.failed") failed = true;
        // Codex also emits non-fatal configuration warnings as error items, not tool actions.
        const notification = event.type === "item.completed" && event.item?.type === "error";
        if (event.item?.type && !["agent_message", "reasoning"].includes(event.item.type) && !notification) {
          const tool = [
            "command_execution",
            "mcp_tool_call",
            "collab_tool_call",
            "file_change",
            "web_search",
            "todo_list",
          ].includes(event.item.type);
          stop(
            tool
              ? "Codex attempted a tool action. Transcription stopped"
              : "Codex returned an unsupported event. Transcription stopped",
          );
        }
      } catch {
        stop("Codex returned an unreadable result. Update the CLI and try again");
      }
    };
    child.stdout?.on("data", (chunk: Buffer) => {
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_OUTPUT_BYTES * 4) {
        stop("Codex output was too large. Try a smaller screen area");
        return;
      }
      pending += chunk.toString();
      let newline: number;
      while ((newline = pending.indexOf("\n")) !== -1) {
        readEvent(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-8192);
    });
    child.once("error", () => {
      closed = true;
      finish();
      reject(new CodexError("Unable to start Codex. Check the command path in preferences"));
    });
    child.once("close", (code) => {
      closed = true;
      readEvent(pending);
      finish();
      if (failure) reject(new CodexError(failure));
      else if (code !== 0 || !completed || failed) reject(new CodexError(failureMessage(stderr)));
      else resolve();
    });
  });

  try {
    const size = (await stat(outputPath)).size;
    if (size > MAX_OUTPUT_BYTES) throw new CodexError("Codex output was too large. Try a smaller screen area");
    const markdown = (await readFile(outputPath, "utf8")).trim();
    if (!markdown) throw new CodexError("Codex returned no Markdown. Try another screen area");
    return markdown;
  } catch (error) {
    if (error instanceof CodexError) throw error;
    throw new CodexError("Codex returned no Markdown. Try another screen area");
  }
}
