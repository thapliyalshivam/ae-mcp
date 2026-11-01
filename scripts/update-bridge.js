#!/usr/bin/env node
/**
 * Run this after changing the bridge, then commit aegp/prebuilt/. It builds and tests the bridge
 * and keeps the compiled copy that CI packages, because the After Effects SDK isn't on GitHub.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { AEGP, bridgeHash } = require('./bridge-hash');

const BUNDLE = 'AE MCP Bridge.plugin';
const PREBUILT = path.join(AEGP, 'prebuilt');

execFileSync(path.join(AEGP, 'build.sh'), { stdio: 'inherit' });
execFileSync(path.join(AEGP, 'test', 'run.sh'), { stdio: 'inherit' });

fs.rmSync(PREBUILT, { recursive: true, force: true });
fs.mkdirSync(PREBUILT);
execFileSync('/usr/bin/ditto', ['--norsrc', path.join(AEGP, 'build', BUNDLE), path.join(PREBUILT, BUNDLE)]);
fs.writeFileSync(path.join(PREBUILT, 'SOURCE.sha256'), bridgeHash() + '\n');
console.log('[update-bridge] Updated ' + PREBUILT + '. Commit it.');
