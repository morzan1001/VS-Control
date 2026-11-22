'use strict';
const vscode = require('vscode');
const { startBridge } = require('./bridge.cjs');
const { createAdapter } = require('./adapter.cjs');
const { createPicker } = require('./picker.cjs');
let bridge;
let lifecycle = Promise.resolve();
function activate(context) {
  const output = vscode.window.createOutputChannel('VS Control');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
  status.command = 'vsControl.status';
  const picker = createPicker(vscode, { output });
  const adapter = createAdapter(vscode, context.subscriptions, { picker });
  const workspaces = () => (vscode.workspace.workspaceFolders || []).map(f => f.uri.fsPath);
  const stop = async () => { const current = bridge; bridge = undefined; if (current) await current.stop(); status.text = '$(debug-disconnect) VS Control'; status.tooltip = 'VS Control bridge stopped'; };
  const restart = async () => {
    await stop();
    if (!vscode.workspace.isTrusted || !vscode.workspace.getConfiguration('vsControl').get('enabled', true)) return;
    bridge = await startBridge(adapter, { workspaces: workspaces(), vscodeVersion: vscode.version });
    status.text = '$(plug) VS Control';
    status.tooltip = 'Local bridge for Claude Code is running';
    output.appendLine(`Bridge started for window ${bridge.id}; VS Code ${vscode.version}.`);
  };
  const queue = fn => { lifecycle = lifecycle.then(fn).catch(error => { output.appendLine(`Bridge error: ${error.message}`); status.text = '$(error) VS Control'; status.tooltip = error.message; }); return lifecycle; };
  context.subscriptions.push(output, status,
    vscode.commands.registerCommand('vsControl.restart', () => queue(restart)),
    vscode.commands.registerCommand('vsControl.stop', () => queue(stop)),
    vscode.commands.registerCommand('vsControl.pickElement', () => picker.pick()),
    vscode.commands.registerCommand('vsControl.status', async () => {
      output.appendLine(JSON.stringify({ connected: !!bridge, windowId: bridge?.id, version: vscode.version, workspaces: workspaces(), tools: (await adapter.list()).map(t => t.name) }, null, 2));
      output.show(true);
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => queue(async () => { if (bridge) await bridge.updateWorkspaces(workspaces()); })),
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('vsControl.enabled')) queue(restart); }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => queue(restart)),
    { dispose: () => { void queue(stop); } }
  );
  status.show();
  return queue(restart).then(() => ({ adapter, picker, getWindowId: () => bridge?.id }));
}
async function deactivate() { await lifecycle; if (bridge) { await bridge.stop(); bridge = undefined; } }
module.exports = { activate, deactivate };
