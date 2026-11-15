#!/usr/bin/env node
// AE MCP - https://shivamthapliyal.com
// Copyright (C) 2026 Shivam Thapliyal
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Enables PlayerDebugMode for all known CEP/CSXS versions so unsigned
 * extensions are loaded by Adobe After Effects.
 */
const { execSync } = require('child_process');

const CEP_VERSIONS = [7, 8, 9, 10, 11, 12];

console.log('[enable-debug] Enabling debug mode for unsigned extensions...');

for (const v of CEP_VERSIONS) {
  try {
    execSync(`defaults write "com.adobe.CSXS.${v}" PlayerDebugMode 1`, {
      stdio: 'pipe',
    });
  } catch {
    // Silently skip versions that don't exist on this machine
  }
}

console.log('[enable-debug] Done.');
