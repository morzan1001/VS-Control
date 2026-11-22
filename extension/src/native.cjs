'use strict';
const { createHash } = require('node:crypto');

// Exact IDs, not descriptions or a broad regex: a third-party tool cannot grant
// itself access merely by claiming to be a browser tool in its description.
const GROUPS = {
  browser: ['open_browser_page', 'list_browser_pages', 'read_page', 'screenshot_page', 'navigate_page', 'click_element', 'type_in_page', 'hover_element', 'drag_element', 'handle_dialog', 'run_playwright_code', 'close_browser_page', 'openBrowserPage', 'listBrowserPages', 'readPage', 'screenshotPage', 'navigatePage', 'clickElement', 'typeInPage', 'hoverElement', 'dragElement', 'handleDialog', 'runPlaywrightCode'],
  testing: ['runTests', 'testFailure', 'runTestsWithCoverage', 'copilot_runTests', 'copilot_testFailure', 'copilot_runTestsWithCoverage'],
  terminal: ['run_in_terminal', 'get_terminal_output', 'terminal_last_command', 'terminal_selection', 'create_and_run_task', 'run_task', 'get_task_output', 'send_to_terminal', 'kill_terminal'],
  notebook: ['edit_notebook_file', 'run_notebook_cell', 'read_notebook_cell_output', 'get_notebook_summary'],
  code: ['read_file', 'list_dir', 'file_search', 'grep_search', 'semantic_search', 'list_code_usages', 'get_errors', 'get_changed_files', 'rename', 'usages', 'vscode_listCodeUsages', 'vscode_renameSymbol']
};
function groupFor(name) { return Object.keys(GROUPS).find(g => GROUPS[g].includes(name)) || 'other'; }
function recursive(name) { return /^mcp[_.-]|^vs_control[_.-]|^vscode_native_/i.test(name); }
function allowed(tool, settings) {
  return !recursive(tool.name) && ((settings.groups || []).includes(groupFor(tool.name)) || (settings.additional || []).includes(tool.name));
}
function mcpName(name) {
  // Always hash: avoids a collision between an escaped name and a literal one.
  return `vscode_native_${name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 39)}_${createHash('sha256').update(name).digest('hex').slice(0, 8)}`;
}
function definitions(tools, settings) {
  return tools.filter(t => allowed(t, settings)).map(t => ({
    name: mcpName(t.name), description: `[Native VS Code ${groupFor(t.name)} tool: ${t.name}] ${t.description}`,
    inputSchema: t.inputSchema || { type: 'object', properties: {} }
  }));
}
// Prompt-TSX parts arrive as their JSON tree: pieces (type 1) wrap text (type 2)
// and opaque values (type 3). Join the text the way the renderer does; a tree
// holding anything else is not flattened.
function promptText(node) {
  let out = '';
  const walk = n => {
    if (n?.type === 2 && typeof n.text === 'string') {
      if (n.lineBreakBefore && out && !out.endsWith('\n')) out += '\n';
      out += n.text; return true;
    }
    return n?.type === 1 && Array.isArray(n.children) && n.children.every(walk);
  };
  return walk(node) ? out : undefined;
}
function convertResult(result) {
  const content = [];
  let unsupported = false;
  let flat;
  for (const part of result?.content || []) {
    if (typeof part?.value === 'string') content.push({ type: 'text', text: part.value });
    else if (part?.data instanceof Uint8Array && typeof part.mimeType === 'string') {
      if (part.mimeType.startsWith('image/')) content.push({ type: 'image', mimeType: part.mimeType, data: Buffer.from(part.data).toString('base64') });
      else if (part.mimeType.startsWith('text/') || part.mimeType === 'application/json') content.push({ type: 'text', text: Buffer.from(part.data).toString('utf8') });
      else { unsupported = true; content.push({ type: 'text', text: `Unsupported native binary result: ${part.mimeType}.` }); }
    } else if (typeof (flat = promptText(part?.value?.node)) === 'string') content.push({ type: 'text', text: flat });
    else {
      // A tree with non-text parts, or an unknown part. Preserve it explicitly
      // instead of silently dropping failure messages, references or images.
      unsupported = true;
      content.push({ type: 'text', text: `Native result requires an unsupported renderer (e.g. Prompt-TSX). Raw data follows; this is not a rendered result:\n${JSON.stringify(part)}` });
    }
  }
  if (!content.length) content.push({ type: 'text', text: 'Native tool returned no content. This alone does not establish success.' });
  return { content, ...(unsupported ? { isError: true } : {}) };
}
module.exports = { GROUPS, groupFor, allowed, recursive, mcpName, definitions, promptText, convertResult };
