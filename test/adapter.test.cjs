'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAdapter } = require('../extension/src/adapter.cjs');

function fixture(overrides = {}) {
  let cancelled = false;
  let options;
  const vscode = {
    version: 'test', workspace: { isTrusted: true, workspaceFolders: [], getConfiguration: () => ({ get: (key, fallback) => fallback }) },
    lm: { tools: [{ name: 'read_page', description: 'Read page', inputSchema: { type: 'object' } }], invokeTool: async (name, opts) => { options = opts; return { content: [{ value: 'actual page' }] }; } },
    tasks: {}, window: {},
    CancellationTokenSource: class { token = {}; cancel() { cancelled = true; } dispose() {} },
    ...overrides
  };
  return { adapter: createAdapter(vscode), vscode, options: () => options, cancelled: () => cancelled };
}
test('native invocation uses documented undefined chat token', async () => {
  const f = fixture();
  const result = await f.adapter.call('vscode_invoke_tool', { name: 'read_page', input: { pageId: '123' } }, new AbortController().signal);
  assert.equal(result.content[0].text, 'actual page');
  assert.deepEqual(f.options(), { input: { pageId: '123' }, toolInvocationToken: undefined });
});
test('bridge never dispatches unexposed native tools or arbitrary commands', async () => {
  const { adapter } = fixture();
  await assert.rejects(adapter.call('vscode_invoke_tool', { name: 'arbitrary_shell' }, new AbortController().signal), /not enabled/);
  await assert.rejects(adapter.call('vscode_command', { command: 'workbench.action.installExtension' }, new AbortController().signal), /not permitted/);
});
test('built-in schemas reject wrong types, negative positions and unknown options', async () => {
  const { adapter } = fixture();
  for (const args of [{ path: '/file', line: -1 }, { path: 3 }, { path: '/file', unknown: true }]) {
    await assert.rejects(adapter.call('vscode_open_file', args, new AbortController().signal));
  }
});
test('adapter independently rejects untrusted workspaces and cancellation', async () => {
  const { adapter, vscode } = fixture();
  const controller = new AbortController(); controller.abort();
  await assert.rejects(adapter.call('vscode_capabilities', {}, controller.signal), /Cancelled/);
  vscode.workspace.isTrusted = false;
  await assert.rejects(adapter.call('vscode_capabilities', {}, new AbortController().signal), /not trusted/);
});
test('debug breakpoints and paused-session inspection use VS Code and DAP, zero-based', async t => {
  const fs = require('node:fs/promises'); const os = require('node:os'); const path = require('node:path');
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'vs-control-debug-')));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, 'app.js'), 'let total = 6;\n');
  const requests = [];
  const replies = {
    threads: { threads: [{ id: 1, name: 'main' }] },
    stackTrace: { totalFrames: 1, stackFrames: [{ id: 7, name: 'run', source: { path: path.join(dir, 'app.js') }, line: 2, column: 3 }] },
    scopes: { scopes: [{ name: 'Local', variablesReference: 11, expensive: true }, { name: 'Global', variablesReference: 12, expensive: true }] },
    variables: { variables: [{ name: 'total', value: '6', type: 'number', variablesReference: 0 }] },
    evaluate: { result: '12', type: 'number', variablesReference: 0 }
  };
  const session = { id: 's', name: 'Launch', type: 'node', customRequest: async (command, body) => { requests.push([command, body]); return replies[command]; } };
  const breakpoints = [];
  const uri = fsPath => ({ fsPath, toString: () => `file://${fsPath}` });
  const { adapter, vscode } = fixture({
    workspace: { isTrusted: true, workspaceFolders: [{ uri: uri(dir) }], getConfiguration: () => ({ get: (key, fallback) => fallback }) },
    Uri: { file: uri },
    Position: class { constructor(line, character) { Object.assign(this, { line, character }); } },
    Location: class { constructor(u, position) { this.uri = u; this.range = { start: position }; } },
    SourceBreakpoint: class { constructor(location, enabled, condition) { Object.assign(this, { id: 'b1', location, enabled, condition }); } },
    debug: { activeDebugSession: undefined, breakpoints, addBreakpoints: list => breakpoints.push(...list), removeBreakpoints: list => list.forEach(b => breakpoints.splice(breakpoints.indexOf(b), 1)) }
  });
  const call = async args => JSON.parse((await adapter.call('vscode_debug', args, new AbortController().signal)).content[0].text);
  assert.deepEqual(await call({ action: 'setBreakpoint', path: 'app.js', line: 0, condition: 'total > 1' }), { id: 'b1', enabled: true, condition: 'total > 1', uri: `file://${path.join(dir, 'app.js')}`, line: 0, column: 0 });
  assert.equal((await call({ action: 'breakpoints' })).breakpoints.length, 1);
  await assert.rejects(adapter.call('vscode_debug', { action: 'stack' }, new AbortController().signal), /No active debug session/);
  vscode.debug.activeDebugSession = session;
  const stack = await call({ action: 'stack' });
  assert.deepEqual(stack.threads[0].frames[0], { id: 7, name: 'run', path: path.join(dir, 'app.js'), line: 1, column: 2 });
  const scopes = (await call({ action: 'variables', frameId: 7 })).scopes;
  assert.deepEqual(scopes.map(s => [s.name, s.expensive, s.variables?.[0].value]), [['Local', true, '6'], ['Global', true, undefined]]);
  assert.equal((await call({ action: 'evaluate', expression: 'total * 2', frameId: 7 })).result, '12');
  assert.deepEqual(requests.at(-1), ['evaluate', { expression: 'total * 2', frameId: 7, context: 'repl' }]);
  await assert.rejects(adapter.call('vscode_debug', { action: 'variables' }, new AbortController().signal), /frameId/);
  assert.equal((await call({ action: 'removeBreakpoints', path: 'app.js' })).removed.length, 1);
  assert.equal(breakpoints.length, 0);
});
