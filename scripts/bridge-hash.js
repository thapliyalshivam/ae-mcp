/**
 * Fingerprint of the bridge's sources. aegp/prebuilt/SOURCE.sha256 records the one the committed
 * bridge was built from, so a release can't ship a bridge older than its C++.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const AEGP = path.resolve(__dirname, '..', 'aegp');
const SOURCES = ['AEMCPBridge.cpp', 'AEMCPBridge_PiPL.r', 'Info.plist', 'build.sh'];

function bridgeHash() {
  const hash = crypto.createHash('sha256');
  for (const name of SOURCES) hash.update(fs.readFileSync(path.join(AEGP, name)));
  return hash.digest('hex');
}

module.exports = { AEGP, bridgeHash };
