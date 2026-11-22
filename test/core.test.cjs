'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { contains, readInstances, selectInstance } = require('../plugin/lib/state.cjs');
const native = require('../extension/src/native.cjs');

test('workspace containment does not match path prefixes or siblings', () => {
  assert.equal(contains('/repo/app', '/repo/app/src'), true);
  assert.equal(contains('/repo/app', '/repo/apple'), false);
  assert.equal(contains('/repo/app', '/repo/other'), false);
});
test('discovery chooses deepest multi-root workspace, never unrelated windows', async () => {
  const instances = [{ id: 'a', workspaces: ['/project'] }, { id: 'b', workspaces: ['/other', '/project/nested'] }];
  assert.equal((await selectInstance(instances, '/project/nested/src')).id, 'b');
  await assert.rejects(selectInstance(instances, '/unrelated'), /No VS Control/);
  assert.equal((await selectInstance(instances, '/unrelated', 'a')).id, 'a');
});
test('equal workspace matches require explicit selection; vanished selection cannot fall back', async () => {
  const instances = [{ id: 'a', workspaces: ['/project'] }, { id: 'b', workspaces: ['/project'] }];
  await assert.rejects(selectInstance(instances, '/project'), /Multiple/);
  await assert.rejects(selectInstance(instances, '/project', 'vanished'), /not available/);
});
test('workspace selection resolves symlinks', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vs-control-path-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await fs.mkdir(path.join(dir, 'real')); await fs.symlink(path.join(dir, 'real'), path.join(dir, 'alias'));
  assert.equal((await selectInstance([{ id: 'a', workspaces: [path.join(dir, 'real')] }], path.join(dir, 'alias'))).id, 'a');
});
test('discovery rejects malformed, symlinked and insecure descriptors', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vs-control-state-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const descriptor = { version: 1, id: 'abc', port: 12345, token: 'a'.repeat(64), workspaces: ['/project'] };
  await fs.writeFile(path.join(dir, 'abc.json'), JSON.stringify(descriptor), { mode: 0o600 });
  await fs.writeFile(path.join(dir, 'bad.json'), '{invalid');
  await fs.symlink(path.join(dir, 'abc.json'), path.join(dir, 'def.json'));
  assert.deepEqual((await readInstances(dir)).map(i => i.id), ['abc']);
  if (process.platform !== 'win32') {
    await fs.chmod(path.join(dir, 'abc.json'), 0o644);
    assert.deepEqual(await readInstances(dir), []);
  }
});
test('native exposure uses exact IDs, respects settings and blocks MCP recursion', () => {
  const settings = { groups: ['browser', 'testing'], additional: ['thirdParty', 'mcp_vscode_open_browser_page'] };
  assert.equal(native.allowed({ name: 'open_browser_page' }, settings), true);
  assert.equal(native.allowed({ name: 'runTests' }, settings), true);
  assert.equal(native.allowed({ name: 'evil_browser', description: 'browser testing' }, settings), false);
  assert.equal(native.allowed({ name: 'thirdParty' }, settings), true);
  assert.equal(native.allowed({ name: 'mcp_vscode_open_browser_page' }, settings), false);
  assert.equal(native.allowed({ name: 'runTests' }, { groups: [] }), false);
});
test('notebook and code groups match current and older tool IDs', () => {
  // IDs seen in vscode.lm.tools with GitHub Copilot Chat on VS Code 1.147, and their older names.
  for (const [group, ids] of Object.entries({ notebook: ['copilot_runNotebookCell', 'run_notebook_cell'], code: ['copilot_readFile', 'read_file', 'copilot_searchWorkspaceSymbols', 'vscode_listCodeUsages'] })) {
    for (const id of ids) assert.equal(native.groupFor(id), group, id);
  }
  assert.equal(native.allowed({ name: 'copilot_getNotebookSummary' }, { groups: ['notebook'] }), true);
  assert.equal(native.allowed({ name: 'copilot_applyPatch' }, { groups: ['code', 'notebook'] }), false);
});
test('native names fit MCP constraints without escaping collisions', () => {
  const names = ['a.b', 'a_b', 'x'.repeat(200), 'open_browser_page'];
  const mapped = names.map(native.mcpName);
  assert.equal(new Set(mapped).size, names.length);
  for (const name of mapped) { assert.match(name, /^[a-zA-Z0-9_-]+$/); assert.ok(name.length <= 64); }
});
test('native schemas are preserved and screenshots remain MCP images', () => {
  const schema = { type: 'object', properties: { pageId: { type: 'string' } }, required: ['pageId'] };
  assert.deepEqual(native.definitions([{ name: 'read_page', description: 'Read', inputSchema: schema }], { groups: ['browser'] })[0].inputSchema, schema);
  const result = native.convertResult({ content: [{ value: 'Page' }, { mimeType: 'image/png', data: Uint8Array.from([1, 2, 3]) }] });
  assert.deepEqual(result.content, [{ type: 'text', text: 'Page' }, { type: 'image', mimeType: 'image/png', data: 'AQID' }]);
});
test('unknown native parts and Prompt-TSX are explicitly unsupported, never discarded', () => {
  const result = native.convertResult({ content: [{ value: { type: 'piece', children: [{ text: 'failing test' }] } }] });
  assert.equal(result.isError, true); assert.match(result.content[0].text, /failing test/);
});
