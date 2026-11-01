/**
 * Client for the AE MCP Bridge AEGP plugin (aegp/AEMCPBridge.cpp), shared by mcp/server.js and
 * the CEP panel. One JSON object per line over 127.0.0.1:<port>; replies echo the request id.
 *
 * Keeps one connection open and reconnects on its own, so the bridge's client list doubles as
 * the "which MCP sessions are alive" view in the panel.
 *
 * Plain CommonJS, no dependencies — it has to load in CEP's Node as well as Claude Code's.
 */
var net = require('net');
var EventEmitter = require('events').EventEmitter;

var DEFAULT_PORT = 7391;

function BridgeClient(options) {
  EventEmitter.call(this);
  options = options || {};
  this.port = Number(options.port || process.env.AE_MCP_PORT || DEFAULT_PORT);
  this.hello = options.hello || { client: 'unknown' };
  this.retryMs = options.retryMs || 3000;
  this.socket = null;
  this.connected = false;
  this.bridgeVersion = null;
  this.enabled = true;
  this.nextId = 1;
  this.pending = {};
  this.buffer = '';
  this.closed = false;
  this.retryTimer = null;
}
BridgeClient.prototype = Object.create(EventEmitter.prototype);
BridgeClient.prototype.constructor = BridgeClient;

BridgeClient.prototype.connect = function () {
  var self = this;
  if (self.closed || self.socket) return;
  var socket = net.createConnection({ host: '127.0.0.1', port: self.port });
  self.socket = socket;
  socket.setEncoding('utf8');
  socket.setNoDelay(true);
  // A local socket that isn't accepted within a couple of seconds isn't the bridge.
  socket.setTimeout(2000, function () { socket.destroy(new Error('connect timeout')); });

  socket.on('connect', function () {
    socket.setTimeout(0);
    self.connected = true;
    self.request('hello', self.hello, 5000).then(function (reply) {
      self.bridgeVersion = reply.version;
      self.enabled = reply.enabled !== false;
      self.emit('connect', reply);
    }, function () { /* the close handler reports it */ });
  });
  socket.on('data', function (chunk) {
    self.buffer += chunk;
    var nl;
    while ((nl = self.buffer.indexOf('\n')) !== -1) {
      var line = self.buffer.slice(0, nl);
      self.buffer = self.buffer.slice(nl + 1);
      if (line) self._receive(line);
    }
  });
  socket.on('error', function () { /* followed by close */ });
  socket.on('close', function () {
    var was = self.connected;
    self.socket = null;
    self.connected = false;
    self.buffer = '';
    var pending = self.pending;
    self.pending = {};
    Object.keys(pending).forEach(function (id) {
      pending[id].reject(new Error('Lost the connection to the AE MCP Bridge.'));
    });
    if (was) self.emit('disconnect');
    if (!self.closed) {
      clearTimeout(self.retryTimer);
      self.retryTimer = setTimeout(function () { self.connect(); }, self.retryMs);
    }
  });
};

BridgeClient.prototype._receive = function (line) {
  var message;
  try { message = JSON.parse(line); } catch (e) { return; }
  if (message.type === 'event') {
    if (message.event === 'paused') this.enabled = false;
    if (message.event === 'resumed') this.enabled = true;
    this.emit('event', message);
    return;
  }
  var waiter = this.pending[message.id];
  if (!waiter) return;
  delete this.pending[message.id];
  clearTimeout(waiter.timer);
  if (message.ok) waiter.resolve(message);
  else {
    var err = new Error(message.error || 'The bridge refused the request.');
    err.paused = !!message.paused;
    waiter.reject(err);
  }
};

/** Send one request; resolves with the reply object, rejects on error/timeout/disconnect. */
BridgeClient.prototype.request = function (type, fields, timeoutMs) {
  var self = this;
  return new Promise(function (resolve, reject) {
    if (!self.socket || !self.connected) return reject(new Error('The AE MCP Bridge is not connected.'));
    var id = self.nextId++;
    var message = { id: id, type: type };
    Object.keys(fields || {}).forEach(function (k) { message[k] = fields[k]; });
    var timer = setTimeout(function () {
      delete self.pending[id];
      reject(new Error('After Effects did not answer within ' + Math.round((timeoutMs || 30000) / 1000) +
        's. A modal dialog may be open, or a render is running.'));
    }, timeoutMs || 30000);
    self.pending[id] = { resolve: resolve, reject: reject, timer: timer };
    self.socket.write(JSON.stringify(message) + '\n');
  });
};

/** Run ExtendScript on AE's main thread. Resolves with the script's result string. */
BridgeClient.prototype.evalScript = function (script, label, timeoutMs) {
  return this.request('eval', { script: script, label: label || 'eval' }, timeoutMs || 300000)
    .then(function (reply) { return reply.result; });
};

BridgeClient.prototype.status = function () {
  return this.request('status', {}, 5000).then(function (reply) { return reply.status; });
};

BridgeClient.prototype.setEnabled = function (enabled) {
  var self = this;
  return this.request('setEnabled', { enabled: !!enabled }, 5000).then(function (reply) {
    self.enabled = reply.enabled;
    return reply;
  });
};

/** Relay an event to the other clients (all, or only those named `to`). */
BridgeClient.prototype.broadcast = function (event, to) {
  var fields = { event: event };
  if (to) fields.to = to;
  return this.request('broadcast', fields, 5000).then(function (reply) { return reply.delivered; });
};

/** Resolves true once connected, false after waitMs. */
BridgeClient.prototype.ready = function (waitMs) {
  var self = this;
  if (self.connected && self.bridgeVersion) return Promise.resolve(true);
  self.connect();
  return new Promise(function (resolve) {
    var timer = setTimeout(function () { self.removeListener('connect', onConnect); resolve(false); }, waitMs || 1500);
    function onConnect() { clearTimeout(timer); resolve(true); }
    self.once('connect', onConnect);
  });
};

BridgeClient.prototype.close = function () {
  this.closed = true;
  clearTimeout(this.retryTimer);
  if (this.socket) this.socket.destroy();
};

module.exports = { BridgeClient: BridgeClient, DEFAULT_PORT: DEFAULT_PORT };
