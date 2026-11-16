import { Clipboard, closeMainWindow, getPreferenceValues, showHUD, showToast, Toast } from "@raycast/api";
import { readFile, unlink } from "node:fs/promises";
import { withCapturedImage } from "./lib/capture";
import { generateMarkdownWithCodex, resolveCodexPath } from "./lib/codex";
import { normalizeError } from "./lib/errors";
import { generateMarkdownFromImage } from "./lib/openai";

type CommandPreferences = {
  provider?: "codex" | "openai-api";
  codexPath?: string;
  codexModel?: string;
  codexReasoningEffort?: "low" | "medium";
  openaiApiKey?: string;
  openaiModel?: string;
};

// Feedback can fail independently of capture, transcription and the clipboard.
async function tryFeedback<T>(operation: () => Promise<T> | undefined): Promise<T | undefined> {
  try {
    return await operation();
  } catch {
    return undefined;
  }
}

export default async function command() {
  let progress: Toast | undefined;
  try {
    const preferences = getPreferenceValues<CommandPreferences>();
    const apiKey = preferences.openaiApiKey?.trim();
    const model = preferences.openaiModel?.trim();
    const provider = preferences.provider ?? "codex";
    if (provider !== "codex" && provider !== "openai-api") {
      await tryFeedback(() => showHUD("Select Codex CLI or OpenAI API in extension preferences"));
      return;
    }
    if (
      provider === "codex" &&
      preferences.codexReasoningEffort !== undefined &&
      !["low", "medium"].includes(preferences.codexReasoningEffort)
    ) {
      await tryFeedback(() => showHUD("Select Low or Medium reasoning in extension preferences"));
      return;
    }
    if (provider === "openai-api" && (!apiKey || !model)) {
      await tryFeedback(() => showHUD("Set your OpenAI API key and model in extension preferences"));
      return;
    }
    const executable = provider === "codex" ? await resolveCodexPath(preferences.codexPath) : undefined;
    await closeMainWindow();
    const markdown = await withCapturedImage(async (imagePath) => {
      progress = await tryFeedback(() =>
        showToast({ style: Toast.Style.Animated, title: "Converting screenshot to Markdown…" }),
      );
      if (provider === "codex" && executable) {
        return generateMarkdownWithCodex({
          imagePath,
          executable,
          model: preferences.codexModel,
          reasoningEffort: preferences.codexReasoningEffort,
        });
      }
      const image = await readFile(imagePath);
      await unlink(imagePath);
      return generateMarkdownFromImage({
        imageDataUrl: `data:image/png;base64,${image.toString("base64")}`,
        apiKey: apiKey!,
        model: model!,
      });
    });
    if (markdown === null) {
      await tryFeedback(() => showHUD("Capture canceled"));
      return;
    }
    await Clipboard.copy(markdown);
    await tryFeedback(() => progress?.hide());
    progress = undefined;
    await tryFeedback(() => showHUD("Copied Markdown to clipboard"));
  } catch (error) {
    // Provider errors can contain screenshot text or credentials; show only our own messages.
    await tryFeedback(() => progress?.hide());
    await tryFeedback(() => showHUD(normalizeError(error).userMessage));
  }
}
