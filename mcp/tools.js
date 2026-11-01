/**
 * The After Effects tools. Everything that can change while a session runs lives here, so the
 * server can drop this module (and engine/vocabulary.js) from require's cache and load it again
 * when the AE MCP panel asks for a reload — no Claude Code restart needed.
 *
 * Transport, in order:
 *   1. the AE MCP Bridge AEGP plugin (aegp/) — AEGP_ExecuteScript on AE's main thread
 *   2. osascript DoScript, when the bridge isn't loaded (AE_MCP_TRANSPORT=bridge disables this)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ENGINE_PATH = path.join(ROOT, 'engine', 'engine.jsx');
const VOCABULARY_PATH = path.join(ROOT, 'engine', 'vocabulary.js');

/**
 * Escape every non-ASCII character to \uXXXX: the trip into ExtendScript mangles them otherwise.
 * Non-ASCII in engine.jsx only appears inside strings and comments, where the escape is either
 * decoded or ignored.
 */
function asciiOnly(s) {
  return s.replace(/[\u0080-￿]/g, (ch) => '\\u' + ('0000' + ch.charCodeAt(0).toString(16)).slice(-4));
}

function literal(value) {
  return asciiOnly(JSON.stringify(value));
}

function engineSource() {
  return asciiOnly(fs.readFileSync(ENGINE_PATH, 'utf8'));
}

/* ---------------------------------------------------------------- osascript fallback */

/** Newest installed "Adobe After Effects <year>", unless AE_APP names one. */
function findAeApp() {
  if (process.env.AE_APP) return process.env.AE_APP;
  const names = fs.readdirSync('/Applications')
    .filter((n) => /^Adobe After Effects (CC )?\d{4}$/.test(n))
    .sort((a, b) => Number(a.slice(-4)) - Number(b.slice(-4)));
  if (names.length === 0) throw new Error('No After Effects found in /Applications. Set AE_APP.');
  return names[names.length - 1];
}

function osascript(script, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error((stderr || err.message).trim()));
        resolve(stdout.replace(/\n$/, ''));
      });
  });
}

function appleString(s) {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

async function evalViaOsascript(expression) {
  const app = findAeApp();
  const running = await osascript('application ' + appleString(app) + ' is running', 10000);
  if (running !== 'true') throw new Error(app + ' is not running. Open it on a comp and try again.');

  // DoScript's AppleScript result is always 0 in AE 2025, so the reply comes back through a file.
  const file = path.join(os.tmpdir(), 'ae-mcp-' + process.pid + '.jsx');
  const out = path.join(os.tmpdir(), 'ae-mcp-' + process.pid + '.json');
  try { fs.unlinkSync(out); } catch (e) { /* not there yet */ }
  fs.writeFileSync(file, engineSource() + '\n' +
    'var __aeMcpOut = new File(' + literal(out) + ');\n' +
    '__aeMcpOut.encoding = "UTF-8";\n' +
    '__aeMcpOut.open("w");\n' +
    '__aeMcpOut.write(' + expression + ');\n' +
    '__aeMcpOut.close();\n');

  const js = "$.evalFile('" + file.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "')";
  await osascript(
    'with timeout of 300 seconds\n' +
    'tell application ' + appleString(app) + ' to DoScript ' + appleString(js) + '\n' +
    'end timeout',
    310000
  );

  try {
    return fs.readFileSync(out, 'utf8');
  } catch (e) {
    throw new Error('After Effects ran the script but wrote no reply. Check Settings > Scripting & ' +
      'Expressions > "Allow Scripts to Write Files and Access Network", or install the AE MCP ' +
      'Bridge plugin (npm run install-aegp in ae-mcp).');
  }
}

/* ---------------------------------------------------------------- tools */

function createTools({ bridge }) {
  const vocab = require(VOCABULARY_PATH);
  const mode = process.env.AE_MCP_TRANSPORT || 'auto';
  let lastTransport = null;

  async function evalInAe(expression, label) {
    let raw;
    if (mode !== 'osascript' && await bridge.ready(1500)) {
      lastTransport = 'bridge';
      raw = await bridge.evalScript(engineSource() + '\n' + expression, label);
    } else if (mode === 'bridge') {
      throw new Error('The AE MCP Bridge is not reachable on 127.0.0.1:' + bridge.port + '. Is After ' +
        'Effects open, with the plugin installed (npm run install-aegp)?');
    } else {
      lastTransport = 'osascript';
      raw = await evalViaOsascript(expression);
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error('Unreadable reply from After Effects: ' + String(raw).slice(0, 200));
    }
    if (parsed.success === false) throw new Error(parsed.message || 'After Effects refused the request.');
    return parsed;
  }

  // AE runs one script at a time, so calls are queued rather than racing each other.
  let queue = Promise.resolve();
  function callAe(expression, label) {
    const run = queue.then(() => evalInAe(expression, label));
    queue = run.catch(() => {});
    return run;
  }

  function formatRows(rows) {
    return rows.map((r) => {
      const tags = [r.ok ? 'ok' : 'BLOCKED'];
      if (r.structural) tags.push('structural');
      let line = r.index + '. [' + tags.join(', ') + '] ' + (r.name || '(comp)') +
        (r.layerId ? ' #' + r.layerId : '') + ' — ' + r.field + ': ' + r.before + ' → ' + r.after;
      if (r.problem) line += '\n   problem: ' + r.problem;
      return line;
    }).join('\n');
  }

  async function getContext() {
    const result = await callAe('claudeGetContext()', 'ae_get_context');
    return result.data;
  }

  async function previewOps(ops) {
    const preview = await callAe('claudePreviewOps(' + literal(ops) + ')', 'ae_preview_ops');
    let text = formatRows(preview.rows);
    if (preview.blocked > 0) text += '\n\n' + preview.blocked + ' op(s) would be refused.';
    return text;
  }

  /** Preview first and apply only what passes. */
  async function applyOps(ops) {
    const preview = await callAe('claudePreviewOps(' + literal(ops) + ')', 'ae_apply_ops: preview');
    const ok = preview.rows.filter((r) => r.ok).map((r) => ops[r.index]);
    const blocked = preview.rows.filter((r) => !r.ok);
    if (ok.length === 0) {
      throw new Error('Nothing applied — every op failed preview:\n' + formatRows(blocked));
    }

    const result = await callAe('claudeApplyOps(' + literal(ok) + ')', 'ae_apply_ops');
    const lines = ['Applied ' + result.applied + ', failed ' + result.failed +
      '. One undo group: Cmd+Z in After Effects reverts the batch.'];
    if (result.errors && result.errors.length) lines.push('Errors:\n' + result.errors.join('\n'));
    if (blocked.length) lines.push('Skipped (failed preview):\n' + formatRows(blocked));
    return lines.join('\n\n');
  }

  /**
   * Run arbitrary ExtendScript in one undo group. The code is passed to eval() as a string, so
   * error line numbers count from the first line of the snippet, not of engine.jsx.
   */
  async function runScript(code, undoName) {
    const body = '(function(){' + code + '\n})()';
    const expression =
      '(function(){\n' +
      '  app.beginUndoGroup(' + literal(undoName || 'Claude script') + ');\n' +
      '  try {\n' +
      '    var __r = eval(' + literal(body) + ');\n' +
      '    return respondWithData(true, "ok", __r === undefined ? "" : String(__r));\n' +
      '  } catch (e) {\n' +
      '    return respond(false, "Script error at line " + e.line + ": " + e.toString());\n' +
      '  } finally {\n' +
      '    app.endUndoGroup();\n' +
      '  }\n' +
      '})()';
    const result = await callAe(expression, 'ae_run_script');
    return 'Script ran. One undo group: Cmd+Z in After Effects reverts it.' +
      (result.data ? '\n\nReturned:\n' + result.data : '');
  }

  async function status() {
    const lines = ['Transport mode: ' + mode + (lastTransport ? ' (last call used ' + lastTransport + ')' : '')];
    if (!(await bridge.ready(1500))) {
      lines.push('AE MCP Bridge: not reachable on 127.0.0.1:' + bridge.port +
        (mode === 'bridge' ? '' : ' — calls fall back to osascript.'));
      return lines.join('\n');
    }
    const s = await bridge.status();
    const mcp = s.clients.filter((c) => c.name === 'mcp').length;
    lines.push('AE MCP Bridge ' + s.version + ': ' + (s.enabled ? 'active' : 'PAUSED (resume in the AE MCP panel)') +
      ', port ' + s.port + ', AE pid ' + s.pid);
    lines.push('Evals: ' + s.evals + ' (' + s.errors + ' errors), queued ' + s.queued +
      (s.running ? ', running ' + s.running : ''));
    lines.push('Connected clients: ' + s.clients.length + ' (' + mcp + ' MCP session' + (mcp === 1 ? '' : 's') + ')');
    return lines.join('\n');
  }

  const opsInput = {
    type: 'object',
    properties: { ops: vocab.OPS_SCHEMA },
    required: ['ops'],
    additionalProperties: false
  };
  const opGuide =
    'Layers are addressed by the id after # in ae_get_context (e.g. "L12"), never by index — ' +
    'indices shift as layers are added, deleted or moved. Index 1 is the TOP layer.\n\n' +
    vocab.OP_CATALOG;

  return [
    {
      name: 'ae_get_context',
      description:
        'Read the active After Effects composition: the selected layers, or the whole comp (up to ' +
        '80 layers) when nothing is selected. Every layer line ends with its id (#L12). Read-only. ' +
        'Call this before proposing edits, and again after applying if you need fresh state.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { title: 'Read AE comp', readOnlyHint: true },
      run: () => getContext()
    },
    {
      name: 'ae_preview_ops',
      description:
        'Check a plan of edits against the LIVE comp without changing anything. Returns one ' +
        'before → after row per op, marks ops that would be refused and why, and tags structural ' +
        'ops (create, duplicate, delete, move, parent). Show the rows to the user before ' +
        'applying.\n\n' + opGuide,
      inputSchema: opsInput,
      annotations: { title: 'Preview AE edits', readOnlyHint: true },
      run: (args) => previewOps(args.ops)
    },
    {
      name: 'ae_apply_ops',
      description:
        'Apply edits to the active comp in one undo group. Ops that fail preview are skipped, ' +
        'not applied. Only call this after the user has seen ae_preview_ops rows and agreed — ' +
        'especially for structural ops.\n\n' + opGuide,
      inputSchema: opsInput,
      annotations: { title: 'Apply AE edits', readOnlyHint: false, destructiveHint: true },
      run: (args) => applyOps(args.ops)
    },
    {
      name: 'ae_run_script',
      description:
        'Run arbitrary ExtendScript in After Effects, for anything the op vocabulary cannot ' +
        'express (text layers, shapes, effects, expressions, masks, render queue...). The code is ' +
        'the body of a function: use `return` to send a value back (it is converted with ' +
        'String()). ES3 only — no JSON, no let/const, no arrow functions, no Array.indexOf. ' +
        'Never write "text" + array: AE overloads + on arrays and throws "invalid numeric result" — ' +
        'use array.join(","). After addProperty() on a property group, re-fetch earlier references ' +
        'from the group: adding invalidates them ("Object is invalid"). The ' +
        'whole run is one undo group named `undoName`. There is no preview: tell the user what ' +
        'the script will do before running it, prefer ae_apply_ops when the ops can do the job, ' +
        'and never call alert() or other modal dialogs — they block AE until dismissed.',
      inputSchema: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'ExtendScript function body.' },
          undoName: { type: 'string', description: 'Name of the undo group shown in Edit > Undo.' }
        },
        required: ['code'],
        additionalProperties: false
      },
      annotations: { title: 'Run AE script', readOnlyHint: false, destructiveHint: true },
      run: (args) => runScript(args.code, args.undoName)
    },
    {
      name: 'ae_status',
      description:
        'Report how this server reaches After Effects: whether the AE MCP Bridge plugin is ' +
        'reachable, paused or active, and how many sessions are connected. Use it when an AE ' +
        'call fails with a connection or "paused" error.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { title: 'AE bridge status', readOnlyHint: true },
      run: () => status()
    }
  ];
}

module.exports = { createTools, VOCABULARY_PATH };
