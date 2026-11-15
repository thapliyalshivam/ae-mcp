#!/usr/bin/env node
// AE MCP - https://shivamthapliyal.com
// Copyright (C) 2026 Shivam Thapliyal
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Picks the next release version and stamps it into the working tree, for CI. Tags are the record
 * of what shipped, so these stamps are never committed.
 *
 * The version is the patch after the newest v* tag. To start a new minor or major, raise the
 * version in package.json above that tag and it's used as is.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function parts(version) {
  return version.split('.').map(Number);
}

function isNewer(a, b) {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] > y[i];
  }
  return false;
}

function latestTag() {
  return execFileSync('git', ['tag', '--list', 'v*'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag))
    .map((tag) => tag.slice(1))
    .reduce((newest, version) => (!newest || isNewer(version, newest) ? version : newest), null);
}

function nextVersion(base, latest) {
  if (!latest || isNewer(base, latest)) return base;
  const [major, minor, patch] = parts(latest);
  return `${major}.${minor}.${patch + 1}`;
}

function stampJson(relativePath, version) {
  const file = path.join(ROOT, relativePath);
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  json.version = version;
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
}

function stampManifest(version) {
  const file = path.join(ROOT, 'CSXS', 'manifest.xml');
  const xml = fs.readFileSync(file, 'utf8')
    .replace(/ExtensionBundleVersion="[^"]+"/, `ExtensionBundleVersion="${version}"`)
    .replace(/(<Extension Id="com\.ae\.tools\.mcp" Version=")[^"]+"/, `$1${version}"`);
  fs.writeFileSync(file, xml);
}

const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const version = nextVersion(base, latestTag());
stampJson('package.json', version);
stampJson('.claude-plugin/plugin.json', version);
stampManifest(version);
console.log(version);
