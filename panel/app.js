// AE MCP - https://shivamthapliyal.com
// Copyright (C) 2026 Shivam Thapliyal
// SPDX-License-Identifier: GPL-3.0-or-later

/* global CSInterface, SystemPath */
/**
 * AE MCP panel — status and controls for the AE MCP Bridge AEGP plugin and the Claude Code
 * sessions connected to it.
 *
 *   this panel ──tcp 127.0.0.1:7391──▶ AE MCP Bridge ◀──tcp── mcp/server.js (one per session)
 *
 * The panel is just another bridge client (named "panel"): it polls `status`, toggles
 * `setEnabled`, and sends a `reload` broadcast that every MCP session acts on.
 */
var csInterface = new CSInterface();
var fs = require('fs');
var path = require('path');

var EXT_ROOT = csInterface.getSystemPath(SystemPath.EXTENSION);
var BridgeClient = require(path.join(EXT_ROOT, 'shared', 'bridge-client.js')).BridgeClient;
var designSystem = require(path.join(EXT_ROOT, 'shared', 'design-system.js'));

var POLL_MS = 1000;
var PLUGIN_NAME = 'AE MCP Bridge.plugin';
var CLAUDE_PLUGIN = 'after-effects@ae-plugins';
var CLAUDE_MARKETPLACE = path.join(EXT_ROOT, 'claude-plugin');
var CLAUDE_COMMANDS = 'claude plugin marketplace add "' + CLAUDE_MARKETPLACE + '"\n' +
  'claude plugin install ' + CLAUDE_PLUGIN;

var bridge = null;
var lastStatus = null;
var toastTimer = null;

function $(id) { return document.getElementById(id); }

/* ---------------------------------------------------------------- formatting */

function ago(ms) {
  if (!ms) return '—';
  var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm ago';
}

function duration(ms) {
  var s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
}

function clock(ms) {
  var d = new Date(ms);
  function two(n) { return (n < 10 ? '0' : '') + n; }
  return two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds());
}

function el(tag, className, text) {
  var node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function toast(message, kind) {
  var t = $('toast');
  t.textContent = message;
  t.className = kind || '';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.textContent = ''; t.className = ''; }, 6000);
}

/* ---------------------------------------------------------------- render */

/** The headline: black state over a grey detail line. kind is ok | warn | bad. */
function setStatus(kind, main, sub) {
  $('status').className = 'status ' + kind;
  $('status-main').textContent = main;
  $('status-sub').textContent = sub || '';
}

/** Follow After Effects' interface brightness (Preferences > Appearance). */
function applyTheme() {
  var theme = 'dark';
  try {
    var c = csInterface.getHostEnvironment().appSkinInfo.panelBackgroundColor.color;
    var luminance = (0.2126 * c.red + 0.7152 * c.green + 0.0722 * c.blue) / 255;
    theme = luminance > 0.5 ? 'light' : 'dark';
  } catch (e) { /* no skin info: keep dark, AE's default */ }
  document.documentElement.setAttribute('data-theme', theme);
}

function installedPlugins() {
  var found = [];
  var dirs = ['/Library/Application Support/Adobe/Common/Plug-ins/7.0/MediaCore'];
  try {
    fs.readdirSync('/Applications').forEach(function (name) {
      if (/^Adobe After Effects/.test(name)) dirs.push(path.join('/Applications', name, 'Plug-ins'));
    });
  } catch (e) { /* no access */ }
  dirs.forEach(function (dir) {
    if (fs.existsSync(path.join(dir, PLUGIN_NAME))) found.push(dir);
  });
  return found;
}

/** The bridge bundled in an installer. A dev install from `npm run deploy` doesn't carry one. */
function bundledBridge() {
  var bundled = path.join(EXT_ROOT, 'native', PLUGIN_NAME);
  return fs.existsSync(bundled) ? bundled : null;
}

/** "/Applications/Adobe After Effects 2025/Plug-ins" for the After Effects running this panel. */
function hostPluginsDir() {
  var match = /^(.*)\/[^/]+\.app(\/|$)/.exec(csInterface.getSystemPath(SystemPath.HOST_APPLICATION));
  return match ? path.join(match[1], 'Plug-ins') : null;
}

function claudePluginInstalled() {
  var home = process.env.CLAUDE_CONFIG_DIR || path.join(process.env.HOME, '.claude');
  try {
    var installed = JSON.parse(fs.readFileSync(path.join(home, 'plugins', 'installed_plugins.json'), 'utf8'));
    return Object.prototype.hasOwnProperty.call(installed.plugins || installed, CLAUDE_PLUGIN);
  } catch (e) {
    return false; // no Claude Code here, or no plugins yet
  }
}

/** A dev install from `npm run deploy` has no bundled plugin to offer. */
function renderClaudeSetup(sessions) {
  $('claude-setup').hidden = sessions > 0 || !fs.existsSync(CLAUDE_MARKETPLACE) || claudePluginInstalled();
}

function renderOffline() {
  lastStatus = null;
  setStatus('bad', 'Offline', 'Bridge not reachable');
  $('offline').hidden = false;
  renderClaudeSetup(0);
  ['btn-toggle', 'btn-reload', 'btn-test'].forEach(function (id) { $(id).disabled = true; });
  ['s-version', 's-endpoint', 's-uptime', 's-evals', 's-last', 's-running'].forEach(function (id) { $(id).textContent = '—'; });
  $('sessions').innerHTML = '<span class="empty">—</span>';

  var hint = $('offline-hint');
  var where = installedPlugins();
  var canInstall = where.length === 0 && !!bundledBridge() && !!hostPluginsDir();
  $('btn-install').hidden = !canInstall;
  if (canInstall) {
    hint.innerHTML = 'The <b>AE MCP Bridge</b> plugin is not installed. Installing it asks for your ' +
      'administrator password, and After Effects then needs a restart. Until then, Claude Code falls ' +
      'back to AppleScript.';
  } else if (where.length === 0) {
    hint.innerHTML = 'The <b>AE MCP Bridge</b> plugin is not installed. In <code>ae-mcp</code> run ' +
      '<code>npm run install-aegp</code>, then restart After Effects. Until then, Claude Code falls back ' +
      'to AppleScript.';
  } else {
    hint.innerHTML = 'The plugin is installed (' + where[0] + ') but nothing answers on 127.0.0.1:' +
      bridge.port + '. Restart After Effects so it loads the plugin. If another After Effects instance ' +
      'is open, it may hold the port.';
  }
}

function renderStatus(s) {
  lastStatus = s;
  $('offline').hidden = true;

  var mcp = s.clients.filter(function (c) { return c.name === 'mcp'; });
  renderClaudeSetup(mcp.length);
  if (s.listenError) setStatus('bad', 'Port error', 'Port ' + s.port + ' unavailable');
  else if (!s.enabled) setStatus('warn', 'Paused', 'Claude Code calls are refused');
  else if (mcp.length === 0) setStatus('warn', 'Idle', 'No sessions');
  else setStatus('ok', 'Active', mcp.length + ' session' + (mcp.length === 1 ? '' : 's'));

  var toggle = $('btn-toggle');
  toggle.disabled = false;
  toggle.textContent = s.enabled ? 'Pause' : 'Resume';
  toggle.className = s.enabled ? '' : 'solid';
  $('btn-reload').disabled = mcp.length === 0;
  $('btn-test').disabled = !s.enabled;

  $('s-version').textContent = 'v' + s.version + ' · AE pid ' + s.pid;
  $('s-endpoint').textContent = s.listenError || ('127.0.0.1:' + s.port);
  $('s-uptime').textContent = duration(s.now - s.startedAt);
  $('s-evals').textContent = s.evals + ' / ' + s.errors + (s.queued ? ' · ' + s.queued + ' queued' : '');
  $('s-last').textContent = ago(s.lastEvalAt);
  $('s-running').textContent = s.running || 'idle';

  var list = $('sessions');
  list.innerHTML = '';
  if (mcp.length === 0) {
    list.appendChild(el('span', 'empty',
      'None connected. Start claude in a terminal — the after-effects plugin launches the MCP server, which connects here within a few seconds.'));
  }
  mcp.forEach(function (c) {
    var row = el('div', 'row');
    row.appendChild(el('span', 'tag mcp', 'pid ' + c.pid));
    row.appendChild(el('span', 'main', c.info || 'MCP server'));
    row.appendChild(el('span', 'side', c.evals + ' calls · up ' + duration(s.now - c.connectedAt)));
    list.appendChild(row);
  });

  var log = $('activity');
  log.innerHTML = '';
  if (s.activity.length === 0) log.appendChild(el('span', 'empty', 'No calls yet.'));
  for (var i = s.activity.length - 1; i >= 0; i--) {
    var a = s.activity[i];
    var line = el('div', 'row');
    line.appendChild(el('span', 'side', clock(a.at)));
    var main = el('span', 'main' + (a.ok ? '' : ' err'), a.label + (a.ok ? '' : ' — ' + a.error));
    main.title = a.error || a.label;
    line.appendChild(main);
    line.appendChild(el('span', 'side', Math.round(a.ms) + ' ms'));
    log.appendChild(line);
  }
}

function refreshHost() {
  csInterface.evalScript('aeMcpHostInfo()', function (raw) {
    var info;
    try { info = JSON.parse(raw); } catch (e) { return; }
    $('h-version').textContent = info.version + ' (' + info.build + ')';
    $('h-project').textContent = info.project;
    $('h-comp').textContent = info.comp || 'none';
  });
}

/** The design system section. Reads the file each time, so a move or an edit shows up. */
function renderDesignSystem() {
  var ds = designSystem.load();
  var name = $('ds-name');
  var detail = $('ds-detail');
  $('btn-ds-remove').hidden = !ds;
  $('btn-ds-choose').textContent = ds ? 'Change' : 'Choose .md';
  name.className = 'ds-name';
  detail.className = 'ds-detail';
  detail.title = '';

  if (!ds) {
    name.textContent = 'None';
    detail.textContent = 'Claude Code follows no brand rules. Choose a design system .md to set them.';
    return;
  }
  detail.title = ds.path;
  if (ds.error) {
    name.textContent = path.basename(ds.path);
    name.className = 'ds-name err';
    detail.textContent = ds.error + ' Choose the file again.';
    return;
  }
  name.textContent = ds.name;
  if (ds.missing.length) {
    detail.className = 'ds-detail err';
    detail.textContent = 'Missing sections: ' + ds.missing.join(', ') + '. Claude Code still reads it.';
  } else {
    detail.textContent = path.basename(ds.path) + ' · Claude Code follows it on every edit.';
  }
}

/* ---------------------------------------------------------------- polling */

function poll() {
  if (!bridge.connected) {
    renderOffline();
    return;
  }
  bridge.status().then(renderStatus, function () { renderOffline(); });
}

function connect() {
  if (bridge) bridge.close();
  bridge = new BridgeClient({ hello: { client: 'panel', pid: 0, info: 'AE MCP panel' }, retryMs: 2000 });
  bridge.on('connect', poll);
  bridge.on('disconnect', renderOffline);
  bridge.connect();
}

/* ---------------------------------------------------------------- actions */

$('btn-toggle').addEventListener('click', function () {
  if (!lastStatus) return;
  var enable = !lastStatus.enabled;
  bridge.setEnabled(enable).then(function () {
    toast(enable ? 'Resumed — Claude Code can reach After Effects again.' : 'Paused — AE calls from Claude Code are refused until you resume.', 'good');
    poll();
  }, function (e) { toast(e.message, 'err'); });
});

$('btn-reload').addEventListener('click', function () {
  bridge.broadcast('reload', 'mcp').then(function (n) {
    toast('Reload sent to ' + n + ' MCP session' + (n === 1 ? '' : 's') + '. Tools, vocabulary and engine are re-read from disk.', 'good');
  }, function (e) { toast(e.message, 'err'); });
});

$('btn-test').addEventListener('click', function () {
  var started = Date.now();
  bridge.evalScript('app.version', 'panel: round-trip test', 15000).then(function (version) {
    toast('Round-trip OK in ' + (Date.now() - started) + ' ms (After Effects ' + version + ').', 'good');
    poll();
  }, function (e) { toast(e.message, 'err'); poll(); });
});

$('btn-reconnect').addEventListener('click', function () {
  toast('Reconnecting…');
  connect();
  bridge.ready(2500).then(function (ok) {
    toast(ok ? 'Connected to the bridge.' : 'The bridge did not answer.', ok ? 'good' : 'err');
    poll();
  });
});

$('btn-copy').addEventListener('click', function () {
  var area = document.createElement('textarea');
  area.value = CLAUDE_COMMANDS;
  document.body.appendChild(area);
  area.select();
  var copied = document.execCommand('copy');
  document.body.removeChild(area);
  toast(copied ? 'Commands copied.' : 'Could not copy. Select the commands instead.', copied ? 'good' : 'err');
});

function shellQuote(s) {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

$('btn-install').addEventListener('click', function () {
  var dest = path.join(hostPluginsDir(), PLUGIN_NAME);
  var command = 'rm -rf ' + shellQuote(dest) + ' && cp -R ' + shellQuote(bundledBridge()) + ' ' + shellQuote(dest) +
    ' && xattr -dr com.apple.quarantine ' + shellQuote(dest);
  var script = 'do shell script ' + JSON.stringify(command) + ' with administrator privileges';
  var button = $('btn-install');
  button.disabled = true;
  require('child_process').execFile('osascript', ['-e', script], function (err) {
    button.disabled = false;
    if (err) { toast('The bridge was not installed: ' + err.message, 'err'); return; }
    toast('Bridge installed. Restart After Effects to load it.', 'good');
    poll();
  });
});

$('btn-ds-choose').addEventListener('click', function () {
  var current = designSystem.chosenPath();
  var start = current ? path.dirname(current) : process.env.HOME;
  var result = window.cep.fs.showOpenDialogEx(false, false, 'Choose a design system', start, ['md']);
  if (result.err || !result.data || !result.data.length) return; // cancelled
  var chosen = result.data[0];
  var text;
  try { text = fs.readFileSync(chosen, 'utf8'); } catch (e) {
    toast('Could not read that file: ' + e.message, 'err');
    return;
  }
  if (!/\.md$/i.test(chosen) || !text.trim()) {
    toast('Choose a Markdown (.md) file that has content.', 'err');
    return;
  }
  try { designSystem.choose(chosen); } catch (e) {
    toast('Could not save the choice: ' + e.message, 'err');
    return;
  }
  renderDesignSystem();
  var missing = designSystem.missingSections(text);
  toast(missing.length
    ? 'Design system set, but it is missing ' + missing.length + ' section(s). See .claude/rules/design-system-files.md.'
    : 'Design system set. Claude Code uses ' + designSystem.nameOf(text, chosen) + ' from its next call.',
    missing.length ? 'err' : 'good');
});

$('btn-ds-remove').addEventListener('click', function () {
  designSystem.clear();
  renderDesignSystem();
  toast('Design system removed. Claude Code follows no brand rules.', 'good');
});

/* A link would load inside the panel. Open it in the default browser instead. */
$('credit-link').addEventListener('click', function (e) {
  e.preventDefault();
  csInterface.openURLInDefaultBrowser(this.href);
});

$('claude-commands').textContent = CLAUDE_COMMANDS;
applyTheme();
renderDesignSystem();
csInterface.addEventListener(CSInterface.THEME_COLOR_CHANGED_EVENT, applyTheme);
connect();
refreshHost();
setInterval(poll, POLL_MS);
setInterval(refreshHost, 5000);
setInterval(renderDesignSystem, 5000);
