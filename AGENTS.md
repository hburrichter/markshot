# Markshot

macOS screenshot-to-Markdown extension for TinyCast and Raycast. Keep the
`capture-markdown` extension and command identifiers stable to preserve preferences
and shortcuts. Product title: Markshot. Command: Capture Region as Markdown.

## Commands & Checks

Use Node >=22.22.2 and npm with the committed `package-lock.json`.

Required checks for code or dependency changes: `npm run check` (types, tests,
Raycast lint, formatting, portable build). Tests use fake screenshots and mocked
provider processes/network responses; never use real screen content or credentials
in automated tests.

Situational checks: when changing capture or launcher APIs, manually verify
capture, Escape cancellation, permissions, process termination and clipboard
output in TinyCast and Raycast. Installing an extension or making a live API request requires the user's
instruction. Do not treat unit tests as proof of native launcher compatibility.

## Review Inputs

Read `README.md` for installation, privacy and runtime constraints. Use
`https://tinycast.dev/docs/extensions/compatibility/` for supported APIs and
`https://developers.raycast.com/misc/changelog.md` for API changes.

Keep provider responses, screenshot content and API keys out of logs and errors.
Do not publish, deploy, create a remote repository or merge without authorization.
