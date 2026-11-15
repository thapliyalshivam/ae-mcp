#!/usr/bin/env node
// AE MCP - https://shivamthapliyal.com
// Copyright (C) 2026 Shivam Thapliyal
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Builds the one file users need: dist/AE-MCP-<version>.pkg. It installs the panel system-wide,
 * with the prebuilt bridge and the Claude Code plugin inside the extension folder, so neither
 * users nor the panel need access to this repo. scripts/pkg/postinstall does the rest.
 *
 *   npm run package                 build the bridge, then the pkg
 *   npm run package -- --skip-build reuse aegp/build
 *   npm run package -- --prebuilt   use aegp/prebuilt, for CI. Fails if it's older than the C++.
 *
 *   PKG_SIGN_IDENTITY="Developer ID Installer: ..."   sign the pkg. Unset means unsigned, and
 *                                                     macOS warns users before opening it.
 *
 * If ZXPSignCmd is available (ZXPSIGNCMD, or on PATH) it also writes dist/ae-mcp-<version>.zxp,
 * signed with ZXP_CERT / ZXP_CERT_PASSWORD. Set ZXP_TSA to timestamp it.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { bridgeHash } = require('./bridge-hash');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const STAGE = path.join(DIST, 'stage');
const BUNDLE = 'AE MCP Bridge.plugin';
const USE_PREBUILT = process.argv.includes('--prebuilt');
const BUILT = path.join(ROOT, 'aegp', USE_PREBUILT ? 'prebuilt' : 'build', BUNDLE);
const EXTENSION_PATH = 'Library/Application Support/Adobe/CEP/extensions/com.ae.tools';

const SKIP = new Set(['.DS_Store', '.gitkeep']);

function fail(message) {
  console.error('[package] ' + message);
  process.exit(1);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    if (SKIP.has(entry)) continue;
    const from = path.join(src, entry);
    const to = path.join(dest, entry);
    if (fs.statSync(from).isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function copyInto(destRoot, relativePath) {
  const from = path.join(ROOT, relativePath);
  const to = path.join(destRoot, relativePath);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (fs.statSync(from).isDirectory()) copyDir(from, to);
  else fs.copyFileSync(from, to);
}

function versions() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const plugin = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).version;
  const manifest = fs.readFileSync(path.join(ROOT, 'CSXS', 'manifest.xml'), 'utf8');
  const bundle = (manifest.match(/ExtensionBundleVersion="([^"]+)"/) || [])[1];
  if (pkg !== plugin || pkg !== bundle) {
    fail(`Versions disagree: package.json ${pkg}, plugin.json ${plugin}, manifest.xml ${bundle}.`);
  }
  return pkg;
}

function stage() {
  fs.rmSync(STAGE, { recursive: true, force: true });
  fs.mkdirSync(STAGE, { recursive: true });
  ['CSXS', 'panel', 'shared', 'LICENSE'].forEach((item) => copyInto(STAGE, item));

  // The bundle's code signature seals its contents, so it goes over byte for byte.
  fs.mkdirSync(path.join(STAGE, 'native'));
  execFileSync('/usr/bin/ditto', ['--norsrc', BUILT, path.join(STAGE, 'native', BUNDLE)]);

  // A local marketplace holding only what the MCP server loads at runtime.
  const plugin = path.join(STAGE, 'claude-plugin');
  ['.claude-plugin/plugin.json', '.claude-plugin/marketplace.json', 'package.json', 'mcp', 'engine',
    'shared/bridge-client.js', 'shared/design-system.js', 'LICENSE'].forEach((item) => copyInto(plugin, item));
}

/** pkgbuild marks bundles relocatable, which would move the bridge onto any copy found elsewhere. */
function componentPlist(root) {
  const plist = path.join(DIST, 'components.plist');
  execFileSync('/usr/bin/pkgbuild', ['--analyze', '--root', root, plist], { stdio: 'pipe' });
  const parsed = JSON.parse(execFileSync('/usr/bin/plutil',
    ['-convert', 'json', '-o', '-', plist], { encoding: 'utf8' }));
  parsed.forEach((component) => { component.BundleIsRelocatable = false; });
  fs.writeFileSync(plist, JSON.stringify(parsed));
  execFileSync('/usr/bin/plutil', ['-convert', 'xml1', plist]);
  return plist;
}

function buildPkg(version) {
  const root = path.join(DIST, 'pkgroot');
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(path.join(root, EXTENSION_PATH)), { recursive: true });
  execFileSync('/usr/bin/ditto', ['--norsrc', STAGE, path.join(root, EXTENSION_PATH)]);

  const output = path.join(DIST, `AE-MCP-${version}.pkg`);
  fs.rmSync(output, { force: true });
  const args = ['--root', root, '--component-plist', componentPlist(root),
    '--scripts', path.join(__dirname, 'pkg'), '--identifier', 'com.ae.tools.mcp',
    '--version', version, '--install-location', '/'];
  if (process.env.PKG_SIGN_IDENTITY) args.push('--sign', process.env.PKG_SIGN_IDENTITY);
  else console.log('[package] No PKG_SIGN_IDENTITY set, so macOS will warn users before opening the pkg.');
  execFileSync('/usr/bin/pkgbuild', [...args, output], { stdio: 'pipe' });
  console.log('[package] Built ' + output);
}

function findZxpSigner() {
  if (process.env.ZXPSIGNCMD) return process.env.ZXPSIGNCMD;
  try {
    return execFileSync('/usr/bin/which', ['ZXPSignCmd'], { encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch (e) {
    return null;
  }
}

function buildZxp(version) {
  const signer = findZxpSigner();
  if (!signer) return;
  if (!process.env.ZXP_CERT || !process.env.ZXP_CERT_PASSWORD) {
    console.log('[package] Skipping the ZXP: it needs ZXP_CERT and ZXP_CERT_PASSWORD.');
    return;
  }
  const output = path.join(DIST, `ae-mcp-${version}.zxp`);
  fs.rmSync(output, { force: true });
  const args = ['-sign', STAGE, output, process.env.ZXP_CERT, process.env.ZXP_CERT_PASSWORD];
  if (process.env.ZXP_TSA) args.push('-tsa', process.env.ZXP_TSA);
  execFileSync(signer, args, { stdio: 'pipe' });
  execFileSync(signer, ['-verify', output], { stdio: 'pipe' });
  console.log('[package] Built ' + output);
}

const version = versions();

if (USE_PREBUILT) {
  const recorded = path.join(ROOT, 'aegp', 'prebuilt', 'SOURCE.sha256');
  if (!fs.existsSync(recorded) || fs.readFileSync(recorded, 'utf8').trim() !== bridgeHash()) {
    fail('aegp/prebuilt is older than the bridge source. Run `npm run update-bridge` and commit it.');
  }
} else if (!process.argv.includes('--skip-build')) {
  console.log('[package] Building the bridge...');
  execFileSync(path.join(ROOT, 'aegp', 'build.sh'), { stdio: 'inherit' });
}
if (!fs.existsSync(BUILT)) fail('No build at ' + BUILT);
if (!fs.existsSync(path.join(ROOT, 'shared', 'CSInterface.js'))) {
  fail('shared/CSInterface.js is missing. Run `npm run download-cep` first.');
}

stage();
buildPkg(version);
buildZxp(version);
