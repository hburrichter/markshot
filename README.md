# Markshot

Select a screen region and copy its text, tables, checkboxes and layout as structured Markdown. Works in TinyCast and Raycast on macOS.

## Install in TinyCast

In **Settings → Extensions → Install → Install…**, enter `hburrichter/markshot`. Choose **npm** to use this repository's `package-lock.json`, then install. TinyCast downloads and builds the extension locally. GitHub installations do not update automatically; install again to update.

To install a local checkout instead:

1. Install dependencies with `npm ci` using Node >=22.22.2.
2. Run `npm run build`.
3. In TinyCast, open **Settings → Extensions → Install → Add from folder** and select this project's `dist/` folder.
4. Leave **AI Provider** set to **Codex CLI (Existing Login)**, or select **OpenAI API** and configure an API key and vision-capable model.

For Raycast development, run `npm run dev` or use Raycast's Import Extension command on this project. `npm run dev` watches and reloads Raycast development changes. Rebuild and reinstall TinyCast folder installations after changes.

## Providers

**Codex CLI is the default.** Install the native Codex CLI (tested with version 0.169) and run `codex login` in Terminal. Markshot uses that existing login; it never reads or copies authentication files. No OpenAI API key is required. The CLI is a local client for hosted models, not local inference.

The command is found in `~/.local/bin`, Homebrew locations, or absolute directories on `PATH`. **Codex Command Path** can override discovery with an absolute path or a `~/` path. **Codex Model** defaults to `gpt-6-luna`; an empty field also uses that default. **Codex Reasoning Effort** defaults to **Low** for faster transcription, with **Medium** available for more reasoning. Both are configurable in Markshot's extension settings. Personal Codex configuration, including its model selection and MCP servers, is ignored. It does not reuse TinyCast's AI provider settings.

Codex Fast mode is enabled for Markshot's requests. It uses included subscription allowance at 2.5× the Standard rate; purchased credits and Enterprise pay-as-you-go usage are billed at 2×. Availability depends on the account and selected model. See [Codex speed settings](https://learn.chatgpt.com/docs/agent-configuration/speed).

Codex runs in a private temporary directory with a read-only sandbox, coding tools, plugins and hooks disabled, web search disabled, and ephemeral session storage. The extension also stops a response that reports a tool action. It requires a successful, completed turn and a nonempty final response. Error output is classified internally and never shown or logged. Strict configuration validation refuses unsupported CLI versions instead of weakening the restrictions.

**OpenAI API** uses your own key and a vision-capable Responses API model (default `gpt-5-mini`). API use is billed to that account. Only the selected provider is contacted: Codex failures never fall back automatically to the API.

Upgrading changes the provider default to Codex even if an OpenAI key was saved earlier. Select OpenAI API explicitly to keep using that account. Existing preference names and internal `capture-markdown` extension/command identifiers remain stable so display-name changes can preserve preferences and shortcuts within each launcher.

## Use

Run **Capture Region as Markdown**, select a region (or press Space to capture a window), then paste the Markdown when the completion message appears. Press Escape during selection to cancel. A progress toast appears while the selected provider processes the image.

Allow Screen Recording for the launcher in **System Settings → Privacy & Security → Screen Recording**. Restart it if macOS requests it.

## Privacy and failure handling

Screenshot content goes to the selected provider. The Codex path uses your signed-in Codex/ChatGPT account and its data policy; `--ephemeral` prevents local session persistence, not server-side retention. The API path sends `store: false`, disabling response storage for later API retrieval; OpenAI's separate data-retention policies still apply.

The PNG is held in a private temporary directory. With Codex, it stays until the process finishes reading it. With OpenAI API, it is converted to an in-memory data URL and deleted before the request. The directory and any Codex output are removed on success, failure and cancellation. Screenshot content, credentials and raw provider errors are never logged.

Codex has a 120-second deadline, then termination and forced-stop attempts. If the host fails to report process exit, the command stops waiting after five more seconds and cleans up. OpenAI API has a 90-second timeout. TinyCast reports fetch cancellation to the extension while its underlying request can continue in the background; a timeout does not guarantee that processing or billing stops. Only validated output is copied to the clipboard.

## Development

```sh
npm ci
npm run check
```

`check` runs native TypeScript 7 checking, mocked tests, Raycast's manifest/icon checks and ESLint, formatting, and a portable build. Raycast lint needs network access to validate the author and manifest schema. Automated tests use fake screenshots and process/network doubles; they do not use credentials, capture the real screen, change the clipboard or contact a provider.

`typecheck` invokes TypeScript 7 explicitly because the TypeScript 6 compatibility package needed by ESLint also installs a `tsc` binary. This follows Microsoft's [side-by-side guidance](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/). A scoped minimatch override addresses [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249); remove it when typescript-eslint adopts a patched version.

Bun can run development scripts, such as `bun run --bun typecheck` and `bun run --bun build`. Keep `package-lock.json` as the installation source of truth and use npm for dependency changes. Bun is not bundled into the extension and does not change the launcher's runtime.

## Compatibility

TinyCast runs extensions in JavaScriptCore; Raycast supplies its own Node runtime. Markshot uses preferences, clipboard, HUD/toasts, window closing, filesystem access, child processes and fetch. Native capture, permissions and process signals still need verification in each launcher; unit tests do not prove these host behaviors.

Raycast's `AI.ask` does not provide the image-input interface needed here, and TinyCast does not currently expose Raycast's AI APIs to extensions. Markshot invokes Codex directly or calls the OpenAI Responses API. See [TinyCast compatibility](https://tinycast.dev/docs/extensions/compatibility/) and the [Raycast API changelog](https://developers.raycast.com/misc/changelog.md).
