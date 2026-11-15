// AE MCP - https://shivamthapliyal.com
// Copyright (C) 2026 Shivam Thapliyal
// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * AE MCP panel — ExtendScript side. Read-only facts the bridge can't see from its socket.
 * ES3 only; replies are JSON strings built by hand.
 */
function aeMcpHostInfo() {
  var comp = app.project ? app.project.activeItem : null;
  return '{"version":"' + esc(app.version) + '"' +
    ',"build":"' + esc(app.buildNumber) + '"' +
    ',"project":"' + esc(app.project && app.project.file ? app.project.file.name : '(unsaved)') + '"' +
    ',"comp":"' + esc(comp instanceof CompItem ? comp.name : '') + '"}';
}

function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '');
}
