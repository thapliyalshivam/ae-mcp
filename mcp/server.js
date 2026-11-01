#!/usr/bin/env node
/**
 * After Effects MCP server — exposes the engine (engine/engine.jsx) to Claude Code as tools.
 *
 *   claude ──stdio JSON-RPC──▶ this server ──tcp──▶ AE MCP Bridge (AEGP) ──▶ ExtendScript
 *                                          └─osascript fallback─┘
 *
 * Hand-rolled MCP (newline-delimited JSON-RPC), no dependencies. This file owns the protocol
 * and the bridge connection; the tools live in tools.js so a "reload" event from the AE MCP
 * panel can swap them in place and tell Claude Code the tool list changed.
 *
 * Logs go to stderr: stdout is the protocol.
 */
const path = require('path');
const readline = require('readline');
const { BridgeClient } = require('../shared/bridge-client');

const ROOT = path.resolve(__dirname, '..');
const VERSION = require(path.join(ROOT, 'package.json')).version;

function log(message) {
  process.stderr.write('[ae-mcp] ' + message + '\n');
}

const INSTRUCTIONS =
  'Edits the active Adobe After Effects comp through a fixed op vocabulary. Workflow: ' +
  'ae_get_context → ae_preview_ops → show the rows to the user → ae_apply_ops with the ops they ' +
  'approved. Anything the ops cannot express, say so rather than forcing a wrong op. If a call ' +
  'fails to reach After Effects, ae_status says why.';

const bridge = new BridgeClient({
  hello: {
    client: 'mcp',
    pid: process.pid,
    info: 'v' + VERSION + ' · ' + path.basename(process.cwd())
  }
});

let tools = [];

/** (Re)load tools.js and engine/vocabulary.js from disk. */
function loadTools() {
  const toolsPath = require.resolve('./tools');
  const { VOCABULARY_PATH } = require(toolsPath);
  delete require.cache[toolsPath];
  delete require.cache[require.resolve(VOCABULARY_PATH)];
  tools = require(toolsPath).createTools({ bridge });
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

async function handle(message) {
  const { id, method, params } = message;
  if (id === undefined || id === null) return; // notification — nothing to answer

  switch (method) {
    case 'initialize':
      return send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: (params && params.protocolVersion) || '2025-06-18',
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: 'after-effects', version: VERSION },
          instructions: INSTRUCTIONS
        }
      });

    case 'ping':
      return send({ jsonrpc: '2.0', id, result: {} });

    case 'tools/list':
      return send({
        jsonrpc: '2.0',
        id,
        result: {
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
            annotations: t.annotations
          }))
        }
      });

    case 'tools/call': {
      const tool = tools.find((t) => t.name === (params && params.name));
      if (!tool) {
        return send({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool: ' + (params && params.name) } });
      }
      // Tool failures go back as isError results, not protocol errors, so the model can read them.
      try {
        const text = await tool.run((params && params.arguments) || {});
        return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } });
      } catch (e) {
        return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: e.message }], isError: true } });
      }
    }

    default:
      return send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found: ' + method } });
  }
}

function main() {
  try {
    loadTools();
  } catch (e) {
    log('Failed to load the tools: ' + e.message);
    process.exit(1);
  }

  bridge.on('connect', (reply) => log('bridge connected (v' + reply.version + (reply.enabled ? '' : ', paused') + ')'));
  bridge.on('disconnect', () => log('bridge disconnected; retrying'));
  bridge.on('event', (event) => {
    if (event.event !== 'reload') return;
    try {
      loadTools();
      send({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
      log('reloaded tools and vocabulary (asked by ' + event.from + ')');
    } catch (e) {
      log('reload failed, keeping the previous tools: ' + e.message);
    }
  });
  bridge.connect();

  const pending = new Set();
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch (e) {
      return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }
    const work = handle(message).catch((e) => {
      log(e.stack || e.message);
      if (message.id !== undefined) {
        send({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: e.message } });
      }
    });
    pending.add(work);
    work.then(() => pending.delete(work));
  });
  // Finish in-flight calls (an apply may be mid-run in AE) before exiting.
  rl.on('close', () => Promise.all(pending).then(() => {
    bridge.close();
    process.exit(0);
  }));
  log('ready');
}

main();
