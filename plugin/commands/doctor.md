---
description: Diagnose the VS Control connection and available native VS Code tools
---

Call `vscode_connection`, then `vscode_windows` if needed. If connected, call `vscode_capabilities` and `vscode_tools` with `includeSchemas: false`. Report the selected workspace, VS Code version, whether `workbench.browser.enableChatTools` is on, available browser/testing tools, whether the element picker is ready (`elementPicker` in `vscode_capabilities`, including whether `claude-vscode.addToChat` is available) and any concrete missing prerequisite. Do not change settings, install anything, invoke browser interactions, or run tests as part of this diagnostic command.
