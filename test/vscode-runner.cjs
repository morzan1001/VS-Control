'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const http = require('node:http');
const vscode = require('vscode');
const { BridgeClient } = require('../plugin/lib/client.cjs');
const manifest = require('../extension/package.json');
const fixtureManifest = require('./fixture-extension/package.json');

exports.run = async () => {
  const checks = [];
  const report = { vscodeVersion: vscode.version, checks, browser: {}, nativeTools: [] };
  const disposables = [];
  const signal = () => new AbortController().signal;
  const check = (name, fn) => fn().then(() => { checks.push({ name, passed: true }); console.log(`PASS ${name}`); });
  try {
    const extension = vscode.extensions.getExtension(`${manifest.publisher}.${manifest.name}`);
    assert.ok(extension, 'Companion extension found');
    await extension.activate();
    await vscode.extensions.getExtension(`${fixtureManifest.publisher}.${fixtureManifest.name}`).activate();
    await vscode.workspace.getConfiguration('vsControl').update('additionalToolNames', ['vscontrol_fixture_echo', 'vscontrol_fixture_image', 'vscontrol_fixture_error'], vscode.ConfigurationTarget.Global);
    const cwd = vscode.workspace.workspaceFolders[0].uri.fsPath;
    const client = new BridgeClient({ cwd });
    await check('extension activation and authenticated discovery', async () => {
      const windows = await client.windows(); assert.equal(windows.length, 1);
      assert.equal(windows[0].vscodeVersion, vscode.version);
    });
    await check('real VS Code tool invocation through HTTP bridge', async () => {
      const result = await client.call('vscode_invoke_tool', { name: 'vscontrol_fixture_echo', input: { value: 'Hello 🚀' } }, signal());
      assert.equal(result.content[0].text, 'Hello 🚀');
    });
    await check('real VS Code binary tool result becomes an MCP image', async () => {
      const result = await client.call('vscode_invoke_tool', { name: 'vscontrol_fixture_image' }, signal());
      assert.equal(result.content[0].type, 'image'); assert.equal(result.content[0].mimeType, 'image/png');
      assert.ok(Buffer.from(result.content[0].data, 'base64').length > 40);
    });
    await check('native exceptions reach the client as tool errors', async () => {
      const result = await client.call('vscode_invoke_tool', { name: 'vscontrol_fixture_error' }, signal());
      assert.equal(result.isError, true); assert.match(result.content[0].text, /intentional failure/);
    });
    const file = path.join(cwd, 'sample.js');
    await check('editor opens actual file and reports selection context', async () => {
      const result = await client.call('vscode_open_file', { path: file, line: 1, column: 2 }, signal());
      assert.equal(result.isError, undefined);
      const context = JSON.parse((await client.call('vscode_context', { includeSelection: true }, signal())).content[0].text);
      assert.equal(context.activeEditor.selection.start.line, 1);
    });
    const diagnostics = vscode.languages.createDiagnosticCollection('vs-control-fixture');
    disposables.push(diagnostics);
    diagnostics.set(vscode.Uri.file(file), [new vscode.Diagnostic(new vscode.Range(0, 0, 0, 3), 'fixture diagnostic', vscode.DiagnosticSeverity.Error)]);
    await check('Problems panel diagnostics are read through the real API', async () => {
      const result = await client.call('vscode_diagnostics', { path: file, severity: 'error' }, signal());
      assert.ok(JSON.parse(result.content[0].text).diagnostics.some(d => d.message === 'fixture diagnostic'));
    });
    // VS Code registers testing tools at LifecyclePhase.Eventually, after the
    // extension host is already ready. Wait once, bounded, for that registration.
    const deadline = Date.now() + 12000;
    while (!vscode.lm.tools.some(t => t.name === 'runTests') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 250));
    const catalog = JSON.parse((await client.call('vscode_tools', { includeSchemas: false }, signal())).content[0].text);
    report.nativeTools = catalog.map(t => ({ name: t.name, enabled: t.enabled }));
    await check('built-in integrated browser lists pages without a chat token', async () => {
      assert.ok(catalog.some(t => t.name === 'list_browser_pages'), 'list_browser_pages available');
      const result = await client.call('vscode_invoke_tool', { name: 'list_browser_pages' }, signal());
      assert.ok(result.content.length); assert.ok(!result.isError, JSON.stringify(result));
      report.browser.listResult = result;
    });
    const web = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><title>VS Control Browser Fixture</title><h1>VS Control fixture</h1><button id="increment" onclick="document.getElementById(\'count\').textContent=\'Count: 1\'">Increment</button><p id="count">Count: 0</p>');
    });
    await new Promise(resolve => web.listen(0, '127.0.0.1', resolve));
    disposables.push({ dispose() { web.closeAllConnections(); web.close(); } });
    await check('native browser opens, reads, clicks and captures a real screenshot', async () => {
      const browserSignal = AbortSignal.timeout(20000);
      const invoke = (name, input) => client.call('vscode_invoke_tool', { name, input }, browserSignal);
      report.browser.openResult = await invoke('open_browser_page', { url: `http://127.0.0.1:${web.address().port}`, forceNew: true });
      assert.ok(!report.browser.openResult.isError, JSON.stringify(report.browser.openResult));
      const pages = await invoke('list_browser_pages', {});
      report.browser.pages = pages;
      const id = pages.content.map(c => c.text || '').join('\n').match(/^- \[([^\]]+)\]/m)?.[1];
      assert.ok(id, JSON.stringify(pages));
      const before = await invoke('read_page', { pageId: id });
      assert.match(JSON.stringify(before), /Count: 0/);
      const click = await invoke('click_element', { pageId: id, selector: '#increment', element: 'Increment button' });
      assert.ok(!click.isError, JSON.stringify(click));
      const after = await invoke('read_page', { pageId: id });
      assert.match(JSON.stringify(after), /Count: 1/);
      const screenshot = await invoke('screenshot_page', { pageId: id });
      const image = screenshot.content.find(c => c.type === 'image');
      assert.ok(image, JSON.stringify(screenshot));
      report.browser.screenshot = { mimeType: image.mimeType, bytes: Buffer.from(image.data, 'base64').length };
      report.browser.interaction = 'Opened loopback fixture, read initial count, clicked Increment, observed Count: 1, captured native screenshot.';
    });
    const controller = vscode.tests.createTestController('vs-control-fixture', 'VS Control fixture tests');
    disposables.push(controller);
    const passing = controller.createTestItem('passing', 'VS Control passing test', vscode.Uri.file(file));
    passing.range = new vscode.Range(0, 0, 0, 1);
    const failing = controller.createTestItem('failing', 'VS Control failing test', vscode.Uri.file(file));
    failing.range = new vscode.Range(1, 0, 1, 1);
    controller.items.add(passing); controller.items.add(failing);
    let runs = 0;
    const profile = controller.createRunProfile('Run', vscode.TestRunProfileKind.Run, request => {
      runs++;
      const run = controller.createTestRun(request);
      for (const item of request.include || [passing, failing]) {
        if (item.id === 'passing') run.passed(item, 1);
        else run.failed(item, new vscode.TestMessage('EXPECTED_FIXTURE_FAILURE: 2 does not equal 3'), 1);
      }
      run.end();
    }, true);
    disposables.push(profile);
    // Test item diffs are batched by the extension host before the workbench
    // can discover them. Allow the newly created fixture to be published.
    await new Promise(resolve => setTimeout(resolve, 600));
    await check('native runTests actually runs a real TestController and returns failures', async () => {
      assert.ok(catalog.some(t => t.name === 'runTests'), 'runTests available');
      const result = await client.call('vscode_invoke_tool', { name: 'runTests', input: { files: [file] } }, signal());
      assert.ok(runs > 0, JSON.stringify(result));
      assert.match(JSON.stringify(result), /EXPECTED_FIXTURE_FAILURE/);
      report.testRun = result;
    });
    await check('native testFailure reads Test Explorer failure state', async () => {
      const result = await client.call('vscode_invoke_tool', { name: 'testFailure' }, signal());
      assert.match(JSON.stringify(result), /EXPECTED_FIXTURE_FAILURE/);
    });
    await check('Test Explorer UI command is dispatched through the bridge', async () => {
      const result = await client.call('vscode_command', { command: 'workbench.view.extension.test' }, signal());
      assert.ok(!result.isError, JSON.stringify(result));
      assert.equal(JSON.parse(result.content[0].text).dispatched, 'workbench.view.extension.test');
    });
    await check('element picker is registered, reports readiness and holds nothing yet', async () => {
      assert.ok((await vscode.commands.getCommands(true)).includes('vsControl.pickElement'));
      const capabilities = JSON.parse((await client.call('vscode_capabilities', {}, signal())).content[0].text);
      assert.equal(typeof capabilities.elementPicker.ready, 'boolean', JSON.stringify(capabilities.elementPicker));
      const held = JSON.parse((await client.call('vscode_picked_element', {}, signal())).content[0].text);
      assert.equal(held.picked, false);
    });
    await check('real task execution reports its process exit code', async () => {
      const task = new vscode.Task({ type: 'vs-control-fixture' }, vscode.TaskScope.Workspace, 'Fixture task', 'VS Control', new vscode.ProcessExecution('/usr/bin/true'));
      disposables.push(vscode.tasks.registerTaskProvider('vs-control-fixture', { provideTasks: () => [task], resolveTask: t => t }));
      const tasks = JSON.parse((await client.call('vscode_tasks', {}, signal())).content[0].text).tasks;
      const selected = tasks.find(t => t.name === 'Fixture task'); assert.ok(selected);
      const execution = JSON.parse((await client.call('vscode_run_task', { id: selected.id }, signal())).content[0].text);
      let status;
      const deadline = Date.now() + 10000;
      do {
        await new Promise(resolve => setTimeout(resolve, 100));
        status = JSON.parse((await client.call('vscode_task_status', { id: execution.id }, signal())).content[0].text);
      } while (status.exitCode === undefined && Date.now() < deadline);
      assert.equal(status.exitCode, 0, JSON.stringify(status));
    });
    report.passed = true;
  } catch (error) { report.passed = false; report.error = error.stack; throw error; }
  finally {
    for (const disposable of disposables.reverse()) disposable.dispose();
    if (process.env.VS_CONTROL_TEST_REPORT) await fs.writeFile(process.env.VS_CONTROL_TEST_REPORT, JSON.stringify(report, null, 2));
  }
};
