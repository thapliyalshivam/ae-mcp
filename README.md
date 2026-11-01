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

## Install

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

## npm scripts

| Command | What it does |
|---|---|
| `npm run setup` | Everything above |
| `npm run deploy` | Re-copy the panel only |
| `npm run build-aegp` | Build the AEGP plugin into `aegp/build/` (`AE_SDK=` points to another SDK `Examples` folder) |
| `npm run install-aegp` | Build and install the AEGP plugin (`-- --skip-build` to only copy) |
| `npm run test-bridge` | Build the bridge against fake AEGP suites (ASan/UBSan) and run the protocol tests, without AE |

## The panel

| Control | Effect |
|---|---|
| Status pill | **Active · N sessions**, **Idle · no sessions**, **Paused**, **Offline** (plugin not loaded) or **Port error** |
| **Pause / Resume** | While paused, the bridge refuses every eval and Claude Code gets a clear "paused" error. It does not fall back to AppleScript. |
| **Reload MCP** | Each connected MCP server re-reads `mcp/tools.js`, `engine/vocabulary.js` and `engine/engine.jsx`, then sends Claude Code `tools/list_changed`. No restart is needed. |
| **Test round-trip** | Runs `app.version` through the bridge and shows the time it took |
| **Reconnect** | Reopens the panel's own bridge connection |
| Sessions / Activity | Each connected `claude` session (pid, project folder, call count) and the last 40 calls with their duration and any errors |

## MCP tools

| Tool | Changes the project? |
|---|---|
| `ae_get_context` | No |
| `ae_preview_ops` | No |
| `ae_apply_ops` | Yes. It runs as one undo group, and ops that fail preview are skipped. |
| `ae_run_script` | Yes. It runs any ExtendScript with no preview, for what the ops can't express. It runs as one undo group, and **Pause** blocks it. |
| `ae_status` | No. Reports whether the bridge is reachable, paused or active, and how many sessions are connected. |

`AE_MCP_TRANSPORT=bridge|osascript|auto` (default `auto`) chooses the transport. `AE_MCP_PORT` changes the port. Set it for both AE and the server.

See `ARCHITECTURE.md` for the protocol and how to add an op.

## ExtendScript constraints

ExtendScript is **ES3**: no `JSON`, `const`/`let`, arrow functions or `forEach`. Wrap edits in `app.beginUndoGroup()` / `app.endUndoGroup()`. Layer indices are 1-based, so address layers by `layer.id`.
