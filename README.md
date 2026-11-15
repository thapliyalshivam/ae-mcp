# AE MCP — After Effects MCP

Lets Claude Code read and edit the active After Effects comp. There are three parts:

| Part | Folder | What it is |
|---|---|---|
| **AE MCP Bridge** | `aegp/` | A native AEGP plugin built with the After Effects SDK. It runs a socket server on `127.0.0.1:7391` inside AE and runs ExtendScript on AE's main thread (`AEGP_ExecuteScript`). |
| **MCP server** | `mcp/` | The Claude Code plugin's server. It connects to the bridge, and falls back to osascript if the bridge isn't there. |
| **AE MCP panel** | `panel/` | A CEP panel (**Window > Extensions > AE MCP**) that shows the bridge status and the connected Claude Code sessions. From it you can pause or resume, reload the MCP tools, and test a round trip. |

The engine, which reads the comp and previews and applies ops, is `engine/engine.jsx`. Its op vocabulary is `engine/vocabulary.js`.

Tested on After Effects 2025 (SDK 25.6) on macOS (arm64 and x86_64).

---

## Install from a release

You need a Mac with After Effects, Claude Code and Node.js. You also need access to the private `thapliyalshivam/ae-mcp-releases` repo, so you need a GitHub account.

1. Download `AE-MCP-<version>.pkg` from the repo's **Releases** page.
2. Open the pkg. macOS blocks it the first time because it's unsigned, so allow it in **System Settings > Privacy & Security**, then open it again.
3. Restart After Effects and open **Window > Extensions > AE MCP**.
4. Run the two commands the panel shows in a terminal, then start `claude`.

The installer turns on `PlayerDebugMode` for the signed-in user, because the panel is unsigned. That lets Adobe apps load any unsigned CEP extension.

To update, install the newer pkg and restart After Effects. If the Claude Code plugin changed, also run:

```bash
claude plugin marketplace update ae-plugins
claude plugin update after-effects@ae-plugins
```

## Install for development

```bash
npm run setup
```

1. Downloads `CSInterface.js` and enables unsigned CEP extensions.
2. Deploys the panel to `~/Library/Application Support/Adobe/CEP/extensions/com.ae.tools`.
3. Builds `aegp/build/AE MCP Bridge.plugin` and copies it into
   `/Applications/Adobe After Effects <year>/Plug-ins/`. That folder is owned by root, so macOS asks for an admin password. If it can't, the script prints a `sudo` command to run instead.

Then restart After Effects and open **Window > Extensions > AE MCP**.

The Claude Code plugin is installed from the local marketplace in this folder:

```
claude plugin marketplace add /path/to/ae-mcp
claude plugin install after-effects@ae-plugins
```

## Build the installer locally

`npm run package` writes `dist/AE-MCP-<version>.pkg`, the one file users need. They don't need access to this repo. It installs the panel system-wide, copies the bridge into every installed After Effects, and enables `PlayerDebugMode` so AE loads the unsigned panel.

The panel then shows the two commands that add the Claude Code plugin from a local marketplace inside the extension folder. They disappear once the plugin is installed.

Set `PKG_SIGN_IDENTITY` to a Developer ID Installer identity to sign the pkg. Signing alone may not clear every macOS warning, because the script doesn't notarize the pkg.

The pkg contains the MCP server and engine as readable JavaScript. Only the bridge is compiled.

If `ZXPSignCmd` 4.1.3 or later is available, with `ZXP_CERT` and `ZXP_CERT_PASSWORD` set, the same run also writes `dist/ae-mcp-<version>.zxp`. In that case the panel's **Install bridge** button handles the bridge.

## Releases

Every push to `main` that touches code runs `.github/workflows/release.yml`. It checks syntax, builds the pkg on a GitHub macOS runner, tags this repo, and publishes the pkg to `thapliyalshivam/ae-mcp-releases` under the same tag. Pushes that only change Markdown, `.cursor/` or `.gitignore` don't release.

Do unfinished work on a branch, because everything that reaches `main` ships.

### Set up releases once

1. Create the private `thapliyalshivam/ae-mcp-releases` repo with a README, because publishing needs at least one commit there.
2. Create a fine-grained GitHub token limited to that repo, with **Contents: Read and write**.
3. In this repo, add the token under **Settings > Secrets and variables > Actions** as `RELEASES_TOKEN`.
4. Push to `main`. The first release is the version in `package.json`.
5. Install that release on a second Mac or a clean user account before adding recipients.

Recipients get access by being added to `ae-mcp-releases`. On a personal GitHub account, collaborators get write access, so use an organization if you want them read-only. Never add them to this repo, because that gives them the source.

### Day to day

- **JavaScript or panel changes:** commit and push.
- **Bridge changes:** the After Effects SDK isn't on GitHub, so CI packages the compiled bridge in `aegp/prebuilt/`. After changing `AEMCPBridge.cpp`, `AEMCPBridge_PiPL.r`, `Info.plist` or `build.sh`, run `npm run update-bridge` and commit the result. The release fails if you forget.
- **Versions:** each release is the next patch after the newest tag. CI stamps it into the pkg without committing it, so `package.json` doesn't change. To start a new minor or major, raise the version in `package.json`, `.claude-plugin/plugin.json` and both version fields in `CSXS/manifest.xml` above that tag.
- **Release notes:** these are the commit subjects since the last tag, and recipients can read them.

## npm scripts

| Command | What it does |
|---|---|
| `npm run setup` | The full development install |
| `npm run deploy` | Re-copy the panel only |
| `npm run build-aegp` | Build the AEGP plugin into `aegp/build/` (`AE_SDK=` points to another SDK `Examples` folder) |
| `npm run install-aegp` | Build and install the AEGP plugin (`-- --skip-build` to only copy) |
| `npm run test-bridge` | Build the bridge against fake AEGP suites (ASan/UBSan) and run the protocol tests, without AE |
| `npm run package` | Build the installer into `dist/` (`-- --skip-build` reuses `aegp/build/`) |
| `npm run update-bridge` | Build and test the bridge, then refresh `aegp/prebuilt/` for CI |

## The panel

| Control | Effect |
|---|---|
| Status pill | **Active · N sessions**, **Idle · no sessions**, **Paused**, **Offline** (plugin not loaded) or **Port error** |
| **Pause / Resume** | While paused, the bridge refuses every eval and Claude Code gets a clear "paused" error. It does not fall back to AppleScript. |
| **Reload MCP** | Each connected MCP server re-reads `mcp/tools.js`, `engine/vocabulary.js` and `engine/engine.jsx`, then sends Claude Code `tools/list_changed`. No restart is needed. |
| **Test round-trip** | Runs `app.version` through the bridge and shows the time it took |
| **Reconnect** | Reopens the panel's own bridge connection |
| Sessions / Activity | Each connected `claude` session (pid, project folder, call count) and the last 40 calls with their duration and any errors |
| **Install bridge** | Shown when the bridge is missing and the installer bundled one. It copies the bridge into the running After Effects, which asks for an admin password. |
| **Design system** | The brand rules Claude Code follows. **Choose .md** picks a design system file (see `Designsystem/`), **Remove** clears it. It shows the name, and warns if the file is missing or lacks a required section. |
| **Connect Claude Code** | Shown when an installed release can't find the Claude Code plugin. It lists the install commands and has a **Copy commands** button. |

## MCP tools

| Tool | Changes the project? |
|---|---|
| `ae_get_context` | No. It opens with the house rules (`mcp/house-rules.md`) and the active design system: each in full the first time in a session and whenever its file changes, a one-line reminder otherwise. |
| `ae_get_design_system` | No. It returns the house rules and the active design system in full. |
| `ae_preview_ops` | No |
| `ae_apply_ops` | Yes. It runs as one undo group, and ops that fail preview are skipped. |
| `ae_run_script` | Yes. It runs any ExtendScript with no preview, for what the ops can't express. It runs as one undo group, and **Pause** blocks it. |
| `ae_status` | No. Reports whether the bridge is reachable, paused or active, and how many sessions are connected. |

`AE_MCP_TRANSPORT=bridge|osascript|auto` (default `auto`) chooses the transport. `AE_MCP_PORT` changes the port. Set it for both AE and the server.

See `ARCHITECTURE.md` for the protocol and how to add an op.

## Design systems

A design system is one Markdown file of brand tokens and rules: colour, motion, typography, layout and hard rules, in that order. `Designsystem/design-shivam.md` is an example, and `.claude/rules/design-system-files.md` says how to write one.

Choose the file in the panel. Its path is saved to `~/Library/Application Support/AE MCP/design-system.json`, and every Claude Code session reads the file from there, so edits to the Markdown apply on the next call without choosing it again. `AE_MCP_DESIGN_SYSTEM=/path/to/file.md` overrides the choice for one session.

## ExtendScript constraints

ExtendScript is **ES3**: no `JSON`, `const`/`let`, arrow functions or `forEach`. Wrap edits in `app.beginUndoGroup()` / `app.endUndoGroup()`. Layer indices are 1-based, so address layers by `layer.id`.

## Debugging

- **Panel HTML/JS:** open `localhost:8800` in Chrome while the panel is open. The port is set in `.debug`.
- **ExtendScript:** attach ExtendScript Toolkit (or the VS Code ExtendScript Debugger) to After Effects and log with `$.writeln()`.

## Author and license

Made by **Shivam Thapliyal** · [shivamthapliyal.com](https://shivamthapliyal.com)

Copyright (C) 2026 Shivam Thapliyal. AE MCP is free software under the [GNU General Public License v3.0 or later](LICENSE). You may share and change it, but anything you distribute that is built on it must stay under the GPL, with its source available and this notice kept.

The bundled fonts, Plus Jakarta Sans and DM Sans, are under the SIL Open Font License 1.1 (`panel/fonts/`). After Effects and its SDK belong to Adobe and are not part of this project.
