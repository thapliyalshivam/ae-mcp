/**
 * Drives the harness (aegp/test/harness.cpp) through shared/bridge-client.js — the same client
 * the MCP server and panel use. Run via aegp/test/run.sh.
 */
const assert = require('assert');
const path = require('path');
const { BridgeClient } = require(path.join(__dirname, '..', '..', 'shared', 'bridge-client.js'));

const port = Number(process.env.AE_MCP_PORT);

async function main() {
  const mcp = new BridgeClient({ port, hello: { client: 'mcp', pid: 4242, info: 'test session' } });
  const panel = new BridgeClient({ port, hello: { client: 'panel', pid: 0, info: 'panel' } });
  assert.ok(await mcp.ready(3000), 'mcp connects');
  assert.ok(await panel.ready(3000), 'panel connects');

  // eval round trip, including unicode, quotes, newlines and a large script
  const script = 'var s = "héllo \\"wörld\\" ✓ 🎬";\nline2\ttab';
  assert.strictEqual(await mcp.evalScript(script, 'ae_get_context'), 'echo:' + script);
  const big = 'x'.repeat(2 * 1024 * 1024);
  assert.strictEqual((await mcp.evalScript(big, 'big')).length, big.length + 5);

  // script errors come back as rejections with AE's message
  await assert.rejects(mcp.evalScript('throw', 'ae_apply_ops'), /thrown on purpose/);

  // concurrent evals are serialized and each gets its own reply
  const results = await Promise.all([1, 2, 3, 4, 5].map((n) => mcp.evalScript('n' + n, 'c' + n)));
  assert.deepStrictEqual(results, ['echo:n1', 'echo:n2', 'echo:n3', 'echo:n4', 'echo:n5']);

  // status: clients, counters, activity
  let s = await panel.status();
  assert.strictEqual(s.enabled, true);
  assert.strictEqual(s.evals, 8);
  assert.strictEqual(s.errors, 1);
  const session = s.clients.find((c) => c.name === 'mcp');
  assert.ok(session && session.pid === 4242 && session.info === 'test session' && session.evals === 8);
  assert.ok(s.clients.find((c) => c.name === 'panel' && c.self));
  assert.strictEqual(s.activity[0].label, 'ae_get_context');
  assert.ok(s.activity.some((a) => !a.ok && /thrown/.test(a.error)));

  // pause: evals are refused with paused=true and the mcp client hears about it
  const pausedEvent = new Promise((resolve) => mcp.once('event', resolve));
  await panel.setEnabled(false);
  assert.strictEqual((await pausedEvent).event, 'paused');
  assert.strictEqual(mcp.enabled, false);
  await assert.rejects(mcp.evalScript('nope'), (e) => e.paused === true);
  await panel.setEnabled(true);
  assert.strictEqual(await mcp.evalScript('back'), 'echo:back');

  // broadcast reload reaches mcp clients only
  const reload = new Promise((resolve) => mcp.once('event', resolve));
  assert.strictEqual(await panel.broadcast('reload', 'mcp'), 1);
  const ev = await reload;
  assert.strictEqual(ev.event, 'reload');
  assert.strictEqual(ev.from, 'panel');

  // a slow script doesn't block status
  const slow = mcp.evalScript('sleep', 'slow');
  await new Promise((r) => setTimeout(r, 100));
  s = await panel.status();
  assert.strictEqual(s.running, 'slow');
  await slow;

  // disconnect shows up in the client list
  mcp.close();
  await new Promise((r) => setTimeout(r, 300));
  s = await panel.status();
  assert.ok(!s.clients.some((c) => c.name === 'mcp'));
  panel.close();
  console.log('bridge tests passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
