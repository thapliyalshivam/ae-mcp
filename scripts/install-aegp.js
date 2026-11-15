#!/usr/bin/env node
// AE MCP - https://shivamthapliyal.com
// Copyright (C) 2026 Shivam Thapliyal
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Builds the AE MCP Bridge and installs it into the newest
 * "/Applications/Adobe After Effects <year>/Plug-ins" (or AE_APP's). That folder is owned by
 * root, so the copy goes through macOS's administrator password prompt.
 *
 *   npm run install-aegp            build + install (aegp/build.sh)
 *   npm run install-aegp -- --skip-build
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BUNDLE = 'AE MCP Bridge.plugin';
const BUILT = path.join(ROOT, 'aegp', 'build', BUNDLE);

function findAeApp() {
  if (process.env.AE_APP) return process.env.AE_APP;
  const names = fs.readdirSync('/Applications')
    .filter((n) => /^Adobe After Effects (CC )?\d{4}$/.test(n))
    .sort((a, b) => Number(a.slice(-4)) - Number(b.slice(-4)));
  if (names.length === 0) throw new Error('No After Effects found in /Applications. Set AE_APP.');
  return names[names.length - 1];
}

function sh(s) {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

if (!process.argv.includes('--skip-build')) {
  console.log('[install-aegp] Building...');
  execFileSync(path.join(ROOT, 'aegp', 'build.sh'), { stdio: 'inherit' });
}
if (!fs.existsSync(BUILT)) {
  console.error('[install-aegp] No build at ' + BUILT);
  process.exit(1);
}

const dest = path.join('/Applications', findAeApp(), 'Plug-ins', BUNDLE);
const command = 'rm -rf ' + sh(dest) + ' && cp -R ' + sh(BUILT) + ' ' + sh(dest);

try {
  execFileSync('/bin/sh', ['-c', command], { stdio: 'pipe' });
} catch (e) {
  console.log('[install-aegp] The Plug-ins folder needs administrator rights — asking macOS...');
  // macOS privacy rules stop the admin shell from reading ~/Documents, so it copies from a
  // staged copy in the temp folder instead.
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'ae-plugin-'));
  const staged = path.join(stage, BUNDLE);
  execFileSync('cp', ['-R', BUILT, staged]);
  const stagedCommand = 'rm -rf ' + sh(dest) + ' && cp -R ' + sh(staged) + ' ' + sh(dest);
  const apple = 'do shell script ' + JSON.stringify(stagedCommand) + ' with administrator privileges';
  try {
    execFileSync('osascript', ['-e', apple], { stdio: 'inherit' });
    fs.rmSync(stage, { recursive: true, force: true });
  } catch (e2) {
    fs.rmSync(stage, { recursive: true, force: true });
    console.error('[install-aegp] Could not get administrator rights. Install it from a terminal with:\n\n' +
      '  sudo /bin/sh -c ' + sh(command) + '\n');
    process.exit(1);
  }
}

console.log('[install-aegp] Installed to: ' + dest);
console.log('[install-aegp] Restart After Effects to load it.');
