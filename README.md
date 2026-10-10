# Shadow

### Companion and initiative

The Overview and Assistant screens include an original layered SVG anime companion with blinking, breathing, task-state cues, collapse controls and reduced-motion support. Settings can hide it or enable optional short spoken cues. Voice cues use installed local device voices, need a user gesture on each device, and are off by default.

Initiative defaults to **Recommend and continue**. **Ask me** requests strategic choices after exploration; **Decide within my boundaries** makes routine choices from evidence and saved preferences. All three preserve the existing tool approval boundaries. These settings guide the model; output quality still depends on the selected model and successful tool calls.

Use **Build a business** on Overview to start a general-purpose product workflow. Shadow can research opportunities, record assumptions and decisions, create local editable product and launch files, and maintain a roadmap through `plan.update`. Roadmaps persist in SQLite and are supplied to the planner on every turn. Completed stages require evidence text and artifact links must belong to the same task. Stage evidence is a model report, not an independent verification of business success.

Google remains a browser connection. This release does not add email features or automatic Google synchronization. Google copies require an explicit task, available browser controls and existing action approvals.

A local-first personal assistant for research, files, coding, creative production, and business workflows. No fixed niche. React + TypeScript + Node.js 24 + SQLite; a restricted Antigravity planner requests actions from a validated application tool broker.

## Run on Windows

Requirements: **Node.js 24+**, your signed-in `agy` installation, **Chrome or Edge**, and **FFmpeg** for rendering.

```powershell
.\start-shadow.cmd
```

Or run `npm ci`, `npm run build`, then `npm start`. Open the **pairing link printed in the terminal**. Codes expire after ten minutes and work once. The server binds only to `127.0.0.1:4310`.

In Connections, check Antigravity CLI and FFmpeg. Launch the dedicated browser and complete website sign-ins yourself. ChatGPT/Claude websites are optional; Shadow can use the Gemini models already exposed by `agy` without depending on a ChatGPT subscription. The CLI model catalog does not establish remaining quota.

For development, run `npm run dev` and `npm run dev:ui` in separate terminals. Open `http://localhost:5173` and enter the terminal pairing code.

## Private phone access

1. Install Tailscale on the PC and phone and sign in to the same private network.
2. Run `tailscale serve --bg http://127.0.0.1:4310` on the PC (or `scripts/phone-access.ps1`). Complete any Tailscale HTTPS setup yourself.
3. Save the resulting HTTPS `.ts.net` origin, **without a trailing slash**, in Shadow Settings.
4. Generate a new pairing code in Settings. Open the private address on the phone with Tailscale connected and enter the code.

The interface is installable through supported browsers’ **Add to Home Screen** option. It requires a live PC connection; it does not queue offline actions. Keep the PC awake and Shadow running. Do not use Tailscale Funnel: this application is intended for private Serve access. Sessions can be revoked in Settings.

## Windows desktop app

Build the signed-in local application installer with `npm run desktop:build`, then run `release/Shadow-Setup-0.1.0.exe`. The installer creates Desktop and Start menu shortcuts. Closing the window keeps Shadow running in the notification area; use its tray menu to reopen or quit. The installed app starts in the tray with Windows by default and stores its database, artifacts, encrypted keys, and browser profile under `%APPDATA%\Shadow\data`.

The current installer is intended for this PC and is not code signed. Windows may identify an installer copied to another computer as an unknown publisher.

## What works

- Persistent tasks, live event updates, chat, pause/cancel/resume, approval inbox, artifact preview/download, encrypted local API-key storage, editable memory, and versioned skill recipes.
- `agy` streaming JSON and structured decisions, Pro planning/review, Flash routine steps, configurable models, daily call and task-step caps. Optional Gemini/Groq/OpenRouter adapters. OpenRouter is restricted to free model IDs.
- Public web search/read/download, dedicated persistent browser, screenshots, inspected controls, reviewed click/fill/key/upload/download actions.
- Task-local file operations, reviewed registered programs, reviewed JavaScript execution with Node filesystem permissions, and FFmpeg image-based landscape/vertical drafts with narration, music, and SRT captions.
- Exact command arguments, code content, and browser page destinations are tied to approval fingerprints. Interrupted actions with uncertain effects require a fresh review. Identical successful reviewed actions are not repeated automatically within a conversation turn.
- Successful local workflows can be saved as learned recipes. Editing or rolling back creates a draft version that must be tested again. Tests run the exact example arguments; they do not prove every future input or third-party website will work.

The curated skill packs start as drafts. Their example tests verify basic tool execution, **not full production integrations**. They become useful guidance once enabled; Shadow still verifies each real task’s outputs.

## Connections and account setup

**Google Flow and ElevenLabs:** browser workflows require the real signed-in workspace. Connection checks detect visible workspace controls; generation must still succeed and produce downloaded assets before a task can claim completion. No unofficial private service APIs are used.

**OmniStudio and `shorts`:** installation paths and launcher behavior have not been supplied. Connections can discover `shorts` on PATH, but nothing guessed is executed. Register the exact program, argument array, working folder, and expected output paths. For PowerShell scripts register `powershell.exe` with `-NoProfile`, `-File`, and the script path. Every execution needs review. General Windows clicking and native-editor project exports are not included.

**Optional APIs:** add keys through Connections, then choose the model in Settings and confirm the account/model uses your free or existing allowance. Shadow never purchases credits or silently falls back to a paid model. Provider billing is controlled by the provider account; use an unbilled project or provider-enforced spend limit. The app’s call cap is a request-count limit, not a billing guarantee. CLI requests may consume your existing account credits according to its configuration.

## Tool permissions and storage

The CLI runs the dedicated `shadow-planner` agent in plan mode. This CLI still advertises execution tools despite the agent’s restricted tool list, so Shadow installs a mandatory `PreToolUse` gate that denies every native tool except the harmless completion tool. Before generation the adapter verifies the exact gate and configuration files, and asks the CLI to confirm that the gate loaded from the expected workspace. Model-generated decisions are schema-validated; the host broker executes the action. There is no unrestricted CLI fallback. `npm run check:agy` tests a live structured response using your existing model allowance.

Files are confined to `data/projects/<task-id>`. Traversal, alternate data streams, and symlinks/junctions are rejected. Public research fetches validate addresses and pin DNS for each redirect. Browser requests are screened for private-network destinations; Chromium’s networking is not a full network sandbox. All browser interactions that can change a page require review. JavaScript execution uses Node’s filesystem permissions and blocks child processes/native addons by default, but **network access is possible**; review generated code before approving it. Registered commands are trusted local programs and may act outside the task folder according to the exact command you approve.

`data/` contains the SQLite database, task artifacts, browser profile, planner configuration, and encrypted keys. The local encryption key lives in `data/secrets.key`; encryption protects against incidental disclosure of the secrets file, not someone who can read the complete data directory. Keep this directory private and out of version control. Model calls include the current task context, relevant memories, skills, and tool outputs; API keys and browser cookies are not included.

Changing or deleting memories affects future context retrieval; it does not erase copies already recorded in earlier task messages. New executable tools and app changes remain drafts requiring review. A failed or cancelled task retains its files for inspection.

## Validate

```powershell
npm run check
npm test
npm run build
npm run test:browser
npm run check:tools
npm run check:agy
npm run check:agy -- --probe-gate
npm run check:agy -- --workflow
```

Browser tests start an isolated test server on port 4310 (stop the normal server first), use a clearly isolated deterministic test provider, and save desktop/mobile screenshots to `test-results/`. Production has no demo/mock provider setting. Core tests exercise actual SQLite persistence, authentication, permission boundaries, approvals, recovery, commands, memory, skill versioning, and real FFmpeg outputs. Website generation and physical phone/Tailscale access require your connected accounts and devices.

The `check:agy` commands use real model calls from your existing allowance. The gate probe attempts a harmless command in a temporary folder and verifies that execution was denied. The workflow check uses real Pro/Flash planning, public research, artifact creation, and review, then saves `test-results/live-research.md`. Public search can encounter CAPTCHA or rate limits; Shadow reports this and can use browser search or source URLs you supply.

## Integration references

- [Antigravity headless protocol](https://www.antigravity.google/docs/cli/headless/)
- [Custom agents and tool allowlists](https://www.antigravity.google/docs/subagents/)
- [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)
- [FFmpeg filters](https://ffmpeg.org/ffmpeg-filters.html)

Shadow is an extensible task assistant with memory and tested workflows, not AGI or self-training model weights.
