#!/usr/bin/env node
// AE MCP - https://shivamthapliyal.com
// Copyright (C) 2026 Shivam Thapliyal
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Full setup: download CSInterface.js, enable debug mode, deploy the panel, build and install
 * the AEGP bridge. Use `npm run setup` to invoke.
 */
const { execFileSync } = require('child_process');
const path = require('path');

const run = (script) =>
  execFileSync(process.execPath, [path.join(__dirname, script)], {
    stdio: 'inherit',
  });

console.log('=== AE MCP — After Effects setup ===\n');

console.log('[1/4] Downloading CSInterface.js...');
run('download-cep.js');

console.log('\n[2/4] Enabling debug mode for unsigned extensions...');
run('enable-debug.js');

console.log('\n[3/4] Deploying the AE MCP panel...');
run('deploy.js');

console.log('\n[4/4] Building and installing the AE MCP Bridge plugin...');
run('install-aegp.js');

console.log(`
All done!

Next steps:
  1. Quit Adobe After Effects completely (if open), then reopen it.
  2. Open  Window > Extensions > AE MCP  — the dot turns green when the bridge is up.
  3. Start claude; the after-effects plugin's MCP server shows up in the panel's sessions list.
`);
