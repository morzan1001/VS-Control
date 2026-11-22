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
test('language features map provider results to zero-based, capped JSON', async t => {
  const fs = require('node:fs/promises'); const os = require('node:os'); const path = require('node:path');
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'vs-control-symbols-')));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, 'app.js'), 'function greet() {}\ngreet();\n');
  const uri = fsPath => ({ fsPath, toString: () => `file://${fsPath}` });
  const file = uri(path.join(dir, 'app.js'));
  const r = (a, b, c, d) => ({ start: { line: a, character: b }, end: { line: c, character: d } });
  const item = { name: 'greet', kind: 11, detail: '', uri: file, selectionRange: r(0, 9, 0, 14) };
  const executed = [];
  const replies = {
    'vscode.executeHoverProvider': [{ contents: [''], range: r(0, 9, 0, 14) }, { contents: [{ value: '```ts\nfunction greet(): void\n```' }, 'plain', ''], range: r(0, 9, 0, 14) }],
    'vscode.executeCodeActionProvider': [{ title: 'Add JSDoc', kind: { value: 'refactor' }, edit: { entries: () => [[file, [{ range: r(0, 0, 0, 0), newText: '/** */\n' }]]] } }, { title: 'Run', command: 'my.command' }],
    'vscode.prepareCallHierarchy': [item],
    'vscode.provideIncomingCalls': [{ from: { ...item, name: '(module)', kind: 1 }, fromRanges: [r(1, 0, 1, 5)] }],
    'vscode.executeWorkspaceSymbolProvider': [{ name: 'greet', kind: 11, containerName: '', location: { uri: file, range: r(0, 9, 0, 14) } }],
    'vscode.executeImplementationProvider': [{ targetUri: file, targetSelectionRange: r(0, 9, 0, 14) }]
  };
  const { adapter } = fixture({
    workspace: { isTrusted: true, workspaceFolders: [{ uri: uri(dir) }], getConfiguration: () => ({ get: (key, fallback) => fallback }), openTextDocument: async () => ({}) },
    Uri: { file: uri }, SymbolKind: { 1: 'Module', 11: 'Function' },
    Position: class { constructor(line, character) { Object.assign(this, { line, character }); } },
    Range: class { constructor(start, end) { Object.assign(this, { start, end }); } },
    commands: { executeCommand: async (command, ...rest) => { executed.push([command, ...rest]); return replies[command]; } }
  });
  const call = async args => JSON.parse((await adapter.call('vscode_symbols', args, new AbortController().signal)).content[0].text);
  assert.deepEqual(await call({ path: 'app.js', kind: 'hover', line: 0, column: 10 }), [{ contents: ['```ts\nfunction greet(): void\n```', 'plain'], range: { start: { line: 0, column: 9 }, end: { line: 0, column: 14 } } }]);
  const actions = await call({ path: 'app.js', kind: 'codeActions', line: 0, column: 0, endLine: 0, endColumn: 5 });
  assert.deepEqual(actions, [{ title: 'Add JSDoc', kind: 'refactor', edits: [{ uri: file.toString(), range: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } }, newText: '/** */\n' }] }, { title: 'Run', command: 'my.command' }]);
  assert.equal(JSON.stringify(executed.at(-1).slice(2)), JSON.stringify([{ start: { line: 0, character: 0 }, end: { line: 0, character: 5 } }, null, 50]));
  const callers = await call({ path: 'app.js', kind: 'callers', line: 0, column: 10 });
  assert.equal(callers[0].symbol.kind, 'Function'); assert.equal(callers[0].calls[0].name, '(module)'); assert.equal(callers[0].calls[0].ranges[0].start.line, 1);
  const workspace = await call({ kind: 'workspace', query: 'greet' });
  assert.deepEqual(workspace.symbols[0], { name: 'greet', kind: 'Function', uri: file.toString(), range: { start: { line: 0, column: 9 }, end: { line: 0, column: 14 } } });
  assert.equal((await call({ path: 'app.js', kind: 'implementation', line: 0, column: 10 }))[0].range.start.column, 9);
  await assert.rejects(adapter.call('vscode_symbols', { kind: 'workspace' }, new AbortController().signal), /needs a query/);
  await assert.rejects(adapter.call('vscode_symbols', { kind: 'hover' }, new AbortController().signal), /file path/);
});
