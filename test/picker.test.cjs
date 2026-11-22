'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const picker = require('../extension/src/picker.cjs');
const { createAdapter } = require('../extension/src/adapter.cjs');

const LISTING = 'The following browser pages are currently shared with you and can be interacted with using the browser tools:\n- [p1] Docs (https://example.com/a) (not visible)\n- [p2] App (dev) (http://localhost:3000/) (active)';
const ELEMENT = { tag: 'button', classes: ['primary'], selector: '#save', inShadowRoot: false, text: 'Save', outerHTML: '<button id="save">Save</button>', truncated: false, rect: { x: 1, y: 2, width: 30, height: 20 }, url: 'http://localhost:3000/', title: 'App' };

test('page listing parses ids, titles with parentheses, URLs and visibility', () => {
  const pages = picker.parsePages(LISTING);
  assert.deepEqual(pages, [
    { id: 'p1', title: 'Docs', url: 'https://example.com/a', state: 'not visible' },
    { id: 'p2', title: 'App (dev)', url: 'http://localhost:3000/', state: 'active' }
  ]);
  assert.equal(picker.choosePage(pages).id, 'p2');
  assert.equal(picker.choosePage([{ id: 'a', state: 'visible' }, { id: 'b', state: 'not visible' }]).id, 'a');
  assert.equal(picker.choosePage([{ id: 'a', state: 'visible' }, { id: 'b', state: 'visible' }]), undefined);
  assert.deepEqual(picker.parsePages('- [p3] Pick (test) (data:text/html,f(x)%20y) (visible)'), [{ id: 'p3', title: 'Pick (test)', url: 'data:text/html,f(x)%20y', state: 'visible' }]);
  assert.deepEqual(picker.parsePages('- [p4] Blocked page (not visible)'), [{ id: 'p4', title: 'Blocked page', url: undefined, state: 'not visible' }]);
  assert.deepEqual(picker.parsePages('No browser pages are currently shared with you.'), []);
});
test('playwright results distinguish values, deferred executions and errors', () => {
  const r = (...texts) => ({ content: texts.map(text => ({ type: 'text', text })) });
  assert.deepEqual(picker.parseResult(r('Result: {"tag":"a"}', 'summary')), { value: { tag: 'a' } });
  assert.deepEqual(picker.parseResult(r('Result: null', 'summary')), { value: null });
  assert.deepEqual(picker.parseResult(r('[deferredResultId=d1] The code has not finished executing yet.', 'summary')), { deferredResultId: 'd1' });
  assert.match(picker.parseResult(r('Code execution failed: boom')).error, /boom/);
});
test('injected page code is valid, self-contained JavaScript', () => {
  assert.doesNotThrow(() => new Function('page', `return (async () => { ${picker.PICK_CODE} })();`));
  assert.match(picker.PICK_CODE, new RegExp(`"expire":${picker.EXPIRE_MS}`));
  assert.match(picker.PICK_CODE.split('\n')[0], /^\/\/ VS Control: Pick Element for Claude\./);
  assert.doesNotMatch(picker.PICK_CODE, /\bnative\b|\brequire\(/);
});
test('markdown fences survive backticks in page content and flag untrusted data', () => {
  const md = picker.toMarkdown({ ...ELEMENT, text: 'use ```code```', pickedAt: 'now' });
  assert.match(md, /untrusted data/);
  assert.match(picker.toMarkdown({ ...ELEMENT, url: `data:text/html,${'x'.repeat(1000)}`, pickedAt: 'now' }), /- Page: App — data:text\/html,x{280,}…\n/);
  assert.match(md, /````text\nuse ```code```\n````/);
  assert.match(md, /```html\n<button id="save">Save<\/button>\n```/);
  assert.equal(picker.fileName({ tag: 'my-el' }, new Date(2026, 0, 1, 9, 5, 7)), 'my-el-090507.md');
  assert.equal(picker.fileName({ tag: '"#' }, new Date(2026, 0, 1, 9, 5, 7)), 'element-090507.md');
});
test('picks are written inside a self-ignoring workspace directory and pruned', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vs-control-pick-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const date = new Date(2026, 0, 1, 12, 0, 0);
  const first = await picker.writePick(dir, { ...ELEMENT, pickedAt: 'now' }, date);
  const second = await picker.writePick(dir, { ...ELEMENT, pickedAt: 'now' }, date);
  assert.notEqual(first, second);
  assert.equal(path.dirname(first), path.join(dir, picker.PICK_DIRECTORY));
  assert.equal(await fs.readFile(path.join(dir, '.vs-control', '.gitignore'), 'utf8'), '*\n');
  for (let i = 0; i < 25; i++) await picker.writePick(dir, { ...ELEMENT, pickedAt: 'now' }, new Date(2026, 0, 1, 13, 0, i));
  assert.equal((await fs.readdir(path.join(dir, picker.PICK_DIRECTORY))).length, 20);
});

function fakeVscode({ dir, commands = ['claude-vscode.addToChat'], responses, settings = { enableChatTools: true } }) {
  const calls = [];
  const executed = [];
  class CancellationError extends Error {}
  const vscode = {
    workspace: { isTrusted: true, workspaceFolders: [{ uri: { fsPath: dir } }], getConfiguration: () => ({ get: (key, fallback) => key in settings ? settings[key] : fallback }) },
    lm: {
      tools: [{ name: 'list_browser_pages' }, { name: 'run_playwright_code' }],
      invokeTool: async (name, options) => { calls.push({ name, input: options.input }); return { content: [{ value: responses.shift() }] }; }
    },
    commands: { getCommands: async () => commands, executeCommand: async (...args) => { executed.push(args); } },
    window: {
      withProgress: async (_options, task) => task({}, { onCancellationRequested: () => {} }),
      showWarningMessage: async message => { executed.push(['warning', message]); },
      showErrorMessage: async message => { executed.push(['error', message]); },
      showInformationMessage: async message => { executed.push(['info', message]); }
    },
    tasks: {}, Uri: { file: fsPath => ({ fsPath }) },
    ProgressLocation: { Notification: 15 },
    CancellationError,
    CancellationTokenSource: class { token = { isCancellationRequested: false }; cancel() { this.token.isCancellationRequested = true; } dispose() {} }
  };
  return { vscode, calls, executed };
}
test('a pick on the active page waits through deferred results, writes the file and adds it to Claude chat', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vs-control-flow-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const f = fakeVscode({ dir, responses: [LISTING, '[deferredResultId=d1] not finished', `Result: ${JSON.stringify(ELEMENT)}`] });
  const p = picker.createPicker(f.vscode);
  await p.pick();
  assert.deepEqual(f.calls.map(c => [c.name, c.input.pageId, c.input.deferredResultId]), [['list_browser_pages', undefined, undefined], ['run_playwright_code', 'p2', undefined], ['run_playwright_code', 'p2', 'd1']]);
  assert.equal(f.calls[2].input.code, undefined);
  const held = p.held();
  assert.equal(held.sequence, 1);
  assert.equal(held.selector, '#save');
  assert.equal(held.sentTo, 'claude-vscode.addToChat');
  assert.deepEqual(f.executed, [['claude-vscode.addToChat', { fsPath: held.file }]]);
  assert.match(await fs.readFile(held.file, 'utf8'), /# Picked element: `#save`/);
  const adapter = createAdapter(f.vscode, [], { picker: p });
  const tool = JSON.parse((await adapter.call('vscode_picked_element', {}, new AbortController().signal)).content[0].text);
  assert.equal(tool.selector, '#save');
});
test('escape leaves nothing held; without addToChat the pick is still readable', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vs-control-flow-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const cancelled = fakeVscode({ dir, responses: [LISTING, 'Result: null'] });
  const p1 = picker.createPicker(cancelled.vscode);
  await p1.pick();
  assert.equal(p1.held(), undefined);
  assert.deepEqual(cancelled.executed, []);
  const plain = fakeVscode({ dir, commands: [], responses: [LISTING, `Result: ${JSON.stringify(ELEMENT)}`] });
  const p2 = picker.createPicker(plain.vscode);
  await p2.pick();
  assert.equal(p2.held().sentTo, 'none');
  assert.equal(plain.executed[0][0], 'info');
});
test('readiness names missing prerequisites and does not invoke tools', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vs-control-flow-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const f = fakeVscode({ dir, commands: [], responses: [], settings: { enableChatTools: false } });
  const p = picker.createPicker(f.vscode);
  const state = await p.readiness();
  assert.equal(state.ready, false);
  assert.equal(state.addToChat, false);
  assert.match(state.problems.join(' '), /enableChatTools/);
  await p.pick();
  assert.deepEqual(f.calls, []);
  assert.match(f.executed[0][1], /enableChatTools/);
});
