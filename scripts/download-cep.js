#!/usr/bin/env node
/**
 * Downloads CSInterface.js from the Adobe CEP Resources repository.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const CEP_URL =
  'https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/CEP_11.x/CSInterface.js';
const DEST = path.resolve(__dirname, '..', 'shared', 'CSInterface.js');

console.log('[download-cep] Downloading CSInterface.js...');

https.get(CEP_URL, (res) => {
  if (res.statusCode !== 200) {
    console.error(`[download-cep] HTTP ${res.statusCode} – download failed.`);
    process.exit(1);
  }
  const file = fs.createWriteStream(DEST);
  res.pipe(file);
  file.on('finish', () => {
    file.close();
    console.log(`[download-cep] Saved to ${DEST}`);
  });
}).on('error', (err) => {
  console.error('[download-cep] Error:', err.message);
  process.exit(1);
});
