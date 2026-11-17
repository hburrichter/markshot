# Changelog

## [Unreleased]

- Give Markshot its own muted-blue capture-frame icon with an 85% Markdown mark.
- Remove the obsolete OCR-correction instruction, consolidate transcription guidelines in the main prompt, and shorten the user message while preserving table/header guidance.
- Keep notification failures from interrupting transcription, clipboard copying or error feedback.
- Invoke TypeScript 7 explicitly so the compatibility compiler cannot shadow the native checker.
- Enable Codex Fast mode for transcription and show its subscription usage multiplier in model settings.
- Default Codex to gpt-6-luna with Low reasoning and expose Low/Medium reasoning choices in extension settings.

- Handle Codex warning notifications without mistaking them for tool actions; still reject failed turns and tool use.
- Rename the extension to Markshot and the command to Capture Region as Markdown; retain internal identifiers.
- Update Raycast API and developer dependencies, migrate to ESLint flat config, and use TypeScript 7's native checker alongside the TypeScript 6 compiler API.
- Build a portable `dist/` folder for TinyCast's Add from folder installer.
- Make the signed-in Codex CLI the default provider, with OpenAI API as an explicit alternative and no automatic fallback.
- Keep screenshots in a private directory only while needed by the selected provider, and clean up on success, failure and cancellation.
- Restrict Codex to transcription with coding tools, plugins, hooks and web search disabled; validate completed output and enforce a deadline.
- Add progress feedback, reject partial/refused/malformed output, and distinguish quota, model and service errors without logging provider content.
- Disable API response storage via `store: false`, request high-detail image reading, and instruct the model to mark unreadable text and treat screenshot instructions as content.
- Add mocked capture, API and command regression tests and a documented check command.

## Initial implementation

- Capture a screenshot region, transcribe it through OpenAI vision and copy structured Markdown.
