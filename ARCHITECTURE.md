# After Effects MCP — architecture

Claude Code edits the active After Effects comp through an MCP server. The server sends ExtendScript to a native plugin inside AE, and the plugin runs it on AE's main thread.

```
 claude (session A) ─stdio─▶ mcp/server.js ─┐
 claude (session B) ─stdio─▶ mcp/server.js ─┤  tcp 127.0.0.1:7391, one JSON object per line
 AE MCP panel (CEP)  ───────────────────────┤
                                            ▼
                ┌──────────── After Effects ─────────────────────────┐
                │ AE MCP Bridge (AEGP plugin)                        │
                │   network thread: poll(), parse, queue             │
                │        │ AEGP_CauseIdleRoutinesToBeCalled          │
                │        ▼                                           │
                │   IdleHook (main thread) ─▶ AEGP_ExecuteScript     │
                │        engine.jsx + "claudeApplyOps([...])"        │
                └────────────────────────────────────────────────────┘
```

If the bridge isn't reachable, `mcp/tools.js` falls back to AppleScript: `DoScript` runs `$.evalFile` on a temp file, and the reply comes back through a second temp file. That route needs macOS Automation permission and AE's **Allow Scripts to Write Files and Access Network** setting. The bridge needs neither. `AE_MCP_TRANSPORT` picks the route: `auto` (the default) uses the bridge and falls back, `bridge` never falls back, and `osascript` always uses AppleScript.

## Layout

```
ae-mcp/
├── .claude-plugin/
│   ├── plugin.json              Claude Code plugin: runs node mcp/server.js
│   └── marketplace.json         local marketplace, source "./"
├── mcp/
│   ├── server.js                MCP protocol (stdio JSON-RPC), bridge connection, reload
│   └── tools.js                 tool definitions and transports (hot-reloadable)
├── engine/
│   ├── engine.jsx               ExtendScript: context, preview, apply, response helpers
│   └── vocabulary.js            OPS_SCHEMA and OP_CATALOG for the op tools
├── aegp/                        AE MCP Bridge, a native plugin built with the After Effects SDK
│   ├── AEMCPBridge.cpp          socket server and idle-hook executor
│   ├── AEMCPBridge_PiPL.r       PiPL: kind AEGP, entry EntryPointFunc
│   ├── Info.plist
│   ├── build.sh                 clang++ (universal) + Rez → build/AE MCP Bridge.plugin
│   └── test/                    run.sh, harness.cpp (fake AEGP suites), bridge.test.js
├── panel/                       CEP panel "AE MCP": index.html, app.js, panel.jsx
├── shared/
│   ├── bridge-client.js         bridge client used by both server.js and the panel
│   └── CSInterface.js           downloaded by setup, not committed
├── CSXS/manifest.xml            the one extension, com.ae.tools.mcp
├── .debug                       CEP remote-debug port (8800) for the panel
└── scripts/                     setup, deploy, install-aegp, download-cep, enable-debug, package
```

`ae-mcp/` is the repo root. `.claude-plugin/marketplace.json` is the local marketplace that installs this plugin as `after-effects@ae-plugins`. The AE SDK sits in `AfterEffectsSDK_25.6_61_mac/`, which is git-ignored. `build.sh` and `test/run.sh` read `Headers/`, `Headers/SP`, `Util/` and `Resources/` from it, and compile `Util/AEGP_SuiteHandler.cpp` and `Util/MissingSuiteError.cpp` in. `AE_SDK` points them to a different SDK `Examples` folder.

## MCP tools

| Tool | What it does | Changes the project? |
|---|---|---|
| `ae_get_context` | Outlines the selected layers, or the whole comp (up to 80 layers) when nothing is selected. Each layer line ends with its id (`#L12`). | No |
| `ae_preview_ops` | Checks a list of ops against the live comp and returns one before → after row per op. It marks refused ops and tags structural ones. | No |
| `ae_apply_ops` | Re-runs preview, then applies only the ops that passed, in one undo group. | Yes |
| `ae_run_script` | Runs any ExtendScript function body in one undo group and returns its `return` value as a string. It has no preview. | Yes |
| `ae_status` | Reports the transport mode and whether the bridge is reachable, paused or active, plus its counters and connected clients. | No |

Every call to AE goes through one promise queue in `tools.js`, because AE runs one script at a time. An eval times out after 300 s, and any other bridge request after 30 s.

### The op tools

Every eval sends the whole of `engine.jsx` followed by one call expression: `claudeGetContext()`, `claudePreviewOps([...])` or `claudeApplyOps([...])`. ExtendScript has no `JSON.parse`, so the ops arrive as an ES3 array literal written into the script. Replies are JSON strings built by hand with `respond` / `respondWithData` / `escStr`. Before sending, the server rewrites every non-ASCII character as `\uXXXX`, because AE mangles non-ASCII on the way in.

Layers are addressed by `layer.id` (`L<id>`, AE 22.0+), not by index, because indices shift as soon as an op adds, deletes or moves a layer. On older AE versions the id falls back to `i<index>:<name>`.

### `ae_run_script`

This tool covers what the vocabulary can't express: text layers, shapes, effects, expressions, masks and the render queue. `tools.js` wraps the code as `eval("(function(){<code>\n})()")` inside `beginUndoGroup` / `endUndoGroup`, with `engine.jsx` loaded in front so its helpers are available. Because the code goes through `eval`, an error's line number counts from the first line of the snippet. A thrown error comes back as `Script error at line N: …`.

## Bridge protocol

Each message is one JSON object per line. Every request has an `id`, and the reply echoes that `id` along with `ok`.

| `type` | Fields | Reply |
|---|---|---|
| `hello` | `client` (`mcp` / `panel`), `pid`, `info` | `version`, `enabled` |
| `eval` | `script`, `label` | `result`, `error`, `ms`. Refused with `paused: true` while paused |
| `status` | — | `status`: version, port, pid, enabled, counters, `running`, `clients[]`, `activity[]` (the last 40 evals) |
| `setEnabled` | `enabled` | Sends the other clients a `paused` or `resumed` event |
| `broadcast` | `event`, `to?` | `delivered`. Every other client named `to` (or every client, if `to` is missing) receives `{type:"event", event, from}` |
| `ping` | — | — |

**Threading.** The network thread never calls AE. An `eval` goes onto a mutex-guarded queue, and then `AEGP_CauseIdleRoutinesToBeCalled` wakes AE. That is the one call the SDK documents as thread-safe, and its suite pointer is acquired on the main thread when the plugin loads. `IdleHook` runs one job per idle call. If more jobs are waiting it sets `max_sleep` to 0, then hands the reply back through a self-pipe. Calls from different sessions are therefore serialized in AE as well.

**Clients.** `shared/bridge-client.js` keeps one connection open. If the connection drops it retries every 3 s, and any connection not accepted within 2 s is treated as not the bridge. Because every Claude Code session stays connected, the bridge's client list doubles as the panel's view of which sessions are alive. `AE_MCP_PORT` changes the port, and it has to be set for both AE and the server.

## The panel

The panel (**Window > Extensions > AE MCP**) is a client of the bridge like the MCP servers are. It shows the status, the connected sessions and recent activity, and it offers four controls:

- **Pause / Resume** sends `setEnabled`. While paused, every eval is refused and Claude Code gets a "paused" error, with no AppleScript fallback.
- **Reload MCP** sends `broadcast {event:"reload", to:"mcp"}`.
- **Test round-trip** times a tiny eval.
- **Reconnect** reopens the panel's own connection.

It also handles first-run setup. If `native/` holds a bundled bridge and no bridge is installed, **Install bridge** copies it into the running AE's `Plug-ins` folder through macOS's administrator prompt. If `after-effects@ae-plugins` isn't in `~/.claude/plugins/installed_plugins.json`, no session is connected, and the extension holds `claude-plugin/`, the panel shows the commands that install the Claude Code plugin from that folder.

## Packaging

`scripts/package.js` stages the extension into `dist/stage/`: `CSXS/`, `panel/`, `shared/`, `native/AE MCP Bridge.plugin`, and `claude-plugin/`, a local marketplace holding the MCP server and engine. It then builds `dist/AE-MCP-<version>.pkg` with that folder at `/Library/Application Support/Adobe/CEP/extensions/com.ae.tools`. `scripts/pkg/postinstall` copies the bridge into each After Effects and sets `PlayerDebugMode` for the signed-in user, because the panel in the pkg is unsigned.

The script refuses to run if `package.json`, `plugin.json` and `manifest.xml` disagree on the version. `.debug` is left out so releases don't open a remote-debug port. The bridge is marked non-relocatable, otherwise the installer could update a copy found elsewhere on disk instead of installing it.

## Reload

When a reload event arrives, each `server.js` does the following:

1. Drops `mcp/tools.js` and `engine/vocabulary.js` from `require.cache` and loads them again.
2. Sends `notifications/tools/list_changed` (the server declares `tools.listChanged`).

What each kind of change needs:

| Changed | To pick it up |
|---|---|
| `engine/engine.jsx` | Nothing. It is read from disk on every call. |
| `mcp/tools.js`, `engine/vocabulary.js` | **Reload MCP** in the panel |
| `mcp/server.js`, `shared/bridge-client.js` | A new Claude Code session, or `/mcp` → reconnect |
| `aegp/` | `npm run install-aegp` and an AE restart |
| `panel/`, `CSXS/` | `npm run deploy` and reopening the panel |

## Adding an op

Make these three edits together:

1. `engine/vocabulary.js`: add the kind to the `kind` enum (plus any new field), and add a line to `OP_CATALOG`.
2. `engine/engine.jsx` → `describeOp`: add a case that fills in `before` / `after` / `problem`.
3. `engine/engine.jsx` → `applyOne`: add the case that does the edit.

If the op adds or removes layers, also add it to `STRUCTURAL`. Then press **Reload MCP**.

When something keeps coming up through `ae_run_script`, promote it to an op so it gets a preview.

## Safety model

The op tools keep several guarantees:

1. **Schema as contract.** Only kinds in the enum validate, so these tools can't carry code.
2. **Preview against the live comp.** Preview catches stale ids, bad blend modes and out-of-range indices before anything changes.
3. **Apply only what passed preview.** `ae_apply_ops` runs preview again itself.
4. **One undo group per apply.**
5. **Ids, not indices.**

`ae_run_script` deliberately gives up guarantees 1–3: it runs model-written code with no preview. Its description tells the model to say what a script will do before running it, to use the ops when they can do the job, and never to open modal dialogs, which block AE until dismissed. Each run is still one undo group.

These hold for every tool:

- **Kill switch.** **Pause** in the panel refuses every bridge eval, `ae_run_script` included.
- **Loopback only.** The socket binds to `127.0.0.1`. Anything on the machine that can open a local socket can run ExtendScript while the bridge is enabled, which is another reason for **Pause**.
