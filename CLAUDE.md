# AE MCP

Lets Claude Code read and edit the active After Effects comp. Three parts:

- `aegp/` — AE MCP Bridge, a native AEGP plugin (C++, After Effects SDK). Socket server on `127.0.0.1:7391`, runs ExtendScript on AE's main thread.
- `mcp/` — the MCP server (`server.js` protocol and bridge connection, `tools.js` hot-reloadable tools).
- `panel/` — the CEP status panel, extension `com.ae.tools.mcp` (`CSXS/manifest.xml`).

The engine is `engine/engine.jsx` (ExtendScript ES3) and its op vocabulary is `engine/vocabulary.js`.

Read `ARCHITECTURE.md` for the protocol, threading, packaging and how to add an op. `README.md` lists every npm script; the common ones:

- `npm run test-bridge` — build the bridge against fake AEGP suites and run the protocol tests, no AE needed
- `npm run install-aegp` — build and install the bridge into After Effects
- `npm run deploy` — re-copy the panel
- `npm run package` — build the installer into `dist/`

The panel's look comes from `panel/tokens.css`; the rules are in `.claude/rules/design-system.md`.
