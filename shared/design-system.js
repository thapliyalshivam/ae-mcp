// AE MCP - https://shivamthapliyal.com
// Copyright (C) 2026 Shivam Thapliyal
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * The active design system: one Markdown file the user picks in the AE MCP panel. The panel
 * writes its path to a small settings file, and every MCP session reads the file from there, so
 * edits to the Markdown reach Claude without picking it again.
 *
 *   ~/Library/Application Support/AE MCP/design-system.json   { "path": "/…/design-shivam.md" }
 *
 * AE_MCP_DESIGN_SYSTEM (a path to a .md) overrides the panel's choice for one session.
 *
 * Loaded by the CEP panel and by mcp/tools.js, so it stays plain CommonJS / ES5.
 */
var fs = require('fs');
var os = require('os');
var path = require('path');

var SETTINGS_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'AE MCP');
var SETTINGS_PATH = path.join(SETTINGS_DIR, 'design-system.json');

/** The headings a design system file must have (.claude/rules/design-system-files.md). */
var REQUIRED_SECTIONS = [
  /^##\s*1\.\s*Colou?r tokens/im,
  /^##\s*2\.\s*Motion tokens/im,
  /^##\s*3\.\s*Typography tokens/im,
  /^##\s*4\.\s*Layout/im,
  /^##\s*5\.\s*Hard rules/im
];
var SECTION_NAMES = ['1. Colour tokens', '2. Motion tokens', '3. Typography tokens', '4. Layout', '5. Hard rules'];

/** The path the user chose, or null. */
function chosenPath() {
  if (process.env.AE_MCP_DESIGN_SYSTEM) return process.env.AE_MCP_DESIGN_SYSTEM;
  try {
    var settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    return typeof settings.path === 'string' && settings.path ? settings.path : null;
  } catch (e) {
    return null; // nothing chosen yet
  }
}

function choose(filePath) {
  fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify({ path: filePath }, null, 2) + '\n');
}

function clear() {
  try { fs.unlinkSync(SETTINGS_PATH); } catch (e) { /* already clear */ }
}

/** "# Design system: Shivam" → "Shivam". Falls back to the file name. */
function nameOf(text, filePath) {
  var match = /^#\s*Design system:\s*(.+)$/im.exec(text);
  if (match) return match[1].trim();
  return path.basename(filePath).replace(/\.md$/i, '');
}

/** The section headings this text is missing. */
function missingSections(text) {
  var missing = [];
  for (var i = 0; i < REQUIRED_SECTIONS.length; i++) {
    if (!REQUIRED_SECTIONS[i].test(text)) missing.push(SECTION_NAMES[i]);
  }
  return missing;
}

/**
 * The active design system.
 *   null                                   nothing chosen
 *   { path, error }                        chosen, but unreadable
 *   { path, name, text, mtimeMs, missing } ready (missing lists absent sections)
 */
function load() {
  var filePath = chosenPath();
  if (!filePath) return null;
  try {
    var text = fs.readFileSync(filePath, 'utf8');
    if (!text.trim()) return { path: filePath, error: 'The file is empty.' };
    return {
      path: filePath,
      name: nameOf(text, filePath),
      text: text,
      mtimeMs: fs.statSync(filePath).mtimeMs,
      missing: missingSections(text)
    };
  } catch (e) {
    return { path: filePath, error: e.code === 'ENOENT' ? 'The file was moved or deleted.' : e.message };
  }
}

module.exports = {
  SETTINGS_PATH: SETTINGS_PATH,
  SECTION_NAMES: SECTION_NAMES,
  chosenPath: chosenPath,
  choose: choose,
  clear: clear,
  load: load,
  missingSections: missingSections,
  nameOf: nameOf
};
