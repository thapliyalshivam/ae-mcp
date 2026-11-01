#!/usr/bin/env node
/**
 * Copies the AE MCP panel into the CEP extensions folder so After Effects can load it.
 * Only what the panel needs goes over: the MCP server and the engine run from this folder.
 */
const fs = require('fs');
const path = require('path');

const EXT_ID = 'com.ae.tools';
const SRC = path.resolve(__dirname, '..');
const DEST = path.join(
  process.env.HOME,
  'Library',
  'Application Support',
  'Adobe',
  'CEP',
  'extensions',
  EXT_ID
);

const INCLUDE = ['CSXS', 'panel', 'shared', '.debug'];
const IGNORE = new Set(['.DS_Store', '.gitkeep']);

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    if (IGNORE.has(entry)) continue;
    const srcPath = path.join(src, entry);
    const destPath = path.join(dest, entry);
    if (fs.statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

console.log('[deploy] Installing the AE MCP panel to the CEP extensions folder...');

if (!fs.existsSync(path.join(SRC, 'shared', 'CSInterface.js'))) {
  console.error('[deploy] shared/CSInterface.js is missing — run `npm run download-cep` first.');
  process.exit(1);
}

if (fs.existsSync(DEST)) {
  fs.rmSync(DEST, { recursive: true, force: true });
}

fs.mkdirSync(DEST, { recursive: true });
for (const entry of INCLUDE) {
  const srcPath = path.join(SRC, entry);
  if (fs.statSync(srcPath).isDirectory()) copyDir(srcPath, path.join(DEST, entry));
  else fs.copyFileSync(srcPath, path.join(DEST, entry));
}
console.log(`[deploy] Installed to: ${DEST}`);
